import logging
from typing import List, Optional, Any, Dict
from uuid import UUID
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

from backend.app.config import settings
from backend.app.database import get_db, SessionLocal
from backend.app.models.chat import ChatSession
from backend.app.models.artifact import Artifact, utc_now
from backend.app.schemas.common import APIResponse
from backend.app.schemas.artifact import (
    ArtifactCreateRequest,
    ArtifactResponse,
    ArtifactSummaryResponse,
)
from backend.app.schemas.chat import VerifiedCitation
from backend.app.services.retrieval import get_retriever
from backend.app.services.html_sanitizer import validate_and_sanitize_html
from backend.app.services.agent_client import (
    get_agent_client,
    AgentClient,
    AgentConnectionError,
    AgentTimeoutError,
    AgentResponseError,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sessions", tags=["Artifacts"])


def format_artifact_response(artifact: Artifact) -> ArtifactResponse:
    """Format an Artifact database model into a validated ArtifactResponse schema."""
    formatted_citations = []
    if artifact.citations and isinstance(artifact.citations, list):
        for c in artifact.citations:
            try:
                formatted_citations.append(
                    VerifiedCitation(
                        chunk_id=UUID(str(c["chunk_id"])),
                        transcript_id=UUID(str(c["transcript_id"])) if c.get("transcript_id") else None,
                        episode_slug=c.get("episode_slug", ""),
                        episode_title=c.get("episode_title", ""),
                        guest=c.get("guest"),
                        speaker=c.get("speaker"),
                        source_url=c.get("source_url"),
                        start_timestamp=c.get("start_timestamp"),
                        end_timestamp=c.get("end_timestamp"),
                        snippet=c.get("snippet"),
                    )
                )
            except Exception as parse_err:
                logger.warning(f"Failed to parse citation record for artifact {artifact.id}: {parse_err}")

    return ArtifactResponse(
        artifact_id=artifact.id,
        session_id=artifact.session_id,
        title=artifact.title,
        artifact_type=artifact.artifact_type,
        source_content=artifact.source_content,
        generation_status=artifact.generation_status,
        validation_results=artifact.validation_results or {},
        citations=formatted_citations,
        provider=artifact.provider,
        model=artifact.model,
        error=artifact.error,
        meta_info=artifact.meta_info or {},
        created_at=artifact.created_at,
        updated_at=artifact.updated_at,
    )


def get_session_factory():
    """Dependency returning the database session factory."""
    return SessionLocal


async def run_artifact_generation_job(
    artifact_id: UUID,
    session_id: UUID,
    title: str,
    artifact_type: str,
    instructions: str,
    topic: Optional[str],
    candidate_passages: List[Any],
    provider: str,
    model: Optional[str],
    agent_client_override: Optional[AgentClient] = None,
    session_factory: Any = None,
):
    """Background task executing artifact generation and updating PostgreSQL."""
    factory = session_factory or SessionLocal
    db = factory()
    agent_client = agent_client_override or get_agent_client()

    try:
        retrieved_map = {}
        passages_payload = []
        for r in candidate_passages:
            chunk_key = str(r.chunk_id).lower()
            retrieved_map[chunk_key] = r
            passages_payload.append({
                "chunk_id": str(r.chunk_id),
                "transcript_id": str(r.transcript_id) if getattr(r, "transcript_id", None) else None,
                "episode_slug": getattr(r, "episode_slug", ""),
                "episode_title": getattr(r, "episode_title", ""),
                "guest": getattr(r, "guest", None),
                "speaker": getattr(r, "speaker", None),
                "source_url": getattr(r, "source_url", None),
                "start_timestamp": getattr(r, "start_timestamp", None),
                "end_timestamp": getattr(r, "end_timestamp", None),
                "content": getattr(r, "content", ""),
            })

        agent_data = await agent_client.generate_artifact(
            session_id=session_id,
            title=title,
            artifact_type=artifact_type,
            instructions=instructions,
            topic=topic,
            candidate_passages=passages_payload,
            provider=provider,
            model=model,
            timeout=300.0,
        )

        raw_citations = agent_data.get("citations", [])
        verified_citations = []
        seen_chunks = set()
        for cite in raw_citations:
            raw_chunk_id = str(cite.get("chunk_id", "")).lower()
            if not raw_chunk_id or raw_chunk_id not in retrieved_map:
                logger.warning(
                    f"Rejecting unverified/fabricated citation chunk_id='{raw_chunk_id}' for artifact {artifact_id}"
                )
                continue
            if raw_chunk_id in seen_chunks:
                continue
            seen_chunks.add(raw_chunk_id)
            matching_record = retrieved_map[raw_chunk_id]
            verified_citations.append({
                "chunk_id": str(matching_record.chunk_id),
                "transcript_id": str(matching_record.transcript_id) if getattr(matching_record, "transcript_id", None) else None,
                "episode_slug": getattr(matching_record, "episode_slug", ""),
                "episode_title": getattr(matching_record, "episode_title", ""),
                "guest": getattr(matching_record, "guest", None),
                "speaker": getattr(matching_record, "speaker", None),
                "source_url": getattr(matching_record, "source_url", None),
                "start_timestamp": getattr(matching_record, "start_timestamp", None),
                "end_timestamp": getattr(matching_record, "end_timestamp", None),
                "snippet": getattr(matching_record, "content", "")[:350],
            })

        source_content = agent_data.get("source_content", "") or ""
        val_results = {}
        status = "completed"
        err_msg = None

        if artifact_type == "html":
            sec_val = validate_and_sanitize_html(source_content)
            val_results = sec_val.to_dict()
            if not sec_val.is_valid:
                status = "validation_failed"
                err_msg = f"HTML failed security validation: {'; '.join(sec_val.errors)}"
                logger.warning(f"Artifact {artifact_id} failed HTML security validation: {sec_val.errors}")
            else:
                source_content = sec_val.sanitized_content or source_content
        else:
            val_results = {"is_valid": True, "errors": [], "warnings": []}

        # Update database record
        art_record = db.query(Artifact).filter(Artifact.id == artifact_id).first()
        if art_record:
            art_record.source_content = source_content
            art_record.generation_status = status
            art_record.validation_results = val_results
            art_record.citations = verified_citations
            art_record.error = err_msg
            art_record.model = agent_data.get("model", model)
            art_record.meta_info = {
                **(art_record.meta_info or {}),
                "duration_ms": agent_data.get("duration_ms"),
                "generator": "pi-coding-agent",
            }
            art_record.updated_at = utc_now()
            db.commit()
            logger.info(f"Artifact {artifact_id} generation completed with status '{status}'")

    except (AgentTimeoutError, AgentConnectionError, AgentResponseError) as a_err:
        logger.error(f"Agent error generating artifact {artifact_id}: {a_err}")
        try:
            art_record = db.query(Artifact).filter(Artifact.id == artifact_id).first()
            if art_record:
                art_record.generation_status = "failed"
                art_record.error = a_err.message
                art_record.updated_at = utc_now()
                db.commit()
        except Exception as db_e:
            logger.error(f"Failed to persist failure status for artifact {artifact_id}: {db_e}")
    except Exception as exc:
        logger.exception(f"Unexpected error in artifact generation background job {artifact_id}: {exc}")
        try:
            art_record = db.query(Artifact).filter(Artifact.id == artifact_id).first()
            if art_record:
                art_record.generation_status = "failed"
                art_record.error = "An internal error occurred during artifact generation."
                art_record.updated_at = utc_now()
                db.commit()
        except Exception as db_e:
            logger.error(f"Failed to record unexpected failure for artifact {artifact_id}: {db_e}")
    finally:
        db.close()


@router.post(
    "/{session_id}/artifacts",
    response_model=APIResponse[ArtifactResponse],
    status_code=status.HTTP_202_ACCEPTED,
    summary="Generate an HTML or Markdown artifact",
)
async def create_artifact(
    session_id: UUID,
    payload: ArtifactCreateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    agent_client: AgentClient = Depends(get_agent_client),
    session_factory: Any = Depends(get_session_factory),
):
    """Start asynchronous artifact generation grounded in Lenny's Podcast knowledge."""
    # 1. Verify session exists
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Chat session '{session_id}' not found",
        )

    # 2. Check for duplicate in-flight generation
    active_art = (
        db.query(Artifact)
        .filter(
            Artifact.session_id == session_id,
            Artifact.generation_status.in_(["pending", "generating"]),
        )
        .first()
    )
    if active_art:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"An artifact generation job ({active_art.id}) is already in progress for this session.",
        )

    # 3. Provider validation
    provider = payload.provider or settings.LLM_PROVIDER
    if provider not in ["ollama", "anthropic"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported provider '{provider}'. Must be 'ollama' or 'anthropic'.",
        )

    if provider == "anthropic" and not settings.ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Anthropic API key is not configured in environment (ANTHROPIC_API_KEY).",
        )

    model = payload.model
    if not model:
        model = settings.ANTHROPIC_MODEL if provider == "anthropic" else settings.OLLAMA_MODEL

    # 4. Transcript evidence retrieval (grounding)
    candidate_passages = []
    search_query = payload.topic or payload.title or payload.instructions
    try:
        retriever = get_retriever(db)
        candidate_passages = retriever.search(query=search_query, limit=5)
        logger.info(f"Retrieved {len(candidate_passages)} evidence passages for artifact query '{search_query[:50]}'")
    except Exception as ret_err:
        logger.warning(f"Retrieval service unavailable or encountered error: {ret_err}")

    # 5. Create initial record in database
    new_artifact = Artifact(
        session_id=session_id,
        title=payload.title,
        artifact_type=payload.artifact_type,
        generation_status="generating",
        provider=provider,
        model=model,
        meta_info={
            "instructions": payload.instructions,
            "topic": payload.topic,
        },
    )
    db.add(new_artifact)
    db.commit()
    db.refresh(new_artifact)

    # 6. Dispatch background task
    background_tasks.add_task(
        run_artifact_generation_job,
        artifact_id=new_artifact.id,
        session_id=session_id,
        title=payload.title,
        artifact_type=payload.artifact_type,
        instructions=payload.instructions,
        topic=payload.topic,
        candidate_passages=candidate_passages,
        provider=provider,
        model=model,
        agent_client_override=agent_client,
        session_factory=session_factory,
    )

    return APIResponse(
        success=True,
        message=f"{payload.artifact_type.upper()} artifact generation started",
        data=format_artifact_response(new_artifact),
    )


@router.get(
    "/{session_id}/artifacts",
    response_model=APIResponse[List[ArtifactSummaryResponse]],
    summary="List artifacts in a session",
)
async def list_artifacts(
    session_id: UUID,
    db: Session = Depends(get_db),
):
    """Retrieve all artifacts generated within a specific chat session."""
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Chat session '{session_id}' not found",
        )

    artifacts = (
        db.query(Artifact)
        .filter(Artifact.session_id == session_id)
        .order_by(Artifact.created_at.desc())
        .all()
    )

    summaries = [
        ArtifactSummaryResponse(
            artifact_id=a.id,
            session_id=a.session_id,
            title=a.title,
            artifact_type=a.artifact_type,
            generation_status=a.generation_status,
            provider=a.provider,
            created_at=a.created_at,
            updated_at=a.updated_at,
        )
        for a in artifacts
    ]

    return APIResponse(
        success=True,
        message=f"Retrieved {len(summaries)} artifacts for session",
        data=summaries,
    )


@router.get(
    "/{session_id}/artifacts/{artifact_id}",
    response_model=APIResponse[ArtifactResponse],
    summary="Get an artifact by ID",
)
async def get_artifact(
    session_id: UUID,
    artifact_id: UUID,
    db: Session = Depends(get_db),
):
    """Retrieve complete artifact details, source code, status, and verified citations."""
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Chat session '{session_id}' not found",
        )

    artifact = (
        db.query(Artifact)
        .filter(
            Artifact.id == artifact_id,
            Artifact.session_id == session_id,
        )
        .first()
    )
    if not artifact:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Artifact '{artifact_id}' not found in session '{session_id}'",
        )

    return APIResponse(
        success=True,
        message="Artifact retrieved successfully",
        data=format_artifact_response(artifact),
    )

import logging
from typing import List, Optional, Any
from uuid import UUID
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

from backend.app.config import settings
from backend.app.database import get_db, SessionLocal
from backend.app.models.chat import ChatSession
from backend.app.models.essay import Essay, utc_now
from backend.app.schemas.common import APIResponse
from backend.app.schemas.essay import (
    EssayGenerateRequest,
    EssayResponse,
    EssaySummaryResponse,
)
from backend.app.schemas.chat import VerifiedCitation
from backend.app.services.retrieval import get_retriever
from backend.app.services.agent_client import (
    get_agent_client,
    AgentClient,
    AgentConnectionError,
    AgentTimeoutError,
    AgentResponseError,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sessions", tags=["Ship 30 Essays"])


def format_essay_response(essay: Essay) -> EssayResponse:
    """Format an Essay database model into a validated EssayResponse schema."""
    formatted_citations = []
    if essay.citations and isinstance(essay.citations, list):
        for c in essay.citations:
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
                logger.warning(f"Failed to parse citation record for essay {essay.id}: {parse_err}")

    return EssayResponse(
        essay_id=essay.id,
        session_id=essay.session_id,
        topic=essay.topic,
        audience=essay.audience,
        intended_outcome=essay.intended_outcome,
        proven_approach=essay.proven_approach,
        four_a_path=essay.four_a_path,
        target_word_count=essay.target_word_count,
        title=essay.title,
        markdown=essay.markdown,
        word_count=essay.word_count,
        generation_status=essay.generation_status,
        validation_results=essay.validation_results or {},
        citations=formatted_citations,
        provider=essay.provider,
        model=essay.model,
        error=essay.error,
        created_at=essay.created_at,
        updated_at=essay.updated_at,
    )


def get_session_factory():
    """Dependency returning the database session factory."""
    return SessionLocal


async def run_essay_generation_job(
    essay_id: UUID,
    session_id: UUID,
    topic: str,
    audience: Optional[str],
    intended_outcome: Optional[str],
    proven_approach: Optional[str],
    four_a_path: Optional[str],
    target_word_count: int,
    candidate_passages: List[Any],
    provider: str,
    model: Optional[str],
    agent_client_override: Optional[AgentClient] = None,
    session_factory: Any = None,
):
    """Background task executing the 5-section Ship 30 generation and updating PostgreSQL."""
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
                "transcript_id": str(r.transcript_id) if r.transcript_id else None,
                "episode_slug": r.episode_slug,
                "episode_title": r.episode_title,
                "guest": r.guest,
                "speaker": r.speaker,
                "source_url": r.source_url,
                "start_timestamp": r.start_timestamp,
                "end_timestamp": r.end_timestamp,
                "content": r.content,
            })

        agent_data = await agent_client.generate_essay(
            session_id=session_id,
            topic=topic,
            audience=audience,
            intended_outcome=intended_outcome,
            proven_approach=proven_approach,
            four_a_path=four_a_path,
            target_word_count=target_word_count,
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
                    f"Rejecting unverified/fabricated citation chunk_id='{raw_chunk_id}' for essay {essay_id}"
                )
                continue
            if raw_chunk_id in seen_chunks:
                continue
            seen_chunks.add(raw_chunk_id)
            evidence = retrieved_map[raw_chunk_id]
            verified_citations.append({
                "chunk_id": str(evidence.chunk_id),
                "transcript_id": str(evidence.transcript_id) if evidence.transcript_id else None,
                "episode_slug": evidence.episode_slug,
                "episode_title": evidence.episode_title,
                "guest": evidence.guest,
                "speaker": evidence.speaker,
                "source_url": evidence.source_url,
                "start_timestamp": evidence.start_timestamp,
                "end_timestamp": evidence.end_timestamp,
                "snippet": evidence.content[:200] + "..." if len(evidence.content) > 200 else evidence.content,
            })

        essay = db.query(Essay).filter(Essay.id == essay_id).first()
        if essay:
            essay.title = agent_data.get("title")
            essay.markdown = agent_data.get("markdown")
            essay.word_count = agent_data.get("word_count")
            val_results = agent_data.get("validation_results", {})
            essay.validation_results = val_results
            essay.citations = verified_citations
            essay.provider = agent_data.get("provider", provider)
            essay.model = agent_data.get("model", model)
            gen_status = agent_data.get("generation_status", "completed")
            is_valid = val_results.get("isValid", True) if isinstance(val_results, dict) else True

            if not is_valid:
                essay.generation_status = "validation_failed"
                errors = val_results.get("errors", []) if isinstance(val_results, dict) else []
                essay.error = "; ".join(str(e) for e in errors) if errors else "Essay failed deterministic validation checks."
            elif gen_status in ["completed", "success"]:
                essay.generation_status = "completed"
                essay.error = None
            else:
                essay.generation_status = gen_status
                errors = val_results.get("errors", []) if isinstance(val_results, dict) else []
                essay.error = "; ".join(str(e) for e in errors) if errors else None

            essay.updated_at = utc_now()
            db.commit()
    except AgentTimeoutError as exc:
        logger.error(f"Essay generation timed out for {essay_id}: {exc}")
        essay = db.query(Essay).filter(Essay.id == essay_id).first()
        if essay:
            essay.generation_status = "failed"
            essay.error = "Essay generation timed out after 300 seconds."
            essay.updated_at = utc_now()
            db.commit()
    except Exception as exc:
        logger.error(f"Essay generation failed for {essay_id}: {exc}")
        essay = db.query(Essay).filter(Essay.id == essay_id).first()
        if essay:
            essay.generation_status = "failed"
            essay.error = f"Essay generation failed: {str(exc)}"
            essay.updated_at = utc_now()
            db.commit()
    finally:
        db.close()


@router.post(
    "/{session_id}/essays",
    response_model=APIResponse[EssayResponse],
    status_code=status.HTTP_202_ACCEPTED,
    summary="Start generation of a Ship 30 for 30 essay",
)
async def create_essay(
    session_id: UUID,
    request: EssayGenerateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    agent_client: AgentClient = Depends(get_agent_client),
    session_factory: Any = Depends(get_session_factory),
):
    """Start asynchronous generation of a ~1,250-word Ship 30 for 30 essay grounded in Lenny's Podcast."""
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Chat session '{session_id}' not found",
        )

    target_provider = request.provider or settings.LLM_PROVIDER
    if target_provider not in ["ollama", "anthropic"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported provider '{target_provider}'. Supported: ollama, anthropic",
        )

    if target_provider == "anthropic" and not settings.ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Anthropic API key is not configured in environment (ANTHROPIC_API_KEY).",
        )

    target_model = request.model or (
        settings.ANTHROPIC_MODEL if target_provider == "anthropic" else settings.OLLAMA_MODEL
    )

    # Avoid duplicate generation for identical topic currently in progress
    existing_in_progress = (
        db.query(Essay)
        .filter(
            Essay.session_id == session_id,
            Essay.topic == request.topic.strip(),
            Essay.generation_status == "generating",
        )
        .first()
    )
    if existing_in_progress:
        return APIResponse(
            success=True,
            message="Essay generation is already in progress for this topic in this session.",
            data=format_essay_response(existing_in_progress),
        )

    # Retrieve candidate transcript evidence
    try:
        retriever = get_retriever(db)
        search_results = retriever.search(query=request.topic.strip(), limit=8)
    except Exception as e:
        logger.error(f"Retrieval error during essay generation request: {e}")
        search_results = []

    # If insufficient evidence, fail-closed immediately with structured outcome
    if len(search_results) == 0:
        new_essay = Essay(
            session_id=session_id,
            topic=request.topic.strip(),
            audience=request.audience,
            intended_outcome=request.intended_outcome,
            proven_approach=request.proven_approach,
            four_a_path=request.four_a_path,
            target_word_count=request.target_word_count or 1250,
            generation_status="insufficient_evidence",
            validation_results={
                "isValid": False,
                "errors": [
                    "Insufficient verified transcript evidence. Cannot generate essay without supporting passages."
                ],
                "warnings": [],
            },
            citations=[],
            provider=target_provider,
            model=target_model,
            error="Insufficient transcript evidence found in Lenny's Podcast index.",
        )
        db.add(new_essay)
        db.commit()
        db.refresh(new_essay)

        return APIResponse(
            success=True,
            message="Insufficient verified transcript evidence to ground the requested essay.",
            data=format_essay_response(new_essay),
        )

    # Create new generating essay record
    new_essay = Essay(
        session_id=session_id,
        topic=request.topic.strip(),
        audience=request.audience,
        intended_outcome=request.intended_outcome,
        proven_approach=request.proven_approach,
        four_a_path=request.four_a_path,
        target_word_count=request.target_word_count or 1250,
        generation_status="generating",
        validation_results={},
        citations=[],
        provider=target_provider,
        model=target_model,
        error=None,
    )
    db.add(new_essay)
    db.commit()
    db.refresh(new_essay)

    # Launch non-blocking background drafting job
    background_tasks.add_task(
        run_essay_generation_job,
        essay_id=new_essay.id,
        session_id=session_id,
        topic=new_essay.topic,
        audience=new_essay.audience,
        intended_outcome=new_essay.intended_outcome,
        proven_approach=new_essay.proven_approach,
        four_a_path=new_essay.four_a_path,
        target_word_count=new_essay.target_word_count,
        candidate_passages=search_results,
        provider=target_provider,
        model=target_model,
        agent_client_override=agent_client,
        session_factory=session_factory,
    )

    return APIResponse(
        success=True,
        message="Ship 30 essay generation initiated.",
        data=format_essay_response(new_essay),
    )


def is_stale_generating(essay: Essay, max_seconds: int = 360) -> bool:
    """Check if an in-progress essay job exceeded the maximum execution window."""
    if essay.generation_status != "generating" or not essay.created_at:
        return False
    now = utc_now()
    created = essay.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return (now - created).total_seconds() > max_seconds


@router.get(
    "/{session_id}/essays/{essay_id}",
    response_model=APIResponse[EssayResponse],
    summary="Get status and content of a specific Ship 30 essay",
)
def get_essay(session_id: UUID, essay_id: UUID, db: Session = Depends(get_db)):
    """Retrieve essay status, markdown, citations, and validation results."""
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Chat session '{session_id}' not found",
        )

    essay = db.query(Essay).filter(Essay.id == essay_id, Essay.session_id == session_id).first()
    if not essay:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Essay '{essay_id}' not found in session '{session_id}'",
        )

    # Lightweight stale-job self-healing recovery:
    # If a generating job exceeded 360s (e.g. server restart or killed background worker), mark failed.
    if is_stale_generating(essay):
        essay.generation_status = "failed"
        essay.error = "Generation job timed out or was interrupted by a server restart. Please trigger generation again."
        essay.updated_at = utc_now()
        db.commit()
        db.refresh(essay)

    return APIResponse(
        success=True,
        message="Essay retrieved successfully.",
        data=format_essay_response(essay),
    )


@router.get(
    "/{session_id}/essays",
    response_model=APIResponse[List[EssaySummaryResponse]],
    summary="List all essays generated for a session",
)
def list_essays(session_id: UUID, db: Session = Depends(get_db)):
    """List all essays generated within a specific chat session."""
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Chat session '{session_id}' not found",
        )

    essays = (
        db.query(Essay)
        .filter(Essay.session_id == session_id)
        .order_by(Essay.created_at.desc())
        .all()
    )

    # Recover any stale generating jobs
    modified = False
    now = utc_now()
    for e in essays:
        if is_stale_generating(e):
            e.generation_status = "failed"
            e.error = "Generation job timed out or was interrupted by a server restart. Please trigger generation again."
            e.updated_at = now
            modified = True
    if modified:
        db.commit()

    summary_list = [
        EssaySummaryResponse(
            essay_id=e.id,
            session_id=e.session_id,
            topic=e.topic,
            title=e.title,
            word_count=e.word_count,
            generation_status=e.generation_status,
            provider=e.provider,
            created_at=e.created_at,
        )
        for e in essays
    ]

    return APIResponse(
        success=True,
        message="Session essays retrieved successfully.",
        data=summary_list,
    )

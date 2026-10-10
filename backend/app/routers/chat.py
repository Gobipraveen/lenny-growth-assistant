from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
from typing import List, Optional
from uuid import UUID
import logging
import uuid

from backend.app.config import settings
from backend.app.database import get_db
from backend.app.models.chat import ChatSession, ChatMessage, utc_now
from backend.app.schemas.common import APIResponse, ErrorResponse
from backend.app.schemas.chat import (
    ChatSessionCreate,
    ChatSessionResponse,
    ChatSessionWithMessages,
    ChatMessageCreate,
    ChatMessageResponse,
    ChatTurnRequest,
    ChatTurnResponse,
    VerifiedCitation,
    ChatStatusResponse,
    ProviderStatusInfo,
)
from backend.app.services.retrieval import get_retriever
from backend.app.services.agent_client import (
    get_agent_client,
    AgentClient,
    AgentConnectionError,
    AgentTimeoutError,
    AgentResponseError,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sessions", tags=["Chat Sessions"])


@router.get(
    "/status",
    response_model=APIResponse[ChatStatusResponse],
    status_code=status.HTTP_200_OK,
    summary="Get chat and model provider status",
)
async def get_chat_status(agent_client: AgentClient = Depends(get_agent_client)):
    """Return status of LLM providers and agent service availability."""
    health_data = await agent_client.check_health()
    agent_online = health_data.get("status") == "ok"

    ollama_info = health_data.get("providers", {}).get("ollama", {})
    ollama_avail = ollama_info.get("available", False)

    anthropic_info = health_data.get("providers", {}).get("anthropic", {})
    anthropic_configured = bool(settings.ANTHROPIC_API_KEY) or anthropic_info.get("configured", False)

    providers = [
        ProviderStatusInfo(
            provider="ollama",
            available=ollama_avail,
            model=settings.OLLAMA_MODEL,
            is_default=settings.LLM_PROVIDER == "ollama",
            details="Local Ollama instance" if ollama_avail else "Ollama offline or model not loaded",
        ),
        ProviderStatusInfo(
            provider="anthropic",
            available=anthropic_configured,
            model=settings.ANTHROPIC_MODEL,
            is_default=settings.LLM_PROVIDER == "anthropic",
            details="Cloud Anthropic API (configured)" if anthropic_configured else "API key not configured",
        ),
    ]

    return APIResponse(
        success=True,
        message="Provider status retrieved",
        data=ChatStatusResponse(
            providers=providers,
            active_provider=settings.LLM_PROVIDER,
            active_model=settings.ANTHROPIC_MODEL if settings.LLM_PROVIDER == "anthropic" else settings.OLLAMA_MODEL,
            agent_service_online=agent_online,
        ),
    )


@router.post("", response_model=ChatSessionResponse, status_code=status.HTTP_201_CREATED)
def create_session(session_data: ChatSessionCreate, db: Session = Depends(get_db)):
    """Create a new chat session."""
    try:
        new_session = ChatSession(
            title=session_data.title,
            user_metadata=session_data.user_metadata or {}
        )
        db.add(new_session)
        db.commit()
        db.refresh(new_session)
        return new_session
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error creating session: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database error occurred")


@router.get("", response_model=List[ChatSessionResponse])
def list_sessions(
    skip: int = Query(0, ge=0, description="Skip the first N sessions"),
    limit: int = Query(20, ge=1, le=100, description="Limit the number of returned sessions"),
    db: Session = Depends(get_db)
):
    """List chat sessions with pagination."""
    try:
        sessions = db.query(ChatSession).order_by(ChatSession.created_at.desc()).offset(skip).limit(limit).all()
        return sessions
    except SQLAlchemyError as e:
        logger.error(f"Database error listing sessions: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database error occurred")


@router.get("/{session_id}", response_model=ChatSessionResponse)
def get_session(session_id: UUID, db: Session = Depends(get_db)):
    """Retrieve a specific chat session."""
    try:
        session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
        if not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        return session
    except SQLAlchemyError as e:
        logger.error(f"Database error retrieving session {session_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database error occurred")


@router.get("/{session_id}/messages", response_model=List[ChatMessageResponse])
def get_session_messages(
    session_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db)
):
    """Retrieve the conversation history for a specific session."""
    try:
        # First check if session exists
        session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
        if not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

        messages = db.query(ChatMessage)\
            .filter(ChatMessage.session_id == session_id)\
            .order_by(ChatMessage.created_at.asc())\
            .offset(skip).limit(limit).all()
        return messages
    except SQLAlchemyError as e:
        logger.error(f"Database error retrieving messages for session {session_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database error occurred")


@router.post("/{session_id}/messages", response_model=ChatMessageResponse, status_code=status.HTTP_201_CREATED)
def create_message(session_id: UUID, message_data: ChatMessageCreate, db: Session = Depends(get_db)):
    """Persist a message in a specific session."""
    try:
        session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
        if not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

        new_message = ChatMessage(
            session_id=session_id,
            role=message_data.role,
            content=message_data.content,
            structured_metadata=message_data.structured_metadata or {}
        )
        db.add(new_message)

        # Also update session updated_at
        session.updated_at = utc_now()

        db.commit()
        db.refresh(new_message)
        return new_message
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error creating message for session {session_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database error occurred")


@router.post(
    "/{session_id}/chat",
    response_model=APIResponse[ChatTurnResponse],
    status_code=status.HTTP_200_OK,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid input query"},
        404: {"model": ErrorResponse, "description": "Session not found"},
        502: {"model": ErrorResponse, "description": "Agent service unavailable or error"},
        504: {"model": ErrorResponse, "description": "Agent service timeout"},
        500: {"model": ErrorResponse, "description": "Internal error"},
    },
)
async def chat_turn(
    session_id: UUID,
    turn_req: ChatTurnRequest,
    db: Session = Depends(get_db),
    agent_client: AgentClient = Depends(get_agent_client),
):
    """Execute a single multi-turn conversational turn with citation verification."""
    # 1. Validate session existence
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Chat session '{session_id}' not found",
        )

    # 2. Validate user message & provider
    cleaned_message = turn_req.message.strip()
    if not cleaned_message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User message cannot be empty or contain only whitespace.",
        )

    supported_providers = {"ollama", "anthropic"}
    target_provider = (turn_req.provider or settings.LLM_PROVIDER).lower()
    if target_provider not in supported_providers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported provider '{turn_req.provider}'. Supported providers: 'ollama', 'anthropic'.",
        )

    if target_provider == "anthropic":
        if not (settings.ANTHROPIC_API_KEY and settings.ANTHROPIC_API_KEY.strip()):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Anthropic provider requested but ANTHROPIC_API_KEY is not configured in the environment.",
            )
        if not (settings.ANTHROPIC_MODEL and settings.ANTHROPIC_MODEL.strip()):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Anthropic provider requested but ANTHROPIC_MODEL is not configured in the environment.",
            )

    # 3. Read previous conversation history (ordered by created_at asc)
    prior_messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )
    history_payload = [
        {"role": m.role, "content": m.content}
        for m in prior_messages[-10:]  # Last 10 messages for bounded prompt context
    ]

    # 4. Retrieve candidate transcript evidence
    try:
        retriever = get_retriever(db)
        search_results = retriever.search(query=cleaned_message, limit=5)
    except Exception as e:
        logger.error(f"Retrieval error during chat turn: {e}")
        search_results = []

    # Map candidate passages by normalized chunk_id string for validation
    candidate_passages_payload = []
    retrieved_map = {}
    for r in search_results:
        chunk_key = str(r.chunk_id).lower()
        retrieved_map[chunk_key] = r
        candidate_passages_payload.append({
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

    trace_id = str(uuid.uuid4())

    # 5. Call Agent Service (wrapped in error handling)
    try:
        agent_data = await agent_client.execute_chat_turn(
            session_id=session_id,
            message=cleaned_message,
            history=history_payload,
            candidate_passages=candidate_passages_payload,
            provider=target_provider,
        )
    except AgentTimeoutError as e:
        logger.error(f"Agent service timed out for session {session_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Agent service timed out while generating response",
        )
    except AgentConnectionError as e:
        logger.error(f"Agent service unavailable for session {session_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Agent service is unavailable or unreachable",
        )
    except AgentResponseError as e:
        logger.error(f"Agent service returned error for session {session_id}: {e}")
        status_code = status.HTTP_400_BAD_REQUEST if e.status_code == 400 else status.HTTP_502_BAD_GATEWAY
        raise HTTPException(
            status_code=status_code,
            detail=f"Agent service returned error: {e.message}",
        )
    except Exception as e:
        logger.error(f"Unexpected error calling agent client: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to communicate with agent service",
        )

    # 6. Validate returned citations against retrieved evidence identifiers
    raw_answer = agent_data.get("answer", "")
    raw_citations = agent_data.get("citations", [])
    used_provider = agent_data.get("provider", turn_req.provider or "ollama")
    used_model = agent_data.get("model", "unknown")

    verified_citations: List[VerifiedCitation] = []
    seen_chunk_ids = set()

    for cite in raw_citations:
        raw_chunk_id = str(cite.get("chunk_id", "")).lower()
        if not raw_chunk_id or raw_chunk_id not in retrieved_map:
            # Reject fabricated citation ID
            logger.warning(
                f"Rejecting unverified/fabricated citation chunk_id='{raw_chunk_id}' for session {session_id}"
            )
            continue

        if raw_chunk_id in seen_chunk_ids:
            continue
        seen_chunk_ids.add(raw_chunk_id)

        evidence = retrieved_map[raw_chunk_id]
        verified_citations.append(
            VerifiedCitation(
                chunk_id=evidence.chunk_id,
                transcript_id=evidence.transcript_id,
                episode_slug=evidence.episode_slug,
                episode_title=evidence.episode_title,
                guest=evidence.guest,
                speaker=evidence.speaker,
                source_url=evidence.source_url,
                start_timestamp=evidence.start_timestamp,
                end_timestamp=evidence.end_timestamp,
                snippet=evidence.content[:200] + "..." if len(evidence.content) > 200 else evidence.content,
            )
        )

    # 7. Persist messages atomically to PostgreSQL
    try:
        user_msg = ChatMessage(
            session_id=session_id,
            role="user",
            content=cleaned_message,
            structured_metadata={},
        )
        db.add(user_msg)

        assistant_msg = ChatMessage(
            session_id=session_id,
            role="assistant",
            content=raw_answer,
            structured_metadata={
                "citations": [c.model_dump(mode="json") for c in verified_citations],
                "provider": used_provider,
                "model": used_model,
                "trace_id": trace_id,
            },
        )
        db.add(assistant_msg)

        session.updated_at = utc_now()
        db.commit()
        db.refresh(user_msg)
        db.refresh(assistant_msg)
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database persistence error during chat turn: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database persistence error while saving chat messages",
        )

    return APIResponse(
        success=True,
        message="Chat turn processed successfully",
        data=ChatTurnResponse(
            session_id=session_id,
            user_message_id=user_msg.id,
            assistant_message_id=assistant_msg.id,
            answer=raw_answer,
            citations=verified_citations,
            provider=used_provider,
            model=used_model,
            trace_id=trace_id,
            created_at=assistant_msg.created_at,
        ),
    )

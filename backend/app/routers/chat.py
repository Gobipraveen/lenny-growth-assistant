from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
from typing import List
from uuid import UUID
import logging

from backend.app.database import get_db
from backend.app.models.chat import ChatSession, ChatMessage
from backend.app.schemas.chat import (
    ChatSessionCreate, ChatSessionResponse, ChatSessionWithMessages,
    ChatMessageCreate, ChatMessageResponse
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sessions", tags=["Chat Sessions"])

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
        from backend.app.models.chat import utc_now
        session.updated_at = utc_now()

        db.commit()
        db.refresh(new_message)
        return new_message
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error creating message for session {session_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database error occurred")

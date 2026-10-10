import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Text, DateTime, ForeignKey, JSON, Uuid
from sqlalchemy.orm import relationship
from backend.app.database import Base


def utc_now():
    return datetime.now(timezone.utc)


class Essay(Base):
    __tablename__ = "essays"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(
        Uuid(as_uuid=True),
        ForeignKey("chat_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    topic = Column(String(500), nullable=False)
    audience = Column(String(255), nullable=True)
    intended_outcome = Column(String(500), nullable=True)
    proven_approach = Column(String(100), nullable=True)
    four_a_path = Column(String(100), nullable=True)
    target_word_count = Column(Integer, default=1250, nullable=False)

    title = Column(String(500), nullable=True)
    markdown = Column(Text, nullable=True)
    word_count = Column(Integer, nullable=True)

    generation_status = Column(
        String(50),
        nullable=False,
        default="pending",
        index=True,
    )  # 'pending', 'generating', 'completed', 'failed', 'insufficient_evidence', 'validation_failed'
    validation_results = Column(JSON, default=dict, nullable=True)
    citations = Column(JSON, default=list, nullable=True)

    provider = Column(String(50), nullable=False, default="ollama")
    model = Column(String(100), nullable=True)
    error = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    session = relationship("ChatSession", back_populates="essays")

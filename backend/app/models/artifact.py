import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, JSON, Uuid
from sqlalchemy.orm import relationship
from backend.app.database import Base


def utc_now():
    return datetime.now(timezone.utc)


class Artifact(Base):
    __tablename__ = "artifacts"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(
        Uuid(as_uuid=True),
        ForeignKey("chat_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title = Column(String(500), nullable=False)
    artifact_type = Column(String(50), nullable=False, index=True)  # 'html' or 'markdown'
    source_content = Column(Text, nullable=True)

    generation_status = Column(
        String(50),
        nullable=False,
        default="pending",
        index=True,
    )  # 'pending', 'generating', 'completed', 'failed', 'validation_failed', 'insufficient_evidence'

    provider = Column(String(50), nullable=False, default="ollama")
    model = Column(String(100), nullable=True)
    error = Column(Text, nullable=True)

    validation_results = Column(JSON, default=dict, nullable=True)
    citations = Column(JSON, default=list, nullable=True)
    meta_info = Column(JSON, default=dict, nullable=True)

    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    session = relationship("ChatSession", back_populates="artifacts")

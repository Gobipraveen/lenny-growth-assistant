import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column,
    String,
    Text,
    Integer,
    Float,
    DateTime,
    ForeignKey,
    JSON,
    Uuid,
    UniqueConstraint,
    Index,
    types,
)
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import relationship
from backend.app.database import Base


def utc_now():
    return datetime.now(timezone.utc)


class TSVectorType(types.TypeDecorator):
    """Dialect-agnostic tsvector type that uses PostgreSQL TSVECTOR in Postgres

    and falls back to UnicodeText in SQLite (for unit tests).
    """

    impl = types.UnicodeText
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(TSVECTOR())
        else:
            return dialect.type_descriptor(types.UnicodeText())


class Transcript(Base):
    __tablename__ = "transcripts"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    episode_slug = Column(String(255), unique=True, nullable=False, index=True)
    title = Column(String(500), nullable=False, index=True)
    guest = Column(String(255), nullable=True, index=True)
    youtube_url = Column(String(500), nullable=True)
    video_id = Column(String(50), nullable=True)
    publish_date = Column(String(50), nullable=True)
    description = Column(Text, nullable=True)
    duration_seconds = Column(Float, nullable=True)
    duration = Column(String(50), nullable=True)
    view_count = Column(Integer, nullable=True)
    channel = Column(String(100), nullable=True)
    keywords = Column(JSON, default=list, nullable=True)

    # Provenance and source metadata
    source_repo = Column(
        String(255),
        default="ChatPRD/lennys-podcast-transcripts",
        nullable=False,
    )
    source_file_path = Column(String(500), nullable=False)
    content_hash = Column(String(64), nullable=False)
    raw_content = Column(Text, nullable=False)
    chunk_count = Column(Integer, default=0, nullable=False)

    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    chunks = relationship(
        "TranscriptChunk",
        back_populates="transcript",
        cascade="all, delete-orphan",
        order_by="TranscriptChunk.chunk_index",
    )


class TranscriptChunk(Base):
    __tablename__ = "transcript_chunks"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    transcript_id = Column(
        Uuid(as_uuid=True),
        ForeignKey("transcripts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chunk_index = Column(Integer, nullable=False)
    speaker = Column(String(255), nullable=True)
    start_timestamp = Column(String(50), nullable=True)
    end_timestamp = Column(String(50), nullable=True)
    content = Column(Text, nullable=False)
    content_hash = Column(String(64), nullable=False)
    char_count = Column(Integer, nullable=False)
    word_count = Column(Integer, nullable=False)

    # Full-text search vector (PostgreSQL TSVECTOR)
    tsv = Column(TSVectorType, nullable=True)

    created_at = Column(DateTime(timezone=True), default=utc_now)

    transcript = relationship("Transcript", back_populates="chunks")

    __table_args__ = (
        UniqueConstraint(
            "transcript_id", "chunk_index", name="uq_transcript_chunk_index"
        ),
        Index("ix_transcript_chunks_tsv", "tsv", postgresql_using="gin"),
        Index("ix_transcript_chunks_speaker", "speaker"),
    )

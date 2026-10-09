import pytest
import tempfile
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.database import Base
from backend.app.models.knowledge import Transcript, TranscriptChunk
from backend.app.services.ingestion import (
    IngestionOptions,
    ingest_single_transcript,
    run_ingestion_pipeline,
)
from backend.app.services.retrieval import get_retriever

SAMPLE_EPISODE_MD = """---
guest: Julie Zhuo
title: Leadership and Product Design
youtube_url: https://www.youtube.com/watch?v=juliezhuo
video_id: juliezhuo
publish_date: 2023-05-10
description: Design principles and leadership frameworks.
duration_seconds: 3000
view_count: 85000
channel: Lenny's Podcast
keywords:
- design
- leadership
---

# Leadership and Product Design

## Transcript

Julie Zhuo (00:00:00):
Design is not just how something looks. It is fundamentally about how it works.

Lenny (00:01:00):
How do you advise early design managers to balance intuition and metrics?

Julie Zhuo (00:01:30):
Metrics tell you what is happening, but intuition and customer empathy tell you why.
"""


@pytest.fixture
def sqlite_db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


def test_ingest_single_transcript_and_idempotency(sqlite_db_session):
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir) / "transcript.md"
        tmp_path.write_text(SAMPLE_EPISODE_MD, encoding="utf-8")

        options = IngestionOptions(source_dir=Path(tmpdir), chunk_size=500, chunk_overlap=50)

        # 1. First ingestion: should process
        processed, count, err = ingest_single_transcript(
            sqlite_db_session, tmp_path, "julie-zhuo", options
        )
        assert processed is True
        assert count > 0
        assert err is None

        # Verify DB records
        transcript = sqlite_db_session.query(Transcript).filter_by(episode_slug="julie-zhuo").first()
        assert transcript is not None
        assert transcript.guest == "Julie Zhuo"
        assert transcript.title == "Leadership and Product Design"
        assert transcript.chunk_count == count
        assert transcript.source_repo == "ChatPRD/lennys-podcast-transcripts"

        chunks = sqlite_db_session.query(TranscriptChunk).filter_by(transcript_id=transcript.id).all()
        assert len(chunks) == count
        assert chunks[0].speaker == "Julie Zhuo"

        # 2. Second ingestion without changes or force: should skip (idempotent)
        processed2, count2, err2 = ingest_single_transcript(
            sqlite_db_session, tmp_path, "julie-zhuo", options
        )
        assert processed2 is False
        assert count2 == 0
        assert err2 is None

        # Record count in DB should remain identical
        total_transcripts = sqlite_db_session.query(Transcript).count()
        total_chunks = sqlite_db_session.query(TranscriptChunk).count()
        assert total_transcripts == 1
        assert total_chunks == count

        # 3. Third ingestion with force=True: should re-process without duplicate transcripts
        force_options = IngestionOptions(source_dir=Path(tmpdir), chunk_size=500, chunk_overlap=50, force=True)
        processed3, count3, err3 = ingest_single_transcript(
            sqlite_db_session, tmp_path, "julie-zhuo", force_options
        )
        assert processed3 is True
        assert count3 == count
        assert sqlite_db_session.query(Transcript).count() == 1
        assert sqlite_db_session.query(TranscriptChunk).count() == count


def test_retrieval_service_on_ingested_content(sqlite_db_session):
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir) / "transcript.md"
        tmp_path.write_text(SAMPLE_EPISODE_MD, encoding="utf-8")

        options = IngestionOptions(source_dir=Path(tmpdir), chunk_size=500, chunk_overlap=50)
        ingest_single_transcript(sqlite_db_session, tmp_path, "julie-zhuo", options)

        retriever = get_retriever(sqlite_db_session)

        # Relevant query
        results = retriever.search("intuition and customer empathy")
        assert len(results) > 0
        assert results[0].episode_slug == "julie-zhuo"
        assert results[0].guest == "Julie Zhuo"
        assert results[0].source_url == "https://www.youtube.com/watch?v=juliezhuo"

        # Irrelevant query
        no_results = retriever.search("quantum mechanical entanglement")
        assert len(no_results) == 0

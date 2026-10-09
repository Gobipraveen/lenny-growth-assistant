import os
import pytest
from sqlalchemy.orm import sessionmaker

from backend.app.database import engine
from backend.app.models.knowledge import Transcript, TranscriptChunk
from backend.app.services.retrieval import PostgresFtsRetriever


@pytest.mark.skipif(
    os.getenv("RUN_POSTGRES_TESTS") != "1",
    reason="PostgreSQL integration tests require RUN_POSTGRES_TESTS=1 environment variable",
)
def test_postgres_fulltext_search_retrieval():
    """Verify native PostgreSQL full-text search against the live database."""
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()
    try:
        retriever = PostgresFtsRetriever(session)
        assert retriever.is_postgresql is True

        # Test search on ingested transcripts
        results = retriever.search("Brian Chesky product management", limit=3)
        assert len(results) > 0
        first = results[0]
        assert first.guest == "Brian Chesky"
        assert first.score is not None
        assert first.score > 0
        assert first.source_url is not None
        assert "youtube.com" in first.source_url

        # Test search with no matching evidence
        empty_results = retriever.search("superconducting quantum bits qubit", limit=3)
        assert len(empty_results) == 0

    finally:
        session.close()

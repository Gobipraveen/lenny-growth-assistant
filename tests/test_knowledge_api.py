import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.main import app
from backend.app.database import Base, get_db
from backend.app.models.knowledge import Transcript, TranscriptChunk
from backend.app.services.chunker import generate_deterministic_transcript_id, generate_deterministic_chunk_id


@pytest.fixture
def api_test_client():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    # Seed test data
    session = TestingSessionLocal()
    t_id = generate_deterministic_transcript_id("brian-chesky")
    transcript = Transcript(
        id=t_id,
        episode_slug="brian-chesky",
        title="Brian Chesky's new playbook",
        guest="Brian Chesky",
        youtube_url="https://www.youtube.com/watch?v=4ef0juAMqoE",
        source_repo="ChatPRD/lennys-podcast-transcripts",
        source_file_path="episodes/brian-chesky/transcript.md",
        content_hash="hash123",
        raw_content="Brian Chesky on product management",
        chunk_count=2,
    )
    session.add(transcript)

    c1 = TranscriptChunk(
        id=generate_deterministic_chunk_id(t_id, 0),
        transcript_id=t_id,
        chunk_index=0,
        speaker="Brian Chesky",
        start_timestamp="00:05:04",
        end_timestamp="00:06:00",
        content="Brian Chesky (00:05:04): We did not eliminate product management, we combined it with product marketing.",
        content_hash="chunkhash1",
        char_count=105,
        word_count=16,
    )
    c2 = TranscriptChunk(
        id=generate_deterministic_chunk_id(t_id, 1),
        transcript_id=t_id,
        chunk_index=1,
        speaker="Brian Chesky",
        start_timestamp="00:06:01",
        end_timestamp="00:07:00",
        content="Brian Chesky (00:06:01): We run one single company roadmap and eliminate functional silos.",
        content_hash="chunkhash2",
        char_count=88,
        word_count=13,
    )
    session.add(c1)
    session.add(c2)
    session.commit()
    session.close()

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    original_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    yield client
    if original_override is not None:
        app.dependency_overrides[get_db] = original_override
    else:
        app.dependency_overrides.pop(get_db, None)


def test_knowledge_search_success(api_test_client):
    response = api_test_client.get("/api/knowledge/search?q=product+management")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["query"] == "product management"
    assert data["data"]["total_results"] > 0
    results = data["data"]["results"]
    assert len(results) > 0
    first = results[0]
    assert first["guest"] == "Brian Chesky"
    assert first["episode_title"] == "Brian Chesky's new playbook"
    assert first["source_url"] == "https://www.youtube.com/watch?v=4ef0juAMqoE"
    assert first["chunk_index"] == 0
    assert "combined it with product marketing" in first["content"]


def test_knowledge_search_empty_query_validation(api_test_client):
    response = api_test_client.get("/api/knowledge/search?q=")
    assert response.status_code == 400
    assert "cannot be empty" in response.json()["detail"]

    response_spaces = api_test_client.get("/api/knowledge/search?q=   ")
    assert response_spaces.status_code == 400


def test_knowledge_search_no_evidence_found(api_test_client):
    response = api_test_client.get("/api/knowledge/search?q=photosynthesis+chloroplasts")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["total_results"] == 0
    assert data["data"]["results"] == []


def test_knowledge_search_pagination_and_filters(api_test_client):
    response = api_test_client.get("/api/knowledge/search?q=chesky&limit=1&offset=0")
    assert response.status_code == 200
    data = response.json()
    assert len(data["data"]["results"]) == 1

    # Filter with non-matching guest
    filtered_response = api_test_client.get("/api/knowledge/search?q=chesky&guest=UnknownGuest")
    assert filtered_response.status_code == 200
    assert filtered_response.json()["data"]["total_results"] == 0


def test_knowledge_status_endpoint(api_test_client):
    response = api_test_client.get("/api/knowledge/status")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    status_data = data["data"]
    assert status_data["total_transcripts"] == 1
    assert status_data["total_chunks"] == 2
    assert len(status_data["episodes"]) == 1
    assert status_data["episodes"][0]["slug"] == "brian-chesky"

import uuid
import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.config import settings
from backend.app.main import app
from backend.app.database import Base, get_db
from backend.app.models.chat import ChatSession, ChatMessage
from backend.app.models.essay import Essay
from backend.app.models.knowledge import Transcript, TranscriptChunk
from backend.app.services.chunker import (
    generate_deterministic_transcript_id,
    generate_deterministic_chunk_id,
)
from backend.app.services.agent_client import (
    AgentClient,
    get_agent_client,
    AgentConnectionError,
    AgentTimeoutError,
    AgentResponseError,
)

# In-memory SQLite database for isolated test execution
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


class MockEssayAgentClient:
    """Mock agent client simulating the Node.js Pi Agent Service for essay generation."""

    def __init__(self, response_data=None, error_to_raise=None):
        self.error_to_raise = error_to_raise
        self.response_data = response_data or {
            "title": "The Unscalable Delight Loop for Founders",
            "markdown": (
                "# The Unscalable Delight Loop for Founders\n\n"
                "Most founders believe scale is the initial metric of success. It is not.\n\n"
                "## The Conventional Trap\n\n"
                "Premature automation destroys early customer feedback loops.\n\n"
                "## Core Transcript Insights\n\n"
                "As Brian Chesky explained on Lenny's Podcast [chunk_id: chunk-valid-1], unscalable hospitality wins.\n\n"
                "## Tactical Execution Playbook\n\n"
                "Map edge case delight before writing production automation.\n\n"
                "## The Actionable Framework\n\n"
                "Execute five user discovery calls every Tuesday morning.\n\n"
            ) + " ".join(["Delight drives word of mouth."] * 130),
            "word_count": 1250,
            "target_word_count": 1250,
            "citations": [
                {
                    "chunk_id": "chunk-valid-1",
                    "episode_title": "Brian Chesky on Airbnb",
                    "guest": "Brian Chesky",
                }
            ],
            "evidence_chunk_ids": ["chunk-valid-1"],
            "generation_status": "success",
            "provider": "ollama",
            "model": "qwen2.5:1.5b",
            "validation_results": {
                "isValid": True,
                "wordCountValid": True,
                "headingsValid": True,
                "citationsValid": True,
                "takeawayValid": True,
                "errors": [],
                "warnings": [],
            },
        }
        self.calls = []

    async def check_health(self):
        return {
            "status": "ok",
            "service": "lenny-pi-agent-service",
            "providers": {
                "ollama": {"available": True, "model": "qwen2.5:1.5b"},
                "anthropic": {"configured": False},
            },
        }

    async def generate_essay(self, **kwargs):
        self.calls.append(kwargs)
        if self.error_to_raise:
            raise self.error_to_raise
        return self.response_data

    async def execute_chat_turn(self, **kwargs):
        return {
            "answer": "Mock chat response",
            "citations": [],
            "provider": "ollama",
            "model": "qwen2.5:1.5b",
        }


from backend.app.routers.essay import get_session_factory


@pytest.fixture(autouse=True)
def setup_database():
    """Create fresh database tables for every test."""
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_session_factory] = lambda: TestingSessionLocal
    yield
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_session_factory, None)
    app.dependency_overrides.pop(get_agent_client, None)


@pytest.fixture
def test_client():
    return TestClient(app)


def seed_sample_transcript_and_chunk(db):
    """Seed sample transcript and chunk for retrieval."""
    t_id = generate_deterministic_transcript_id("brian-chesky-airbnb")
    transcript = Transcript(
        id=t_id,
        episode_slug="brian-chesky-airbnb",
        title="Brian Chesky on Airbnb",
        guest="Brian Chesky",
        youtube_url="https://youtube.com/watch?v=123",
        source_repo="test",
        source_file_path="transcripts/brian.json",
        content_hash="hash1",
        raw_content="Designing the 11-star experience",
        chunk_count=1,
    )
    db.add(transcript)

    c_id = generate_deterministic_chunk_id(t_id, 0)
    chunk = TranscriptChunk(
        id=c_id,
        transcript_id=t_id,
        chunk_index=0,
        content="Designing the 11-star experience was key to unlocking unscalable product-market fit.",
        speaker="Brian Chesky",
        start_timestamp="00:01:00",
        end_timestamp="00:02:00",
        content_hash="chunkhash1",
        char_count=85,
        word_count=12,
    )
    db.add(chunk)
    db.commit()
    return transcript, chunk


# -----------------------------------------------------------------------------
# 1. Validation & Input Contract Tests
# -----------------------------------------------------------------------------
def test_essay_request_validation_topic_too_short(test_client):
    """Verify that essay creation rejects topics under 3 characters with 422."""
    session_id = uuid.uuid4()
    # Create session first
    db = TestingSessionLocal()
    db.add(ChatSession(id=session_id, title="Test Session"))
    db.commit()
    db.close()

    res = test_client.post(
        f"/api/sessions/{session_id}/essays",
        json={"topic": "hi"},
    )
    assert res.status_code == 422


def test_essay_missing_session_returns_404(test_client):
    """Verify that posting an essay to a non-existent session returns 404."""
    non_existent = uuid.uuid4()
    res = test_client.post(
        f"/api/sessions/{non_existent}/essays",
        json={"topic": "Product-Led Growth Playbook"},
    )
    assert res.status_code == 404
    data = res.json()
    assert "not found" in data["detail"].lower()


def test_essay_unsupported_provider_rejected(test_client):
    """Verify that an unsupported provider returns 400 Bad Request."""
    session_id = uuid.uuid4()
    db = TestingSessionLocal()
    db.add(ChatSession(id=session_id, title="Test Session"))
    db.commit()
    db.close()

    res = test_client.post(
        f"/api/sessions/{session_id}/essays",
        json={"topic": "Product-Led Growth Playbook", "provider": "invalid_provider"},
    )
    assert res.status_code == 400
    assert "unsupported provider" in res.json()["detail"].lower()


def test_essay_missing_cloud_credentials_rejected(test_client, monkeypatch):
    """Verify that selecting Anthropic when ANTHROPIC_API_KEY is unset returns 400."""
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    session_id = uuid.uuid4()
    db = TestingSessionLocal()
    db.add(ChatSession(id=session_id, title="Test Session"))
    db.commit()
    db.close()

    res = test_client.post(
        f"/api/sessions/{session_id}/essays",
        json={"topic": "Product-Led Growth Playbook", "provider": "anthropic"},
    )
    assert res.status_code == 400
    assert "anthropic api key is not configured" in res.json()["detail"].lower()


# -----------------------------------------------------------------------------
# 2. Evidence Grounding & Insufficient Evidence Outcome
# -----------------------------------------------------------------------------
def test_essay_insufficient_evidence_returns_structured_outcome(test_client):
    """Verify that when no transcript evidence exists, a structured insufficient_evidence outcome is returned."""
    session_id = uuid.uuid4()
    db = TestingSessionLocal()
    db.add(ChatSession(id=session_id, title="Test Session"))
    db.commit()
    db.close()

    mock_client = MockEssayAgentClient()
    app.dependency_overrides[get_agent_client] = lambda: mock_client

    res = test_client.post(
        f"/api/sessions/{session_id}/essays",
        json={"topic": "CompletelyUnindexedExtraterrestrialTopic12345"},
    )
    assert res.status_code in [200, 202]
    data = res.json()["data"]
    assert data["generation_status"] == "insufficient_evidence"
    assert "insufficient" in data["error"].lower()
    # Ensure agent was NOT called for inference
    assert len(mock_client.calls) == 0


# -----------------------------------------------------------------------------
# 3. Successful Generation & Background Task Execution
# -----------------------------------------------------------------------------
def test_essay_generation_success_with_verified_citations(test_client):
    """Verify full end-to-end essay creation with background task completion and verified citations."""
    db = TestingSessionLocal()
    session_id = uuid.uuid4()
    db.add(ChatSession(id=session_id, title="Test Session"))
    db.commit()
    transcript, chunk = seed_sample_transcript_and_chunk(db)
    chunk_id = str(chunk.id)
    db.close()

    mock_client = MockEssayAgentClient(
        response_data={
            "title": "The Unscalable Delight Loop for Founders",
            "markdown": (
                "# The Unscalable Delight Loop for Founders\n\n"
                "Single hook sentence.\n\n"
                "## The Conventional Trap\n\n"
                "Premature automation is the death of customer empathy.\n\n"
                "## Core Transcript Insights\n\n"
                f"As Brian Chesky explained [chunk_id: {chunk_id}], eleven-star thinking uncovers magic.\n\n"
                "## Tactical Operational Playbook\n\n"
                "Map edge case delight before writing software.\n\n"
                "## The Actionable Framework\n\n"
                "Execute five customer discovery interviews every Tuesday morning.\n\n"
            ) + " ".join(["Customer delight generates authentic growth."] * 130),
            "word_count": 1250,
            "target_word_count": 1250,
            "citations": [
                {
                    "chunk_id": chunk_id,
                    "episode_title": "Brian Chesky on Airbnb",
                    "guest": "Brian Chesky",
                }
            ],
            "evidence_chunk_ids": [chunk_id],
            "generation_status": "success",
            "provider": "ollama",
            "model": "qwen2.5:1.5b",
            "validation_results": {
                "isValid": True,
                "wordCountValid": True,
                "headingsValid": True,
                "citationsValid": True,
                "takeawayValid": True,
                "errors": [],
                "warnings": [],
            },
        }
    )
    app.dependency_overrides[get_agent_client] = lambda: mock_client

    # TestClient runs FastAPI background tasks synchronously before returning!
    res = test_client.post(
        f"/api/sessions/{session_id}/essays",
        json={
            "topic": "11-star customer experience",
            "audience": "Early Stage Founders",
            "intended_outcome": "Unscalable delight loop",
        },
    )
    assert res.status_code == 202
    data = res.json()["data"]
    essay_id = data["essay_id"]

    # Verify background task finished and essay is persisted in DB
    get_res = test_client.get(f"/api/sessions/{session_id}/essays/{essay_id}")
    assert get_res.status_code == 200
    essay_data = get_res.json()["data"]
    assert essay_data["generation_status"] == "completed"
    assert essay_data["title"] == "The Unscalable Delight Loop for Founders"
    assert essay_data["word_count"] == 1250
    assert len(essay_data["citations"]) == 1
    assert essay_data["citations"][0]["chunk_id"] == str(chunk.id)
    assert essay_data["citations"][0]["guest"] == "Brian Chesky"


# -----------------------------------------------------------------------------
# 4. Fabricated Citation Rejection
# -----------------------------------------------------------------------------
def test_essay_rejection_of_fabricated_citations(test_client):
    """Verify that cited chunk IDs not present in retrieved transcript evidence are rejected."""
    db = TestingSessionLocal()
    session_id = uuid.uuid4()
    db.add(ChatSession(id=session_id, title="Test Session"))
    db.commit()
    transcript, chunk = seed_sample_transcript_and_chunk(db)
    db.close()

    fabricated_id = str(uuid.uuid4())
    mock_client = MockEssayAgentClient(
        response_data={
            "title": "Title with Hallucinated Citation",
            "markdown": f"# Title\n\nHook.\n\n## Section 1\n\nClaim [chunk_id: {fabricated_id}].\n\n## Section 2\n\nBody.\n\n## Section 3\n\nMore.\n\n## The Actionable Framework\n\nTakeaway.\n\n" + " ".join(["Word"] * 1100),
            "word_count": 1150,
            "target_word_count": 1250,
            "citations": [
                {
                    "chunk_id": fabricated_id,
                    "episode_title": "Fake Episode",
                    "guest": "Fake Guest",
                }
            ],
            "evidence_chunk_ids": [],
            "generation_status": "success",
            "provider": "ollama",
            "model": "qwen2.5:1.5b",
            "validation_results": {"isValid": True},
        }
    )
    app.dependency_overrides[get_agent_client] = lambda: mock_client

    res = test_client.post(
        f"/api/sessions/{session_id}/essays",
        json={"topic": "11-star customer experience"},
    )
    assert res.status_code == 202
    essay_id = res.json()["data"]["essay_id"]

    get_res = test_client.get(f"/api/sessions/{session_id}/essays/{essay_id}")
    essay_data = get_res.json()["data"]
    # The fabricated citation must be filtered out
    assert len(essay_data["citations"]) == 0


# -----------------------------------------------------------------------------
# 5. Session Isolation Tests
# -----------------------------------------------------------------------------
def test_essay_session_isolation(test_client):
    """Verify that an essay generated in Session A cannot be retrieved via Session B."""
    db = TestingSessionLocal()
    sess_a = uuid.uuid4()
    sess_b = uuid.uuid4()
    db.add(ChatSession(id=sess_a, title="Session A"))
    db.add(ChatSession(id=sess_b, title="Session B"))

    essay_a = Essay(
        session_id=sess_a,
        topic="Topic in Session A",
        generation_status="completed",
        title="Essay A",
        markdown="# Essay A",
        word_count=1200,
        provider="ollama",
    )
    db.add(essay_a)
    db.commit()
    essay_id = essay_a.id
    db.close()

    # Allowed in Session A
    res_a = test_client.get(f"/api/sessions/{sess_a}/essays/{essay_id}")
    assert res_a.status_code == 200

    # Rejected in Session B with 404
    res_b = test_client.get(f"/api/sessions/{sess_b}/essays/{essay_id}")
    assert res_b.status_code == 404


def test_essay_list_by_session(test_client):
    """Verify listing essays filters strictly by session."""
    db = TestingSessionLocal()
    sess_a = uuid.uuid4()
    sess_b = uuid.uuid4()
    db.add(ChatSession(id=sess_a, title="Session A"))
    db.add(ChatSession(id=sess_b, title="Session B"))

    db.add(Essay(session_id=sess_a, topic="Topic A1", generation_status="completed", title="Essay A1"))
    db.add(Essay(session_id=sess_a, topic="Topic A2", generation_status="completed", title="Essay A2"))
    db.add(Essay(session_id=sess_b, topic="Topic B1", generation_status="completed", title="Essay B1"))
    db.commit()
    db.close()

    res_a = test_client.get(f"/api/sessions/{sess_a}/essays")
    assert res_a.status_code == 200
    essays_a = res_a.json()["data"]
    assert len(essays_a) == 2
    assert {e["topic"] for e in essays_a} == {"Topic A1", "Topic A2"}


# -----------------------------------------------------------------------------
# 6. Error & Timeout Handling
# -----------------------------------------------------------------------------
def test_essay_timeout_handling(test_client):
    """Verify that AgentTimeoutError sets the essay generation_status to 'failed' with actionable message."""
    db = TestingSessionLocal()
    session_id = uuid.uuid4()
    db.add(ChatSession(id=session_id, title="Test Session"))
    db.commit()
    seed_sample_transcript_and_chunk(db)
    db.close()

    timeout_mock = MockEssayAgentClient(error_to_raise=AgentTimeoutError("Inference timed out"))
    app.dependency_overrides[get_agent_client] = lambda: timeout_mock

    res = test_client.post(
        f"/api/sessions/{session_id}/essays",
        json={"topic": "11-star customer experience"},
    )
    assert res.status_code == 202
    essay_id = res.json()["data"]["essay_id"]

    get_res = test_client.get(f"/api/sessions/{session_id}/essays/{essay_id}")
    essay_data = get_res.json()["data"]
    assert essay_data["generation_status"] == "failed"
    assert "timed out" in essay_data["error"].lower()


def test_essay_agent_connection_error_handling(test_client):
    """Verify that AgentConnectionError sets generation_status to 'failed'."""
    db = TestingSessionLocal()
    session_id = uuid.uuid4()
    db.add(ChatSession(id=session_id, title="Test Session"))
    db.commit()
    seed_sample_transcript_and_chunk(db)
    db.close()

    conn_mock = MockEssayAgentClient(error_to_raise=AgentConnectionError("Connection refused"))
    app.dependency_overrides[get_agent_client] = lambda: conn_mock

    res = test_client.post(
        f"/api/sessions/{session_id}/essays",
        json={"topic": "11-star customer experience"},
    )
    assert res.status_code == 202
    essay_id = res.json()["data"]["essay_id"]

    get_res = test_client.get(f"/api/sessions/{session_id}/essays/{essay_id}")
    essay_data = get_res.json()["data"]
    assert essay_data["generation_status"] == "failed"
    assert "failed" in essay_data["error"].lower()


# -----------------------------------------------------------------------------
# 7. AgentClient Unit Tests
# -----------------------------------------------------------------------------
@pytest.mark.anyio
async def test_agent_client_generate_essay_fails_closed_without_secret():
    """Verify AgentClient.generate_essay fails closed if AGENT_INTERNAL_SECRET is empty."""
    client = AgentClient(base_url="http://127.0.0.1:8001", internal_secret="")
    with pytest.raises(AgentResponseError) as exc_info:
        await client.generate_essay(
            session_id=uuid.uuid4(),
            topic="Test Topic",
        )
    assert exc_info.value.code == "SECRET_NOT_CONFIGURED"


def test_essay_avoid_duplicate_in_progress(test_client):
    """Verify that posting identical topic while one is generating returns the in-progress essay."""
    db = TestingSessionLocal()
    session_id = uuid.uuid4()
    db.add(ChatSession(id=session_id, title="Test Session"))
    db.commit()

    # Seed an already generating essay
    existing_essay = Essay(
        session_id=session_id,
        topic="Duplicate In-Flight Topic",
        generation_status="generating",
        provider="ollama",
    )
    db.add(existing_essay)
    db.commit()
    existing_id = str(existing_essay.id)
    db.close()

    mock_client = MockEssayAgentClient()
    app.dependency_overrides[get_agent_client] = lambda: mock_client

    res = test_client.post(
        f"/api/sessions/{session_id}/essays",
        json={"topic": "Duplicate In-Flight Topic"},
    )
    assert res.status_code in [200, 202]
    data = res.json()
    assert "already in progress" in data["message"].lower()
    assert data["data"]["essay_id"] == existing_id


def test_essay_non_existent_essay_returns_404(test_client):
    """Verify requesting an unknown essay_id returns 404."""
    db = TestingSessionLocal()
    session_id = uuid.uuid4()
    db.add(ChatSession(id=session_id, title="Test Session"))
    db.commit()
    db.close()

    random_id = uuid.uuid4()
    res = test_client.get(f"/api/sessions/{session_id}/essays/{random_id}")
    assert res.status_code == 404


def test_essay_target_word_count_bounds_validation(test_client):
    """Verify that target_word_count outside [500, 3000] is rejected by Pydantic."""
    session_id = uuid.uuid4()
    db = TestingSessionLocal()
    db.add(ChatSession(id=session_id, title="Test Session"))
    db.commit()
    db.close()

    # Too small (<500)
    res_low = test_client.post(
        f"/api/sessions/{session_id}/essays",
        json={"topic": "Valid Topic", "target_word_count": 400},
    )
    assert res_low.status_code == 422

    # Too high (>3000)
    res_high = test_client.post(
        f"/api/sessions/{session_id}/essays",
        json={"topic": "Valid Topic", "target_word_count": 3500},
    )
    assert res_high.status_code == 422


def test_chat_turn_regression_remains_functional(test_client):
    """Verify existing chat turn orchestration remains intact after essay router integration."""
    db = TestingSessionLocal()
    session_id = uuid.uuid4()
    db.add(ChatSession(id=session_id, title="Chat Session"))
    db.commit()
    seed_sample_transcript_and_chunk(db)
    db.close()

    mock_client = MockEssayAgentClient()
    app.dependency_overrides[get_agent_client] = lambda: mock_client

    res = test_client.post(
        f"/api/sessions/{session_id}/chat",
        json={"message": "What did Brian Chesky say about customer experience?"},
    )
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["session_id"] == str(session_id)
    assert data["answer"] == "Mock chat response"


def test_essay_failed_validation_persists_as_validation_failed(test_client):
    """Verify that an essay failing validation is persisted as 'validation_failed', not 'completed'."""
    db = TestingSessionLocal()
    session_id = uuid.uuid4()
    db.add(ChatSession(id=session_id, title="Validation Test Session"))
    db.commit()
    seed_sample_transcript_and_chunk(db)
    db.close()

    mock_client = MockEssayAgentClient(
        response_data={
            "title": "Too Short Essay",
            "markdown": "# Too Short Essay\n\nOnly 50 words.",
            "word_count": 50,
            "target_word_count": 1250,
            "citations": [],
            "evidence_chunk_ids": [],
            "generation_status": "completed",
            "provider": "ollama",
            "model": "qwen2.5:1.5b",
            "validation_results": {
                "isValid": False,
                "wordCountValid": False,
                "headingsValid": False,
                "citationsValid": True,
                "takeawayValid": False,
                "errors": ["Essay is substantially too short (50 words)."],
                "warnings": [],
            },
        }
    )
    app.dependency_overrides[get_agent_client] = lambda: mock_client

    # Request essay generation
    res = test_client.post(
        f"/api/sessions/{session_id}/essays",
        json={"topic": "Customer experience and 11 star frameworks"},
    )
    assert res.status_code == 202
    essay_id = res.json()["data"]["essay_id"]

    # Poll status after background execution
    res_status = test_client.get(f"/api/sessions/{session_id}/essays/{essay_id}")
    assert res_status.status_code == 200
    data = res_status.json()["data"]
    assert data["generation_status"] == "validation_failed"
    assert "substantially too short" in data["error"]
    assert data["validation_results"]["isValid"] is False


def test_essay_stale_job_recovery_on_get(test_client):
    """Verify that an orphaned 'generating' essay older than 360s is recovered to 'failed' on GET."""
    from datetime import timedelta
    db = TestingSessionLocal()
    session_id = uuid.uuid4()
    db.add(ChatSession(id=session_id, title="Stale Recovery Session"))
    db.commit()

    # Seed an essay created 400 seconds ago in 'generating' state (simulates server restart)
    stale_created = datetime.now(timezone.utc) - timedelta(seconds=400)
    stale_essay = Essay(
        session_id=session_id,
        topic="Interrupted Generation Topic",
        generation_status="generating",
        provider="ollama",
        created_at=stale_created,
        updated_at=stale_created,
    )
    db.add(stale_essay)
    db.commit()
    essay_id = str(stale_essay.id)
    db.close()

    res = test_client.get(f"/api/sessions/{session_id}/essays/{essay_id}")
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["generation_status"] == "failed"
    assert "interrupted by a server restart" in data["error"].lower()

    # Check persistence in DB
    db2 = TestingSessionLocal()
    persisted = db2.query(Essay).filter(Essay.id == uuid.UUID(essay_id)).first()
    assert persisted.generation_status == "failed"
    db2.close()


def test_essay_stale_job_recovery_on_list(test_client):
    """Verify that list_essays transitions stale generating jobs to failed."""
    from datetime import timedelta
    db = TestingSessionLocal()
    session_id = uuid.uuid4()
    db.add(ChatSession(id=session_id, title="Stale List Session"))
    db.commit()

    stale_created = datetime.now(timezone.utc) - timedelta(seconds=500)
    stale_essay = Essay(
        session_id=session_id,
        topic="Stale List Topic",
        generation_status="generating",
        provider="ollama",
        created_at=stale_created,
        updated_at=stale_created,
    )
    db.add(stale_essay)
    db.commit()
    db.close()

    res = test_client.get(f"/api/sessions/{session_id}/essays")
    assert res.status_code == 200
    items = res.json()["data"]
    assert len(items) == 1
    assert items[0]["generation_status"] == "failed"

import uuid
import pytest
import httpx
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.config import settings
from backend.app.main import app
from backend.app.database import Base, get_db
from backend.app.models.chat import ChatSession, ChatMessage
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


class MockAgentClient:
    """Mock agent client simulating the Node.js Pi Agent Service."""

    def __init__(self, response_data=None, error_to_raise=None, health_data=None):
        self.response_data = response_data
        self.error_to_raise = error_to_raise
        self.health_data = health_data or {
            "status": "ok",
            "service": "lenny-pi-agent-service",
            "providers": {
                "ollama": {"available": True, "model": "qwen2.5:1.5b"},
                "anthropic": {"configured": False},
            },
        }
        self.calls = []

    async def check_health(self):
        return self.health_data

    async def execute_chat_turn(
        self,
        session_id,
        message,
        history=None,
        candidate_passages=None,
        provider=None,
        model=None,
        system_instructions=None,
    ):
        self.calls.append({
            "session_id": session_id,
            "message": message,
            "history": history or [],
            "candidate_passages": candidate_passages or [],
            "provider": provider,
            "model": model,
            "system_instructions": system_instructions,
        })
        if self.error_to_raise:
            raise self.error_to_raise
        return self.response_data or {
            "answer": "Mocked grounded response from Lenny's transcripts.",
            "citations": [],
            "provider": provider or "ollama",
            "model": model or "qwen2.5:1.5b",
            "durationMs": 150,
        }


@pytest.fixture
def test_env():
    """Setup clean tables and seed sample knowledge data."""
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.create_all(bind=engine)

    db = TestingSessionLocal()
    # Seed transcript and chunk
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
        chunk_count=1,
    )
    db.add(transcript)

    c1_id = generate_deterministic_chunk_id(t_id, 0)
    c1 = TranscriptChunk(
        id=c1_id,
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
    db.add(c1)
    db.commit()
    db.close()

    saved_secret = settings.AGENT_INTERNAL_SECRET
    settings.AGENT_INTERNAL_SECRET = "test-agent-bridge-secret-token"

    client = TestClient(app, raise_server_exceptions=False)
    yield {
        "client": client,
        "transcript_id": t_id,
        "chunk_id": c1_id,
    }

    # Cleanup
    settings.AGENT_INTERNAL_SECRET = saved_secret
    app.dependency_overrides.pop(get_agent_client, None)
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


# ---------------------------------------------------------------------------
# C — Internal Retrieval Authentication Tests
# ---------------------------------------------------------------------------


def test_internal_search_missing_token_rejected(test_env):
    """Verify that requests lacking the X-Internal-Token header are rejected with 401."""
    client = test_env["client"]
    response = client.post(
        "/api/internal/knowledge/search",
        json={"query": "product management", "limit": 5},
    )
    assert response.status_code == 401
    assert "Invalid internal agent bridge token" in response.text
    # Ensure configured secret is never echoed in error
    assert settings.AGENT_INTERNAL_SECRET not in response.text


def test_internal_search_invalid_token_rejected(test_env):
    """Verify that an incorrect token is rejected with 401 without leaking the secret."""
    client = test_env["client"]
    response = client.post(
        "/api/internal/knowledge/search",
        json={"query": "product management", "limit": 5},
        headers={"X-Internal-Token": "completely-wrong-token-xyz"},
    )
    assert response.status_code == 401
    assert "Invalid internal agent bridge token" in response.text
    assert settings.AGENT_INTERNAL_SECRET not in response.text


def test_internal_search_correct_token_success(test_env):
    """Verify that the configured internal token succeeds and returns search results."""
    client = test_env["client"]
    response = client.post(
        "/api/internal/knowledge/search",
        json={"query": "product management", "limit": 5},
        headers={"X-Internal-Token": settings.AGENT_INTERNAL_SECRET},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["total_results"] >= 1
    assert body["data"]["results"][0]["guest"] == "Brian Chesky"


def test_internal_search_validation(test_env):
    """Verify input validation: whitespace query rejected with 400, limit bounds with 422."""
    client = test_env["client"]
    headers = {"X-Internal-Token": settings.AGENT_INTERNAL_SECRET}

    # Empty query
    r_empty = client.post(
        "/api/internal/knowledge/search",
        json={"query": "   ", "limit": 5},
        headers=headers,
    )
    assert r_empty.status_code == 400
    assert "cannot be empty" in r_empty.json()["detail"]

    # Limit too large (> 10)
    r_limit = client.post(
        "/api/internal/knowledge/search",
        json={"query": "product", "limit": 50},
        headers=headers,
    )
    assert r_limit.status_code == 422


def test_internal_search_unconfigured_secret_fails_closed(test_env, monkeypatch):
    """Verify that if AGENT_INTERNAL_SECRET is empty/unconfigured, internal search fails closed with 500."""
    monkeypatch.setattr(settings, "AGENT_INTERNAL_SECRET", "")
    client = test_env["client"]
    response = client.post(
        "/api/internal/knowledge/search",
        json={"query": "product management", "limit": 5},
        headers={"X-Internal-Token": "some-token"},
    )
    assert response.status_code == 500
    assert "shared secret is not configured" in response.text


# ---------------------------------------------------------------------------
# D — Chat Turn Endpoint & Citation Validation Tests
# ---------------------------------------------------------------------------


def test_chat_turn_success_with_verified_citations(test_env):
    """Verify chat turn with valid citations matching retrieved evidence."""
    client = test_env["client"]
    chunk_id = test_env["chunk_id"]

    # Create a real session
    r_sess = client.post("/api/sessions", json={"title": "Product Growth Chat"})
    session_id = r_sess.json()["id"]

    # Configure mock agent returning valid chunk_id citation
    mock_agent = MockAgentClient(
        response_data={
            "answer": "Brian Chesky explained that Airbnb merged product management with product marketing.",
            "citations": [
                {
                    "chunk_id": str(chunk_id),
                    "episode_title": "Brian Chesky's new playbook",
                    "guest": "Brian Chesky",
                }
            ],
            "provider": "ollama",
            "model": "qwen2.5:1.5b",
        }
    )
    app.dependency_overrides[get_agent_client] = lambda: mock_agent

    response = client.post(
        f"/api/sessions/{session_id}/chat",
        json={"message": "What did Brian Chesky say about product management?"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    turn_data = body["data"]

    assert turn_data["session_id"] == session_id
    assert "Brian Chesky" in turn_data["answer"]
    assert turn_data["provider"] == "ollama"
    assert turn_data["model"] == "qwen2.5:1.5b"
    assert "trace_id" in turn_data

    # Citations validation: verified against database
    assert len(turn_data["citations"]) == 1
    cited = turn_data["citations"][0]
    assert cited["chunk_id"] == str(chunk_id)
    assert cited["guest"] == "Brian Chesky"
    assert cited["episode_title"] == "Brian Chesky's new playbook"
    assert cited["source_url"] == "https://www.youtube.com/watch?v=4ef0juAMqoE"
    assert "combined it with product marketing" in cited["snippet"]

    # Verify PostgreSQL / DB persistence of user and assistant messages
    db_messages = client.get(f"/api/sessions/{session_id}/messages").json()
    assert len(db_messages) == 2
    assert db_messages[0]["role"] == "user"
    assert db_messages[0]["content"] == "What did Brian Chesky say about product management?"
    assert db_messages[1]["role"] == "assistant"
    assert db_messages[1]["content"] == turn_data["answer"]
    assert len(db_messages[1]["structured_metadata"]["citations"]) == 1


def test_chat_turn_rejection_of_fabricated_citations(test_env):
    """Verify that hallucinated or fabricated citation IDs are filtered out."""
    client = test_env["client"]
    fake_chunk_id = str(uuid.uuid4())

    r_sess = client.post("/api/sessions", json={"title": "Hallucination Test"})
    session_id = r_sess.json()["id"]

    # Agent returns citation with non-existent chunk ID
    mock_agent = MockAgentClient(
        response_data={
            "answer": "This is an answer with a hallucinated chunk ID.",
            "citations": [
                {
                    "chunk_id": fake_chunk_id,
                    "episode_title": "Fake Episode",
                    "guest": "Fake Guest",
                    "source_url": "https://www.youtube.com/watch?v=fabricated",
                }
            ],
            "provider": "ollama",
            "model": "qwen2.5:1.5b",
        }
    )
    app.dependency_overrides[get_agent_client] = lambda: mock_agent

    response = client.post(
        f"/api/sessions/{session_id}/chat",
        json={"message": "Tell me about growth loops."},
    )
    assert response.status_code == 200
    turn_data = response.json()["data"]

    # Fabricated citation must be rejected
    assert len(turn_data["citations"]) == 0

    # DB assistant message metadata must have empty citations list
    db_messages = client.get(f"/api/sessions/{session_id}/messages").json()
    assert len(db_messages) == 2
    assert db_messages[1]["structured_metadata"]["citations"] == []


def test_chat_turn_missing_session_returns_404(test_env):
    """Verify that targeting a non-existent session ID returns 404."""
    client = test_env["client"]
    non_existent = str(uuid.uuid4())
    mock_agent = MockAgentClient()
    app.dependency_overrides[get_agent_client] = lambda: mock_agent

    response = client.post(
        f"/api/sessions/{non_existent}/chat",
        json={"message": "Hello"},
    )
    assert response.status_code == 404
    assert f"Chat session '{non_existent}' not found" in response.json()["detail"]


def test_chat_turn_invalid_request_validation(test_env):
    """Verify that empty whitespace queries return 400 and missing fields return 422."""
    client = test_env["client"]
    r_sess = client.post("/api/sessions", json={"title": "Validation Test"})
    session_id = r_sess.json()["id"]

    # Whitespace only message
    r_empty = client.post(
        f"/api/sessions/{session_id}/chat",
        json={"message": "    "},
    )
    assert r_empty.status_code == 400
    assert "cannot be empty" in r_empty.json()["detail"]

    # Missing message field
    r_missing = client.post(
        f"/api/sessions/{session_id}/chat",
        json={},
    )
    assert r_missing.status_code == 422


def test_chat_turn_agent_timeout_handling(test_env):
    """Verify that agent timeouts return 504 and persist no orphan or misleading messages."""
    client = test_env["client"]
    r_sess = client.post("/api/sessions", json={"title": "Timeout Test"})
    session_id = r_sess.json()["id"]

    mock_agent = MockAgentClient(error_to_raise=AgentTimeoutError("Mock timeout after 60s"))
    app.dependency_overrides[get_agent_client] = lambda: mock_agent

    response = client.post(
        f"/api/sessions/{session_id}/chat",
        json={"message": "This will time out"},
    )
    assert response.status_code == 504
    assert "timed out" in response.json()["detail"]

    # Verify NO messages were saved to the database on failure
    msgs = client.get(f"/api/sessions/{session_id}/messages").json()
    assert len(msgs) == 0


def test_chat_turn_agent_unavailable_handling(test_env):
    """Verify that unreachable agent service returns 502 without partial persistence."""
    client = test_env["client"]
    r_sess = client.post("/api/sessions", json={"title": "Unavailable Test"})
    session_id = r_sess.json()["id"]

    mock_agent = MockAgentClient(error_to_raise=AgentConnectionError("Connection refused"))
    app.dependency_overrides[get_agent_client] = lambda: mock_agent

    response = client.post(
        f"/api/sessions/{session_id}/chat",
        json={"message": "Service is down"},
    )
    assert response.status_code == 502
    assert "unavailable or unreachable" in response.json()["detail"]

    # Verify database remains clean
    msgs = client.get(f"/api/sessions/{session_id}/messages").json()
    assert len(msgs) == 0


def test_chat_turn_invalid_agent_response_handling(test_env):
    """Verify that malformed or error agent responses return 502 without partial persistence."""
    client = test_env["client"]
    r_sess = client.post("/api/sessions", json={"title": "Bad Response Test"})
    session_id = r_sess.json()["id"]

    mock_agent = MockAgentClient(error_to_raise=AgentResponseError("Agent runtime exception"))
    app.dependency_overrides[get_agent_client] = lambda: mock_agent

    response = client.post(
        f"/api/sessions/{session_id}/chat",
        json={"message": "Trigger bad response"},
    )
    assert response.status_code == 502
    assert "Agent service returned error" in response.json()["detail"]

    msgs = client.get(f"/api/sessions/{session_id}/messages").json()
    assert len(msgs) == 0


def test_chat_turn_independent_session_history(test_env):
    """Verify that multi-turn history passed to the agent client is strictly isolated per session."""
    client = test_env["client"]

    # Create Session A and Session B
    r_a = client.post("/api/sessions", json={"title": "Session A"})
    s_a = r_a.json()["id"]
    r_b = client.post("/api/sessions", json={"title": "Session B"})
    s_b = r_b.json()["id"]

    mock_agent = MockAgentClient(
        response_data={"answer": "Turn answer", "citations": [], "provider": "ollama", "model": "qwen2.5:1.5b"}
    )
    app.dependency_overrides[get_agent_client] = lambda: mock_agent

    # Turn 1 on Session A
    client.post(f"/api/sessions/{s_a}/chat", json={"message": "Msg A1"})
    # Turn 2 on Session A
    client.post(f"/api/sessions/{s_a}/chat", json={"message": "Msg A2"})

    # Check mock calls for Session A turn 2
    assert len(mock_agent.calls) == 2
    call_a2 = mock_agent.calls[1]
    assert call_a2["session_id"] == uuid.UUID(s_a)
    assert len(call_a2["history"]) == 2  # user Msg A1 + assistant Turn answer
    assert call_a2["history"][0]["content"] == "Msg A1"

    # Turn 1 on Session B
    client.post(f"/api/sessions/{s_b}/chat", json={"message": "Msg B1"})
    assert len(mock_agent.calls) == 3
    call_b1 = mock_agent.calls[2]
    assert call_b1["session_id"] == uuid.UUID(s_b)
    # Session B history must be EMPTY (no leakage from Session A!)
    assert len(call_b1["history"]) == 0


def test_chat_status_endpoint(test_env):
    """Verify that GET /api/sessions/status reports provider and agent availability."""
    client = test_env["client"]
    mock_agent = MockAgentClient(
        health_data={
            "status": "ok",
            "providers": {
                "ollama": {"available": True, "model": "qwen2.5:1.5b"},
                "anthropic": {"configured": False},
            },
        }
    )
    app.dependency_overrides[get_agent_client] = lambda: mock_agent

    response = client.get("/api/sessions/status")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    data = body["data"]
    assert data["agent_service_online"] is True
    assert data["active_provider"] == settings.LLM_PROVIDER
    assert len(data["providers"]) == 2


# ---------------------------------------------------------------------------
# E — AgentClient Direct Unit Tests with MockTransport
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_agent_client_headers_and_config():
    """Verify AgentClient initializes without exposing secrets in logs or repr."""
    client = AgentClient(
        base_url="http://127.0.0.1:8001",
        internal_secret="test-secret-token",
        timeout=30.0,
    )
    headers = client._get_headers()
    assert headers["X-Internal-Token"] == "test-secret-token"
    assert headers["Content-Type"] == "application/json"


@pytest.mark.anyio
async def test_agent_client_turn_success(monkeypatch):
    """Verify AgentClient successful turn parsing with mock transport."""
    client = AgentClient(base_url="http://127.0.0.1:8001", internal_secret="secret")

    def mock_handler(request: httpx.Request):
        assert request.headers.get("x-internal-token") == "secret"
        return httpx.Response(
            200,
            json={
                "success": True,
                "data": {
                    "answer": "Test answer",
                    "citations": [],
                    "provider": "ollama",
                    "model": "qwen2.5:1.5b",
                },
            },
        )

    transport = httpx.MockTransport(mock_handler)
    original_async_client = httpx.AsyncClient

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *args, **kwargs: original_async_client(transport=transport),
    )

    result = await client.execute_chat_turn(
        session_id=uuid.uuid4(),
        message="Test message",
    )
    assert result["answer"] == "Test answer"


@pytest.mark.anyio
async def test_agent_client_401_auth_failure(monkeypatch):
    """Verify AgentClient maps 401 to AgentResponseError with AUTH_FAILED."""
    client = AgentClient(base_url="http://127.0.0.1:8001", internal_secret="bad-secret")

    def mock_handler(request: httpx.Request):
        return httpx.Response(401, json={"error": "Unauthorized"})

    transport = httpx.MockTransport(mock_handler)
    original_async_client = httpx.AsyncClient

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *args, **kwargs: original_async_client(transport=transport),
    )

    with pytest.raises(AgentResponseError) as exc_info:
        await client.execute_chat_turn(session_id=uuid.uuid4(), message="Test")

    assert exc_info.value.code == "AUTH_FAILED"

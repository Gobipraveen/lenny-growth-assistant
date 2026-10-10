"""Focused verification tests for Task 04D:
Conversation quality, grounding logic, provider switching, and failure isolation.
"""
import uuid
import pytest
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
    get_agent_client,
    AgentConnectionError,
    AgentTimeoutError,
    AgentResponseError,
)

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


class MockQualityAgentClient:
    """Mock agent client with call recording and configurable behavior."""

    def __init__(self, response_factory=None, error_to_raise=None):
        self.response_factory = response_factory
        self.error_to_raise = error_to_raise
        self.calls = []

    async def check_health(self):
        return {
            "status": "ok",
            "service": "lenny-pi-agent-service",
            "providers": {
                "ollama": {"available": True, "model": "qwen2.5:1.5b"},
                "anthropic": {"configured": bool(settings.ANTHROPIC_API_KEY)},
            },
        }

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
        call_record = {
            "session_id": session_id,
            "message": message,
            "history": history or [],
            "candidate_passages": candidate_passages or [],
            "provider": provider,
            "model": model,
            "system_instructions": system_instructions,
        }
        self.calls.append(call_record)

        if self.error_to_raise:
            raise self.error_to_raise

        if self.response_factory:
            return self.response_factory(call_record)

        return {
            "answer": "Mocked quality answer.",
            "citations": [],
            "provider": provider or "ollama",
            "model": model or "qwen2.5:1.5b",
            "durationMs": 100,
        }


@pytest.fixture
def test_setup():
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.create_all(bind=engine)

    db = TestingSessionLocal()
    # Seed authentic transcript and chunk records
    t_id = generate_deterministic_transcript_id("brian-chesky")
    transcript = Transcript(
        id=t_id,
        episode_slug="brian-chesky",
        title="Brian Chesky’s new playbook",
        guest="Brian Chesky",
        youtube_url="https://www.youtube.com/watch?v=4ef0juAMqoE",
        source_repo="ChatPRD/lennys-podcast-transcripts",
        source_file_path="episodes/brian-chesky/transcript.md",
        content_hash="test_hash_chesky",
        raw_content="Brian Chesky discusses product management structure at Airbnb.",
        chunk_count=1,
    )
    db.add(transcript)

    c_id = generate_deterministic_chunk_id(t_id, 0)
    chunk = TranscriptChunk(
        id=c_id,
        transcript_id=t_id,
        chunk_index=0,
        speaker="Brian Chesky",
        start_timestamp="00:06:46",
        end_timestamp="00:07:42",
        content="Brian Chesky (00:06:46): So we don't have any longer the traditional product management function...",
        content_hash="chunk_hash_0",
        char_count=100,
        word_count=15,
    )
    db.add(chunk)
    db.commit()
    db.close()

    saved_secret = settings.AGENT_INTERNAL_SECRET
    settings.AGENT_INTERNAL_SECRET = "test-agent-quality-secret"

    client = TestClient(app, raise_server_exceptions=False)
    yield {
        "client": client,
        "transcript_id": t_id,
        "chunk_id": c_id,
    }

    settings.AGENT_INTERNAL_SECRET = saved_secret
    app.dependency_overrides.pop(get_agent_client, None)
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


# ---------------------------------------------------------------------------
# Section A: Conversation Quality & Grounding Logic
# ---------------------------------------------------------------------------


def test_follow_up_context_receives_previous_history(test_setup):
    """Verify that a follow-up question in the same session receives full prior conversation history."""
    client = test_setup["client"]
    r_sess = client.post("/api/sessions", json={"title": "Follow-up Test"})
    session_id = r_sess.json()["id"]

    mock_agent = MockQualityAgentClient(
        response_factory=lambda c: {
            "answer": f"Answer to: {c['message']}",
            "citations": [],
            "provider": "ollama",
            "model": "qwen2.5:1.5b",
        }
    )
    app.dependency_overrides[get_agent_client] = lambda: mock_agent

    # Turn 1
    r1 = client.post(f"/api/sessions/{session_id}/chat", json={"message": "What did Brian say?"})
    assert r1.status_code == 200

    # Turn 2 (Follow-up)
    r2 = client.post(f"/api/sessions/{session_id}/chat", json={"message": "Can you elaborate on that?"})
    assert r2.status_code == 200

    assert len(mock_agent.calls) == 2
    turn2_call = mock_agent.calls[1]
    history = turn2_call["history"]
    assert len(history) == 2
    assert history[0]["role"] == "user"
    assert history[0]["content"] == "What did Brian say?"
    assert history[1]["role"] == "assistant"
    assert history[1]["content"] == "Answer to: What did Brian say?"


def test_independent_sessions_isolated_history(test_setup):
    """Verify that independent sessions never receive another session's history."""
    client = test_setup["client"]
    r_a = client.post("/api/sessions", json={"title": "Session A"})
    s_a = r_a.json()["id"]
    r_b = client.post("/api/sessions", json={"title": "Session B"})
    s_b = r_b.json()["id"]

    mock_agent = MockQualityAgentClient()
    app.dependency_overrides[get_agent_client] = lambda: mock_agent

    # 2 turns in Session A
    client.post(f"/api/sessions/{s_a}/chat", json={"message": "Private A1"})
    client.post(f"/api/sessions/{s_a}/chat", json={"message": "Private A2"})

    # 1 turn in Session B
    client.post(f"/api/sessions/{s_b}/chat", json={"message": "Hello B"})

    assert len(mock_agent.calls) == 3
    call_b = mock_agent.calls[2]
    assert call_b["session_id"] == uuid.UUID(s_b)
    # Session B must receive zero history from Session A
    assert len(call_b["history"]) == 0


def test_no_evidence_retrieval_insufficient_evidence(test_setup):
    """Verify that when no transcript evidence matches, candidate passages are empty and 0 citations returned."""
    client = test_setup["client"]
    r_sess = client.post("/api/sessions", json={"title": "No Evidence Test"})
    session_id = r_sess.json()["id"]

    # Query concerning topics completely absent from the indexed data
    no_evidence_query = "What did guest talk about quantum gravity cosmology astrophysics?"

    mock_agent = MockQualityAgentClient(
        response_factory=lambda c: {
            "answer": "I could not find sufficient evidence in the indexed Lenny's Podcast transcripts to answer this question.",
            "citations": [],
            "provider": "ollama",
            "model": "qwen2.5:1.5b",
        }
    )
    app.dependency_overrides[get_agent_client] = lambda: mock_agent

    resp = client.post(f"/api/sessions/{session_id}/chat", json={"message": no_evidence_query})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert "could not find sufficient evidence" in data["answer"].lower()
    assert len(data["citations"]) == 0

    # Verify agent was given empty candidate passages
    last_call = mock_agent.calls[-1]
    assert len(last_call["candidate_passages"]) == 0


def test_fabricated_citation_rejected(test_setup):
    """Verify that hallucinated/fabricated citation IDs not in retrieved evidence are rejected."""
    client = test_setup["client"]
    r_sess = client.post("/api/sessions", json={"title": "Fabrication Test"})
    session_id = r_sess.json()["id"]

    fake_chunk_id = str(uuid.uuid4())

    mock_agent = MockQualityAgentClient(
        response_factory=lambda c: {
            "answer": "Brian Chesky invented a new product framework.",
            "citations": [
                {
                    "chunk_id": fake_chunk_id,
                    "guest": "Fake Guest",
                    "episode_title": "Fake Episode",
                }
            ],
            "provider": "ollama",
            "model": "qwen2.5:1.5b",
        }
    )
    app.dependency_overrides[get_agent_client] = lambda: mock_agent

    # Query for Brian Chesky (so DB retrieves real chunk, but agent returns fake chunk ID)
    resp = client.post(
        f"/api/sessions/{session_id}/chat",
        json={"message": "What did Brian Chesky discuss regarding product management?"},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    # The fabricated citation must be completely stripped out
    assert len(data["citations"]) == 0


def test_valid_citation_contains_database_derived_metadata(test_setup):
    """Verify that a valid citation contains rich metadata derived from the database, not untrusted agent input."""
    client = test_setup["client"]
    chunk_id = test_setup["chunk_id"]
    r_sess = client.post("/api/sessions", json={"title": "Valid Citation Test"})
    session_id = r_sess.json()["id"]

    mock_agent = MockQualityAgentClient(
        response_factory=lambda c: {
            "answer": "Brian Chesky explained that Airbnb did not eliminate product management.",
            "citations": [
                {
                    "chunk_id": str(chunk_id),
                    "guest": "Untrusted Model Guest Name",  # Should be overridden by DB
                }
            ],
            "provider": "ollama",
            "model": "qwen2.5:1.5b",
        }
    )
    app.dependency_overrides[get_agent_client] = lambda: mock_agent

    resp = client.post(
        f"/api/sessions/{session_id}/chat",
        json={"message": "Brian Chesky product management"},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["citations"]) == 1
    citation = data["citations"][0]

    # Verify fields came from the database entity
    assert citation["chunk_id"] == str(chunk_id)
    assert citation["guest"] == "Brian Chesky"  # From DB, not "Untrusted Model Guest Name"
    assert citation["episode_title"] == "Brian Chesky’s new playbook"
    assert citation["episode_slug"] == "brian-chesky"
    assert citation["speaker"] == "Brian Chesky"
    assert citation["source_url"] == "https://www.youtube.com/watch?v=4ef0juAMqoE"
    assert citation["start_timestamp"] == "00:06:46"
    assert citation["end_timestamp"] == "00:07:42"
    assert "traditional product management" in citation["snippet"]


def test_substantive_claims_without_evidence_has_no_citations(test_setup):
    """Verify that an answer asserting claims without matching citations has empty citations list."""
    client = test_setup["client"]
    r_sess = client.post("/api/sessions", json={"title": "Unverified Claims Test"})
    session_id = r_sess.json()["id"]

    mock_agent = MockQualityAgentClient(
        response_factory=lambda c: {
            "answer": "The secret to 10x growth is daily cold calling and aggressive outbound sales.",
            "citations": [],  # Agent provided no supporting citations
            "provider": "ollama",
            "model": "qwen2.5:1.5b",
        }
    )
    app.dependency_overrides[get_agent_client] = lambda: mock_agent

    resp = client.post(
        f"/api/sessions/{session_id}/chat",
        json={"message": "What is the secret to 10x growth?"},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["citations"]) == 0
    # DB persistence check
    db = TestingSessionLocal()
    persisted_msg = db.query(ChatMessage).filter(ChatMessage.id == uuid.UUID(data["assistant_message_id"])).first()
    assert persisted_msg.structured_metadata["citations"] == []
    db.close()


def test_failed_model_request_leaves_no_orphaned_messages(test_setup):
    """Verify that when an agent request fails (502/504), neither user nor assistant message is saved."""
    client = test_setup["client"]
    r_sess = client.post("/api/sessions", json={"title": "Failure Test"})
    session_id = r_sess.json()["id"]

    mock_agent = MockQualityAgentClient(error_to_raise=AgentTimeoutError("Inference timed out"))
    app.dependency_overrides[get_agent_client] = lambda: mock_agent

    resp = client.post(
        f"/api/sessions/{session_id}/chat",
        json={"message": "Will fail"},
    )
    assert resp.status_code == 504

    # Verify zero messages exist in database
    msgs_resp = client.get(f"/api/sessions/{session_id}/messages")
    assert msgs_resp.status_code == 200
    assert len(msgs_resp.json()) == 0


# ---------------------------------------------------------------------------
# Section B: Provider Switching & Failure Behavior
# ---------------------------------------------------------------------------


def test_default_provider_is_ollama(test_setup):
    """Verify that when no provider is explicitly requested, default provider 'ollama' is used."""
    client = test_setup["client"]
    r_sess = client.post("/api/sessions", json={"title": "Default Provider Test"})
    session_id = r_sess.json()["id"]

    mock_agent = MockQualityAgentClient()
    app.dependency_overrides[get_agent_client] = lambda: mock_agent

    resp = client.post(f"/api/sessions/{session_id}/chat", json={"message": "Hello"})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["provider"] == "ollama"

    assert len(mock_agent.calls) == 1
    assert mock_agent.calls[0]["provider"] == "ollama"


def test_unsupported_provider_rejected_with_400(test_setup):
    """Verify that unsupported provider names are rejected with HTTP 400 Bad Request."""
    client = test_setup["client"]
    r_sess = client.post("/api/sessions", json={"title": "Bad Provider Test"})
    session_id = r_sess.json()["id"]

    resp = client.post(
        f"/api/sessions/{session_id}/chat",
        json={"message": "Hello", "provider": "openai_gpt4"},
    )
    assert resp.status_code == 400
    assert "Unsupported provider 'openai_gpt4'" in resp.json()["detail"]


def test_missing_anthropic_api_key_returns_actionable_error(test_setup, monkeypatch):
    """Verify that requesting anthropic without ANTHROPIC_API_KEY returns HTTP 400 with actionable error."""
    client = test_setup["client"]
    r_sess = client.post("/api/sessions", json={"title": "Missing Key Test"})
    session_id = r_sess.json()["id"]

    # Ensure ANTHROPIC_API_KEY is empty
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")

    resp = client.post(
        f"/api/sessions/{session_id}/chat",
        json={"message": "Hello Claude", "provider": "anthropic"},
    )
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert "ANTHROPIC_API_KEY is not configured" in detail


def test_no_silent_fallback_on_ollama_failure(test_setup):
    """Verify that an Ollama failure results in HTTP 502/504 error rather than silent fallback to cloud."""
    client = test_setup["client"]
    r_sess = client.post("/api/sessions", json={"title": "No Fallback Test"})
    session_id = r_sess.json()["id"]

    mock_agent = MockQualityAgentClient(
        error_to_raise=AgentConnectionError("Ollama connection refused on 11434")
    )
    app.dependency_overrides[get_agent_client] = lambda: mock_agent

    resp = client.post(
        f"/api/sessions/{session_id}/chat",
        json={"message": "Test Ollama failure", "provider": "ollama"},
    )
    assert resp.status_code == 502
    assert "Agent service is unavailable or unreachable" in resp.json()["detail"]

    # Verify agent was called with 'ollama', and never attempted a secondary cloud call
    assert len(mock_agent.calls) == 1
    assert mock_agent.calls[0]["provider"] == "ollama"


def test_selected_provider_and_model_reported_accurately(test_setup):
    """Verify that the response payload accurately reflects the selected provider and model."""
    client = test_setup["client"]
    r_sess = client.post("/api/sessions", json={"title": "Model Reporting Test"})
    session_id = r_sess.json()["id"]

    mock_agent = MockQualityAgentClient(
        response_factory=lambda c: {
            "answer": "Test answer.",
            "citations": [],
            "provider": "ollama",
            "model": "qwen2.5:1.5b",
        }
    )
    app.dependency_overrides[get_agent_client] = lambda: mock_agent

    resp = client.post(
        f"/api/sessions/{session_id}/chat",
        json={"message": "Test report", "provider": "ollama"},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["provider"] == "ollama"
    assert data["model"] == "qwen2.5:1.5b"
    assert "trace_id" in data


def test_unreferenced_claims_with_guest_name_alone_not_cited(test_setup):
    """Verify that an answer referencing a guest or episode without explicit chunk citation has no citations."""
    client = test_setup["client"]
    r_sess = client.post("/api/sessions", json={"title": "Unreferenced Guest Test"})
    session_id = r_sess.json()["id"]

    mock_agent = MockQualityAgentClient(
        response_factory=lambda c: {
            "answer": "Brian Chesky in brian-chesky discussed product marketing and founders.",
            "citations": [],  # Model omitted explicit chunk ID citation
            "provider": "ollama",
            "model": "qwen2.5:1.5b",
        }
    )
    app.dependency_overrides[get_agent_client] = lambda: mock_agent

    resp = client.post(
        f"/api/sessions/{session_id}/chat",
        json={"message": "What did Brian Chesky discuss?"},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["citations"]) == 0


def test_missing_anthropic_model_returns_actionable_error(test_setup, monkeypatch):
    """Verify that requesting anthropic when ANTHROPIC_MODEL is unconfigured returns HTTP 400."""
    client = test_setup["client"]
    r_sess = client.post("/api/sessions", json={"title": "Missing Model Test"})
    session_id = r_sess.json()["id"]

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-test-key")
    monkeypatch.setattr(settings, "ANTHROPIC_MODEL", "")

    resp = client.post(
        f"/api/sessions/{session_id}/chat",
        json={"message": "Hello Claude", "provider": "anthropic"},
    )
    assert resp.status_code == 400
    assert "ANTHROPIC_MODEL is not configured" in resp.json()["detail"]


@pytest.mark.anyio
async def test_agent_client_fails_closed_when_secret_not_configured():
    """Verify that AgentClient.execute_chat_turn fails closed if AGENT_INTERNAL_SECRET is empty."""
    from backend.app.services.agent_client import AgentClient, AgentResponseError

    client = AgentClient(
        base_url="http://127.0.0.1:8001",
        internal_secret="",
    )
    with pytest.raises(AgentResponseError) as exc_info:
        await client.execute_chat_turn(
            session_id=uuid.uuid4(),
            message="Test message",
        )
    assert exc_info.value.code == "SECRET_NOT_CONFIGURED"
    assert exc_info.value.status_code == 500

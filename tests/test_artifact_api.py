import asyncio
import uuid
from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.config import settings
from backend.app.main import app
from backend.app.database import Base, get_db
from backend.app.models.chat import ChatSession
from backend.app.models.artifact import Artifact
from backend.app.routers.artifact import run_artifact_generation_job, get_session_factory
from backend.app.services.agent_client import (
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


class MockArtifactAgentClient:
    """Mock agent client simulating the Node.js Pi Agent Service for artifact generation."""

    def __init__(self, response_data=None, error_to_raise=None):
        self.error_to_raise = error_to_raise
        self.response_data = response_data or {
            "title": "Elena Verna B2B Growth Strategy",
            "artifact_type": "html",
            "source_content": (
                "<!DOCTYPE html><html><head><title>Strategy</title>"
                "<style>body { font-family: sans-serif; padding: 1rem; }</style>"
                "</head><body><h1>Growth Strategy</h1>"
                "<p>Retention drives growth [chunk_id: chunk-valid-1].</p>"
                "</body></html>"
            ),
            "citations": [
                {
                    "chunk_id": "chunk-valid-1",
                    "episode_title": "Elena Verna on B2B SaaS Growth",
                    "guest": "Elena Verna",
                }
            ],
            "provider": "ollama",
            "model": "qwen2.5:1.5b",
            "duration_ms": 150,
        }
        self.calls = []

    async def generate_artifact(self, **kwargs):
        self.calls.append(kwargs)
        if self.error_to_raise:
            raise self.error_to_raise
        return self.response_data


@pytest.fixture(autouse=True)
def setup_test_db():
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_session_factory] = lambda: TestingSessionLocal
    yield
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.clear()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def test_session():
    db = TestingSessionLocal()
    sess_id = uuid.uuid4()
    sess = ChatSession(id=sess_id, title="Artifact Test Session")
    db.add(sess)
    db.commit()
    db.close()

    class SessionRef:
        id = sess_id

    return SessionRef()


# -----------------------------------------------------------------------------
# 1. Request Validation Tests
# -----------------------------------------------------------------------------
def test_create_artifact_validates_required_fields(client, test_session):
    # Missing title
    res = client.post(
        f"/api/sessions/{test_session.id}/artifacts",
        json={"artifact_type": "html", "instructions": "Build a dashboard"},
    )
    assert res.status_code == 422

    # Title too short (<2 chars)
    res = client.post(
        f"/api/sessions/{test_session.id}/artifacts",
        json={"title": "A", "artifact_type": "html", "instructions": "Build a dashboard"},
    )
    assert res.status_code == 422

    # Instructions too short (<3 chars)
    res = client.post(
        f"/api/sessions/{test_session.id}/artifacts",
        json={"title": "Dashboard", "artifact_type": "html", "instructions": "hi"},
    )
    assert res.status_code == 422


# -----------------------------------------------------------------------------
# 2. Unsupported Artifact Types
# -----------------------------------------------------------------------------
def test_create_artifact_unsupported_type_rejected(client, test_session):
    res = client.post(
        f"/api/sessions/{test_session.id}/artifacts",
        json={
            "title": "Native Binary",
            "artifact_type": "wasm",
            "instructions": "Build a wasm module",
        },
    )
    assert res.status_code == 422
    assert "Input should be 'html' or 'markdown'" in res.text


# -----------------------------------------------------------------------------
# 3. Missing Session Validation
# -----------------------------------------------------------------------------
def test_create_artifact_nonexistent_session_returns_404(client):
    fake_id = uuid.uuid4()
    res = client.post(
        f"/api/sessions/{fake_id}/artifacts",
        json={
            "title": "Dashboard",
            "artifact_type": "html",
            "instructions": "Build metrics card",
        },
    )
    assert res.status_code == 404
    assert f"Chat session '{fake_id}' not found" in res.json()["detail"]


# -----------------------------------------------------------------------------
# 4. Session Isolation Tests
# -----------------------------------------------------------------------------
def test_session_isolation_prevents_cross_session_leakage(client):
    db = TestingSessionLocal()
    sess_a_id = uuid.uuid4()
    sess_b_id = uuid.uuid4()
    art_a_id = uuid.uuid4()
    sess_a = ChatSession(id=sess_a_id, title="Session A")
    sess_b = ChatSession(id=sess_b_id, title="Session B")
    art_a = Artifact(
        id=art_a_id,
        session_id=sess_a_id,
        title="Artifact A Only",
        artifact_type="markdown",
        source_content="# Confidential A",
        generation_status="completed",
        provider="ollama",
    )
    db.add_all([sess_a, sess_b, art_a])
    db.commit()
    db.close()

    # Retrieving art_a via sess_b must return 404
    res = client.get(f"/api/sessions/{sess_b_id}/artifacts/{art_a_id}")
    assert res.status_code == 404
    assert "not found in session" in res.json()["detail"]

    # Listing sess_b artifacts must not return art_a
    list_res = client.get(f"/api/sessions/{sess_b_id}/artifacts")
    assert list_res.status_code == 200
    assert len(list_res.json()["data"]) == 0


# -----------------------------------------------------------------------------
# 5. Markdown Artifact Generation Contracts
# -----------------------------------------------------------------------------
def test_create_markdown_artifact_contract(client, test_session):
    mock_agent = MockArtifactAgentClient(
        response_data={
            "title": "PLG Growth Playbook",
            "artifact_type": "markdown",
            "source_content": "# PLG Playbook\n\n1. Frictionless onboarding\n2. Viral loop",
            "citations": [],
            "provider": "ollama",
            "model": "qwen2.5:1.5b",
            "duration_ms": 100,
        }
    )
    app.dependency_overrides[get_agent_client] = lambda: mock_agent

    res = client.post(
        f"/api/sessions/{test_session.id}/artifacts",
        json={
            "title": "PLG Growth Playbook",
            "artifact_type": "markdown",
            "instructions": "Outline 5 rules of product-led growth",
        },
    )
    assert res.status_code == 202
    data = res.json()["data"]
    assert data["title"] == "PLG Growth Playbook"
    assert data["artifact_type"] == "markdown"
    assert data["generation_status"] in ["generating", "completed"]


# -----------------------------------------------------------------------------
# 6. HTML Artifact Generation Contracts & Retrieval
# -----------------------------------------------------------------------------
def test_create_html_artifact_contract_and_retrieval(client, test_session):
    mock_agent = MockArtifactAgentClient()
    app.dependency_overrides[get_agent_client] = lambda: mock_agent

    res = client.post(
        f"/api/sessions/{test_session.id}/artifacts",
        json={
            "title": "Elena Verna B2B Growth Strategy",
            "artifact_type": "html",
            "instructions": "Create a modern visual card comparing PLG vs Sales-led",
        },
    )
    assert res.status_code == 202
    art_id = res.json()["data"]["artifact_id"]

    # Fetch detail
    get_res = client.get(f"/api/sessions/{test_session.id}/artifacts/{art_id}")
    assert get_res.status_code == 200
    detail = get_res.json()["data"]
    assert detail["title"] == "Elena Verna B2B Growth Strategy"
    assert detail["artifact_type"] == "html"


# -----------------------------------------------------------------------------
# 7. Safe HTML Accepted via Job Execution
# -----------------------------------------------------------------------------
def test_safe_html_job_completes_successfully(test_session):
    art_id = uuid.uuid4()
    db = TestingSessionLocal()
    art = Artifact(
        id=art_id,
        session_id=test_session.id,
        title="Safe Dashboard",
        artifact_type="html",
        generation_status="generating",
    )
    db.add(art)
    db.commit()
    db.close()

    safe_html = "<!DOCTYPE html><html><head><style>h1 { color: #BE5103; }</style></head><body><h1>Metrics</h1><p>Clean text</p></body></html>"
    mock_agent = MockArtifactAgentClient(
        response_data={
            "title": "Safe Dashboard",
            "artifact_type": "html",
            "source_content": safe_html,
            "citations": [],
            "provider": "ollama",
            "model": "qwen2.5:1.5b",
        }
    )

    asyncio.run(
        run_artifact_generation_job(
            artifact_id=art_id,
            session_id=test_session.id,
            title="Safe Dashboard",
            artifact_type="html",
            instructions="Build clean metrics",
            topic=None,
            candidate_passages=[],
            provider="ollama",
            model="qwen2.5:1.5b",
            agent_client_override=mock_agent,
            session_factory=TestingSessionLocal,
        )
    )

    verify_db = TestingSessionLocal()
    updated = verify_db.query(Artifact).filter(Artifact.id == art_id).first()
    assert updated.generation_status == "completed"
    assert updated.source_content == safe_html
    assert updated.validation_results["is_valid"] is True
    assert updated.error is None
    verify_db.close()


# -----------------------------------------------------------------------------
# 8. Script Elements Rejected -> validation_failed
# -----------------------------------------------------------------------------
def test_script_tag_in_html_sets_validation_failed(test_session):
    art_id = uuid.uuid4()
    db = TestingSessionLocal()
    art = Artifact(
        id=art_id,
        session_id=test_session.id,
        title="Malicious Script Artifact",
        artifact_type="html",
        generation_status="generating",
    )
    db.add(art)
    db.commit()
    db.close()

    malicious_html = "<div><h1>Header</h1><script>alert('pwned')</script></div>"
    mock_agent = MockArtifactAgentClient(
        response_data={
            "title": "Malicious Script Artifact",
            "artifact_type": "html",
            "source_content": malicious_html,
            "citations": [],
            "provider": "ollama",
        }
    )

    asyncio.run(
        run_artifact_generation_job(
            artifact_id=art_id,
            session_id=test_session.id,
            title="Malicious Script Artifact",
            artifact_type="html",
            instructions="Test",
            topic=None,
            candidate_passages=[],
            provider="ollama",
            model="qwen2.5:1.5b",
            agent_client_override=mock_agent,
            session_factory=TestingSessionLocal,
        )
    )

    verify_db = TestingSessionLocal()
    updated = verify_db.query(Artifact).filter(Artifact.id == art_id).first()
    assert updated.generation_status == "validation_failed"
    assert "HTML failed security validation" in updated.error
    assert updated.validation_results["is_valid"] is False
    assert any("Forbidden tag <script>" in err for err in updated.validation_results["errors"])
    verify_db.close()


# -----------------------------------------------------------------------------
# 9. Inline Event Handlers Rejected -> validation_failed
# -----------------------------------------------------------------------------
def test_inline_event_handler_sets_validation_failed(test_session):
    art_id = uuid.uuid4()
    db = TestingSessionLocal()
    art = Artifact(
        id=art_id,
        session_id=test_session.id,
        title="Inline Handler Artifact",
        artifact_type="html",
        generation_status="generating",
    )
    db.add(art)
    db.commit()
    db.close()

    handler_html = "<button onclick=\"alert('click')\">Button</button>"
    mock_agent = MockArtifactAgentClient(
        response_data={
            "title": "Inline Handler Artifact",
            "artifact_type": "html",
            "source_content": handler_html,
            "citations": [],
            "provider": "ollama",
        }
    )

    asyncio.run(
        run_artifact_generation_job(
            artifact_id=art_id,
            session_id=test_session.id,
            title="Inline Handler Artifact",
            artifact_type="html",
            instructions="Test",
            topic=None,
            candidate_passages=[],
            provider="ollama",
            model="qwen2.5:1.5b",
            agent_client_override=mock_agent,
            session_factory=TestingSessionLocal,
        )
    )

    verify_db = TestingSessionLocal()
    updated = verify_db.query(Artifact).filter(Artifact.id == art_id).first()
    assert updated.generation_status == "validation_failed"
    assert any("Inline event handler 'onclick'" in err for err in updated.validation_results["errors"])
    verify_db.close()


# -----------------------------------------------------------------------------
# 10. Unsafe URLs Rejected -> validation_failed
# -----------------------------------------------------------------------------
def test_javascript_url_sets_validation_failed(test_session):
    art_id = uuid.uuid4()
    db = TestingSessionLocal()
    art = Artifact(
        id=art_id,
        session_id=test_session.id,
        title="JS URL Artifact",
        artifact_type="html",
        generation_status="generating",
    )
    db.add(art)
    db.commit()
    db.close()

    js_url_html = "<a href=\"javascript:alert('xss')\">Click</a>"
    mock_agent = MockArtifactAgentClient(
        response_data={
            "title": "JS URL Artifact",
            "artifact_type": "html",
            "source_content": js_url_html,
            "citations": [],
            "provider": "ollama",
        }
    )

    asyncio.run(
        run_artifact_generation_job(
            artifact_id=art_id,
            session_id=test_session.id,
            title="JS URL Artifact",
            artifact_type="html",
            instructions="Test",
            topic=None,
            candidate_passages=[],
            provider="ollama",
            model="qwen2.5:1.5b",
            agent_client_override=mock_agent,
            session_factory=TestingSessionLocal,
        )
    )

    verify_db = TestingSessionLocal()
    updated = verify_db.query(Artifact).filter(Artifact.id == art_id).first()
    assert updated.generation_status == "validation_failed"
    assert any("Dangerous URL scheme 'javascript:'" in err for err in updated.validation_results["errors"])
    verify_db.close()


# -----------------------------------------------------------------------------
# 11. External Resource Restrictions -> validation_failed
# -----------------------------------------------------------------------------
def test_external_stylesheet_sets_validation_failed(test_session):
    art_id = uuid.uuid4()
    db = TestingSessionLocal()
    art = Artifact(
        id=art_id,
        session_id=test_session.id,
        title="External CSS Artifact",
        artifact_type="html",
        generation_status="generating",
    )
    db.add(art)
    db.commit()
    db.close()

    ext_css_html = "<head><link rel=\"stylesheet\" href=\"https://remote.com/style.css\"></head><body>Body</body>"
    mock_agent = MockArtifactAgentClient(
        response_data={
            "title": "External CSS Artifact",
            "artifact_type": "html",
            "source_content": ext_css_html,
            "citations": [],
            "provider": "ollama",
        }
    )

    asyncio.run(
        run_artifact_generation_job(
            artifact_id=art_id,
            session_id=test_session.id,
            title="External CSS Artifact",
            artifact_type="html",
            instructions="Test",
            topic=None,
            candidate_passages=[],
            provider="ollama",
            model="qwen2.5:1.5b",
            agent_client_override=mock_agent,
            session_factory=TestingSessionLocal,
        )
    )

    verify_db = TestingSessionLocal()
    updated = verify_db.query(Artifact).filter(Artifact.id == art_id).first()
    assert updated.generation_status == "validation_failed"
    assert any("external stylesheet import is forbidden" in err for err in updated.validation_results["errors"])
    verify_db.close()


# -----------------------------------------------------------------------------
# 12. Provider Validation
# -----------------------------------------------------------------------------
def test_unsupported_provider_rejected(client, test_session):
    res = client.post(
        f"/api/sessions/{test_session.id}/artifacts",
        json={
            "title": "Test Artifact",
            "artifact_type": "html",
            "instructions": "Test instructions",
            "provider": "unsupported_llm",
        },
    )
    assert res.status_code == 400
    assert "Unsupported provider" in res.json()["detail"]


# -----------------------------------------------------------------------------
# 13. Pi SDK Invocation & Duplicate Job Prevention
# -----------------------------------------------------------------------------
def test_duplicate_in_flight_generation_rejected(client, test_session):
    db = TestingSessionLocal()
    in_flight = Artifact(
        id=uuid.uuid4(),
        session_id=test_session.id,
        title="Running Job",
        artifact_type="html",
        generation_status="generating",
    )
    db.add(in_flight)
    db.commit()
    db.close()

    res = client.post(
        f"/api/sessions/{test_session.id}/artifacts",
        json={
            "title": "Second Job",
            "artifact_type": "html",
            "instructions": "Should conflict",
        },
    )
    assert res.status_code == 409
    assert "already in progress" in res.json()["detail"]


# -----------------------------------------------------------------------------
# 14. Citation Provenance Verification
# -----------------------------------------------------------------------------
def test_citation_provenance_rejects_fabricated_chunks(test_session):
    art_id = uuid.uuid4()
    db = TestingSessionLocal()
    art = Artifact(
        id=art_id,
        session_id=test_session.id,
        title="Citation Provenance Artifact",
        artifact_type="markdown",
        generation_status="generating",
    )
    db.add(art)
    db.commit()
    db.close()

    class MockPassage:
        def __init__(self, chunk_id, content):
            self.chunk_id = chunk_id
            self.transcript_id = None
            self.episode_slug = "brian-chesky"
            self.episode_title = "Brian Chesky on Airbnb"
            self.guest = "Brian Chesky"
            self.speaker = "Brian Chesky"
            self.source_url = "https://youtube.com/watch?v=123"
            self.start_timestamp = "00:05:00"
            self.end_timestamp = "00:07:00"
            self.content = content

    valid_chunk_id = str(uuid.uuid4())
    passages = [MockPassage(valid_chunk_id, "Real retrieved text")]

    mock_agent = MockArtifactAgentClient(
        response_data={
            "title": "Citation Provenance Artifact",
            "artifact_type": "markdown",
            "source_content": "# Document",
            "citations": [
                {"chunk_id": valid_chunk_id},
                {"chunk_id": "fabricated-fake-uuid-999"},
            ],
            "provider": "ollama",
        }
    )

    asyncio.run(
        run_artifact_generation_job(
            artifact_id=art_id,
            session_id=test_session.id,
            title="Citation Provenance Artifact",
            artifact_type="markdown",
            instructions="Test",
            topic=None,
            candidate_passages=passages,
            provider="ollama",
            model="qwen2.5:1.5b",
            agent_client_override=mock_agent,
            session_factory=TestingSessionLocal,
        )
    )

    verify_db = TestingSessionLocal()
    updated = verify_db.query(Artifact).filter(Artifact.id == art_id).first()
    assert updated.generation_status == "completed"
    # Fabricated chunk ID was dropped; only verified chunk preserved!
    assert len(updated.citations) == 1
    assert updated.citations[0]["chunk_id"] == valid_chunk_id
    verify_db.close()


# -----------------------------------------------------------------------------
# 15. Job Persistence Across States
# -----------------------------------------------------------------------------
def test_job_persistence_and_listing(client, test_session):
    db = TestingSessionLocal()
    a1 = Artifact(
        id=uuid.uuid4(),
        session_id=test_session.id,
        title="Artifact 1",
        artifact_type="html",
        generation_status="completed",
        provider="ollama",
    )
    a2 = Artifact(
        id=uuid.uuid4(),
        session_id=test_session.id,
        title="Artifact 2",
        artifact_type="markdown",
        generation_status="failed",
        error="Inference timeout",
        provider="ollama",
    )
    db.add_all([a1, a2])
    db.commit()
    db.close()

    res = client.get(f"/api/sessions/{test_session.id}/artifacts")
    assert res.status_code == 200
    items = res.json()["data"]
    assert len(items) == 2
    statuses = {item["generation_status"] for item in items}
    assert "completed" in statuses
    assert "failed" in statuses


# -----------------------------------------------------------------------------
# 16. Timeout and Failed-Status Handling
# -----------------------------------------------------------------------------
def test_agent_timeout_persists_failed_status(test_session):
    art_id = uuid.uuid4()
    db = TestingSessionLocal()
    art = Artifact(
        id=art_id,
        session_id=test_session.id,
        title="Timing Out Artifact",
        artifact_type="html",
        generation_status="generating",
    )
    db.add(art)
    db.commit()
    db.close()

    mock_agent = MockArtifactAgentClient(
        error_to_raise=AgentTimeoutError("Agent service timed out after 300s")
    )

    asyncio.run(
        run_artifact_generation_job(
            artifact_id=art_id,
            session_id=test_session.id,
            title="Timing Out Artifact",
            artifact_type="html",
            instructions="Test",
            topic=None,
            candidate_passages=[],
            provider="ollama",
            model="qwen2.5:1.5b",
            agent_client_override=mock_agent,
            session_factory=TestingSessionLocal,
        )
    )

    verify_db = TestingSessionLocal()
    updated = verify_db.query(Artifact).filter(Artifact.id == art_id).first()
    assert updated.generation_status == "failed"
    assert "timed out after 300s" in updated.error
    verify_db.close()


# -----------------------------------------------------------------------------
# 17. Non-Destructive Migration Verification
# -----------------------------------------------------------------------------
def test_alembic_migration_defines_upgrade_and_downgrade():
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "migration",
        "alembic/versions/e5f6a1b2c3d4_create_artifacts_table.py",
    )
    migration_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration_mod)

    assert hasattr(migration_mod, "upgrade")
    assert hasattr(migration_mod, "downgrade")
    assert migration_mod.revision == "e5f6a1b2c3d4"
    assert migration_mod.down_revision == "d4e5f6a1b2c3"

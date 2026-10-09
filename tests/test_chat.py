import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.main import app
from backend.app.database import get_db, Base
from backend.app.models.chat import ChatSession, ChatMessage

# Create in-memory SQLite db for testing
# NOTE: We use SQLite for tests because we don't assume the PostgreSQL database is safely available for destructive tests.
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

client = TestClient(app, raise_server_exceptions=False)

@pytest.fixture(autouse=True)
def setup_db():
    # Create tables
    Base.metadata.create_all(bind=engine)
    yield
    # Drop tables
    Base.metadata.drop_all(bind=engine)

def test_create_session():
    response = client.post("/api/sessions", json={"title": "Test Session", "user_metadata": {"foo": "bar"}})
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Test Session"
    assert "id" in data
    assert data["user_metadata"] == {"foo": "bar"}

def test_list_sessions():
    client.post("/api/sessions", json={"title": "Session 1"})
    client.post("/api/sessions", json={"title": "Session 2"})

    response = client.get("/api/sessions")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2

def test_independent_session_isolation():
    r1 = client.post("/api/sessions", json={"title": "S1"})
    s1_id = r1.json()["id"]
    r2 = client.post("/api/sessions", json={"title": "S2"})
    s2_id = r2.json()["id"]

    client.post(f"/api/sessions/{s1_id}/messages", json={"role": "user", "content": "msg1"})
    client.post(f"/api/sessions/{s2_id}/messages", json={"role": "user", "content": "msg2"})

    r1_msgs = client.get(f"/api/sessions/{s1_id}/messages").json()
    r2_msgs = client.get(f"/api/sessions/{s2_id}/messages").json()

    assert len(r1_msgs) == 1
    assert r1_msgs[0]["content"] == "msg1"

    assert len(r2_msgs) == 1
    assert r2_msgs[0]["content"] == "msg2"

def test_message_persistence():
    r = client.post("/api/sessions", json={"title": "S"})
    s_id = r.json()["id"]

    msg = client.post(f"/api/sessions/{s_id}/messages", json={"role": "user", "content": "hello", "structured_metadata": {"time": "now"}})
    assert msg.status_code == 201
    msg_data = msg.json()
    assert msg_data["content"] == "hello"
    assert msg_data["role"] == "user"

def test_ordered_message_retrieval():
    r = client.post("/api/sessions", json={"title": "S"})
    s_id = r.json()["id"]

    client.post(f"/api/sessions/{s_id}/messages", json={"role": "user", "content": "first"})
    client.post(f"/api/sessions/{s_id}/messages", json={"role": "assistant", "content": "second"})

    msgs = client.get(f"/api/sessions/{s_id}/messages").json()
    assert len(msgs) == 2
    assert msgs[0]["content"] == "first"
    assert msgs[1]["content"] == "second"

def test_invalid_session_ids():
    response = client.get("/api/sessions/invalid-uuid-format")
    assert response.status_code == 422 # validation error

def test_missing_session_ids():
    import uuid
    random_uuid = str(uuid.uuid4())
    response = client.get(f"/api/sessions/{random_uuid}")
    assert response.status_code == 404

def test_invalid_request_bodies():
    r = client.post("/api/sessions", json={"title": "S"})
    s_id = r.json()["id"]

    response = client.post(f"/api/sessions/{s_id}/messages", json={"role": "user"}) # missing content
    assert response.status_code == 422

def test_db_connection_failure(monkeypatch):
    from sqlalchemy.exc import SQLAlchemyError
    from backend.app.routers.chat import get_db

    def override_get_db_error():
        raise SQLAlchemyError("Mocked DB connection failure")
        yield

    app.dependency_overrides[get_db] = override_get_db_error

    # Simulate API call with broken DB - TestClient with raise_server_exceptions=False returns 500
    response = client.get("/api/sessions")
    assert response.status_code == 500
    assert response.text == "Internal Server Error"

    # Restore overrides
    app.dependency_overrides[get_db] = override_get_db

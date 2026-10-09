import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.main import app
from backend.app.database import get_db, Base
from backend.app.config import settings

# Guard: Only run if explicitly requested
RUN_POSTGRES_TESTS = os.getenv("RUN_POSTGRES_TESTS", "0") == "1"
if not RUN_POSTGRES_TESTS:
    pytest.skip("Skipping PostgreSQL integration tests (RUN_POSTGRES_TESTS != 1)", allow_module_level=True)

# Important: Test database should be isolated if possible, but since we are running locally
# for the assignment, we use the actual lenny_assistant db. We will rely on transaction rollback
# or explicit teardown of our test data.
db_url = settings.DATABASE_URL
if db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+psycopg2://", 1)
engine = create_engine(db_url)
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
    app.dependency_overrides[get_db] = override_get_db
    # We do NOT create or drop all tables here because this is the real PostgreSQL DB
    # that should be managed by Alembic. We will just yield.
    # The tests should clean up any data they create.
    yield

def test_pg_session_and_message_persistence():
    # 1. Create a session
    r1 = client.post("/api/sessions", json={"title": "PG Test Session", "user_metadata": {"test": True}})
    assert r1.status_code == 201
    s_id = r1.json()["id"]

    # 2. Add a message
    r2 = client.post(f"/api/sessions/{s_id}/messages", json={"role": "user", "content": "PG Test Message"})
    assert r2.status_code == 201

    # 3. Retrieve the message
    r3 = client.get(f"/api/sessions/{s_id}/messages")
    assert r3.status_code == 200
    msgs = r3.json()
    assert len(msgs) == 1
    assert msgs[0]["content"] == "PG Test Message"

    # Cleanup: We can rely on a DELETE endpoint if one existed, but since it doesn't,
    # we will delete it manually from the DB session.
    db = TestingSessionLocal()
    from backend.app.models.chat import ChatSession
    session_obj = db.query(ChatSession).filter(ChatSession.id == s_id).first()
    if session_obj:
        db.delete(session_obj)
        db.commit()
    db.close()

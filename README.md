# The Lenny Growth Assistant

An AI-powered conversational web application grounded in Lenny's Podcast and Newsletter transcripts. Built for product managers, growth leaders, and founders to query tactical frameworks, generate Ship 30 for 30 essays, and preview interactive artifacts side-by-side.

---

## Architecture Overview

The application is structured as a full-stack monorepo:
* **Frontend (`/frontend`):** React 18 + Vite SPA featuring a dual-panel conversational and artifact viewing interface.
* **Backend (`/backend`):** FastAPI application providing REST API endpoints, Pydantic schemas, and centralized settings.
* **Documentation (`/docs`):** Comprehensive Product Requirements (`PRD.md`), UI/UX design specifications (`design.md`), and system architecture specifications (`architecture.md`).
* **Tests (`/tests`):** Automated test suite running with pytest and FastAPI TestClient.
* **Agent Logs (`/agent-logs`):** Operational audit logs and milestone verification records.

---

## Prerequisites (Windows 11)

* **Python:** 3.11+
* **Node.js:** v20+ (v22.19.0 verified)
* **npm:** 10+ (10.9.3 verified)
* **Ollama:** Installed locally (for mandatory local LLM demo)
* **PowerShell:** Version 5.1+ or PowerShell 7

---

## Project Structure

```
E:\lenny-growth-assistant\
├── .env.example              # Template environment configuration (no secrets)
├── .gitignore                # Comprehensive exclusions for venv, build, and node_modules
├── README.md                 # Project guide and operational instructions
├── agent-logs/               # Milestone audit records and transcripts
│   └── task-01-audit.md      # Task 01 mandatory audit report
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── config.py         # Pydantic BaseSettings configuration
│   │   ├── main.py           # FastAPI entrypoint with CORS & routing
│   │   ├── routers/
│   │   │   ├── __init__.py
│   │   │   └── health.py     # GET /health endpoint
│   │   └── schemas/
│   │       ├── __init__.py
│   │       ├── common.py     # API envelope & error schemas
│   │       └── health.py     # Health response models
│   └── requirements.txt      # Pinned backend dependencies
├── docs/
│   ├── PRD.md                # Discovery brief, metrics, assumptions, and risks
│   ├── design.md             # UI/UX principles, layout, states, and accessibility
│   └── architecture.md       # Schemas, component boundaries, and pipeline design
├── frontend/
│   ├── index.html            # Application HTML shell
│   ├── package.json          # Vite + React dependencies
│   ├── vite.config.js        # Vite build configuration
│   └── src/
│       ├── App.jsx           # Main UI with responsive dual-panel layout
│       ├── index.css         # Dark theme design system & styling
│       └── main.jsx          # React DOM entrypoint
├── scripts/
│   └── check_env.py          # Environment diagnostics helper
└── tests/
    ├── __init__.py
    └── test_health.py        # Automated test for FastAPI health check
```

---

## Installation & Setup (Windows)

All commands are executed from the project root: `E:\lenny-growth-assistant`.

### 1. Backend Setup

Create and activate the local virtual environment, then install backend requirements:

```powershell
# Create virtual environment if not already present
python -m venv .venv

# Activate virtual environment
.\.venv\Scripts\Activate.ps1

# Install dependencies
.\.venv\Scripts\pip.exe install -r backend\requirements.txt
```

### 2. Frontend Setup

Install frontend Node dependencies:

```powershell
cd frontend
npm install
cd ..
```

### 3. Agent Service Setup (Node.js Pi Agent)

Install agent service Node dependencies:

```powershell
cd agent-service
npm install
cd ..
```

### 4. Environment Configuration

Copy the example environment configuration:

```powershell
Copy-Item .env.example .env
```

Ensure `.env` contains safe parameters. Generate and configure the private internal bridge shared secret:

```powershell
# Generate a cryptographically secure random token:
.\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_hex(32))"
```

Add the generated token to `.env` as `AGENT_INTERNAL_SECRET=<your_token>`. Both FastAPI and the Node.js Pi Agent Service read this secret to authenticate inter-process requests. If missing or blank, both services fail closed.

### 5. Database Setup (PostgreSQL)

You must manually initialize the PostgreSQL database and application role securely:

1. Run the initialization script as the PostgreSQL administrator (e.g. `postgres` user) to create the role and database:
   ```powershell
   psql -U postgres -h 127.0.0.1 -p 5432 -f scripts\setup_db.sql
   ```
2. Set a secure password for the `lenny_app` role using the interactive prompt:
   ```powershell
   psql -U postgres -h 127.0.0.1 -p 5432 -c "\password lenny_app"
   ```
3. Run the configuration helper to securely inject your URL-encoded password into your `.env` file:
   ```powershell
   .\.venv\Scripts\python.exe scripts\configure_db_env.py
   ```
4. Apply the initial Alembic migration to create tables in the `lenny_assistant` database:
   ```powershell
   .\.venv\Scripts\alembic upgrade head
   ```

---

## Running the Application Locally

The application components run in separate processes. Because this development system has 8 GB RAM, start services sequentially and ensure at least 1.5 GB free RAM before running live local LLM inference.

### 1. Start Ollama (Local LLM)

In terminal 1:
```powershell
ollama serve
```
Ensure the default model is downloaded:
```powershell
ollama pull qwen2.5:1.5b
```

### 2. Start the Node.js Pi Agent Service

In terminal 2:
```powershell
cd agent-service
node src/server.mjs
```
* Service Health: [http://127.0.0.1:8001/health](http://127.0.0.1:8001/health)

### 3. Start the FastAPI Backend

In terminal 3:
```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```
* API Root: [http://127.0.0.1:8000/](http://127.0.0.1:8000/)
* Health Endpoint: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)
* Provider Status: [http://127.0.0.1:8000/api/sessions/status](http://127.0.0.1:8000/api/sessions/status)
* Interactive Swagger Docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

### 4. Start the Frontend

In terminal 4:
```powershell
cd frontend
npm run dev
```
* Frontend UI: [http://localhost:5173/](http://localhost:5173/)

---

## Running Automated Tests

### Backend Python Tests (pytest)
Run all backend unit and mock integration tests (health, sessions, knowledge, agent bridge & quality):

```powershell
.\.venv\Scripts\python.exe -m pytest -v
```

### Agent Service Node.js Tests
Run isolated unit tests for the Pi Agent Service:

```powershell
cd agent-service
npm test
cd ..
```


All API endpoints, health check, session isolation, and agent bridge tests will run.
Note: For testing resilience, the unit test suite (`tests/test_chat.py`) uses an isolated in-memory SQLite database (`sqlite:///:memory:`) via dependency injection to avoid accidental manipulation of the PostgreSQL development database.

### Running PostgreSQL Integration Tests

To verify functionality against the real PostgreSQL database:

```powershell
$env:RUN_POSTGRES_TESTS="1"
.\.venv\Scripts\pytest.exe tests\test_postgres_integration.py -v
```

This verifies actual persistence, indexing, and foreign-key behavior inside PostgreSQL using disposable test data.

---

## Verifying Persistence Across Restarts

1. Start the FastAPI backend and create a session.
2. Terminate the FastAPI process (`Ctrl+C`).
3. Restart the FastAPI backend.
4. Issue a `GET /api/sessions` request to verify the session remains available.

Example API Response (`GET /api/sessions`):
```json
[
  {
    "title": "My Session",
    "user_metadata": {},
    "id": "e81c01e6-9ab5-46ba-b847-bb0364d26210",
    "created_at": "2026-10-09T15:00:00Z",
    "updated_at": "2026-10-09T15:00:00Z"
  }
]
```

---

## Transcript Ingestion & Knowledge Base (Task 03)

The Lenny Growth Assistant retrieves source-grounded insights from transcripts in the authoritative archive:
[https://github.com/ChatPRD/lennys-podcast-transcripts](https://github.com/ChatPRD/lennys-podcast-transcripts).

### Ingestion CLI Operations

All ingestion operations are performed via `scripts/ingest.py`:

```powershell
# 1. View current knowledge base status
.\.venv\Scripts\python.exe scripts/ingest.py --status

# 2. Download and ingest the deterministic flagship dataset (10 core growth episodes)
.\.venv\Scripts\python.exe scripts/ingest.py --download --flagship

# 3. Ingest all available transcripts (all 300+ episodes)
.\.venv\Scripts\python.exe scripts/ingest.py --download --all

# 4. Ingest specific episodes by slug
.\.venv\Scripts\python.exe scripts/ingest.py --episodes brian-chesky shreyas-doshi

# 5. Force re-chunking and re-indexing even if content hashes match
.\.venv\Scripts\python.exe scripts/ingest.py --flagship --force
```

### Knowledge Base API Endpoints

* **Search Transcripts:**
  `GET /api/knowledge/search?q=product+market+fit&limit=5`
  Returns matching passages, speaker attribution, start/end timestamps, relevance score, episode title, guest name, and canonical YouTube URL.
* **Knowledge Base Status:**
  `GET /api/knowledge/status`
  Returns total indexed transcripts, chunk counts, search engine status, and episode summaries.

---

## Frontend Build Verification

To verify the production build of the frontend:

```powershell
cd frontend
npm run build
cd ..
```

---

## Troubleshooting

1. **PowerShell Script Execution Policy Error:**
   If running `.\.venv\Scripts\Activate.ps1` gives an execution policy error, either run:
   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   ```
   Or call the virtual environment Python binary directly: `.\.venv\Scripts\python.exe`.

2. **Ollama Connection:**
   Ensure Ollama is running locally for future milestones:
   ```powershell
   ollama list
   ```

3. **Database Connection Errors:**
   If the API returns `500 Internal Server Error` (e.g. `No module named 'psycopg'` or `password authentication failed`), verify that:
   - You used `configure_db_env.py` to securely store your password in `.env`.
   - Your `.env` URL contains `postgresql+psycopg2://` (or `postgresql://` which the backend config automatically handles).
   - PostgreSQL is running on `127.0.0.1:5432`.

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

### 3. Environment Configuration

Copy the example environment configuration:

```powershell
Copy-Item .env.example .env
```

Ensure `.env` contains safe default parameters. No actual API keys or secrets are committed.

---

## Running the Application Locally

### Running the Backend

Start the FastAPI development server:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```

* API Root: [http://127.0.0.1:8000/](http://127.0.0.1:8000/)
* Health Endpoint: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)
* Interactive Swagger Docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

### Running the Frontend

In a separate terminal window:

```powershell
cd frontend
npm run dev
```

* Frontend UI: [http://localhost:5173/](http://localhost:5173/)

---

## Running Automated Tests

Run the backend pytest suite:

```powershell
.\.venv\Scripts\python.exe -m pytest -v
```

All health check tests and schema validations will run and report status.

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

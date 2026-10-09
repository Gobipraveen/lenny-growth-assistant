# Architecture Specification
## The Lenny Growth Assistant - System Design & Boundaries

**Document Version:** 0.1.0<br />
**Status:** Provisional (To be validated against concrete Agent SDK & Ollama runtimes)

---

## 1. Architectural Overview & Boundaries

The Lenny Growth Assistant is designed as a decoupled, full-stack application composed of:
1. **Frontend Client:** React (SPA) built with Vite, handling chat streaming, artifact rendering, and state management.
2. **Backend API:** FastAPI (Python 3.11) exposing asynchronous REST and WebSocket/SSE endpoints for session lifecycle, chat streaming, and agent execution.
3. **Agent & Retrieval Layer:** Agent orchestrator (Anthropic Claude Agent SDK / Pi Coding Agent / Ollama Adapter) with vector/keyword retrieval over Lenny's Podcast transcripts.
4. **Data Persistence:** PostgreSQL for storing user sessions, message histories, transcript metadata, and generated artifacts.

```
+-------------------------------------------------------------------------+
|                              REACT FRONTEND                             |
|  [Chat Interface]  <---- Event Stream / SSE ---->  [Artifact Sandbox]   |
+------------------------------------+------------------------------------+
                                     | HTTP / WebSocket
                                     v
+-------------------------------------------------------------------------+
|                            FASTAPI BACKEND                              |
|  [Routers: /health, /sessions, /chat, /artifacts, /models]             |
|  [Pydantic Validation & Settings]                                       |
+------------------+----------------------------------+-------------------+
                   |                                  |
                   v                                  v
+------------------------------------+   +--------------------------------+
|       PERSISTENCE LAYER            |   |     AGENT & RETRIEVAL LAYER    |
| - PostgreSQL (Sessions & Messages) |   | - Agent Controller             |
| - Artifact store                   |   | - Ship 30 for 30 Skill Engine  |
| - Vector index / Transcript chunks |   | - Hybrid Vector & BM25 Search  |
+------------------------------------+   +----------------+---------------+
                                                          |
                                      +-------------------+-------------------+
                                      |                                       |
                                      v                                       v
                             [Local Ollama (Llama 3)]             [Cloud LLM (Claude 3.5)]
```

---

## 2. Provisional Architecture Disclaimer
> **Important Note:** All architectural definitions—including the agent orchestration engine, schema definitions, and retrieval mechanisms—are **provisional**. Concrete implementations will be finalized once local Ollama inference speeds, agent SDK dependencies, and vector database trade-offs are validated on the target Windows environment.

---

## 3. Database Schema (Target Relational Design)

The planned PostgreSQL relational schema supports multi-turn chat sessions, persistent transcripts, and artifact versioning:

### 3.1 `sessions`
* `id` (UUID, Primary Key): Unique session identifier.
* `title` (VARCHAR(255)): Generated or user-defined session title.
* `model_provider` (VARCHAR(50)): Active LLM provider (`ollama`, `anthropic`, `openai`).
* `model_name` (VARCHAR(100)): Specific model ID (e.g., `llama3:8b`, `claude-3-5-sonnet`).
* `created_at` (TIMESTAMP WITH TIME ZONE, Default NOW()).
* `updated_at` (TIMESTAMP WITH TIME ZONE, Default NOW()).

### 3.2 `messages`
* `id` (UUID, Primary Key): Unique message ID.
* `session_id` (UUID, Foreign Key $\rightarrow$ `sessions.id` ON DELETE CASCADE).
* `role` (VARCHAR(20)): Sender (`user`, `assistant`, `system`).
* `content` (TEXT): Message markdown text.
* `citations` (JSONB): Array of referenced transcript segments `[{ episode, guest, timestamp, quote }]`.
* `created_at` (TIMESTAMP WITH TIME ZONE).

### 3.3 `artifacts`
* `id` (UUID, Primary Key): Unique artifact ID.
* `session_id` (UUID, Foreign Key $\rightarrow$ `sessions.id`).
* `message_id` (UUID, Foreign Key $\rightarrow$ `messages.id`).
* `artifact_type` (VARCHAR(30)): Type (`markdown`, `html`, `essay_ship30`).
* `title` (VARCHAR(255)): Artifact title.
* `content` (TEXT): Full content of generated artifact.
* `metadata` (JSONB): Word count, generation parameters, skill attributes.
* `created_at` (TIMESTAMP WITH TIME ZONE).

### 3.4 `transcripts` & `chunks`
* `episode_id` (VARCHAR(100), Primary Key): Episode slug / identifier.
* `title` (TEXT), `guest` (VARCHAR(255)), `published_date` (DATE).
* `chunk_id` (UUID, Primary Key): Chunk identifier.
* `chunk_text` (TEXT), `embedding` (VECTOR(1536) or local embedding size).
* `metadata` (JSONB): Timestamps, speaker markers.

---

## 4. API Endpoints Contract (Provisional)

| Method | Endpoint | Description | Status |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Operational health check of backend services. | **Implemented (Task 01)** |
| `GET` | `/api/v1/models` | List available LLM backends (Ollama status & Cloud availability). | Planned |
| `POST` | `/api/v1/sessions` | Create a new isolated chat session. | Planned |
| `GET` | `/api/v1/sessions` | List active sessions with summaries. | Planned |
| `POST` | `/api/v1/chat` | Send prompt and receive streaming response with citations. | Planned |
| `GET` | `/api/v1/artifacts/{id}` | Retrieve generated artifact for in-app viewer. | Planned |

---

## 5. Ingestion & Grounding Flow

```
[Raw Lenny Transcripts]
       │
       ▼
[Text Cleaning & Normalization]
       │
       ▼
[Chunking (500-800 tokens with speaker preservation)]
       │
       ▼
[Embedding Generation (Local Ollama / Cloud)]
       │
       ▼
[Vector Store / PostgreSQL pgvector / Chroma]
```

### Retrieval & Query Pipeline
1. User prompt is received by the backend.
2. Query Rewriter extracts key tactical product concepts.
3. Hybrid search (BM25 keyword + semantic vector similarity) retrieves top $K$ relevant transcript chunks.
4. If relevance score falls below threshold $\theta$, the agent explicitly acknowledges that transcripts do not contain the answer.
5. Grounded prompt context is injected into the selected model with strict citation instructions.

---

## 6. Flexible Model Switcher & Local-First Strategy

* **Local Inference (Mandatory for Demo):** Runs against local Ollama (`http://localhost:11434`) using models such as `llama3` or `qwen2.5`.
* **Cloud Fallback / Toggle:** Supports Anthropic Claude or OpenAI via standard SDK adapters.
* **Failure Handling:** If local Ollama is offline or experiences GPU out-of-memory errors, the backend returns clear diagnostic errors without crashing.

---

## 7. Security Topology

1. **Untrusted Content Isolation:** All model-generated HTML/CSS is isolated within sandboxed `<iframe>` instances with strict CSP rules.
2. **Secrets Protection:** No API keys are hardcoded. Centralized configuration reads strictly from `.env`.
3. **CORS Enforcement:** Backend strictly restricts origins to authorized frontend development servers (`http://localhost:5173`).

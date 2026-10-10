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

### 3.4 `transcripts`
* `id` (UUID, Primary Key): Deterministic UUIDv5 identifier based on `episode_slug`.
* `episode_slug` (VARCHAR(255), Unique, Indexed): Slug identifier (e.g., `brian-chesky`).
* `title` (VARCHAR(500), Indexed): Full episode title.
* `guest` (VARCHAR(255), Indexed): Primary guest name.
* `youtube_url` (VARCHAR(500)): Canonical YouTube recording URL.
* `video_id` (VARCHAR(50)): YouTube video identifier.
* `publish_date` (VARCHAR(50)): Episode publication date.
* `description` (TEXT): Episode description and overview.
* `duration_seconds` (FLOAT): Episode duration in seconds.
* `duration` (VARCHAR(50)): Human-readable duration (HH:MM:SS).
* `view_count` (INTEGER): View count at archival time.
* `channel` (VARCHAR(100)): Channel name.
* `keywords` (JSON): Curated keyword tags from dataset.
* `source_repo` (VARCHAR(255)): Source repository provenance (`ChatPRD/lennys-podcast-transcripts`).
* `source_file_path` (VARCHAR(500)): Relative file path in archive.
* `content_hash` (VARCHAR(64)): SHA-256 hash of raw file for incremental re-ingestion.
* `raw_content` (TEXT): Full raw markdown content.
* `chunk_count` (INTEGER): Number of child chunks created.
* `created_at` / `updated_at` (TIMESTAMP WITH TIME ZONE).

### 3.5 `transcript_chunks`
* `id` (UUID, Primary Key): Deterministic UUIDv5 identifier based on transcript UUID and chunk index.
* `transcript_id` (UUID, Foreign Key $\rightarrow$ `transcripts.id` ON DELETE CASCADE).
* `chunk_index` (INTEGER): Zero-indexed sequence number in episode.
* `speaker` (VARCHAR(255), Indexed): Primary speaker in chunk passage.
* `start_timestamp` (VARCHAR(50)): First timestamp in chunk (e.g. `00:05:04`).
* `end_timestamp` (VARCHAR(50)): Final timestamp in chunk.
* `content` (TEXT): Formatted speaker-attributed chunk text.
* `content_hash` (VARCHAR(64)): SHA-256 hash of chunk content.
* `char_count` (INTEGER), `word_count` (INTEGER).
* `tsv` (TSVECTOR): PostgreSQL full-text search vector with weights (Title 'A', Guest 'A', Speaker 'B', Content 'C').
* Indexes:
  * `uq_transcript_chunk_index`: Unique constraint on `(transcript_id, chunk_index)`.
  * `ix_transcript_chunks_tsv`: GIN index on `tsv`.
  * `ix_transcript_chunks_speaker`: B-Tree index on `speaker`.

---

## 4. API Endpoints Contract

| Method | Endpoint | Description | Status |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Operational health check of backend services. | **Implemented (Task 01)** |
| `POST` | `/api/sessions` | Create a new isolated chat session. | **Implemented (Task 02)** |
| `GET` | `/api/sessions` | List active sessions with summaries. | **Implemented (Task 02)** |
| `GET` | `/api/sessions/{session_id}` | Retrieve a specific chat session. | **Implemented (Task 02)** |
| `GET` | `/api/sessions/{session_id}/messages` | Retrieve conversation history for a session. | **Implemented (Task 02)** |
| `POST` | `/api/sessions/{session_id}/messages` | Persist a message in a session. | **Implemented (Task 02)** |
| `GET` | `/api/knowledge/search` | Search indexed transcripts using ranked FTS. | **Implemented (Task 03)** |
| `GET` | `/api/knowledge/status` | Ingested transcripts & chunk counts status. | **Implemented (Task 03)** |
| `GET` | `/api/sessions/status` | Live LLM provider & agent service availability. | **Implemented (Task 04)** |
| `POST` | `/api/sessions/{session_id}/chat` | Multi-turn chat turn with verified transcript citations. | **Implemented (Task 04)** |
| `POST` | `/api/internal/knowledge/search` | Authenticated internal retrieval endpoint for Pi agent. | **Implemented (Task 04)** |
| `GET` | `/api/v1/artifacts/{id}` | Retrieve generated artifact for in-app viewer. | Planned |

---

## 5. Ingestion & Retrieval Architecture (Task 03)

### 5.1 Authoritative Dataset
* **Source:** `https://github.com/ChatPRD/lennys-podcast-transcripts` (main branch).
* **Archive Size:** ~8.75 MB compressed zip containing 303 episode transcripts (`episodes/{guest-slug}/transcript.md`).
* **Licensing:** Educational and research use with all rights reserved by Lenny Rachitsky and guests. Raw downloaded files are excluded from git via `.gitignore` (`data/`).

### 5.2 Ingestion Workflow
```
[ChatPRD Zip Archive / Local Directory]
                  │
                  ▼
[Discovery & Content Hash Computation]
                  │
       Is Hash Unchanged?
         ├── Yes ──> [Skip Episode (Incremental Idempotency)]
         └── No  ──> [Parse Markdown Frontmatter & Speaker Turns]
                  │
                  ▼
[Speaker-Aware & Paragraph-Aware Chunking (1200 chars, 200 overlap)]
                  │
                  ▼
[PostgreSQL Weighted TSVECTOR Generation (Title A, Guest A, Speaker B, Content C)]
                  │
                  ▼
[Atomic Transaction: Upsert Transcript + Chunks + GIN Index]
```

### 5.3 Retrieval Pipeline
The retrieval service (`BaseRetriever` interface) provides pluggable search capabilities:
1. **Tier 1 (Strict Websearch):** Executes `websearch_to_tsquery('english', query)` using GIN index for exact phrases and boolean syntax.
2. **Tier 2 (Plainto TSQuery):** Executes `plainto_tsquery('english', query)` if Tier 1 yields no results.
3. **Tier 3 (Multi-Term Ranked Fallback):** For natural language queries with multiple keywords, executes ranked `to_tsquery('english', 'token1 | token2 | ...')`, ranked with `ts_rank_cd(tc.tsv, q)`, filtered to require $\ge \min(2, N)$ matching tokens to prevent single-word false matches.
4. **Empty / Unsupported Queries:** Returns 0 results cleanly without fabricated evidence.

---

## 6. Agent Architecture & Multi-Provider Strategy (Task 04)

The agent layer uses a decoupled bridge architecture connecting the FastAPI backend to an isolated Node.js agent service running the **Pi Coding Agent SDK** (`@earendil-works/pi-coding-agent`):

```
[User Request via API / Frontend]
               │
               ▼
   [FastAPI POST /api/sessions/{id}/chat]
               │
               ├─► Validate Session Existence in PostgreSQL
               ├─► Retrieve Candidate Passages (PostgreSQL FTS)
               ├─► Package Context & Prior History (last 10 turns)
               │
               ▼  (HTTP POST http://127.0.0.1:8001/chat + X-Internal-Token)
   [Node.js Pi Agent Service (src/server.mjs)]
               │
               ├─► Authenticate Shared Secret (fail-closed)
               ├─► Initialize ModelRuntime with syncModelsConfig()
               ├─► Create AgentSession with tools: ["search_transcripts"]
               │   (Disables all coding tools: bash, read, write, edit, grep)
               │
               ▼
      [LLM Inference Engine]
         ├── Local: Ollama (qwen2.5:1.5b via http://127.0.0.1:11434/v1)
         └── Cloud: Anthropic Claude (claude-3-5-sonnet via API key)
               │
               ├─► Synthesize grounded response using transcript evidence
               ├─► Call search_transcripts tool if additional data needed
               │
               ▼
   [FastAPI Response Processing & Verification]
               │
               ├─► Verify citations against genuine PostgreSQL chunk IDs
               ├─► Populate citation metadata from database records
               ├─► Strip unverified or fabricated citation identifiers
               ├─► Atomically persist User & Assistant ChatMessages
               ▼
   [Return APIResponse[ChatTurnResponse]]
```

### 6.1 Tool Allowlisting & Security Isolation
* To protect the host system, the Pi Coding Agent SDK is configured with an explicit allowlist: `tools: ["search_transcripts"]`.
* Built-in file system and shell execution tools (`bash`, `read`, `write`, `edit`, `find`, `grep`, `powershell`) are strictly excluded.
* Inter-process communication between FastAPI and the agent service is secured using an internal shared secret (`X-Internal-Token`).

### 6.2 Provider Switching & Configuration
* **Default Provider:** Local Ollama (`qwen2.5:1.5b`).
* **Cloud Provider:** Anthropic Claude (`claude-3-5-sonnet-20241022`).
* Provider selection is dynamic via `.env` or per-request override (`ChatTurnRequest.provider`), requiring zero source code modifications.
* There is no silent fallback: if Ollama fails, the error is returned immediately rather than incurring silent cloud charges.
* `agent-service/.pi_runtime/models.json` is generated deterministically at runtime via `syncModelsConfig()`, ensuring 100% reproducible deployment without committing credentials.

---

## 7. Security Topology

1. **Untrusted Content Isolation:** All model-generated HTML/CSS is isolated within sandboxed `<iframe>` instances with strict CSP rules.
2. **Secrets Protection:** No API keys are hardcoded. Centralized configuration reads strictly from `.env`.
3. **CORS Enforcement:** Backend strictly restricts origins to authorized frontend development servers (`http://localhost:5173`).
4. **Internal Agent Bridge Security:** Fixed internal token verification with fail-closed semantics; services bind strictly to loopback (`127.0.0.1`).

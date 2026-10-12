# Architecture Specification
## The Lenny Growth Assistant - System Design & Boundaries

**Document Version:** 1.0.0<br />
**Status:** Complete / Verified (Task 08D)

---

## 1. Architectural Overview & Boundaries

The Lenny Growth Assistant is designed as a decoupled, full-stack application composed of:
1. **Frontend Client:** React 18 (SPA) built with Vite, handling chat streaming, artifact rendering, and state management.
2. **Backend API:** FastAPI (Python 3.11) exposing asynchronous REST endpoints for session lifecycle, chat streaming, knowledge search, essay drafting, and artifact generation.
3. **Agent & Retrieval Layer:** Node.js service running the Pi Coding Agent SDK (`@earendil-works/pi-coding-agent`), orchestrating model turns with weighted PostgreSQL full-text retrieval over Lenny's Podcast transcripts.
4. **Data Persistence Layer:** PostgreSQL storing user sessions, message histories, transcript metadata, chunks with TSVECTOR full-text indexes, essays, and generated artifacts.

```
+-------------------------------------------------------------------------+
|                              REACT FRONTEND                             |
|  [Chat Interface]  <---- Event Stream / Poll ---->  [Artifact Sandbox]  |
+------------------------------------+------------------------------------+
                                     | HTTP REST (Port 8000)
                                     v
+-------------------------------------------------------------------------+
|                            FASTAPI BACKEND                              |
|  [Routers: /health, /sessions, /chat, /essays, /artifacts, /knowledge]  |
|  [Pydantic Validation & Settings]  [HTML Sanitizer & Security Validator]|
+------------------+----------------------------------+-------------------+
                   |                                  |
                   v (SQLAlchemy / Alembic)           v (HTTP + X-Internal-Token)
+------------------------------------+   +--------------------------------+
|       PERSISTENCE LAYER            |   |     NODE PI AGENT SERVICE      |
| - PostgreSQL (Sessions & Messages) |   | - Pi Coding Agent SDK Runtime  |
| - Essays (Ship 30 for 30 drafts)   |   | - Ship 30 for 30 Skill Engine  |
| - Artifacts (HTML/CSS & Markdown)  |   | - HTML/CSS Generator (150s TO) |
| - Transcripts & TSVECTOR chunks    |   | - Allowlisted tool: search_ts  |
+------------------------------------+   +----------------+---------------+
                                                          |
                                      +-------------------+-------------------+
                                      |                                       |
                                      v                                       v
                             [Local Ollama (qwen2.5:1.5b)]         [Google Gemini (3.5-flash-lite)]
                                Port 11434 (Default)                  Google AI Studio Cloud
```

---

## 2. Relational Database Schema (PostgreSQL)

The database schema is managed via Alembic migrations (`alembic upgrade head`) and defines five core models:

### 2.1 `chat_sessions`
* `id` (UUID, Primary Key): Unique session identifier.
* `title` (VARCHAR(255)): Generated or user-defined session title.
* `user_metadata` (JSONB): Client metadata.
* `created_at` / `updated_at` (TIMESTAMP WITH TIME ZONE, Default NOW()).

### 2.2 `chat_messages`
* `id` (UUID, Primary Key): Unique message ID.
* `session_id` (UUID, Foreign Key $\rightarrow$ `chat_sessions.id` ON DELETE CASCADE).
* `role` (VARCHAR(20)): Sender (`user`, `assistant`, `system`).
* `content` (TEXT): Message markdown text.
* `citations` (JSONB): Array of referenced transcript segments `[{ chunk_id, episode_title, guest, timestamp, snippet }]`.
* `provider` (VARCHAR(50)): Active LLM provider (`ollama`, `gemini`).
* `model_name` (VARCHAR(100)): Specific model ID (e.g., `qwen2.5:1.5b`, `gemini-3.5-flash-lite`).
* `created_at` (TIMESTAMP WITH TIME ZONE).

### 2.3 `transcripts`
* `id` (UUID, Primary Key): Deterministic UUIDv5 identifier based on `episode_slug`.
* `episode_slug` (VARCHAR(255), Unique, Indexed): Slug identifier (e.g., `brian-chesky`).
* `title` (VARCHAR(500), Indexed): Full episode title.
* `guest` (VARCHAR(255), Indexed): Primary guest name.
* `youtube_url` (VARCHAR(500)): Canonical YouTube recording URL.
* `duration` (VARCHAR(50)): Human-readable duration (HH:MM:SS).
* `source_repo` (VARCHAR(255)): Provenance repository (`ChatPRD/lennys-podcast-transcripts`).
* `content_hash` (VARCHAR(64)): SHA-256 hash of raw file for incremental re-ingestion idempotency.
* `chunk_count` (INTEGER): Number of child chunks created.
* `created_at` / `updated_at` (TIMESTAMP WITH TIME ZONE).

### 2.4 `transcript_chunks`
* `id` (UUID, Primary Key): Deterministic UUIDv5 identifier based on transcript UUID and chunk index.
* `transcript_id` (UUID, Foreign Key $\rightarrow$ `transcripts.id` ON DELETE CASCADE).
* `chunk_index` (INTEGER): Zero-indexed sequence number in episode.
* `speaker` (VARCHAR(255), Indexed): Primary speaker in chunk passage.
* `start_timestamp` / `end_timestamp` (VARCHAR(50)): Timestamps in format `HH:MM:SS`.
* `content` (TEXT): Formatted speaker-attributed chunk text.
* `content_hash` (VARCHAR(64)): SHA-256 hash of chunk content.
* `tsv` (TSVECTOR): PostgreSQL full-text search vector with weights (Title 'A', Guest 'A', Speaker 'B', Content 'C').
* Indexes:
  * `uq_transcript_chunk_index`: Unique constraint on `(transcript_id, chunk_index)`.
  * `ix_transcript_chunks_tsv`: GIN index on `tsv`.
  * `ix_transcript_chunks_speaker`: B-Tree index on `speaker`.

### 2.5 `essays`
* `id` (UUID, Primary Key): Unique essay UUID.
* `session_id` (UUID, Foreign Key $\rightarrow$ `chat_sessions.id` ON DELETE CASCADE).
* `topic` (VARCHAR(500)): Requested growth topic.
* `audience` / `intended_outcome` / `proven_approach` / `four_a_path` (VARCHAR).
* `target_word_count` (INTEGER, Default 1,250).
* `title` (VARCHAR(500)): Generated H1 title.
* `markdown` (TEXT): Assembled 5-section markdown prose.
* `word_count` (INTEGER): Deterministically counted word total.
* `generation_status` (VARCHAR(50)): `generating`, `completed`, `validation_failed`, `failed`.
* `validation_results` (JSONB): Deterministic validation errors, warnings, and word counts.
* `citations` (JSONB): Array of verified citations linked to genuine chunks.
* `provider` / `model` (VARCHAR): Model used.
* `created_at` / `updated_at` (TIMESTAMP WITH TIME ZONE).

### 2.6 `artifacts`
* `id` (UUID, Primary Key): Unique artifact UUID.
* `session_id` (UUID, Foreign Key $\rightarrow$ `chat_sessions.id` ON DELETE CASCADE).
* `title` (VARCHAR(255)): Artifact title.
* `artifact_type` (VARCHAR(50)): `html` or `markdown`.
* `source_content` (TEXT): Generated sanitized HTML/CSS or Markdown.
* `generation_status` (VARCHAR(50)): `generating`, `completed`, `validation_failed`, `failed`.
* `validation_results` (JSONB): Security sanitizer errors, warnings, and tag statistics.
* `citations` (JSONB): Verified source citations.
* `provider` / `model` (VARCHAR): Model used.
* `meta_info` (JSONB): Instructions, topic, and generation parameters.
* `created_at` / `updated_at` (TIMESTAMP WITH TIME ZONE).

---

## 3. API Endpoints Contract

| Method | Endpoint | Description | Status |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Operational health check of backend services. | Verified |
| `POST` | `/api/sessions` | Create a new isolated chat session. | Verified |
| `GET` | `/api/sessions` | List active sessions with summaries. | Verified |
| `GET` | `/api/sessions/{session_id}` | Retrieve a specific chat session. | Verified |
| `GET` | `/api/sessions/{session_id}/messages` | Retrieve conversation history for a session. | Verified |
| `POST` | `/api/sessions/{session_id}/messages` | Persist a message in a session. | Verified |
| `GET` | `/api/sessions/status` | Live LLM provider & agent service availability. | Verified |
| `POST` | `/api/sessions/{session_id}/chat` | Multi-turn chat turn with verified transcript citations. | Verified |
| `GET` | `/api/knowledge/search` | Search indexed transcripts using ranked FTS. | Verified |
| `GET` | `/api/knowledge/status` | Ingested transcripts & chunk counts status. | Verified |
| `POST` | `/api/internal/knowledge/search` | Authenticated internal retrieval endpoint for Pi agent. | Verified |
| `POST` | `/api/sessions/{session_id}/essays` | Start asynchronous generation of a Ship 30 essay. | Verified |
| `GET` | `/api/sessions/{session_id}/essays` | List Ship 30 essays for a session. | Verified |
| `GET` | `/api/sessions/{session_id}/essays/{id}` | Retrieve status, markdown, citations of an essay. | Verified |
| `POST` | `/api/sessions/{session_id}/artifacts` | Start asynchronous generation of an HTML/MD artifact. | Verified |
| `GET` | `/api/sessions/{session_id}/artifacts` | List artifacts for a session. | Verified |
| `GET` | `/api/sessions/{session_id}/artifacts/{id}`| Retrieve status, content, validation results of artifact. | Verified |

---

## 4. Ingestion & Retrieval Pipeline

### 4.1 Authoritative Dataset
* **Source Archive:** `https://github.com/ChatPRD/lennys-podcast-transcripts`
* **Local Index:** **10 flagship episodes, 1,271 chunks** indexed into PostgreSQL with weighted GIN TSVECTOR indexing (`Title A, Guest A, Speaker B, Content C`).

### 4.2 Three-Tier Search Engine
The retrieval service (`PostgresFtsRetriever`) executes a cascading search:
1. **Tier 1 (Strict Websearch):** Executes `websearch_to_tsquery('english', query)` using GIN index for exact phrases and boolean syntax.
2. **Tier 2 (Plainto TSQuery):** Executes `plainto_tsquery('english', query)` if Tier 1 yields no results.
3. **Tier 3 (Multi-Term Ranked Fallback):** For natural language queries with multiple keywords, executes ranked `to_tsquery('english', 'token1 | token2 | ...')`, ranked with `ts_rank_cd(tc.tsv, q)`, filtered to require $\ge \min(2, N)$ matching tokens to prevent single-word false matches.
4. **Empty / Unsupported Queries:** Returns 0 results cleanly without fabricated evidence.

---

## 5. Agent Architecture & Multi-Provider Strategy

The agent layer uses a decoupled bridge connecting FastAPI to the Node.js Pi Agent Service running `@earendil-works/pi-coding-agent`:

```
[FastAPI Backend (Port 8000)]
         │
         ▼  (HTTP POST + X-Internal-Token header)
[Node.js Pi Agent Service (Port 8001)]
         │
         ├─► Validate X-Internal-Token (fail-closed)
         ├─► syncModelsConfig(): writes .pi_runtime/models.json deterministically
         ├─► Allowlisted Tool: ["search_transcripts"] (coding/shell tools disabled)
         │
         ▼
   [Inference Engine]
      ├── Local Default: Ollama (qwen2.5:1.5b via http://127.0.0.1:11434/v1)
      └── Cloud Option: Google Gemini (gemini-3.5-flash-lite via API key)
```

### 5.1 Ship 30 for 30 Skill Engine
* **Structure:** Deterministic 5-section essay structure:
  1. Section 1 (Headline & Hook): ~200 words
  2. Section 2 (The Conventional Trap): ~250 words
  3. Section 3 (The Transcript Breakthrough): ~300 words
  4. Section 4 (From Philosophy to Execution): ~300 words
  5. Section 5 (The Actionable Framework): ~200 words
* **Target Word Budget:** 1,250 words total.
* **Validation Bounds:** Strict **1,100–1,400 words**.
* **Provider Headroom:** 1.5x token budget bonus (`providerBonus`) applied for Gemini to prevent premature truncation.
* **Bounded Underlength Expansion:** If draft is under 1,100 words and no compression was required, executes at most one single-turn bounded expansion on Section 3 or Section 4. If citations are damaged or words remain under 1,100, the draft stays marked `validation_failed`.

### 5.2 HTML/CSS Artifact Security & Sanitizer
* **Backend Sanitizer (`validate_and_sanitize_html`):**
  - Rejects `<script>` tags, inline event handlers (`onclick`, `onload`), `javascript:` URIs, external stylesheet links (`<link rel="stylesheet">`), and dangerous CSS `@import` rules.
* **Frontend Sandboxing:**
  - Rendered in `<iframe sandbox="" />` with zero permissions (scripts disabled, same-origin disabled, forms disabled).
  - Runtime injection of strict Content Security Policy (`prepareSandboxedSrcDoc`):
    `default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; script-src 'none';`

---

## 6. Full-Stack Timeout Hierarchy

All timeout thresholds are strictly bounded and harmonized across the stack to prevent zombie jobs, hanging UI spinners, or silent failures:

```
[Browser / Frontend Asynchronous Polling]  -->  330.0 seconds (TIMEOUT_MS)
                       │
                       ▼
[FastAPI Backend HTTP Client (httpx)]      -->  300.0 seconds (call_timeout)
                       │
                       ▼
[Node.js Pi Agent Service (Artifact)]      -->  150.0 seconds (artifactTimeoutMs)
                       │
                       ▼
[Node.js Pi Agent Service (Standard Chat)] -->   60.0 seconds (requestTimeoutMs)
```

- If an artifact takes longer than 150 seconds, Node aborts and returns HTTP 504 `INFERENCE_TIMEOUT`.
- FastAPI catches this within its 300s window, marks the artifact record `failed` with an informative error message, and commits to PostgreSQL.
- Frontend polling observes the terminal `failed` status within 330 seconds, presenting an actionable retry/error banner.

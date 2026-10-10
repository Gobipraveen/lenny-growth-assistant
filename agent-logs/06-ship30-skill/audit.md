# Milestone Audit: 06 — Ship 30 for 30 Dedicated Writing Skill (Task 06A)

## Executive Summary
This audit documents the specification, implementation, and automated contract verification of the **Ship 30 for 30 Dedicated Writing Skill** (`agent-service/skills/ship30/`) for **The Lenny Growth Assistant**.
The skill encodes the proven online writing methodology co-founded by Dickie Bush and Nicolas Cole into a deterministic, verifiable, transcript-grounded agent component designed to produce ~1,250-word publication-grade essays.

---

## 1. Environment & Baseline Status
* **Git Baseline Commit:** `f4d9c91` (`feat(frontend): implement conversational chat interface and citations`)
* **Host Operating System:** Windows 11 (8 GB RAM environment)
* **Node.js Runtime:** v22.19.0
* **Pi Agent Framework:** `@earendil-works/pi-coding-agent` v1.1.0
* **Source Guide Verified:** `https://www.ship30for30.com/post/how-to-start-writing-online-the-ship-30-for-30-ultimate-guide` (retrieved and analyzed)

---

## 2. Ship 30 Writing Principles Encoded

The skill explicitly implements the key principles extracted from the official Ship 30 for 30 guide:

| Principle | Guide Rule | Implementation in Skill Engine |
| :--- | :--- | :--- |
| **The Digital Writer Mindset** | Treat writing like a startup: test in public, optimize for Rate of Revelation. | Prompt enforces high density: every sentence must introduce new insight; no repetitive fluff. |
| **The Endless Idea Generator** | Specific Topic + Credibility as Curation + 4A Path + Proven Approach. | Structured planner decomposes broad topics into a specific 4A path (`actionable`, `analytical`, `aspirational`, `anthropological`) and unified container (`framework`, `lessons`, `mistakes`, `steps`). |
| **Credibility as Curation** | Don't invent personal authority; curate verified experts. | Anchors insights exclusively in Lenny's Podcast guest transcripts (e.g. Brian Chesky, Elena Verna). |
| **Headline Design** | Answer WHO, WHAT, and WHY (the PROMISE). Clear > Clever. Curiosity Gap. | Planner generates headlines stating target audience, topic, and concrete payoff without vague clickbait. |
| **Strong Hook & Cadence** | Open with tension or misconception. 1/3/1 or 1/5/1 sentence rhythm. | Section 1 prompts enforce 1/5/1 rhythm: single-sentence opener, structured body, punchy conclusion. No fake anecdotes. |
| **Skimmable Formatting** | Wheels & Spokes (H1 and H2s), short paragraphs, selective bolding, concise bullets. | Validator verifies exactly 1 H1 headline, $\ge 3$ H2 section headers, bold tags (`**key phrases**`), and bullet points. |
| **Content Differentiation** | The Tequila Test: Say what conventional wisdom ignores. | Prompts instruct agent to challenge cliché business tropes using counter-intuitive transcript mechanics. |
| **The Actionable Ending** | Conclude with an immediate takeaway, checklist, or decision rule. | Section 5 requires a concrete diagnostic checklist, framework, or decision rule under a validated takeaway heading. |

---

## 3. Skill Architecture & Boundaries

The skill is implemented as a modular component in `agent-service/skills/ship30/`:

```
agent-service/skills/ship30/
├── SKILL.md             # Formal skill specification & guidelines with YAML frontmatter
├── contracts.mjs        # Input validation, parameter constraints, and evidence normalization
├── planner.mjs          # 5-section narrative blueprint & word budget allocation
├── prompt_builder.mjs   # Strict prompt synthesis combining Ship 30 rules and evidence blocks
├── validator.mjs        # Deterministic word counting, structural parsing, citation checking
└── index.mjs            # Workflow coordinator and safe Pi agent tool registration
```

### Modular Boundaries & Tool Security
1. **Isolated Execution:** The skill operates purely on in-memory data structures. It has **zero access to shell/bash execution**, filesystem modifications, Git commands, or raw database connections.
2. **Safe Tool Registration (`registerShip30PiTool`):** Exposes only high-level parameters (`topic`, `audience`, `intended_outcome`, `proven_approach`, `four_a_path`, `target_word_count`) to the Pi Agent SDK without exposing system capabilities.

---

## 4. Length & Token Budget Strategy

### The 1,250-Word Challenge on Small Models
* **Word Count Target:** ~1,250 words (acceptable tolerance: 1,100 to 1,400 words).
* **Token Math:** 1,250 English words typically require **1,650 to 1,950 generation tokens**.
* **Model Constraints:**
  - On `qwen2.5:1.5b` (local Ollama), the generation budget is constrained by `maxTokens: 2048`.
  - In a single zero-shot generation pass, small 1.5B models frequently exhaust context, repeat paragraphs, or truncate before hitting 1,250 words.
* **Architectural Blueprint:**
  - The planner divides the essay into 5 distinct narrative sections:
    1. *Section 1 (Hook & Tension):* ~200 words (Rhythm: 1/5/1)
    2. *Section 2 (The Conventional Trap):* ~250 words (Rhythm: 1/3/1 + 1/3/1)
    3. *Section 3 (Transcript Breakthrough):* ~350 words (Rhythm: 1/5/1)
    4. *Section 4 (Tactical Execution):* ~250 words (Rhythm: 1/3/1)
    5. *Section 5 (Actionable Checklist):* ~200 words (Rhythm: 1/3/1)
    **Total:** 1,250 words.
  - In Task 06B, generation can be executed section-by-section using `buildSectionPrompt` or via unified drafting, guaranteeing complete length without truncation.

---

## 5. Grounding & Citation Safeguards

1. **Explicit Chunk Tags:** Claims must cite verified evidence using `[chunk_id: <uuid>]`.
2. **Strict Citation Validation:** Every chunk ID in the generated text is checked against `verified_evidence`. If the essay cites a fabricated ID (e.g. `[chunk_id: chunk-fabricated-999]`), the validator triggers a hard validation error.
3. **Insufficient Evidence Guard:** If `verified_evidence` is empty or missing, `executeSkillWorkflow` immediately terminates with status `"insufficient_evidence"`, refusing to generate ungrounded essays.
4. **Safety Against Untrusted Code:** The validator flags any presence of raw executable HTML tags (`<script>`, `<iframe>`, `<object>`, `<form>`).

---

## 6. Input & Output Contract Specification

### Input Schema
* `topic` (string, required, $\ge 5$ chars)
* `audience` (string, default: "Product Managers and Growth Leaders")
* `intended_outcome` (string, optional)
* `proven_approach` (enum: `framework` | `lessons` | `mistakes` | `steps`)
* `four_a_path` (enum: `actionable` | `analytical` | `aspirational` | `anthropological`)
* `target_word_count` (integer, default: 1250, range: 500–3000)
* `min_word_count` (integer, default: 1100)
* `max_word_count` (integer, default: 1400)
* `verified_evidence` (array of normalized transcript chunk objects)

### Output Schema
* `title` (string): Extracted H1 title
* `markdown` (string): Complete generated essay
* `word_count` (integer): Deterministic word count
* `citations` (array): Verified citation objects referenced in the essay
* `evidence_chunk_ids` (array): List of available chunk IDs
* `validation_results` (object):
  - `isValid` (boolean)
  - `wordCountValid` (boolean)
  - `headingsValid` (boolean)
  - `citationsValid` (boolean)
  - `takeawayValid` (boolean)
  - `errors` (array of string)
  - `warnings` (array of string)
* `generation_status` (`"success"` | `"insufficient_evidence"` | `"invalid_input"` | `"validation_failed"` | `"generation_error"`)

---

## 7. Verification Test Results

### 7.1 Ship 30 Skill Automated Tests (`agent-service/test/ship30_skill.test.mjs`)
Executed via `node --test test/ship30_skill.test.mjs`:
* **Input & Evidence Contracts (5 tests):**
  - Validates correct input successfully (PASS)
  - Rejects missing or too-short topic (PASS)
  - Rejects invalid `proven_approach` or `four_a_path` (PASS)
  - Normalizes evidence and deduplicates chunk IDs (PASS)
  - Rejects missing evidence and returns structured `insufficient_evidence` outcome (PASS)
* **Word Count & Deterministic Validation (9 tests):**
  - Counts words accurately ignoring markdown noise (PASS)
  - Accepts an essay within the target range (1,100 to 1,400 words) (PASS)
  - Identifies a substantially too-short essay (< 1,100 words) (PASS)
  - Identifies an overly long essay (> 1,400 words) (PASS)
  - Rejects essay missing H1 headline (PASS)
  - Rejects essay with fewer than 3 H2 sections (PASS)
  - Rejects essay missing actionable takeaway section (PASS)
  - Rejects fabricated citation IDs not present in verified evidence (PASS)
  - Rejects unsafe HTML tags in generated content (PASS)
* **Structure Planning & Workflow Contracts (4 tests):**
  - Creates structured 5-section essay plan allocating word budgets (PASS)
  - Builds generation prompt containing strict Ship 30 constraints and evidence blocks (PASS)
  - Executes skill workflow returning full output contract with mocked generator (PASS)
  - `registerShip30PiTool` defines safe tool without shell or filesystem access (PASS)

**Subtotal: 18 / 18 passed (100%).**

### 7.2 Agent Service Regression Test Suite
Executed via `npm test` in `agent-service`:
* **Total Tests:** 30 tests across 4 test suites
* **Passed:** 30 (100%)
* **Failed:** 0
* Existing Pi agent session isolation, model runtime loading, and `/chat` HTTP contracts remain fully operational.

### 7.3 Frontend Regression Test Suite
Executed via `npm test` in `frontend`:
* **Total Tests:** 21 tests across 3 test suites
* **Passed:** 21 (100%)
* **Failed:** 0

---

## 8. Honest Limitations of Quality Checks
1. **Semantic Grounding vs. Syntactic Citation:** Deterministic validation guarantees that cited chunk IDs exist in the retrieved evidence and rejects fabricated IDs. However, syntax validation cannot mathematically prove that every prose claim matches the nuance of the transcript without semantic verification.
2. **Word Count vs. Substance:** Meeting the 1,100–1,400 word threshold confirms length compliance, but editorial quality depends on model adherence to the prompt constraints.
3. **Small Model Context Limits:** Multi-section drafting in Task 06B is essential for `qwen2.5:1.5b` to prevent repetitive loops or abrupt token cutoff.

---

## 9. Task 06B — Backend & Agent Integration Milestone

### 9.1 Objectives & Scope
Task 06B connected the dedicated Ship 30 for 30 skill into an executable, persistent backend workflow:
* Integrated sequential 5-section essay generation into the Node.js Pi Agent Service via `POST /essay`.
* Built an asynchronous, non-blocking background job lifecycle in FastAPI (`POST /api/sessions/{session_id}/essays`) with durable PostgreSQL persistence.
* Preserved strict transcript grounding against PostgreSQL retrieval (`retriever.search`) and fail-closed behavior for missing evidence.
* Strictly restricted the Pi Agent runtime tool allowlist (`tools: []`), forbidding arbitrary shell execution, filesystem mutation, or Git access.
* Implemented deterministic Alembic migration (`d4e5f6a1b2c3_create_essays_table.py`) and 16 new automated FastAPI tests.

---

### 9.2 Architecture & Flow

```
[Client / UI]
     │
     │  1. POST /api/sessions/{session_id}/essays
     ▼
[FastAPI Router (essay.py)]
     │
     ├── 2. Verify Session & Validate Request Body
     ├── 3. Retrieve Transcript Chunks (retriever.search)
     │       └── If 0 chunks found ──> Status: 'insufficient_evidence' (Fail-Closed)
     ├── 4. Insert Essay Record in PostgreSQL (Status: 'generating')
     └── 5. Return HTTP 202 Accepted with essay_id & metadata
             │
             ▼ (BackgroundTasks / Non-blocking)
[run_essay_generation_job]
     │
     ├── 6. HTTP POST /essay (AgentClient with X-Internal-Token)
     ▼
[Node.js Pi Agent Service (server.mjs)]
     │
     ├── 7. Authenticate via X-Internal-Token
     ├── 8. PiAgentManager.generateShip30Essay
     │       ├── Create Pi SDK session (tools: [] - STRICT SANDBOX)
     │       ├── Run createEssayPlan (5 sections, word budgets)
     │       └── Loop 5 sections sequentially:
     │            ├── buildSectionPrompt(section, plan, accumulatedText)
     │            └── session.prompt() -> getLastAssistantText()
     ├── 9. assembleEssaySections (1 H1, >=3 H2s, Actionable Framework)
     └── 10. validateEssay (word counts, headings, citation authenticity)
             │
     ┌───────┘ (Returns JSON data envelope)
     ▼
[FastAPI Background Worker]
     ├── 11. Cross-validate cited chunk IDs against DB retrieval map
     ├── 12. Filter out any unverified or hallucinated chunk IDs
     └── 13. Persist markdown, word count, validation results to PostgreSQL
             └── Status: 'completed' (or 'failed' on timeout/error)

[Client / Polling]
     │
     │  14. GET /api/sessions/{session_id}/essays/{essay_id}
     ▼
[FastAPI Router] ──> Returns full EssayResponse (Markdown, Citations, Metadata)
```

---

### 9.3 Database Persistence & Alembic Migration
* **Migration Revision:** `d4e5f6a1b2c3_create_essays_table` (revises `37c50a7f838d`).
* **Table Schema (`essays`):**
  * `id`: UUID (Primary Key)
  * `session_id`: UUID (Foreign Key `chat_sessions.id` ON DELETE CASCADE, indexed)
  * `topic`: String(500), non-null
  * `audience`, `intended_outcome`, `proven_approach`, `four_a_path`: Nullable strings
  * `target_word_count`: Integer (default 1250)
  * `title`: String(500), nullable
  * `markdown`: Text, nullable
  * `word_count`: Integer, nullable
  * `generation_status`: String(50), indexed (`pending`, `generating`, `completed`, `failed`, `insufficient_evidence`, `validation_failed`)
  * `validation_results`: JSON (stores errors, warnings, wordCountValid, etc.)
  * `citations`: JSON (stores verified citations with timestamps and episode metadata)
  * `provider`: String(50) (`ollama` or `anthropic`)
  * `model`: String(100)
  * `error`: Text (actionable error message)
  * `created_at`, `updated_at`: Timestamptz
* **Integrity:** Non-destructive migration applied via `alembic upgrade head`. Existing chat records and transcripts remain untouched.

---

### 9.4 Verification & Test Execution Summary

Tests were executed sequentially without launching live LLM inference or background servers:

| Component | Test Suite | Tests Run | Result |
| :--- | :--- | :--- | :--- |
| **Ship 30 Skill Engine** | `agent-service/test/ship30_skill.test.mjs` | 20 | **20 PASSED (100%)** |
| **Node.js Agent Service** | `agent-service/test/agent_service.test.mjs` | 17 | **17 PASSED (100%)** |
| **FastAPI Essay API** | `tests/test_essay_api.py` | 16 | **16 PASSED (100%)** |
| **FastAPI Agent Bridge** | `tests/test_agent_bridge.py` | 17 | **17 PASSED (100%)** |
| **FastAPI Agent Quality** | `tests/test_agent_quality.py` | 15 | **15 PASSED (100%)** |
| **Frontend Client & UI** | `frontend/test/client_and_logic.test.mjs` | 21 | **21 PASSED (100%)** |
| **TOTAL** | | **106** | **106 PASSED, 0 FAILED** |

---

### 9.5 Memory & Runtime Safety Observations
* **Host Environment:** Windows 11, 8 GB RAM laptop.
* **Available Physical RAM:** ~980–1,020 MB free throughout testing.
* **No Live Ollama Inference:** All tests utilized mocked and deterministic text fixtures. Zero model weights were loaded into memory, avoiding RAM pressure.
* **No Shell / Bash Leaks:** Pi agent sessions during essay generation are initialized with `tools: []`, strictly barring shell execution or filesystem access.

---

## 10. Conclusion & Final Verdict
* **Task 06A Verdict:** **PASS**
* **Task 06B Verdict:** **PASS**
* The dedicated Ship 30 writing skill is fully specified, verified, and executable via FastAPI and the Pi Agent Service.
* The system is ready for Task 07 (React Markdown artifact viewer and essay display UI).

---

## 11. Task 06C — Pre-Commit Reliability Verification Milestone

### 11.1 Model Configuration Verification
* **Anthropic Model:** `claude-3-5-sonnet-latest` verified consistent across:
  * `backend/app/config.py` (`ANTHROPIC_MODEL`)
  * `backend/app/routers/essay.py` (`settings.ANTHROPIC_MODEL`)
  * `agent-service/src/config.mjs` (`anthropicModel`)
  * `.env.example` (`ANTHROPIC_MODEL="claude-3-5-sonnet-latest"`)
* **Dynamic Resolution:** Verified that `PiAgentManager.generateShip30Essay` dynamically resolves models and populates `models.json` via `syncModelsConfig()`. No obsolete hardcoded model strings remain.
* **Testing Note:** Anthropic inference was NOT live-tested; verification was completed using mocked fixtures and schema contracts to prevent API consumption and protect private credentials.

### 11.2 Generation Timeouts & Timer Leak Prevention
* **HTTP Client Timeout:** FastAPI `AgentClient.generate_essay` enforces a 300.0-second HTTP timeout with `httpx.AsyncClient(timeout=call_timeout)`.
* **Server Request Timeout:** Configured `server.requestTimeout = 310000` and `server.timeout = 310000` in `agent-service/src/server.mjs` to ensure Node's HTTP server does not terminate connections before FastAPI's 300s boundary.
* **Bounded Per-Section Inference:** Each of the 5 sequential sections has a bounded 60-second execution window (`config.requestTimeoutMs`).
* **Timer Handle Cleanup:** Wrapped `Promise.race` in `executeTurn` and `generateShip30Essay` (`generateSectionFn`) with `try...finally { if (timerId) clearTimeout(timerId); }` in `agent-service/src/pi_agent.mjs`, eliminating lingering timer references in the Node event loop.
* **Timeout Propagation & Session Cleanup:** In `agent-service/skills/ship30/index.mjs`, re-threw `INFERENCE_TIMEOUT` (HTTP 504) so that `PiAgentManager` catches it, executes `session.abort()`, and cleanly propagates the 504 status back to FastAPI.
* **Sequential Termination:** If any individual section throws or times out, the sequential loop immediately breaks and halts further generation.

### 11.3 Essay Validation & Grounding Enforcement
* **Range Validation:** Deterministic validation verifies the 1,100–1,400-word target range on assembled Markdown.
* **Status Guard:** In `backend/app/routers/essay.py`, fixed the status transition guard: if `validation_results.isValid` is `False`, the essay status transitions to `validation_failed` (preserving error details), never silently becoming `completed`.
* **Citation Grounding:** Unverified and fabricated chunk IDs are strictly stripped or rejected by both the Node validator and the FastAPI worker.
* **Missing Evidence:** Returns structured `insufficient_evidence` outcome without invoking LLM inference.

### 11.4 Background Job Lifecycle & Stale-Job Recovery
* **Dedicated Database Session:** Verified that `run_essay_generation_job` creates its own dedicated database session (`db = session_factory()`) and executes `db.close()` in a `finally` block, never reusing the request-scoped session.
* **Lightweight Stale-Job Self-Healing:** Added `is_stale_generating` recovery logic to `get_essay` and `list_essays`. Any essay record in `generating` status with `created_at` older than 360 seconds (indicating an interrupted job due to server restart or dropped worker) is automatically transitioned to `failed` with an informative error message:
  *"Generation job timed out or was interrupted by a server restart. Please trigger generation again."*
  This provides resilient self-healing without requiring Redis or Celery.

### 11.5 PostgreSQL Migration Safety
* **Migration Inspected:** `alembic/versions/d4e5f6a1b2c3_create_essays_table.py` (revises `37c50a7f838d`).
* **Safety Verified:** Strictly additive (`op.create_table('essays')`). Does not alter, truncate, or drop existing chat or knowledge tables (`chat_sessions`, `chat_messages`, `transcripts`, `transcript_chunks`).

### 11.6 Verification Test Results
Executed sequentially:
1. `tests/test_essay_api.py`: **19 / 19 PASSED (100%)**
2. `agent-service/test/ship30_skill.test.mjs`: **20 / 20 PASSED (100%)**
3. `agent-service/test/agent_service.test.mjs`: **17 / 17 PASSED (100%)**
* **Total Task 06C Focused Tests:** **56 PASSED, 0 FAILED**
* `git diff --check`: Clean exit, zero whitespace or conflict errors.

### 11.7 Honest Limitations & Operational Boundaries
1. **Server Restart Recovery:** In-flight background tasks running in Python memory cannot resume after an abrupt server restart; the stale-job recovery cleanly marks them `failed` so users and the UI can re-trigger generation.
2. **Multi-Section Duration:** 5 sequential sections on local `qwen2.5:1.5b` can take 2–3 minutes total. The 300s HTTP and 310s server timeouts accommodate this, but system responsiveness is best when memory is unconstrained.

### 11.8 Task 06C Verdict
* **Final Verdict:** **PASS**
* All pre-commit reliability criteria for the Ship 30 essay skill integration are fulfilled.

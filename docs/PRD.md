# Product Requirements Document (PRD)
## The Lenny Growth Assistant

**Status:** Complete / Final Submission Readiness (Task 08D)<br />
**Role:** Forward Deployed Engineer<br />
**Engagement:** Internal Product & Growth AI Assistant Deployment

---

## 1. Executive Summary

"The Lenny Growth Assistant" is an AI-powered conversational web application designed for product managers, growth leads, and founders. It ingests transcripts from Lenny's Podcast knowledge base (`ChatPRD/lennys-podcast-transcripts`) into a local PostgreSQL database with weighted full-text search. It delivers strictly grounded answers to complex product strategy questions, generates publication-grade Ship 30 for 30 essays, and creates live, in-app interactive artifacts (Markdown and isolated HTML/CSS).

The application natively supports two genuine AI inference pathways via the Pi Coding Agent SDK (`@earendil-works/pi-coding-agent`):
1. **Local Default:** Ollama (`qwen2.5:1.5b`) running self-contained on the developer workstation without external egress or API cost.
2. **Cloud Option:** Google Gemini (`gemini-3.5-flash-lite`) via Google AI Studio API for higher-capacity reasoning.

---

## 2. Discovery Brief

### 2.1 Primary User & Problem Framing
* **Primary Users:** Growth Leaders, Product Managers (PMs), Founders, and Product Operations teams.
* **Jobs-to-be-Done (JTBD):**
  1. *Quick Knowledge Extraction:* Query tactical advice from world-class operators (e.g., pricing ladders, retention loops, 0-to-1 PM frameworks) without manually scrubbing transcripts.
  2. *Content & Synthesis:* Transform conversational advice into structured, high-retention internal memos or Ship 30 for 30 atomic essays for team alignment.
  3. *Actionable Artifacts:* Render interactive artifacts (framework diagrams, teardown checklists, calculators) directly inside the workflow without external tooling.
* **Pain Removed:**
  - Eliminates generic, hallucinated AI responses by strictly grounding answers in verified podcast transcripts.
  - Eliminates manual transcription search and disjointed note synthesis.
  - Eliminates context-switching between chat and artifact visualizers.

### 2.2 Measurable Success Metrics
1. **Grounded Retrieval Precision & Faithfulness (Product Metric):**
   - $\ge 90\%$ of generated factual claims must carry verifiable citations linked back to specific podcast transcript segments / episodes.
   - Zero hallucinated guest quotes or fabricated metrics.
   - Deterministic validation rejects fabricated citation UUIDs not present in retrieved context.
2. **Inference Latency & Timeout Boundaries (Operational Metric):**
   - Local Ollama chat turn synthesis $\le 15\text{ s}$ on 8 GB host laptops.
   - Cloud Gemini chat roundtrip $\le 3.5\text{ s}$.
   - Harmonized timeout hierarchy: Frontend polling (330s) > FastAPI downstream HTTP client (300s) > Node artifact generation (150s) > Standard chat request (60s).
3. **Artifact Render Safety & Reliability (Technical Metric):**
   - $100\%$ of user-requested artifacts render inside an isolated frontend sandbox (`sandbox=""`) with zero script execution, zero external network requests, and strict Content Security Policy (CSP).
   - Backend HTML sanitizer rejects `<script>`, inline event handlers, `javascript:` URLs, and external CSS `@import` vectors.

### 2.3 Explicit Assumptions & Deployment Constraints
1. **Local-First Evaluation:** The client evaluation takes place on a local developer workstation (Windows 11 with 8 GB Physical RAM and Ollama) and must run self-contained without mandatory cloud API spend.
2. **Authoritative Transcript Archive:** Transcripts originate from `ChatPRD/lennys-podcast-transcripts`. The local PostgreSQL index contains the curated flagship collection: **10 episodes and 1,271 chunks**. (The full upstream 303-episode archive is supported by the ingestion CLI, but 10 flagship episodes are indexed locally to preserve workstation disk and memory constraints).
3. **Session Persistence:** Relational database persistence (PostgreSQL with SQLAlchemy and Alembic) stores session history, conversational state, verified citations, essays, and artifact records across restarts.
4. **Agent Framework:** Built on the Pi Coding Agent SDK (`@earendil-works/pi-coding-agent`), isolating tools to `search_transcripts` while disabling dangerous filesystem or shell access.
5. **No Silent Fallback:** If cloud Gemini or local Ollama fails (network, key hold, quota exhaustion), the error is surfaced immediately via HTTP 502/504 without silently switching providers or incurring hidden charges.

### 2.4 Scope Choices (What is Included vs. Excluded)
| Dimension | Included in Scope | Excluded from Scope | Rationale |
| :--- | :--- | :--- | :--- |
| **Conversational Core** | Multi-turn chat, session tracking, query expansion, transcript grounding, compact citations. | Multi-user enterprise RBAC, SSO, workspace billing. | Keep local evaluation frictionless; focus on core operator value. |
| **Grounding & RAG** | PostgreSQL weighted TSVECTOR search (Title/Guest 'A', Speaker 'B', Content 'C') with GIN indexing over Lenny transcripts. | Arbitrary web search or real-time dynamic scraping of external podcasts. | Preserve strict grounding boundaries within Lenny's corpus. |
| **Specialized Skills** | Dedicated Ship 30 for 30 essay generation skill (~1,250 words, hook, 5 sections, bolding, skimmable structure). | Generic, open-ended blog writer without strict editorial rules. | Evaluates forward-deployed prompt/agent craftsmanship. |
| **Artifacts** | Beside-the-chat viewer supporting Markdown and sandboxed HTML/CSS snippets, copy/download, fullscreen. | Arbitrary full-stack code execution (e.g., Python code execution engine). | High security risk and operational complexity; HTML/CSS sandbox solves UX requirement safely. |
| **LLM Support** | Dual configuration: Local Ollama (`qwen2.5:1.5b`) + Cloud Google Gemini (`gemini-3.5-flash-lite`). | Dozens of obscure model providers. | Meets client requirement while keeping configuration clean and reliable. |

### 2.5 Key Risks & Trade-Offs
* **Local Model Quality vs. Cloud Intelligence:** Local 1.5B/7B models require carefully sized chunk retrieval and strict prompt constraints. Cloud Gemini provides rapid multi-section synthesis when configured.<br />
  *Mitigation:* Optimize chunk retrieval, enforce 5-section planning in the skill, and provide a one-click header provider toggle.
* **Artifact Security (XSS / Untrusted HTML):** Rendering model-generated HTML in the client risks script injection.<br />
  *Mitigation:* Render artifacts inside an `<iframe>` with `sandbox=""` (zero permissions) and inject a strict `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:;`.
* **Transcript Hallucination:** Models tend to extrapolate beyond transcripts.<br />
  *Mitigation:* Pass candidate passages in prompt; deterministic validation checks verify cited chunk UUIDs against genuine PostgreSQL chunks before saving.

---

## 3. User Journey & Core Flows

1. **Session Lifecycle:** User enters the application, selects model provider (Ollama Local or Google Gemini Cloud), and starts a conversation session.
2. **Knowledge Querying:** User asks a tactical growth question (e.g., "What does Brian Chesky advise about founder-led product decisions?").
3. **Grounded Response & Citations:** Assistant synthesizes an answer referencing compact tokens `[S1]`, `[S2]`. The UI renders interactive citation pills showing episode title, guest name, timestamp, and transcript snippet.
4. **Ship 30 for 30 Essay Generation:** User triggers the essay creation modal, selects an evidence topic, audience, and editorial lens. The agent executes structured 5-section drafting with bounded expansion, generating ~1,250 words with verified quotations.
5. **HTML/CSS Artifact Creation:** User requests a tactical growth playbook or dashboard. The assistant generates clean static HTML/CSS, validated by the backend sanitizer, and renders it in the right-hand preview panel.
6. **Side-by-Side Viewing & Export:** User can inspect the artifact in Preview or raw Code mode, expand to Fullscreen, copy markdown/HTML to clipboard, or download the artifact file.

---

## 4. Completed Milestone Checklist

- [x] **Task 01 — Monorepo Architecture & Backend Foundation:** Clean full-stack layout, FastAPI `GET /health`, Pydantic settings, Vite React skeleton, and pinned dependencies.
- [x] **Task 02 — Relational Persistence & Chat Sessions:** PostgreSQL database schema, Alembic migrations, session management APIs, and conversation history persistence.
- [x] **Task 03 — Transcript Ingestion & Knowledge Base:** Automated ingestion CLI (`scripts/ingest.py`), markdown frontmatter parsing, speaker turn extraction, chunking, and PostgreSQL weighted full-text search.
- [x] **Task 04 — Pi Coding Agent Integration & Tool Allowlisting:** Node.js agent service running Pi Coding Agent SDK (`@earendil-works/pi-coding-agent`), tool restricted to `search_transcripts`, internal token authentication.
- [x] **Task 05 — Full-Stack Conversational UI:** Dual-panel desktop layout, dark theme design system, responsive drawer on mobile, and real-time streaming state.
- [x] **Task 06 — Ship 30 for 30 Writing Skill:** Deterministic 5-section planning, word-budget allocation (1,100–1,400 words), hook generation, and compact citation mapping.
- [x] **Task 07 — Interactive Artifact Viewer & HTML Sanitizer:** In-app side-by-side artifact viewer, backend HTML sanitizer (`validate_and_sanitize_html`), sandboxed iframe with zero permissions, strict CSP injection.
- [x] **Task 08 — Live End-to-End Verification:** Genuine local Ollama inference verified across chat, essays, and artifacts with PostgreSQL persistence.
- [x] **Task 08C — Google Gemini Cloud Provider Integration:** Dual-provider architecture replacing Anthropic with Google Gemini (`gemini-3.5-flash-lite`), credentials privacy, fail-closed error handling.
- [x] **Task 08C-4 — Gemini Essay Length & HTML Timeout Repair:** Provider token budget bonus (1.5x), bounded underlength expansion, 150-second configurable artifact timeout, 1,142-word live essay verified, 11,796-char HTML artifact verified.
- [x] **Task 08D — Final Submission Readiness:** One-command Windows startup script (`scripts/start.ps1`), clean shutdown (`scripts/stop.ps1`), comprehensive documentation, reviewer manual test guide, and final audit.

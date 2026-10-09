# Product Requirements Document (PRD)
## The Lenny Growth Assistant

**Status:** Preliminary / Milestone 01 Draft<br />
**Role:** Forward Deployed Engineer<br />
**Engagement:** Internal Product & Growth AI Assistant Deployment

---

## 1. Executive Summary
"The Lenny Growth Assistant" is an AI-powered conversational web application designed for product managers, growth leads, and founders. It ingests transcripts from Lenny's Podcast / Newsletter knowledge base to deliver strictly grounded answers to complex product strategy questions, generate publication-grade Ship 30 for 30 essays, and create live, in-app interactive artifacts (Markdown and isolated HTML/CSS).

---

## 2. Discovery Brief

### 2.1 Primary User & Problem Framing
* **Primary Users:** Growth Leaders, Product Managers (PMs), Founders, and Product Operations teams.
* **Jobs-to-be-Done (JTBD):**
  1. *Quick Knowledge Extraction:* Query hundreds of hours of tactical advice from world-class operators (e.g., pricing ladders, retention loops, 0-to-1 PM frameworks) without manually scrubbing transcripts.
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
2. **First-Response Latency (Operational Metric):**
   - Local Ollama model response start $\le 2.5\text{ s}$ for streaming tokens on target Ryzen 5 / GPU hardware.
   - End-to-end cloud model response $\le 3.5\text{ s}$.
3. **Artifact Render Safety & Reliability (Technical Metric):**
   - $100\%$ of user-requested artifacts render inside an isolated frontend sandbox with zero script injection or style leakage.

### 2.3 Explicit Assumptions
Because the initial client brief contained operational ambiguities, the following forward deployment assumptions were established:
1. **Local-First Evaluation:** The client evaluation will take place on a local developer workstation (Windows 11 with Ollama) and must run self-contained without mandatory cloud API spend.
2. **Knowledge Base Format:** Transcripts are accessible as clean text/JSON collections with episode metadata (speaker, episode number, topic).
3. **Session Persistence:** A lightweight relational database (PostgreSQL via local service or container) suffices for storing session history, conversational state, and artifact blobs.
4. **Agent Framework Flexibility:** While Anthropic Claude Agent SDK and Pi Coding Agent are highlighted, local evaluation requires an adapter architecture supporting Ollama local inference.

### 2.4 Scope Choices (What is Included vs. Excluded)
| Dimension | Included in Scope | Excluded from Scope | Rationale |
| :--- | :--- | :--- | :--- |
| **Conversational Core** | Multi-turn chat, session tracking, query rewriting, transcript grounding. | Multi-user enterprise RBAC, SSO, workspace billing. | Keep local evaluation frictionless; focus on core operator value. |
| **Grounding & RAG** | Vector indexing + hybrid keyword search over Lenny transcripts with episode citations. | Real-time web crawling or dynamic scraping of arbitrary podcasts. | Preserve strict grounding boundaries within Lenny's corpus. |
| **Specialized Skills** | Dedicated Ship 30 for 30 essay generation skill (~1,250 words, hook, bolding, skimmable structure). | Generic, open-ended blog writer without strict editorial rules. | Evaluates forward-deployed prompt/agent craftsmanship. |
| **Artifacts** | Beside-the-chat viewer supporting Markdown and sandboxed HTML/CSS snippets. | Arbitrary full-stack code execution (e.g., Python sandbox). | High security risk and operational complexity; HTML/CSS sandbox solves UX requirement safely. |
| **LLM Support** | Dual configuration: Local Ollama (default demo) + Cloud LLM (Claude / OpenAI). | Dozens of obscure model providers. | Meets client requirement while keeping configuration clean and reliable. |

### 2.5 Key Risks & Trade-Offs
* **Local Model Quality vs. Cloud Intelligence:** Local 7B/8B models (e.g., Llama 3) may struggle with long-context nuance compared to Claude 3.5 Sonnet.<br />
  *Mitigation:* Optimize chunk retrieval size, engineer strict system prompt constraints, and provide a one-click cloud toggle.
* **Artifact Security (XSS / Untrusted HTML):** Rendering model-generated HTML in the client risks script injection.<br />
  *Mitigation:* Render artifacts inside a sandboxed `<iframe>` with `sandbox="allow-scripts"` (or no script execution) and CSP protections.
* **Transcript Hallucination:** Models tend to extrapolate beyond transcripts.<br />
  *Mitigation:* Explicit refusal prompting when knowledge is not present in retrieved context; strict citation verification.

---

## 3. Provisional Architecture Notice
> **Important Note:** Architectural choices in this preliminary specification remain **provisional** until actual agent framework APIs (e.g., Anthropic Claude Agent SDK vs. Pi Coding Agent) and local Ollama compatibility on Windows are validated in subsequent milestones.

---

## 4. User Journey & Core Flows
1. **Session Creation:** User enters the application, selects model provider (Ollama / Cloud), and starts a session.
2. **Knowledge Querying:** User asks a tactical growth question (e.g., "How does Figma approach bottom-up expansion?").
3. **Grounded Response & Citations:** Assistant returns an answer with expandable episode citations.
4. **Artifact Request:** User requests: "Generate an artifact summarizing this retention loop" or "Write a Ship 30 for 30 essay on this framework".
5. **Side-by-Side Viewing:** Frontend renders the artifact in the right-hand panel while keeping chat intact on the left.

---

## 5. Acceptance Criteria for Task 01
- [x] Clean monorepo directory layout (`backend/`, `frontend/`, `docs/`, `scripts/`, `tests/`, `agent-logs/`).
- [x] Functional FastAPI application with explicit `GET /health` returning healthy status.
- [x] Local Python virtual environment (`.venv`) with pinned dependencies.
- [x] Automated test for `/health` endpoint passing cleanly.
- [x] Minimal React + Vite application with split-panel layout placeholder.
- [x] Safe `.gitignore` and `.env.example` with zero exposed secrets.
- [x] No fake AI responses or unverified functionality.

## 6. Acceptance Criteria for Task 02
- [x] PostgreSQL persistence implemented for independent conversational sessions.
- [x] Alembic migrations configured and generated for ChatSession and ChatMessage schemas.
- [x] Database API endpoints (`POST/GET /api/sessions`, `GET/POST .../messages`) completed.
- [x] Comprehensive automated test suite ensuring isolated operations.
- [x] Secure manual database setup script without hardcoded secrets.

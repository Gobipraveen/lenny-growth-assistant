# Reviewer Manual Testing Guide
## The Lenny Growth Assistant

**Target Audience:** Evaluators, Technical Reviewers, and Hiring Managers<br />
**Evaluation OS:** Windows 11 (PowerShell 5.1 / PowerShell 7)<br />
**Hardware Baseline:** 8 GB Physical RAM Workstation

---

## 1. Quick One-Command Startup

From the repository root (`E:\lenny-growth-assistant`):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

### What this script validates automatically:
1. System prerequisites: Python 3.11+, Node.js v20+, npm, PostgreSQL (port 5432), and Ollama (port 11434).
2. Python virtual environment (`.venv`) and dependencies.
3. Node dependencies in `agent-service` and `frontend`.
4. Environment variables (`.env`) without revealing secrets.
5. PostgreSQL connectivity and applies pending Alembic migrations (`alembic upgrade head`).
6. Verifies local Ollama model (`qwen2.5:1.5b`).
7. Checks for already-running services to avoid duplicate servers.
8. Launches missing services in separate console windows and polls for health.
9. Opens the browser at [http://localhost:5173/](http://localhost:5173/).

---

## 2. Reviewer Step-by-Step Evaluation Walkthrough

Follow these 11 sequential steps to verify all features and guarantees:

### Step 1: Confirm System Readiness
- Open the application at [http://localhost:5173/](http://localhost:5173/).
- Observe the clean slate dark theme interface with two main panels:
  - Left panel: Chat stream and conversation history.
  - Right panel: Interactive Artifact workspace.
- Check the top header:
  - Title: **The Lenny Growth Assistant**
  - Provider Selector: **Ollama (Local)** by default with model pill `qwen2.5:1.5b`.
  - Status indicator: Green connected pill.
  - Knowledge count: `10 episodes · 1,271 chunks`.

### Step 2: Create a New Conversation Session
- Click **+ New Chat** in the top navigation bar.
- Notice that a new session is initialized and assigned a persistent UUID in PostgreSQL.

### Step 3: Query an Indexed Podcast Topic with Ollama (Local)
- Ensure the header provider is set to **Ollama (Local)**.
- In the chat input, type:
  ```
  What does Brian Chesky advise about founder-led product decisions?
  ```
- Press **Enter** or click **Send**.
- Observe the streaming assistant response summarizing Brian Chesky's product leadership principles (staying in the details, un-delegating product reviews, merging inbound development with outbound storytelling).
- Note: First-token latency is typically ~8–12 seconds on an 8 GB laptop during active local model inference.

### Step 4: Inspect Authentic Source Citations
- In the assistant's response, notice the compact citation badges (e.g. `[S1]`, `[S2]`).
- Click on any citation badge.
- An interactive citation card expands, showing:
  - Episode Title (e.g. *"Brian Chesky’s new playbook"*).
  - Guest Name (*Brian Chesky*).
  - Speaker Attribution (*Brian Chesky*).
  - Start/End Timestamp (e.g. `00:15:30`).
  - Canonical YouTube URL link.
  - Verified transcript chunk excerpt matching the exact database record.
- Try an out-of-scope question (e.g. *"What is the recipe for chocolate chip cookies?"*). Notice that the assistant gracefully refuses without hallucinating or inventing quotes.

### Step 5: Generate a Ship 30 for 30 Essay (Local or Cloud)
- Below the chat input, click the **Write Ship 30 Essay** button.
- In the essay creation modal, configure:
  - **Topic:** `How founder-led product decisions drive startup growth`
  - **Target Audience:** `Founders and product leaders`
  - **Intended Outcome:** `Understanding Brian Chesky's founder-led product philosophy, practical lessons for founders, and a clear takeaway`
  - **Organizational Approach:** `lessons`
  - **Editorial Lens:** `actionable`
  - **Target Word Count:** `1250` words
- Click **Generate Essay**.
- A non-blocking asynchronous generation job begins:
  - The right-hand panel automatically switches to the essay draft in generating state.
  - The skill executes structured 5-section drafting with bounded length control.
  - Upon completion, observe the **completed** badge, verified word count (between 1,100 and 1,400 words), 5 sections with H1 and H2 hierarchy, and authentic citations.

### Step 6: Preview and Export Markdown
- In the right-hand panel, inspect the generated essay in the **Preview** tab.
- Click the **Code** tab to view the raw markdown.
- Click **Copy Markdown** to copy the content to your clipboard.
- Click **Download** to save the formatted `.md` file to your computer.

### Step 7: Generate an HTML/CSS Artifact
- Below the chat input, click **Create HTML Artifact**.
- In the modal:
  - Select format: **HTML/CSS (Interactive Dashboard/Playbook)**.
  - Click the **Growth Strategy Dashboard** quick-start preset, or customize the instructions:
    ```
    Create a polished, professional, static HTML/CSS growth playbook using genuine insights from the indexed Brian Chesky podcast.
    Required content:
    - Clear title and introductory summary.
    - Three practical strategy cards.
    - A prioritized founder action plan.
    - A short evidence/sources section.
    Visual requirements:
    - Clean responsive layout.
    - Strong text/background contrast.
    - Balanced spacing.
    - Mobile-friendly CSS.
    - No unsupported business statistics.
    - No JavaScript.
    - No external image or font dependencies.
    ```
- Click **Generate Artifact**.
- In the right-hand panel, observe asynchronous polling. The completed artifact status changes to **completed**.

### Step 8: Test Artifact Modes (Preview, Code, Fullscreen)
1. **Preview Tab:** Renders the responsive HTML/CSS dashboard inside an isolated `<iframe sandbox="">` with strict CSP injected. Test hovering over cards.
2. **Code Tab:** Click **Code** to inspect the clean, sanitized HTML markup rendered safely as inert text. Notice zero `<script>` tags.
3. **Fullscreen Mode:** Click the **Fullscreen** button in the top right of the artifact panel. The artifact expands to fill your screen. Press **Escape** or click **Exit Fullscreen** to return.

### Step 9: Switch to Google Gemini (Cloud Provider)
*Optional: If you have a Google AI Studio API key.*
1. In the root `.env` file, configure your key:
   ```env
   GEMINI_API_KEY="your-google-ai-studio-api-key"
   GEMINI_MODEL="gemini-3.5-flash-lite"
   ```
2. Restart the Node Agent Service so it loads your new key:
   ```powershell
   cd agent-service; node src/server.mjs
   ```
3. In the frontend header, select **Google Gemini (Cloud)** from the provider dropdown.
4. Send a chat message:
   ```
   What does Marty Cagan say about product management theater?
   ```
5. Notice the rapid cloud response (~2–3 seconds roundtrip) with verified citations from Marty Cagan's indexed episode.
6. Note: If an unconfigured or restricted key is used, the system displays an informative HTTP 502/504 provider error dialog without crashing or falling back silently.

### Step 10: Confirm Persistence Across Restarts
1. Note your current Session ID and generated essays/artifacts.
2. Hard refresh your browser (`Ctrl+F5`).
3. Notice that your session, conversation history, essay drafts, and HTML artifacts remain 100% intact from PostgreSQL.
4. Switch between previous conversations in the left sidebar to confirm complete session isolation.

### Step 11: Verify Provider Identities in Database
To confirm that model providers and names are truthfully recorded in the database without fabrication:
```powershell
.\.venv\Scripts\python.exe -c "from backend.app.database import SessionLocal; from backend.app.models.chat import ChatMessage; db = SessionLocal(); print([(m.role, m.provider, m.model_name) for m in db.query(ChatMessage).order_by(ChatMessage.created_at.desc()).limit(5)]); db.close()"
```
Observe that each message records its authentic provider (`ollama` or `gemini`) and model identifier (`qwen2.5:1.5b` or `gemini-3.5-flash-lite`).

---

## 3. How to Stop Services Safely

When your evaluation is complete, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop.ps1
```

This terminates only the Node.js Pi Agent (8001), FastAPI backend (8000), and Vite frontend (5173) processes, leaving PostgreSQL and Ollama unaffected.

---

## 4. API Billing & Free-Tier Quota Notes

- **Ollama (Local):** 100% free and offline. Requires zero API keys or external egress.
- **Google Gemini (Cloud):** Google AI Studio provides free-tier quotas on `gemini-3.5-flash-lite` (15 Requests Per Minute / 1,500 Requests Per Day). If your Google Cloud project has billing restrictions or reaches quota limits, the system catches the error and surfaces an actionable dialog.

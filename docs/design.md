# Design Specifications
## The Lenny Growth Assistant - UI/UX Architecture

**Document Version:** 1.0.0<br />
**Status:** Complete / Verified (Task 08D)

---

## 1. Design Philosophy & Principles

The user interface for **The Lenny Growth Assistant** bridges conversational AI with tactical document workflows. It draws inspiration from Claude Artifacts and modern developer tools:

1. **High Information Density & Low Clutter:** Product managers and founders require clear, scannable insights without decorative distractions.
2. **Side-by-Side Co-presence:** Conversational context and generated artifacts (essays, playbooks, dashboards) live side-by-side in a responsive split view. Context is never lost when reading an artifact.
3. **Transparency of Grounding:** Every factual claim derived from transcripts visibly links to its source episode, guest, timestamp, and transcript snippet.
4. **Resilient Feedback States:** Clear visual cues for model thinking, retrieval progress, streaming status, and error recovery.
5. **Defense-in-Depth Security:** Untrusted generated HTML is isolated in an empty-permission sandboxed `<iframe>` with strict Content Security Policy (CSP), while raw code is rendered as inert text.

---

## 2. Information Architecture

```
+-----------------------------------------------------------------------------------------+
| HEADER: Lenny Growth Assistant [Provider: Ollama / Gemini] [Artifacts Count] [New Chat] |
+-------------------------------------------+---------------------------------------------+
| LEFT PANEL (Chat & Conversation Stream)   | RIGHT PANEL (Artifact Workspace & Viewer)   |
|                                           |                                             |
| - Session Title & Context Banner          | - Artifact Header (Title, Type Pill, Status)|
| - Transcript Grounded Chat Stream         | - View Mode Toggles: [Preview] [Code]       |
| - Inline Compact Citation Pills [S1], [S2]| - Action Buttons: [Copy] [Download] [Full]  |
| - Expandable Citation Modal / Cards       | - Interactive Render Area:                  |
| - Prompt Input Box                        |   * Markdown Render (Gfm, Syntax Highlight) |
| - Skill Action Buttons:                   |   * Sandboxed HTML/CSS Preview (Iframe)     |
|   * [Write Ship 30 Essay]                 |   * Raw Code Display (Escaped, Read-Only)   |
|   * [Generate HTML Artifact]              | - Saved Artifacts History Navigation        |
+-------------------------------------------+---------------------------------------------+
| FOOTER / STATUS: Connection Status | Active Model | Session ID | Knowledge Base Count   |
+-----------------------------------------------------------------------------------------+
```

---

## 3. Key Interaction Workflows & Modals

### 3.1 Provider Selection (Header)
* **Component:** `ProviderSelector.jsx`
* **Options:**
  - `Ollama (Local)`: default local inference with `qwen2.5:1.5b` (port 11434). Zero cloud egress.
  - `Google Gemini (Cloud)`: cloud inference with `gemini-3.5-flash-lite`. Requires `GEMINI_API_KEY` in `.env`.
* **Behavior:** Dynamic switching per session; badge indicator displays active model identity; surfaces clear warning dialogs when cloud keys are unconfigured or project quotas are exceeded.

### 3.2 Ship 30 for 30 Essay Modal (`CreateEssayModal.jsx`)
* **Topic Input:** Focus area grounded in Lenny's podcast (e.g., *"How founder-led product decisions drive startup growth"*).
* **Audience:** Target reader persona (e.g., *"Founders and product leaders"*).
* **Intended Outcome:** Actionable takeaway for readers.
* **Structural Approach:** Selectable framework (`lessons`, `framework`, `mistakes`, `steps`).
* **Editorial Lens (4A Path):** Selectable lens (`actionable`, `analytical`, `aspirational`, `anthropological`).
* **Target Word Count:** Default 1,250 words (deterministic validation boundary: 1,100–1,400 words).
* **Progress & Polling:** Non-blocking async generation; polls backend status every 3s up to 240s; displays terminal results with word count badge and citation count.

### 3.3 HTML/CSS Artifact Modal (`CreateArtifactModal.jsx`)
* **Format Selector:** Radio toggle between `HTML/CSS (Interactive Dashboard/Playbook)` and `Markdown (Structured Memo/Document)`.
* **Quick-Start Presets:**
  - *Growth Strategy Dashboard:* 3 metric cards, prioritized action plan, source attribution.
  - *Product Strategy Playbook:* Tactical principles, operational checklists, source attribution.
  - *User Research Summary:* Qualitative insights, interview quotes, customer journey.
* **Custom Instructions:** Free-form prompt text area for specific UI/layout needs.

### 3.4 Artifact Viewer Modes (`ArtifactViewer.jsx`)
1. **Preview Mode:**
   - Markdown: Rendered with safe GitHub Flavored Markdown, syntax highlighting, and heading anchor IDs.
   - HTML/CSS: Rendered inside `<iframe sandbox="">` with runtime CSP injection (`prepareSandboxedSrcDoc()`), preventing parent access or network exfiltration.
2. **Code Mode:**
   - Displays raw markdown or sanitized HTML as inert pre-formatted text with line numbers, copy button, and syntax styling.
3. **Fullscreen Mode:**
   - Expands artifact workspace to fill entire viewport with escape key and exit button handlers.
4. **Export Actions:**
   - Copy to clipboard with visual confirmation tooltip.
   - Download file with slugified title and proper extension (`.html` or `.md`).

---

## 4. Responsive Layout & Breakpoints

* **Desktop ($\ge 1024\text{px}$):**
  - Side-by-side two-column split layout (50/50 ratio).
  - Synchronized independent scrolling for conversation and artifact workspace.
* **Tablet ($768\text{px} - 1023\text{px}$):**
  - Collapsible side panel with quick-toggle tab bar (Chat $\leftrightarrow$ Artifact).
* **Mobile ($< 768\text{px}$):**
  - Full-width stacked view; active artifact overlays conversation as a dedicated view with back button, preserving conversational state.

---

## 5. Security & Isolation in Artifact Rendering

To satisfy enterprise-grade security for untrusted model outputs:
1. **Markdown Artifacts:** Rendered using sanitized parsers with dangerous HTML tags stripped and script tags rejected.
2. **HTML/CSS Artifacts:**
   - **Backend Sanitization:** FastAPI passes HTML through `validate_and_sanitize_html()`, rejecting `<script>` tags, inline event handlers (`onclick`, `onload`), `javascript:` URIs, external stylesheet links (`<link rel="stylesheet">`), and dangerous CSS `@import` rules.
   - **Frontend Iframe Sandboxing:** Rendered strictly with an empty sandbox attribute: `<iframe sandbox="" srcDoc={sanitizedSrcDoc} />`. An empty sandbox enforces maximum restriction: no script execution, no form submission, no popups, no same-origin storage access.
   - **Content Security Policy Injection:** The frontend injects a strict CSP meta tag into the iframe document:
     ```html
     <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; script-src 'none'; connect-src 'none'; frame-src 'none';">
     ```
   - **Zero dangerous DOM methods:** Absolutely no `dangerouslySetInnerHTML` is used for untrusted model outputs anywhere in the frontend codebase.

---

## 6. Accessibility & Design Tokens

* **Color Palette (Dark Modern Slate System):**
  - Primary Background: `#0f172a` (Slate 900)
  - Surface / Card Background: `#1e293b` (Slate 800)
  - Border Lines: `#334155` (Slate 700)
  - Text Primary: `#f8fafc` (Slate 50)
  - Text Muted: `#94a3b8` (Slate 400)
  - Accent / Sky: `#38bdf8` (Sky 400)
  - Accent Dark: `#0284c7` (Sky 600)
  - Success Green: `#22c55e`
  - Error Red: `#ef4444`
* **Typography:** System font stack (`Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`) for crisp readability and fast local rendering without external font downloads.
* **WCAG Compliance:** Meets WCAG 2.1 AA standards with $\ge 4.5:1$ contrast ratio across all text and interactive controls.

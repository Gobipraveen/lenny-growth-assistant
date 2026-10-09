# Design Specifications
## The Lenny Growth Assistant - UI/UX Architecture

**Document Version:** 0.1.0<br />
**Status:** Provisional (Subject to agent SDK and artifact validation)

---

## 1. Design Philosophy & Principles

The user interface for **The Lenny Growth Assistant** is built to bridge conversational AI with tactical document workflows. It draws inspiration from Claude Artifacts and modern developer tools:

1. **High Information Density & Low Clutter:** Product managers and founders require clear, scannable insights without decorative distractions.
2. **Side-by-Side Co-presence:** Conversational context and generated artifacts (essays, diagrams, checklists) should never hide each other. Both live side-by-side in a responsive split view.
3. **Transparency of Grounding:** Every factual claim derived from transcripts must visibly link to its source episode, guest, and timestamp.
4. **Resilient Feedback States:** Clear visual cues for model thinking, retrieval progress, streaming status, and error recovery.

> **Provisional Architecture Note:** Initial interface specifications remain provisional until the interaction model between the frontend and the agent runtime (Ollama vs. Cloud SDKs) is concretely benchmarked in subsequent milestones.

---

## 2. Information Architecture

```
+--------------------------------------------------------------------------+
|  HEADER: Lenny Growth Assistant [Model Selector: Ollama / Claude] [New Chat]|
+-------------------------------------+------------------------------------+
|  LEFT PANEL (Chat Stream)           |  RIGHT PANEL (Artifact Workspace)  |
|                                     |                                    |
|  - Session Title & Context Banner   |  - Artifact Tabs / Breadcrumb      |
|  - Transcript Grounded Chat Stream  |  - View Mode Toggle (Preview/Code) |
|  - Inline Citation Cards            |  - Interactive Render Area         |
|  - Prompt Input Box + Skill Chips   |    * Markdown Render               |
|    (e.g., [Ship 30 for 30 Essay])   |    * Sandboxed HTML/CSS Preview    |
|                                     |  - Export Actions (Copy, Download) |
+-------------------------------------+------------------------------------+
|  FOOTER: Connection Status | Active Model | Session ID                    |
+--------------------------------------------------------------------------+
```

---

## 3. Key Interaction States

1. **Empty State:**
   - Left panel shows prompt suggestions (e.g., *"What is Brian Chesky's stance on product management vs. marketing?"*, *"Generate a Ship 30 essay on Elena Verna's B2B PLG flywheel"*).
   - Right panel displays a subtle placeholder card explaining artifact capabilities.
2. **Active Streaming State:**
   - Left panel shows streaming markdown text with pulsating status indicator.
   - Grounding badges highlight citations as chunks stream in.
3. **Artifact Triggered State:**
   - When the assistant decides to generate an artifact (e.g., Ship 30 essay or HTML table), an inline artifact pill appears in the chat stream.
   - The right panel automatically springs into focus, displaying the rendering artifact in real time.
4. **Error & Fallback State:**
   - If local Ollama is offline or times out, an inline banner offers graceful fallback with clear diagnostic guidance (e.g., "Ollama unreachable at http://localhost:11434. Check `ollama serve` or switch to Cloud LLM").

---

## 4. Responsive Layout & Breakpoints

* **Desktop ($\ge 1024\text{px}$):**
  - Two-column split layout (50/50 or configurable 45/55 split).
  - Synchronized scrolling and independent scrollbars.
* **Tablet ($768\text{px} - 1023\text{px}$):**
  - Collapsible side panel with quick-toggle tab bar (Chat $\leftrightarrow$ Artifact).
* **Mobile ($< 768\text{px}$):**
  - Full-width stacked view or bottom-sheet drawer for artifacts to prevent cramped reading.

---

## 5. Security & Isolation in Artifact Rendering

To satisfy the client security expectations regarding untrusted model outputs:
1. **Markdown Artifacts:** Rendered using sanitized parsers with HTML tags stripped or strictly whitelisted.
2. **HTML/CSS Artifacts:**
   - Rendered inside an `<iframe>` container.
   - Enforced iframe attributes: `sandbox="allow-scripts"` (if interactivity is needed) or `sandbox` (for static content).
   - Strict Content Security Policy (CSP) headers applied to prevent parent window access, cookie exfiltration, or external network calls.

---

## 6. Accessibility & Design Tokens

* **Color Palette (Dark Modern Theme):**
  - Primary Background: `#0f172a` (Slate 900)
  - Surface Background: `#1e293b` (Slate 800)
  - Border Lines: `#334155` (Slate 700)
  - Text Primary: `#f8fafc` (Slate 50)
  - Text Muted: `#94a3b8` (Slate 400)
  - Accent / Primary CTA: `#38bdf8` (Sky 400)
* **Typography:** System font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto`) for crisp readability and fast local rendering.
* **WCAG Compliance:** Target WCAG 2.1 AA contrast ratios ($\ge 4.5:1$ for normal text).

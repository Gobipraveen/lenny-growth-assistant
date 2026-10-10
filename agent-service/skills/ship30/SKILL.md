---
name: ship30_essay_writer
description: Dedicated Ship 30 for 30 essay writing skill grounded in Lenny's Podcast transcripts.
version: 1.0.0
author: Oogway Labs
target_word_count: 1250
tolerance:
  min: 1100
  max: 1400
proven_approaches:
  - framework
  - lessons
  - mistakes
  - steps
four_a_paths:
  - actionable
  - analytical
  - aspirational
  - anthropological
---

# Ship 30 for 30 Dedicated Essay Writing Skill

A publication-grade, reusable agent skill designed to synthesize Lenny's Podcast transcript evidence into high-retention, skimmable ~1,250-word essays following the official Ship 30 for 30 online writing methodology.

---

## 1. Assignment Source of Truth & Philosophy

Based on **Section 4.2 of the Oogway Labs Assignment** and the official Ship 30 for 30 guide (*"How To Start Writing Online: The Ship 30 for 30 Ultimate Guide"* by Dickie Bush and Nicolas Cole):

### Core Ship 30 Principles Encoded
1. **The Digital Writer Mindset:**
   - Writing online is an iterative startup process: test concepts in public, measure clarity, and optimize for **Rate of Revelation** (every single sentence advances the reader's understanding).
2. **The Endless Idea Generator:**
   - **Topic Specificity:** Narrow down broad topics (e.g. from generic "pricing" to *"How seed-stage B2B founders should price their first 10 design partners"*).
   - **Credibility as Curation:** Rather than inventing personal authority, the essayist explicitly curates top-tier practitioners from Lenny's Podcast (e.g. Brian Chesky, Elena Verna, Shreyas Doshi).
   - **The 4A Paths:** Select an intentional lens:
     - *Actionable:* Here is the exact playbook to do it.
     - *Analytical:* Here are the numbers, benchmarks, and retention metrics.
     - *Aspirational:* Here is the transformative trajectory possible.
     - *Anthropological:* Here is the human and organizational psychology driving behavior.
   - **The Proven Approach:** Choose one unified container: *Steps*, *Lessons Learned*, *Mistakes to Avoid*, or *The Framework*.
3. **Headline Design (Clear > Clever):**
   - Must answer three questions before the reader clicks:
     - **WHO** is this for?
     - **WHAT** is this about?
     - **WHY** should they care? (The PROMISE).
   - Leverages the **Curiosity Gap**: reveals the beginning and end of the transformation, compelling the reader to read the middle.
4. **The Strong Hook:**
   - Begins with an immediate tension, counter-intuitive insight, or pervasive misconception.
   - Structured with a **1/3/1** or **1/5/1** rhythm: a crisp single-sentence opener, an informative middle, and a punchy transition sentence.
   - Zero hallucinated anecdotes or fake personal stories.
5. **Skimmable Presentation (Wheels & Spokes):**
   - **One H1 headline** acting as the main wheel.
   - **At least 3 descriptive H2 section headings** serving as spokes.
   - Short paragraphs (2 to 4 sentences maximum).
   - **Selective bold emphasis** on core pivots so skimmers grasp the thesis in 30 seconds.
   - Bulleted lists used exclusively where they improve readability.
6. **Content Differentiation (The Tequila Test):**
   - If everyone in the industry says the same cliché thing ("align stakeholders", "meditate every morning"), pass the Tequila Test by offering the fresh, non-obvious insight backed by Lenny's guests.
7. **The Actionable Ending:**
   - Every essay must conclude with a concrete takeaway: a diagnostic checklist, a decision rule, or an immediate 3-step exercise.

---

## 2. Length & Token Budget Strategy

### The 1,250-Word Challenge on Small Models
* **Word Count Target:** ~1,250 words (acceptable range: 1,100 to 1,400 words).
* **Token Math:** 1,250 English words typically require **1,650 to 1,950 generation tokens**.
* **Model Constraints:**
  - On `qwen2.5:1.5b` (local Ollama), the generation budget is constrained by `maxTokens: 2048`.
  - In a single zero-shot generation pass, small 1.5B models frequently exhaust context, repeat paragraphs, or truncate before hitting 1,250 words.
* **Architectural Solution (Task 06A & 06B):**
  - **Structured 5-Section Plan:** The planner allocates distinct word count budgets:
    1. *Section 1 (Hook & Tension):* ~200 words (Rhythm: 1/5/1)
    2. *Section 2 (The Conventional Trap):* ~250 words (Rhythm: 1/3/1 + 1/3/1)
    3. *Section 3 (Transcript Breakthrough):* ~350 words (Rhythm: 1/5/1)
    4. *Section 4 (Tactical Execution):* ~250 words (Rhythm: 1/3/1)
    5. *Section 5 (Actionable Checklist):* ~200 words (Rhythm: 1/3/1)
    **Total:** 1,250 words.
  - In Task 06B, generation can be executed in a multi-stage workflow (Outline $\rightarrow$ Section-by-Section drafting $\rightarrow$ Final assembly and validation), ensuring full ~1,250-word length without truncation.

---

## 3. Strict Evidence Grounding & Citation Contracts

* **No Hallucinations:** Every significant external claim must reference verified transcript chunks.
* **Format:** Explicit chunk citations embedded in text: `[chunk_id: <uuid>]`.
* **Verification:** The validator verifies every cited ID against the supplied `verified_evidence`. Unverified or fabricated IDs cause hard validation failure.
* **Zero Evidence Safety Gate:** If zero relevant evidence passages are retrieved, the skill aborts with status `"insufficient_evidence"`, refusing to generate an ungrounded essay.

---

## 4. Input & Output Interface Specification

### Input Schema
```json
{
  "topic": "B2B SaaS Pricing and Packaging for Early Stage Startups",
  "audience": "Seed and Series A Founders",
  "intended_outcome": "Transition from bespoke pricing to transparent value metric tiers",
  "proven_approach": "framework",
  "four_a_path": "actionable",
  "target_word_count": 1250,
  "min_word_count": 1100,
  "max_word_count": 1400,
  "verified_evidence": [
    {
      "chunk_id": "8a32b21c-...",
      "episode_title": "Patrick Campbell on Pricing Strategy",
      "guest": "Patrick Campbell",
      "speaker": "Patrick Campbell",
      "source_url": "https://youtube.com/watch?v=...",
      "start_timestamp": "00:15:30",
      "end_timestamp": "00:18:45",
      "content": "Most companies mess up pricing because they pick the wrong value metric..."
    }
  ]
}
```

### Output Schema
```json
{
  "title": "The Seed Founder's Guide to B2B SaaS Pricing: How to Stop Guessing and Pick the Right Value Metric",
  "markdown": "# The Seed Founder's Guide to B2B SaaS Pricing...\n\n...",
  "word_count": 1248,
  "citations": [ ... ],
  "evidence_chunk_ids": [ "8a32b21c-..." ],
  "validation_results": {
    "isValid": true,
    "wordCountValid": true,
    "headingsValid": true,
    "citationsValid": true,
    "takeawayValid": true,
    "errors": [],
    "warnings": []
  },
  "generation_status": "success"
}
```

---

## 5. Security & Isolation Safeguards
* **No Unsafe Tools:** The skill executes in pure memory space; it has zero access to shell/bash execution, filesystem writes, or database mutations.
* **Deterministic Output:** Post-generation validators enforce length, structure, and citation integrity.

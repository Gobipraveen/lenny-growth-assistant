/**
 * Prompt Builder for Ship 30 for 30 Essay Generation.
 * Synthesizes strict editorial constraints, formatting cadence, and verified evidence blocks.
 */

/**
 * Builds the comprehensive generation prompt for drafting a full ~1,250-word Ship 30 essay.
 * @param {object} plan - Output of createEssayPlan
 * @returns {string} System & user prompt for the agent
 */
export function buildGenerationPrompt(plan) {
  const {
    headline,
    topic,
    audience,
    intended_outcome,
    proven_approach,
    four_a_path,
    target_word_count,
    wordBudgets,
    guests,
    sections,
    allEvidence,
  } = plan;

  // Format verified evidence block with explicit IDs
  let evidenceBlock = "";
  if (allEvidence.length > 0) {
    evidenceBlock = allEvidence
      .map(
        (p) =>
          `[VERIFIED PASSAGE chunk_id="${p.chunk_id}"]\n` +
          `Episode: "${p.episode_title}"\n` +
          `Guest / Speaker: ${p.guest || p.speaker || "Unknown"}\n` +
          `Timestamps: ${p.start_timestamp || "N/A"} - ${p.end_timestamp || "N/A"}\n` +
          `URL: ${p.source_url || "N/A"}\n` +
          `Content:\n${p.content}`
      )
      .join("\n\n---\n\n");
  } else {
    evidenceBlock = "NO VERIFIED EVIDENCE AVAILABLE. (Do not fabricate claims; report insufficient evidence).";
  }

  return `You are an elite Digital Essayist and Product Mentor trained in the Ship 30 for 30 methodology (co-founded by Dickie Bush & Nicolas Cole) and deeply knowledgeable in Lenny's Podcast archives.

YOUR MISSION:
Write a publication-grade, skimmable, highly actionable ~${target_word_count}-word essay on "${topic}" specifically for ${audience}.

MANDATORY SHIP 30 EDITORIAL RULES:
1. HEADLINE (One H1):
   - Suggested: ${headline}
   - Must be Clear > Clever. Specifies WHO it is for, WHAT it is about, and the PROMISE to the reader.
2. STRONG HOOK (Section 1):
   - Open with an immediate tension, counter-intuitive insight, or pervasive misconception.
   - Use the 1/5/1 or 1/3/1 rhythm: short single-sentence opener, structured body, punchy conclusion.
   - Do NOT invent fake personal anecdotes or fabricated statistics.
3. CONTENT DIFFERENTIATION (The Tequila Test):
   - Avoid generic corporate clichés ("align stakeholders", "communicate frequently").
   - Challenge conventional wisdom with specific, non-obvious principles from Lenny's guests.
4. SKIMMABLE FORMATTING (Wheels & Spokes):
   - Exactly one H1 headline.
   - At least 3 descriptive H2 section headings.
   - Short paragraphs (2-4 sentences maximum).
   - Use selective bolding (**bold key shifts**) so the essay can be skimmed in 30 seconds.
   - Use bullet points only where they clarify steps or checklists.
5. STRICT GROUNDING & CREDIBILITY:
   - Ground all insights in the transcript passages provided below.
   - Attribute quotes and ideas to the correct guest (${guests.join(", ") || "Lenny's Podcast guest"}).
   - When citing evidence, include the explicit chunk tag in the text, e.g.: [chunk_id: <chunk_id>].
   - NEVER invent chunk IDs, timestamps, or URLs not present in the verified evidence.
6. CONCRETE ACTIONABLE TAKEAWAY (Section 5):
   - Conclude with an explicit actionable framework, diagnostic checklist, or decision rule under a heading like "## The Actionable Framework" or "## The Checklist".
   - Give the reader something they can implement in their company tomorrow morning.
7. WORD COUNT & CADENCE:
   - Target length: ${target_word_count} words (acceptable range: 1,100 to 1,400 words).
   - Budget breakdown:
     * Section 1 (Hook & Tension): ~${wordBudgets.hook} words
     * Section 2 (The Conventional Trap): ~${wordBudgets.problem} words
     * Section 3 (Transcript-Backed Insights): ~${wordBudgets.insights} words
     * Section 4 (Tactical Execution): ~${wordBudgets.implications} words
     * Section 5 (Actionable Framework / Checklist): ~${wordBudgets.takeaway} words

VERIFIED TRANSCRIPT EVIDENCE BASE:
${evidenceBlock}

OUTPUT FORMAT:
Return ONLY the complete essay in clean Markdown. Do not include introductory conversational meta-commentary like "Here is your essay:".`;
}

/**
 * Builds an isolated prompt for a single section, enabling section-by-section drafting
 * under tight output token limits for small local models.
 * @param {object} section - Section definition from planner
 * @param {object} plan - Overall essay plan
 * @param {string} priorSectionsText - Already generated sections for context continuity
 * @returns {string} Prompt for drafting this specific section
 */
export function buildSectionPrompt(section, plan, priorSectionsText = "") {
  const assignedEvidenceText = (section.assignedEvidence || [])
    .map((p) => `[chunk_id="${p.chunk_id}"] (Guest: ${p.guest}): "${p.content}"`)
    .join("\n\n");

  return `Draft ${section.id} ("${section.title}") for a Ship 30 for 30 essay on "${plan.topic}".
Target length: exactly ~${section.targetWords} words.
Cadence rhythm: ${section.rhythm}.
Purpose: ${section.purpose}
Specific Section Rules:
${section.rules.map((r) => `- ${r}`).join("\n")}

${assignedEvidenceText ? `Assigned Evidence Chunks to cite:\n${assignedEvidenceText}\n` : ""}
${priorSectionsText ? `Prior Context:\n${priorSectionsText.slice(-600)}\n` : ""}

Draft ONLY the markdown content for this section.`;
}

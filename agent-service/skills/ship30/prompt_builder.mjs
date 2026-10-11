/**
 * Prompt Builder for Ship 30 for 30 Essay Generation.
 * Synthesizes strict editorial constraints, formatting cadence, and verified evidence blocks.
 */

import { countWords } from "./validator.mjs";

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
        (p, idx) =>
          `[VERIFIED PASSAGE chunk_id="${p.chunk_id}"] [SOURCE S${idx + 1}]\n` +
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
   - When citing evidence, cite using compact tokens like [S1], [S2] (or [chunk_id: <chunk_id>]).
   - NEVER invent chunk IDs, citation tokens, timestamps, or URLs not present in the verified evidence.
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
Return ONLY the complete essay in clean Markdown. Do NOT wrap the entire output in an outer \`\`\`markdown code block. Do not include introductory conversational meta-commentary like "Here is your essay:".`;
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
  const validTokens = (section.assignedEvidence || []).map((p, idx) => {
    const globalIdx = (plan.allEvidence || []).findIndex((e) => e.chunk_id === p.chunk_id);
    return globalIdx >= 0 ? `S${globalIdx + 1}` : `S${idx + 1}`;
  });

  const assignedEvidenceText = (section.assignedEvidence || [])
    .map((p, idx) => {
      const globalIdx = (plan.allEvidence || []).findIndex((e) => e.chunk_id === p.chunk_id);
      const token = globalIdx >= 0 ? `S${globalIdx + 1}` : `S${idx + 1}`;
      return `[SOURCE ${token} | chunk_id="${p.chunk_id}"] (Guest: ${p.guest || p.speaker || "Lenny's Guest"}):\n"${p.content}"`;
    })
    .join("\n\n");

  const citationNotice = validTokens.length > 0
    ? `Assigned valid source tokens: [${validTokens.join(", ")}]. When citing, use compact tokens like [${validTokens[0]}] or (${validTokens[0]}). NEVER invent unassigned tokens.`
    : `This section does not introduce direct evidence citations. Do not invent citation tokens.`;

  const minWords = section.minWords || Math.round(section.targetWords * 0.75);
  const maxWords = section.maxWords || Math.round(section.targetWords * 1.25);

  return `Draft Section "${section.title}" (${section.id}) for a Ship 30 for 30 essay on "${plan.topic}".

SECTION SPECIFICATIONS:
- Target word count: ~${section.targetWords} words (STRICT BOUNDS: ${minWords} to ${maxWords} words).
- Rhythm cadence: ${section.rhythm}.
- Section purpose: ${section.purpose}
- Specific Section Rules:
${section.rules.map((r) => `- ${r}`).join("\n")}

${assignedEvidenceText ? `VERIFIED EVIDENCE CHUNKS ASSIGNED TO THIS SECTION:\n${assignedEvidenceText}\n` : ""}
${priorSectionsText ? `PRIOR CONTEXT (for continuity only):\n${priorSectionsText.slice(-600)}\n` : ""}

CRITICAL GENERATION CONSTRAINTS (MANDATORY):
1. LENGTH CONSTRAINT: Write strictly between ${minWords} and ${maxWords} words (target: ~${section.targetWords} words). Do NOT exceed ${maxWords} words.
2. Produce ONLY the requested section prose. Do NOT write an entire multi-section essay.
3. Do NOT repeat prior sections, repeat prior paragraphs, or repeat concluding quotes from earlier sections.
4. Do NOT repeat supplied transcript evidence verbatim. Synthesize core principles.
5. Do NOT include introductory conversational meta-commentary (e.g., "Sure, here is the draft..."). Begin immediately with the section content.
6. Do NOT restate prompts, section titles, or editorial instructions.
7. Do NOT wrap prose in outer \`\`\`markdown code fences or backticks.
8. CITATION INTEGRITY: ${citationNotice}
9. Stop immediately once the allotted section content is complete.`;
}

/**
 * Builds a prompt for bounded single-section compression when an overlong section is detected.
 * @param {object} section - Section definition
 * @param {string} draftText - The overlong draft text
 * @param {number} targetWords - Target word count for compression
 * @returns {string} Compression prompt
 */
export function buildCompressionPrompt(section, draftText, targetWords) {
  const minWords = section.minWords || Math.round(targetWords * 0.75);
  const maxWords = section.maxWords || Math.round(targetWords * 1.15);

  return `The following draft for Section "${section.title}" is ${countWords(draftText)} words, which exceeds its allocated budget.
Rewrite and compress this section to strictly ~${targetWords} words (acceptable range: ${minWords} to ${maxWords} words).

DRAFT TO COMPRESS:
${draftText}

COMPRESSION RULES:
1. Preserve all core arguments, structure, and all verified citation tokens (e.g. [S1], (S1), (S2:00:06:46)). Do NOT delete or alter citations.
2. Cut filler, conversational preamble, repeated quotes, and verbose elaboration.
3. Output ONLY the compressed Markdown prose for this section. No outer code fences, no introductory meta-commentary.
4. Stop immediately once the concise point is made.`;
}

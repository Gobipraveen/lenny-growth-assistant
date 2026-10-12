/**
 * Ship 30 for 30 Dedicated Essay Writing Skill
 * Grounded exclusively in Lenny's Podcast Transcripts.
 */

import { validateSkillInput, normalizeEvidence, ESSAY_DEFAULTS } from "./contracts.mjs";
import { createEssayPlan } from "./planner.mjs";
import { buildGenerationPrompt, buildSectionPrompt, buildCompressionPrompt, buildExpansionPrompt } from "./prompt_builder.mjs";
import { validateEssay, countWords, stripOuterMarkdownFence, extractCompactCitationTokens } from "./validator.mjs";

export {
  validateSkillInput,
  normalizeEvidence,
  createEssayPlan,
  buildGenerationPrompt,
  buildSectionPrompt,
  buildCompressionPrompt,
  buildExpansionPrompt,
  validateEssay,
  countWords,
  stripOuterMarkdownFence,
  extractCompactCitationTokens,
  assembleEssaySections,
  ESSAY_DEFAULTS,
};


/**
 * Assembles 5 sequentially generated sections into a cohesive Ship 30 Markdown essay.
 * Safely strips outer markdown fences from section drafts, guarantees exactly one
 * top-level H1 headline, properly structured H2 section headers, and an explicit
 * actionable takeaway section.
 * @param {object} params
 * @param {object} params.plan - Narrative plan from createEssayPlan
 * @param {Array<{ section: object, text: string }>} params.sectionTexts - Ordered section outputs
 * @returns {string} Assembled Markdown document
 */
function assembleEssaySections({ plan, sectionTexts }) {
  const parts = [];
  const headline = plan.headline.startsWith("# ") ? plan.headline : `# ${plan.headline}`;

  sectionTexts.forEach(({ section, text }, idx) => {
    let cleanText = stripOuterMarkdownFence(text || "");

    if (idx === 0) {
      // First section: ensure H1 is present
      if (cleanText.startsWith("# ")) {
        parts.push(cleanText);
      } else {
        parts.push(`${headline}\n\n${cleanText}`);
      }
    } else {
      // Demote any accidental H1 in subsequent sections to H2
      cleanText = cleanText.replace(/^#\s+(.+)$/gm, "## $1");

      // Check if section already starts with an H2
      if (!cleanText.startsWith("## ")) {
        const defaultH2 = idx === 4 ? "## The Actionable Framework" : `## ${section.title}`;
        cleanText = `${defaultH2}\n\n${cleanText}`;
      }
      parts.push(cleanText);
    }
  });

  return parts.join("\n\n");
}

/**
 * Standardized Skill Execution Workflow.
 * Safely manages evidence normalization, plan formulation, generation, and deterministic validation.
 * Supports both single-turn full prompt generation (generateFn) and sequential 5-section drafting (generateSectionFn).
 * @param {object} params
 * @param {object} params.input - Skill invocation inputs
 * @param {Function} [params.generateFn] - Callable LLM generator function: (prompt) => Promise<string>
 * @param {Function} [params.generateSectionFn] - Sequential section generator: ({ section, plan, priorSectionsText, prompt }) => Promise<string>
 * @returns {Promise<object>} Standardized Ship30EssayOutput contract
 */
export async function executeSkillWorkflow({ input, generateFn, generateSectionFn }) {
  // 1. Validate inputs
  const inputValidation = validateSkillInput(input);
  if (!inputValidation.isValid) {
    return {
      title: "",
      markdown: "",
      word_count: 0,
      citations: [],
      evidence_chunk_ids: [],
      validation_results: {
        isValid: false,
        wordCountValid: false,
        headingsValid: false,
        citationsValid: false,
        takeawayValid: false,
        errors: inputValidation.errors,
        warnings: [],
      },
      generation_status: "invalid_input",
    };
  }

  const sanitizedInput = inputValidation.sanitizedInput;

  // 2. Normalize and verify evidence
  const normalizedEvidence = normalizeEvidence(sanitizedInput.verified_evidence);
  if (normalizedEvidence.length === 0) {
    return {
      title: "",
      markdown: "",
      word_count: 0,
      citations: [],
      evidence_chunk_ids: [],
      validation_results: {
        isValid: false,
        wordCountValid: false,
        headingsValid: false,
        citationsValid: false,
        takeawayValid: false,
        errors: ["Insufficient verified transcript evidence. Cannot generate essay without supporting passages."],
        warnings: [],
      },
      generation_status: "insufficient_evidence",
    };
  }

  // 3. Create 5-section narrative plan
  const plan = createEssayPlan(sanitizedInput, normalizedEvidence);

  // 4. Build prompt
  const prompt = buildGenerationPrompt(plan);

  // If no generator is provided, return the generated plan and prompt for offline inspection/testing
  if (typeof generateFn !== "function" && typeof generateSectionFn !== "function") {
    return {
      title: plan.headline.replace(/^#\s+/, ""),
      plan,
      prompt,
      word_count: 0,
      citations: [],
      evidence_chunk_ids: normalizedEvidence.map((e) => e.chunk_id),
      validation_results: {
        isValid: true,
        wordCountValid: false,
        headingsValid: false,
        citationsValid: true,
        takeawayValid: false,
        errors: [],
        warnings: ["Offline mode: generation function was not invoked."],
      },
      generation_status: "planned",
    };
  }

  // 5. Generate essay content (sequential section-by-section or single-turn)
  let generatedMarkdown = "";
  try {
    if (typeof generateSectionFn === "function") {
      const sectionTexts = [];
      let accumulatedText = "";
      let compressionOccurred = false;
      for (const section of plan.sections) {
        const sectionPrompt = buildSectionPrompt(section, plan, accumulatedText);
        let sectionText = await generateSectionFn({
          section,
          plan,
          priorSectionsText: accumulatedText,
          prompt: sectionPrompt,
          maxTokens: section.maxTokens,
        });

        // Deterministic Section-Length Measurement
        let cleanSection = stripOuterMarkdownFence(sectionText || "");
        let sectionWords = countWords(cleanSection);
        const maxSectionWords = section.maxWords || Math.round(section.targetWords * 1.25);

        // Detect overlong section
        if (sectionWords > maxSectionWords) {
          compressionOccurred = true;
          // Bounded revision: at most ONE compression attempt
          const compressionPrompt = buildCompressionPrompt(section, cleanSection, section.targetWords);
          const compressedText = await generateSectionFn({
            section,
            plan,
            priorSectionsText: accumulatedText,
            prompt: compressionPrompt,
            maxTokens: section.maxTokens,
          });

          const cleanCompressed = stripOuterMarkdownFence(compressedText || "");
          const compressedWords = countWords(cleanCompressed);

          // Preserve shorter valid version only if it remains structurally correct and citations remain valid
          if (compressedWords < sectionWords && compressedWords > 0) {
            const compressedCitations = extractCompactCitationTokens(cleanCompressed);
            const validShortIds = new Set(normalizedEvidence.map((_, idx) => `s${idx + 1}`));
            const hasInvalidCitation = compressedCitations.some((c) => !validShortIds.has(c.shortId));

            if (!hasInvalidCitation) {
              sectionText = cleanCompressed;
              cleanSection = cleanCompressed;
              sectionWords = compressedWords;
            }
          }

          // If revision fails to prevent severe overrun, report truthful validation failure
          const severeOverrunLimit = Math.max(500, Math.round(section.targetWords * 1.8));
          if (sectionWords > severeOverrunLimit) {
            return {
              title: plan.headline.replace(/^#\s+/, ""),
              markdown: assembleEssaySections({ plan, sectionTexts: [...sectionTexts, { section, text: cleanSection }] }),
              word_count: sectionWords,
              citations: [],
              evidence_chunk_ids: normalizedEvidence.map((e) => e.chunk_id),
              validation_results: {
                isValid: false,
                wordCountValid: false,
                headingsValid: false,
                citationsValid: false,
                takeawayValid: false,
                errors: [
                  `Section "${section.title}" exceeded length budget (${sectionWords} words; maximum allowed is ${maxSectionWords} words). Severe overrun detected.`,
                ],
                warnings: [],
              },
              generation_status: "section_word_count_exceeded",
            };
          }
        }

        sectionTexts.push({ section, text: cleanSection });
        accumulatedText += `\n\n${cleanSection}`.trim();
      }
      generatedMarkdown = assembleEssaySections({ plan, sectionTexts });

      // Deterministic Bounded Underlength Expansion (at most ONE attempt)
      const currentWordCount = countWords(generatedMarkdown);
      if (!compressionOccurred && currentWordCount < sanitizedInput.min_word_count && typeof generateSectionFn === "function") {
        const targetSectionIdx = sectionTexts.findIndex((s) => s.section.id === "section_3_insights");
        const expandIdx = targetSectionIdx >= 0 ? targetSectionIdx : (sectionTexts.length > 2 ? 2 : 0);
        const targetItem = sectionTexts[expandIdx];

        const neededWords = sanitizedInput.target_word_count - currentWordCount;
        const targetAddition = Math.min(220, Math.max(90, neededWords + 40));
        const expansionPrompt = buildExpansionPrompt(targetItem.section, targetItem.text, targetAddition);

        try {
          const expandedText = await generateSectionFn({
            section: targetItem.section,
            plan,
            priorSectionsText: "",
            prompt: expansionPrompt,
            maxTokens: Math.round((targetItem.section.maxTokens || 500) * 1.5),
          });

          const cleanExpanded = stripOuterMarkdownFence(expandedText || "");
          const expandedWords = countWords(cleanExpanded);
          const originalWords = countWords(targetItem.text);

          if (expandedWords > originalWords) {
            // Verify citations remained valid
            const expandedCitations = extractCompactCitationTokens(cleanExpanded);
            const validShortIds = new Set(normalizedEvidence.map((_, idx) => `s${idx + 1}`));
            const hasInvalidCitation = expandedCitations.some((c) => !validShortIds.has(c.shortId));

            if (!hasInvalidCitation) {
              sectionTexts[expandIdx] = {
                section: targetItem.section,
                text: cleanExpanded,
              };
              generatedMarkdown = assembleEssaySections({ plan, sectionTexts });
            }
          }
        } catch (expErr) {
          // If expansion fails or times out, retain current assembled markdown
        }
      }
    } else if (typeof generateFn === "function") {
      generatedMarkdown = await generateFn(prompt);
    }
  } catch (genErr) {
    if (genErr.code === "INFERENCE_TIMEOUT" || genErr.name === "TimeoutError" || genErr.statusCode === 504) {
      throw genErr;
    }
    return {
      title: plan.headline.replace(/^#\s+/, ""),
      markdown: "",
      word_count: 0,
      citations: [],
      evidence_chunk_ids: normalizedEvidence.map((e) => e.chunk_id),
      validation_results: {
        isValid: false,
        wordCountValid: false,
        headingsValid: false,
        citationsValid: false,
        takeawayValid: false,
        errors: [`Inference generation failed: ${genErr.message}`],
        warnings: [],
      },
      generation_status: "generation_error",
    };
  }

  // 6. Post-generation validation
  const validationResults = validateEssay({
    markdown: generatedMarkdown,
    verifiedEvidence: normalizedEvidence,
    targetWordCount: sanitizedInput.target_word_count,
    minWordCount: sanitizedInput.min_word_count,
    maxWordCount: sanitizedInput.max_word_count,
  });

  const titleMatch = generatedMarkdown.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : plan.headline.replace(/^#\s+/, "");

  return {
    title,
    markdown: generatedMarkdown,
    word_count: validationResults.wordCount,
    target_word_count: sanitizedInput.target_word_count,
    word_count_range: {
      min: sanitizedInput.min_word_count,
      max: sanitizedInput.max_word_count,
    },
    citations: validationResults.citations,
    evidence_chunk_ids: normalizedEvidence.map((e) => e.chunk_id),
    plan,
    validation_results: validationResults,
    generation_status: validationResults.isValid ? "success" : "validation_failed",
  };
}

/**
 * Registers the Ship 30 for 30 skill as a structured tool on a Pi agent session.
 * Exposes ONLY a safe, non-system, non-shell interface to the agent.
 * @param {object} pi - Pi Agent SDK instance
 * @param {object} [options]
 */
export function registerShip30PiTool(pi, options = {}) {
  if (!pi || typeof pi.registerTool !== "function") {
    throw new Error("Invalid Pi agent instance provided to registerShip30PiTool.");
  }

  pi.registerTool({
    name: "generate_ship30_essay",
    description: "Write a high-retention, skimmable ~1,250-word Ship 30 for 30 essay grounded in Lenny's Podcast transcripts.",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "The specific product, growth, or leadership topic to explore",
        },
        audience: {
          type: "string",
          description: "The intended reader (e.g., 'Early-Stage Founders', 'B2B Product Managers')",
        },
        intended_outcome: {
          type: "string",
          description: "The specific transformation or framework the reader will take away",
        },
        proven_approach: {
          type: "string",
          enum: ["framework", "lessons", "mistakes", "steps"],
          description: "Structural organization approach",
        },
        four_a_path: {
          type: "string",
          enum: ["actionable", "analytical", "aspirational", "anthropological"],
          description: "Editorial lens for the piece",
        },
        target_word_count: {
          type: "integer",
          description: "Target word count (default: 1250)",
        },
      },
      required: ["topic"],
    },
    async execute(args) {
      // In Task 06B, this will retrieve evidence from FastAPI knowledge search and invoke generation
      return {
        content: [
          {
            type: "text",
            text: `Ship 30 skill tool invoked for topic: '${args.topic}'. Use executeSkillWorkflow with verified evidence.`,
          },
        ],
      };
    },
  });
}

/**
 * Input and Output Contracts for the Ship 30 for 30 Essay Writing Skill.
 * Enforces strict typing, evidence normalization, and default parameter boundaries.
 */

export const ESSAY_DEFAULTS = Object.freeze({
  targetWordCount: 1250,
  minWordCount: 1100,
  maxWordCount: 1400,
  minEvidencePassages: 1,
  defaultApproach: "framework",
  defaultFourAPath: "actionable",
});

export const VALID_PROVEN_APPROACHES = Object.freeze([
  "framework",
  "lessons",
  "mistakes",
  "steps",
]);

export const VALID_FOUR_A_PATHS = Object.freeze([
  "actionable",      // Here's how to do it
  "analytical",      // Here are the metrics/breakdowns
  "aspirational",    // Yes, you can achieve this
  "anthropological", // Here's why human/organizational behavior works this way
]);

/**
 * Validates skill invocation input.
 * @param {object} input
 * @returns {{ isValid: boolean, errors: string[], sanitizedInput: object }}
 */
export function validateSkillInput(input = {}) {
  const errors = [];

  if (!input || typeof input !== "object") {
    return {
      isValid: false,
      errors: ["Input must be a valid non-null object."],
      sanitizedInput: null,
    };
  }

  const topic = typeof input.topic === "string" ? input.topic.trim() : "";
  if (!topic || topic.length < 5) {
    errors.push("Field 'topic' is required and must be at least 5 characters long.");
  }

  const audience = typeof input.audience === "string" ? input.audience.trim() : "Product Managers and Growth Leaders";
  const intendedOutcome = typeof input.intended_outcome === "string" ? input.intended_outcome.trim() : "";

  let targetWordCount = parseInt(input.target_word_count, 10);
  if (isNaN(targetWordCount) || targetWordCount < 500 || targetWordCount > 3000) {
    targetWordCount = ESSAY_DEFAULTS.targetWordCount;
  }

  let minWordCount = parseInt(input.min_word_count, 10);
  if (isNaN(minWordCount) || minWordCount < 300) {
    minWordCount = ESSAY_DEFAULTS.minWordCount;
  }

  let maxWordCount = parseInt(input.max_word_count, 10);
  if (isNaN(maxWordCount) || maxWordCount > 4000) {
    maxWordCount = ESSAY_DEFAULTS.maxWordCount;
  }

  const approach = (input.proven_approach || ESSAY_DEFAULTS.defaultApproach).toLowerCase();
  if (!VALID_PROVEN_APPROACHES.includes(approach)) {
    errors.push(`Invalid proven_approach '${approach}'. Allowed: ${VALID_PROVEN_APPROACHES.join(", ")}`);
  }

  const fourAPath = (input.four_a_path || ESSAY_DEFAULTS.defaultFourAPath).toLowerCase();
  if (!VALID_FOUR_A_PATHS.includes(fourAPath)) {
    errors.push(`Invalid four_a_path '${fourAPath}'. Allowed: ${VALID_FOUR_A_PATHS.join(", ")}`);
  }

  const verifiedEvidence = Array.isArray(input.verified_evidence) ? input.verified_evidence : [];

  const sanitizedInput = {
    topic,
    audience,
    intended_outcome: intendedOutcome,
    proven_approach: approach,
    four_a_path: fourAPath,
    target_word_count: targetWordCount,
    min_word_count: minWordCount,
    max_word_count: maxWordCount,
    conversation_context: typeof input.conversation_context === "string" ? input.conversation_context.trim() : "",
    verified_evidence: verifiedEvidence,
  };

  return {
    isValid: errors.length === 0,
    errors,
    sanitizedInput: errors.length === 0 ? sanitizedInput : null,
  };
}

/**
 * Normalizes retrieved transcript evidence passages to ensure mandatory fields exist.
 * Rejects malformed or incomplete chunk objects.
 * @param {Array<object>} rawPassages
 * @returns {Array<object>} Normalized passages
 */
export function normalizeEvidence(rawPassages = []) {
  if (!Array.isArray(rawPassages)) return [];

  const normalized = [];
  const seenChunkIds = new Set();

  for (const raw of rawPassages) {
    if (!raw || typeof raw !== "object") continue;

    const chunkId = (raw.chunk_id || "").toString().trim();
    if (!chunkId) continue;

    const normalizedChunkId = chunkId.toLowerCase();
    if (seenChunkIds.has(normalizedChunkId)) continue;
    seenChunkIds.add(normalizedChunkId);

    const episodeTitle = (raw.episode_title || "Lenny's Podcast Episode").toString().trim();
    const guest = (raw.guest || "Expert Guest").toString().trim();
    const speaker = (raw.speaker || guest || "Speaker").toString().trim();
    const sourceUrl = (raw.source_url || "").toString().trim();
    const startTimestamp = (raw.start_timestamp || "").toString().trim();
    const endTimestamp = (raw.end_timestamp || "").toString().trim();
    const content = (raw.content || raw.snippet || "").toString().trim();

    if (!content) continue;

    normalized.push({
      chunk_id: chunkId,
      normalized_chunk_id: normalizedChunkId,
      transcript_id: raw.transcript_id ? raw.transcript_id.toString().trim() : null,
      episode_slug: (raw.episode_slug || "").toString().trim(),
      episode_title: episodeTitle,
      guest,
      speaker,
      source_url: sourceUrl,
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp,
      content,
    });
  }

  return normalized;
}

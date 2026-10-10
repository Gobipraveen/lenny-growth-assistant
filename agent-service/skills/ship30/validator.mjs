/**
 * Deterministic post-generation validators for Ship 30 for 30 essays.
 * Validates word counts, headings, narrative structure, citation authenticity, and formatting.
 * Distinguishes fatal errors from advisory quality warnings.
 */

import { ESSAY_DEFAULTS } from "./contracts.mjs";

/**
 * Deterministically counts English words in a markdown string,
 * ignoring frontmatter and markdown syntax noise.
 * @param {string} text
 * @returns {number}
 */
export function countWords(text = "") {
  if (!text || typeof text !== "string") return 0;

  // Strip frontmatter if present
  let cleanText = text.replace(/^---[\s\S]*?---\s*/, "");

  // Strip code blocks and urls to count actual prose words
  cleanText = cleanText.replace(/```[\s\S]*?```/g, " ");
  cleanText = cleanText.replace(/https?:\/\/[^\s)]+/g, " ");

  // Match sequences of non-whitespace characters
  const words = cleanText.trim().match(/[A-Za-z0-9_'\u00C0-\u024F-]+/g);
  return words ? words.length : 0;
}

/**
 * Validates an essay against Ship 30 structural, length, citation, and safety criteria.
 * @param {object} params
 * @param {string} params.markdown - The generated essay in markdown format
 * @param {Array<object>} params.verifiedEvidence - List of verified passages supplied from retrieval
 * @param {number} [params.targetWordCount=1250] - Expected word count
 * @param {number} [params.minWordCount=1100] - Minimum allowed words
 * @param {number} [params.maxWordCount=1400] - Maximum allowed words
 * @returns {object} Validation result
 */
export function validateEssay({
  markdown,
  verifiedEvidence = [],
  targetWordCount = ESSAY_DEFAULTS.targetWordCount,
  minWordCount = ESSAY_DEFAULTS.minWordCount,
  maxWordCount = ESSAY_DEFAULTS.maxWordCount,
}) {
  const errors = [];
  const warnings = [];

  // 1. Basic content existence
  if (!markdown || typeof markdown !== "string" || !markdown.trim()) {
    return {
      isValid: false,
      wordCount: 0,
      targetWordCount,
      minWordCount,
      maxWordCount,
      wordCountValid: false,
      headingsValid: false,
      citationsValid: false,
      takeawayValid: false,
      citations: [],
      errors: ["Essay output is empty or whitespace."],
      warnings: [],
    };
  }

  const trimmedMarkdown = markdown.trim();
  const wordCount = countWords(trimmedMarkdown);

  // 2. Word count range validation
  const wordCountValid = wordCount >= minWordCount && wordCount <= maxWordCount;
  if (wordCount < minWordCount) {
    errors.push(
      `Essay is substantially too short (${wordCount} words). Target is ${targetWordCount} words (minimum acceptable is ${minWordCount} words).`
    );
  } else if (wordCount > maxWordCount) {
    errors.push(
      `Essay exceeds the upper length boundary (${wordCount} words). Maximum acceptable is ${maxWordCount} words.`
    );
  }

  // 3. Heading structure validation
  // Rule: Exactly one H1 headline
  const h1Matches = trimmedMarkdown.match(/^#\s+(.+)$/gm) || [];
  let headingsValid = true;

  if (h1Matches.length === 0) {
    errors.push("Missing required H1 headline ('# Title'). The essay must begin with a clear headline.");
    headingsValid = false;
  } else if (h1Matches.length > 1) {
    warnings.push(`Essay contains ${h1Matches.length} H1 headers. Only one overarching H1 headline is recommended.`);
  }

  // Rule: At least 3 H2 section headings for skimmable Wheels & Spokes presentation
  const h2Matches = trimmedMarkdown.match(/^##\s+(.+)$/gm) || [];
  if (h2Matches.length < 3) {
    errors.push(
      `Essay has only ${h2Matches.length} H2 subheadings. Ship 30 structure requires at least 3 distinct H2 sections for skimmability.`
    );
    headingsValid = false;
  }

  // 4. Concrete takeaway / useful ending validation
  const takeawayPatterns = [
    /##\s+.*(takeaway|checklist|framework|action|next steps|exercise|decision rule|playbook)/i,
    /\*\*(the (framework|checklist|takeaway|playbook|exercise))\*\*/i,
    /###\s+.*(takeaway|checklist|framework|action|next steps)/i,
  ];
  const hasTakeaway = takeawayPatterns.some((pattern) => pattern.test(trimmedMarkdown));
  let takeawayValid = true;

  if (!hasTakeaway) {
    errors.push(
      "Missing concrete takeaway section. Ship 30 essays must conclude with an actionable checklist, framework, or decision rule."
    );
    takeawayValid = false;
  }

  // 5. Citation and evidence validation
  // Build lookup map of valid supplied chunks
  const validChunkIds = new Map();
  for (const p of verifiedEvidence) {
    if (p && p.chunk_id) {
      validChunkIds.set(p.chunk_id.toString().toLowerCase(), p);
    }
  }

  // Find all cited chunk IDs in markdown (e.g., [chunk_id: xxx], (chunk_id: xxx), chunk_id="xxx")
  const citationPattern = /chunk_id(?::|=|\s+is\s+|:\s*)["']?([a-zA-Z0-9_-]{8,})["']?/gi;
  const foundChunkIds = new Set();
  let match;

  while ((match = citationPattern.exec(trimmedMarkdown)) !== null) {
    foundChunkIds.add(match[1].toLowerCase());
  }

  const validCitations = [];
  const invalidCitationIds = [];

  for (const citedId of foundChunkIds) {
    if (validChunkIds.has(citedId)) {
      validCitations.push(validChunkIds.get(citedId));
    } else {
      invalidCitationIds.push(citedId);
    }
  }

  let citationsValid = true;
  if (invalidCitationIds.length > 0) {
    errors.push(
      `Fabricated or unverified citation IDs detected: [${invalidCitationIds.join(", ")}]. Claims must only cite verified chunks provided by retrieval.`
    );
    citationsValid = false;
  }

  if (validCitations.length === 0 && verifiedEvidence.length > 0) {
    warnings.push(
      "No explicit chunk citations detected in essay body. While ideas may be paraphrased, explicit [chunk_id: <id>] references ensure verifiable attribution."
    );
  }

  // 6. Skimmability & formatting checks
  // Check for bold emphasis
  const hasBold = /\*\*[^*]+\*\*/.test(trimmedMarkdown);
  if (!hasBold) {
    warnings.push("Essay lacks selective bold emphasis (**key phrase**). Ship 30 essays use bolding to guide skimming.");
  }

  // Check for bulleted lists
  const hasBullets = /^\s*[-*]\s+.+/m.test(trimmedMarkdown);
  if (!hasBullets) {
    warnings.push("Essay contains no bullet points. Bullet points improve skimmability when presenting steps or frameworks.");
  }

  // Check for raw unsafe HTML
  const dangerousHtmlPattern = /<(script|iframe|object|embed|form|input|button)\b|javascript:|onerror=|onload=/i;
  if (dangerousHtmlPattern.test(trimmedMarkdown)) {
    errors.push("Security violation: Essay contains unsafe HTML tags or script attributes.");
  }

  // Check for apparent generation truncation
  const endsAbruptly = /[a-zA-Z0-9,;:]$/.test(trimmedMarkdown) && !trimmedMarkdown.endsWith(".");
  if (endsAbruptly) {
    warnings.push("Essay may be truncated; the final paragraph does not end with complete punctuation.");
  }

  return {
    isValid: errors.length === 0,
    wordCount,
    targetWordCount,
    minWordCount,
    maxWordCount,
    wordCountValid,
    headingsValid,
    citationsValid,
    takeawayValid,
    citations: validCitations,
    citedChunkIds: Array.from(foundChunkIds),
    errors,
    warnings,
  };
}

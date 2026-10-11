/**
 * Deterministic post-generation validators for Ship 30 for 30 essays.
 * Validates word counts, headings, narrative structure, citation authenticity, and formatting.
 * Distinguishes fatal errors from advisory quality warnings.
 */

import { ESSAY_DEFAULTS } from "./contracts.mjs";

/**
 * Safely detects and removes an OUTER Markdown code fence enclosing an entire generated section or document.
 * Preserves the inner draft prose and any genuine embedded code blocks within.
 * @param {string} text
 * @returns {string}
 */
export function stripOuterMarkdownFence(text = "") {
  if (!text || typeof text !== "string") return "";
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;

  const lines = trimmed.split("\n");
  const firstLine = lines[0].trim();
  if (!/^```(?:markdown|md|text)?$/i.test(firstLine)) {
    return trimmed;
  }
  const lastLine = lines[lines.length - 1].trim();
  if (lastLine !== "```") {
    return trimmed;
  }

  // Check if the opening fence was already closed before the final line.
  // An inner code block (e.g. ```python ... ```) can exist inside an outer markdown fence.
  let insideInnerFence = false;
  let outerClosedEarly = false;

  for (let i = 1; i < lines.length - 1; i++) {
    const l = lines[i].trim();
    if (l.startsWith("```")) {
      if (!insideInnerFence) {
        if (l === "```") {
          // A bare closing fence when not inside an inner fence means the outer fence closed early
          outerClosedEarly = true;
          break;
        } else {
          // Opening an inner code block
          insideInnerFence = true;
        }
      } else {
        // Closing the inner code block
        insideInnerFence = false;
      }
    }
  }

  if (outerClosedEarly) {
    return trimmed;
  }

  // Remove the first and last lines (the outer fences)
  return lines.slice(1, lines.length - 1).join("\n").trim();
}

/**
 * Deterministically counts English words in a markdown string,
 * ignoring frontmatter and markdown syntax noise.
 * Correctly distinguishes outer fenced draft prose from genuine embedded code.
 * @param {string} text
 * @returns {number}
 */
export function countWords(text = "") {
  if (!text || typeof text !== "string") return 0;

  // 1. Strip frontmatter if present
  let cleanText = text.replace(/^---[\s\S]*?---\s*/, "");

  // 2. Unwrap outer markdown fence if the entire text is enclosed in one
  cleanText = stripOuterMarkdownFence(cleanText);

  // 3. Unwrap any inner blocks explicitly fenced as ```markdown or ```md (draft sections)
  cleanText = cleanText.replace(/```(?:markdown|md)\s*\n([\s\S]*?)\n?```/gi, " $1 ");

  // 4. Strip genuine embedded code blocks (e.g. ```python, ```js, ```sql, or unlabeled ```code```)
  cleanText = cleanText.replace(/```[\s\S]*?```/g, " ");

  // 5. Strip URLs
  cleanText = cleanText.replace(/https?:\/\/[^\s)]+/g, " ");

  // 6. Match word tokens
  const words = cleanText.trim().match(/[A-Za-z0-9_'\u00C0-\u024F-]+/g);
  return words ? words.length : 0;
}

/**
 * Extracts compact citation tokens (e.g. [S1], (S1), (S2:00:06:46), [SOURCE: S1], [S1, S2], (S1, S2))
 * from a text string. Rejects loose prose occurrences and non-citation parentheticals.
 * @param {string} text
 * @returns {Array<{ tokenNumber: string, rawToken: string, shortId: string }>}
 */
export function extractCompactCitationTokens(text = "") {
  if (!text || typeof text !== "string") return [];

  const results = [];
  // Matches enclosed bracketed [...] or parenthesized (...) blocks without newlines
  const blockRegex = /(?:\[([^\]\n]+)\]|\(([^)\n]+)\))/g;
  const singleTokenRegex = /^(?:SOURCE:?\s*)?S(\d+)(?:\s*:\s*\d{1,2}:\d{2}(?::\d{2})?)?$/i;

  let match;
  while ((match = blockRegex.exec(text)) !== null) {
    const rawInner = (match[1] !== undefined ? match[1] : match[2]) || "";
    const inner = rawInner.trim();
    if (!inner) continue;

    // Reject blocks that contain full UUID markers like [chunk_id: ...] or [chunk: ...]
    // (those are handled separately by UUID citation extractors)
    if (/^chunk(?:_id)?\b/i.test(inner)) continue;

    // Split by comma or semicolon to allow multiple tokens inside one enclosure
    const parts = inner.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;

    // Check if ALL parts are valid citation token formats
    let allPartsValid = true;
    const tokensInBlock = [];

    for (const part of parts) {
      const tokenMatch = part.match(singleTokenRegex);
      if (tokenMatch) {
        tokensInBlock.push({
          tokenNumber: tokenMatch[1],
          rawToken: `S${tokenMatch[1]}`,
          shortId: `s${tokenMatch[1]}`,
        });
      } else {
        allPartsValid = false;
        break;
      }
    }

    if (allPartsValid && tokensInBlock.length > 0) {
      for (const t of tokensInBlock) {
        results.push(t);
      }
    }
  }

  return results;
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

  // Normalize outer fences before validation checks
  const trimmedMarkdown = stripOuterMarkdownFence(markdown.trim());
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
  // Build lookup maps of valid supplied chunks: by UUID and by compact token S1, S2, ...
  const validChunkIds = new Map();
  const validShortIds = new Map();

  verifiedEvidence.forEach((p, idx) => {
    if (p && p.chunk_id) {
      const cId = p.chunk_id.toString().toLowerCase();
      validChunkIds.set(cId, p);
      // Compact citation tokens: S1, S2, ...
      validShortIds.set(`s${idx + 1}`, p);
      if (p.source_token) {
        validShortIds.set(p.source_token.toString().toLowerCase(), p);
      }
    }
  });

  const validCitations = [];
  const invalidCitationIds = [];
  const seenValidChunkIds = new Set();
  const foundChunkIds = new Set();

  // Find compact citations: [S1], [s1], [SOURCE: S1], [SOURCE S1], (S1), (S2:00:06:46), etc.
  const compactTokens = extractCompactCitationTokens(trimmedMarkdown);
  for (const { shortId, rawToken } of compactTokens) {
    if (validShortIds.has(shortId)) {
      const passage = validShortIds.get(shortId);
      const cId = passage.chunk_id.toString().toLowerCase();
      foundChunkIds.add(cId);
      if (!seenValidChunkIds.has(cId)) {
        seenValidChunkIds.add(cId);
        validCitations.push(passage);
      }
    } else {
      invalidCitationIds.push(rawToken);
    }
  }

  // Find UUID citations: chunk_id="...", [chunk_id: ...], [chunk: ...]
  const citationPattern = /chunk_id(?::|=|\s+is\s+|:\s*)["']?([a-zA-Z0-9_-]+)["']?/gi;
  let match;
  while ((match = citationPattern.exec(trimmedMarkdown)) !== null) {
    const citedId = match[1].toLowerCase();
    if (validChunkIds.has(citedId)) {
      const passage = validChunkIds.get(citedId);
      const cId = passage.chunk_id.toString().toLowerCase();
      foundChunkIds.add(cId);
      if (!seenValidChunkIds.has(cId)) {
        seenValidChunkIds.add(cId);
        validCitations.push(passage);
      }
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
      "No explicit chunk citations detected in essay body. While ideas may be paraphrased, explicit [S1] or [chunk_id: <id>] references ensure verifiable attribution."
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

import fs from "node:fs";
import path from "node:path";
import {
  createAgentSession,
  SessionManager,
  DefaultResourceLoader,
  SettingsManager,
  ModelRuntime
} from "@earendil-works/pi-coding-agent";
import { config, SUPPORTED_PROVIDERS } from "./config.mjs";
import { executeSkillWorkflow, extractCompactCitationTokens } from "../skills/ship30/index.mjs";

// Ensure runtime directory exists
if (!fs.existsSync(config.agentDataDir)) {
  fs.mkdirSync(config.agentDataDir, { recursive: true });
}

// Write models.json configuration for Pi SDK
export function syncModelsConfig() {
  const modelsConfig = {
    providers: {
      ollama: {
        baseUrl: `${config.ollamaBaseUrl}/v1`,
        api: "openai-completions",
        apiKey: "ollama",
        models: [
          {
            id: config.ollamaModel,
            name: `Ollama (${config.ollamaModel})`,
            contextWindow: 32768,
            maxTokens: 2048,
            input: ["text"],
            compat: {
              maxTokensField: "max_tokens"
            }
          }
        ]
      }
    }
  };

  if (config.anthropicApiKey) {
    modelsConfig.providers.anthropic = {
      baseUrl: "https://api.anthropic.com/v1",
      api: "anthropic-messages",
      apiKey: config.anthropicApiKey,
      models: [
        {
          id: config.anthropicModel,
          name: "Claude 3.5 Sonnet",
          contextWindow: 200000,
          maxTokens: 4096,
          input: ["text"]
        }
      ]
    };
  }

  const modelsPath = path.join(config.agentDataDir, "models.json");
  fs.writeFileSync(modelsPath, JSON.stringify(modelsConfig, null, 2), "utf-8");
  return modelsPath;
}

// Simple per-session lock to prevent concurrent turns corrupting session state
const sessionLocks = new Map();

async function acquireLock(sessionId) {
  while (sessionLocks.has(sessionId)) {
    await sessionLocks.get(sessionId);
  }
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  sessionLocks.set(sessionId, promise);
  return () => {
    sessionLocks.delete(sessionId);
    release();
  };
}

/**
 * Tracks and assigns compact source IDs (S1, S2, ...) deterministically
 * to retrieved passages during a turn, mapping them to verified chunk UUIDs and metadata.
 */
export class TurnEvidenceTracker {
  constructor() {
    this.passagesByShortId = new Map(); // "s1" -> passage
    this.passagesByChunkId = new Map(); // "uuid" -> passage
    this.shortIdByChunkId = new Map(); // "uuid" -> "S1"
    this.counter = 1;
  }

  addPassage(passage) {
    if (!passage || !passage.chunk_id) return null;
    const chunkId = String(passage.chunk_id).trim().toLowerCase();
    if (this.passagesByChunkId.has(chunkId)) {
      return this.shortIdByChunkId.get(chunkId);
    }
    const shortId = `S${this.counter++}`;
    const shortKey = shortId.toLowerCase();
    this.passagesByShortId.set(shortKey, passage);
    this.passagesByChunkId.set(chunkId, passage);
    this.shortIdByChunkId.set(chunkId, shortId);
    return shortId;
  }

  getShortId(chunkId) {
    if (!chunkId) return null;
    return this.shortIdByChunkId.get(String(chunkId).trim().toLowerCase()) || null;
  }

  getByShortId(shortId) {
    if (!shortId) return null;
    return this.passagesByShortId.get(String(shortId).trim().toLowerCase()) || null;
  }

  getByChunkId(chunkId) {
    if (!chunkId) return null;
    return this.passagesByChunkId.get(String(chunkId).trim().toLowerCase()) || null;
  }

  getAllPassages() {
    return Array.from(this.passagesByChunkId.values());
  }

  formatPassage(passage) {
    const shortId = this.addPassage(passage);
    return `[SOURCE ${shortId} | chunk_id="${passage.chunk_id}"] Episode: "${passage.episode_title}" (Guest: ${passage.guest || "Lenny Rachitsky"})\nSpeaker: ${passage.speaker || "Unknown"}\nContent: ${passage.content}`;
  }
}

/**
 * Extracts and resolves citation tokens deterministically against the verified evidence tracker.
 * Rejects unknown or malformed tokens, and attaches only verified source metadata.
 */
export function parseAndResolveCitations(rawAnswer = "", tracker) {
  if (!rawAnswer || !tracker) return [];

  const verifiedCitations = [];
  const seenChunkIds = new Set();

  // 1. Match compact citation tokens: [S1], (S1), (S2:00:06:46), [SOURCE: S1], [S1, S2], etc.
  const compactTokens = extractCompactCitationTokens(rawAnswer);
  for (const { shortId, rawToken } of compactTokens) {
    const passage = tracker.getByShortId(shortId);
    if (passage && passage.chunk_id) {
      const cId = String(passage.chunk_id).toLowerCase();
      if (!seenChunkIds.has(cId)) {
        seenChunkIds.add(cId);
        verifiedCitations.push({
          chunk_id: passage.chunk_id,
          transcript_id: passage.transcript_id,
          episode_slug: passage.episode_slug,
          episode_title: passage.episode_title,
          guest: passage.guest,
          speaker: passage.speaker,
          source_url: passage.source_url,
          start_timestamp: passage.start_timestamp,
          end_timestamp: passage.end_timestamp,
          snippet: passage.content ? passage.content.slice(0, 200) + "..." : "",
          source_token: rawToken
        });
      }
    }
  }

  // 2. Also support full UUID citations for backward compatibility: [chunk_id: <uuid>] or [chunk: <uuid>]
  const uuidRegex = /\[(?:chunk_id|chunk)(?::|=|\s+is\s+|:\s*)["']?([a-f0-9-]{32,36})["']?\]/gi;
  let match;
  while ((match = uuidRegex.exec(rawAnswer)) !== null) {
    const citedUuid = match[1].toLowerCase();
    const passage = tracker.getByChunkId(citedUuid);
    if (passage && passage.chunk_id) {
      const cId = String(passage.chunk_id).toLowerCase();
      if (!seenChunkIds.has(cId)) {
        seenChunkIds.add(cId);
        verifiedCitations.push({
          chunk_id: passage.chunk_id,
          transcript_id: passage.transcript_id,
          episode_slug: passage.episode_slug,
          episode_title: passage.episode_title,
          guest: passage.guest,
          speaker: passage.speaker,
          source_url: passage.source_url,
          start_timestamp: passage.start_timestamp,
          end_timestamp: passage.end_timestamp,
          snippet: passage.content ? passage.content.slice(0, 200) + "..." : "",
          source_token: tracker.getShortId(cId) || null
        });
      }
    }
  }

  return verifiedCitations;
}

/**
 * Identifies distinctive named frameworks, numbered concepts, or quoted phrases
 * in a user query that are completely absent from all retrieved evidence chunks.
 */
export function detectDistinctiveAbsentConcepts(message = "", passages = []) {
  if (!message || typeof message !== "string") return [];

  const candidates = [];

  // 1. Quoted terms: "11-star", "11-star experience"
  const quoted = message.match(/"([^"]{3,40})"/g);
  if (quoted) {
    for (const q of quoted) {
      candidates.push(q.replace(/"/g, "").trim());
    }
  }

  // 2. Numbered / named frameworks, e.g. "11-star", "11 star", "5-step", "3-pillar"
  const numberedFramework = message.match(/\b\d+[- ](?:star|step|phase|rule|tier|point|pillar|framework|level|factor|x)(?:\s+(?:experience|model|rule|process|method|approach|framework|journey))?\b/gi);
  if (numberedFramework) {
    for (const nf of numberedFramework) {
      candidates.push(nf.trim());
    }
  }

  // 3. Coined phrases: e.g. "X framework", "X methodology"
  const coinedPhrases = message.match(/\b[A-Za-z0-9-]+\s+(?:framework|methodology|matrix|equation|doctrine|canvas)\b/gi);
  if (coinedPhrases) {
    for (const cp of coinedPhrases) {
      const lower = cp.toLowerCase();
      if (!lower.startsWith("product ") && !lower.startsWith("growth ") && !lower.startsWith("our ") && !lower.startsWith("this ")) {
        candidates.push(cp.trim());
      }
    }
  }

  if (candidates.length === 0) return [];

  const corpus = passages.map((p) => `${p.episode_title || ""} ${p.content || ""}`.toLowerCase()).join(" ");

  const absent = [];
  for (const item of candidates) {
    const raw = item.toLowerCase();
    const normalizedSpaced = raw.replace(/[-_]/g, " ");
    const normalizedHyphen = raw.replace(/\s+/g, "-");

    const found = corpus.includes(raw) || corpus.includes(normalizedSpaced) || corpus.includes(normalizedHyphen);
    if (!found) {
      absent.push(item);
    }
  }

  return [...new Set(absent)];
}

export class PiAgentManager {
  constructor() {
    syncModelsConfig();
  }

  async executeTurn({
    sessionId,
    message,
    history = [],
    candidatePassages = [],
    provider = config.defaultProvider,
    model = null,
    systemInstructions = ""
  }) {
    const releaseLock = await acquireLock(sessionId || "default");
    const startTime = Date.now();

    const selectedProvider = provider || config.defaultProvider;
    if (!SUPPORTED_PROVIDERS.includes(selectedProvider)) {
      releaseLock();
      const err = new Error(`Unsupported provider '${selectedProvider}'. Supported: ${SUPPORTED_PROVIDERS.join(", ")}`);
      err.statusCode = 400;
      err.code = "INVALID_PROVIDER";
      throw err;
    }

    const selectedModel = model || (selectedProvider === "anthropic" ? config.anthropicModel : config.ollamaModel);

    // Validate provider credentials if cloud
    if (selectedProvider === "anthropic" && !config.anthropicApiKey) {
      releaseLock();
      const err = new Error("Anthropic API key is not configured in environment (ANTHROPIC_API_KEY).");
      err.statusCode = 400;
      err.code = "MISSING_CLOUD_CREDENTIALS";
      throw err;
    }

    const modelsPath = syncModelsConfig();

    // Official ModelRuntime creation and model resolution
    let modelRuntime;
    let targetModel;
    try {
      modelRuntime = await ModelRuntime.create({ modelsPath });
      targetModel = modelRuntime.getModel(selectedProvider, selectedModel);
      if (!targetModel) {
        releaseLock();
        const err = new Error(`Model '${selectedModel}' for provider '${selectedProvider}' is not configured in models.json.`);
        err.statusCode = 400;
        err.code = "MODEL_NOT_FOUND";
        throw err;
      }
    } catch (mErr) {
      if (mErr.code === "MODEL_NOT_FOUND" || mErr.statusCode === 400) throw mErr;
      releaseLock();
      const err = new Error(`Failed to load model runtime: ${mErr.message}`);
      err.statusCode = 500;
      err.code = "RUNTIME_INIT_ERROR";
      throw err;
    }

    // Deterministic Turn Evidence Tracker
    const evidenceTracker = new TurnEvidenceTracker();
    for (const p of candidatePassages) {
      evidenceTracker.addPassage(p);
    }

    const toolExecutions = [];

    const cwd = config.agentDataDir;
    const agentDir = config.agentDataDir;
    const settingsManager = SettingsManager.create(cwd, agentDir);

    // Custom read-only transcript retrieval tool
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      extensionFactories: [
        async (pi) => {
          pi.registerTool({
            name: "search_transcripts",
            description: "Search Lenny's Podcast transcripts for product, growth, strategy, and leadership advice.",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search keywords or question about product/growth"
                },
                limit: {
                  type: "integer",
                  description: "Number of relevant passages to retrieve (1 to 5)"
                }
              },
              required: ["query"]
            },
            async execute(args) {
              const query = (args.query || "").trim();
              const limit = Math.min(Math.max(parseInt(args.limit || 5, 10), 1), 10);
              const toolRecord = { name: "search_transcripts", query, limit, timestamp: new Date().toISOString() };

              try {
                const response = await fetch(`${config.fastapiUrl}/api/internal/knowledge/search`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "X-Internal-Token": config.internalSecret
                  },
                  body: JSON.stringify({ query, limit })
                });

                if (!response.ok) {
                  toolRecord.error = `HTTP ${response.status}`;
                  toolExecutions.push(toolRecord);
                  return {
                    content: [{ type: "text", text: `Search tool returned error status: ${response.status}` }]
                  };
                }

                const data = await response.json();
                const results = data.data?.results || [];
                toolRecord.resultsCount = results.length;
                toolExecutions.push(toolRecord);

                for (const item of results) {
                  evidenceTracker.addPassage(item);
                }

                if (results.length === 0) {
                  return {
                    content: [{ type: "text", text: `No relevant transcript evidence found for '${query}'.` }]
                  };
                }

                const formatted = results.map((r) => evidenceTracker.formatPassage(r)).join("\n\n---\n\n");
                return { content: [{ type: "text", text: formatted }] };
              } catch (err) {
                toolRecord.error = err.message;
                toolExecutions.push(toolRecord);
                return {
                  content: [{ type: "text", text: `Search tool failed: ${err.message}` }]
                };
              }
            }
          });
        }
      ]
    });

    await resourceLoader.reload();

    let session;
    try {
      // Official SDK configuration:
      // Passing tools: ["search_transcripts"] sets an explicit allowlist that disables
      // all built-in coding tools (read, bash, edit, write) and allows only search_transcripts.
      // Passing model: targetModel initializes the session directly with the resolved model.
      const sessionResult = await createAgentSession({
        cwd,
        agentDir,
        settingsManager,
        resourceLoader,
        model: targetModel,
        modelRuntime,
        sessionManager: SessionManager.inMemory(),
        tools: ["search_transcripts"]
      });

      session = sessionResult.session;

      // Format initial evidence block with compact source tokens
      let evidenceBlock = "";
      if (candidatePassages.length > 0) {
        evidenceBlock = "\n\n[CANDIDATE TRANSCRIPT PASSAGES FROM PRE-RETRIEVAL]:\n" +
          candidatePassages.map((p) => evidenceTracker.formatPassage(p)).join("\n\n---\n\n");
      } else {
        evidenceBlock = "\n\n[PRE-RETRIEVAL STATUS]: No high-confidence initial passages were found for this query. You may use search_transcripts to find evidence.";
      }

      // Format conversation history
      let historyBlock = "";
      if (history.length > 0) {
        historyBlock = "\n\n[PRIOR CONVERSATION HISTORY]:\n" +
          history.slice(-8).map((h) => `${h.role.toUpperCase()}: ${h.content}`).join("\n");
      }

      // Check for distinctive named concepts absent from current evidence
      const absentConcepts = detectDistinctiveAbsentConcepts(message, evidenceTracker.getAllPassages());
      let absentConstraint = "";
      if (absentConcepts.length > 0) {
        absentConstraint = `\n[GROUNDING NOTICE - CRITICAL CONSTRAINT]:
The user query mentions the specific concept(s): "${absentConcepts.join(", ")}".
The indexed Lenny's Podcast transcript archives DO NOT contain mentions of this specific concept or framework.
You MUST:
1. State clearly and honestly that the indexed Lenny's Podcast transcripts do not contain evidence for "${absentConcepts.join(", ")}".
2. DO NOT invent quotes, timestamps, or stories attributing this concept to Lenny or any podcast guest.
3. If providing general context about the guest or related topics, clearly state that this is separate general background, not the requested framework.`;
      }

      const promptPayload = `System Instructions:
You are The Lenny Growth Assistant, an authoritative AI mentor grounded exclusively in Lenny's Podcast transcripts.
CRITICAL OPERATING RULES:
1. Answer the question thoroughly and accurately using ONLY the transcript evidence provided below or retrieved via search_transcripts.
2. CITATION RULE: When referencing evidence, cite using compact source tokens corresponding to the provided sources: e.g., [S1], [S2]. Place citations directly next to the claim they support.
3. If the transcripts do NOT contain sufficient information to answer the question, state honestly:
"I could not find sufficient evidence in the indexed Lenny's Podcast transcripts to answer this question."
Do not guess or use outside knowledge when evidence is missing.
4. Never invent quotes, episode titles, timestamps, or source links. Only cite verified source tokens that are explicitly present in the evidence base.
${absentConstraint}

${systemInstructions ? `Additional Context: ${systemInstructions}\n` : ""}${historyBlock}${evidenceBlock}

User Question:
${message}`;

      // Bounded inference execution
      let timerId;
      const promptPromise = session.prompt(promptPayload);
      const timeoutPromise = new Promise((_, reject) => {
        timerId = setTimeout(() => {
          const tErr = new Error(`Inference timed out after ${config.requestTimeoutMs}ms.`);
          tErr.statusCode = 504;
          tErr.code = "INFERENCE_TIMEOUT";
          reject(tErr);
        }, config.requestTimeoutMs);
      });

      try {
        await Promise.race([promptPromise, timeoutPromise]);
      } finally {
        if (timerId) clearTimeout(timerId);
      }

      let finalAnswer = session.getLastAssistantText() || "";
      const durationMs = Date.now() - startTime;

      // Fail-closed conservative check for absent distinctive concepts
      if (absentConcepts.length > 0) {
        const mentionsAbsence = /not\s+(?:found|contain|mention|discuss|include)|could\s+not\s+find|insufficient\s+evidence/i.test(finalAnswer);
        const fabricatedQuotes = /["“][^"”]{10,}["”]\s*[-–—]\s*(?:Brian|Lenny)|(?:Brian|Lenny):\s*["“]/i.test(finalAnswer);

        if (!mentionsAbsence || fabricatedQuotes) {
          const concept = absentConcepts[0];
          finalAnswer = `I searched the indexed Lenny's Podcast transcripts, but could not find evidence for the "${concept}" framework or discussion. While the archives include discussions with guests on product management and company culture, the specific concept requested is not documented in the indexed episodes. Therefore, I cannot provide verified quotes or timestamps for it.`;
        }
      }

      // Deterministic Citation Parsing and Validation
      const verifiedCitations = parseAndResolveCitations(finalAnswer, evidenceTracker);

      return {
        answer: finalAnswer,
        citations: verifiedCitations,
        toolExecutions,
        provider: selectedProvider,
        model: selectedModel,
        durationMs
      };
    } catch (err) {
      if (session) {
        try {
          await session.abort();
        } catch (_) {}
      }
      throw err;
    } finally {
      if (session) {
        session.dispose();
      }
      releaseLock();
    }
  }

  /**
   * Generates a 5-section Ship 30 for 30 essay using the Pi Agent SDK and verified transcript evidence.
   * Executes sequentially in bounded sections under strict tool-restricted conditions (tools: []).
   */
  async generateShip30Essay({
    sessionId,
    topic,
    audience = "Product managers, growth leads, and founders",
    intendedOutcome = "A practical framework and actionable decision rules",
    provenApproach = "framework",
    fourAPath = "actionable",
    targetWordCount = 1250,
    candidatePassages = [],
    provider = config.defaultProvider,
    model = null,
  }) {
    const releaseLock = await acquireLock(sessionId || "default");
    const startTime = Date.now();

    const selectedProvider = provider || config.defaultProvider;
    if (!SUPPORTED_PROVIDERS.includes(selectedProvider)) {
      releaseLock();
      const err = new Error(`Unsupported provider '${selectedProvider}'. Supported: ${SUPPORTED_PROVIDERS.join(", ")}`);
      err.statusCode = 400;
      err.code = "INVALID_PROVIDER";
      throw err;
    }

    const selectedModel = model || (selectedProvider === "anthropic" ? config.anthropicModel : config.ollamaModel);

    if (selectedProvider === "anthropic" && !config.anthropicApiKey) {
      releaseLock();
      const err = new Error("Anthropic API key is not configured in environment (ANTHROPIC_API_KEY).");
      err.statusCode = 400;
      err.code = "MISSING_CLOUD_CREDENTIALS";
      throw err;
    }

    // Fail-closed immediately if evidence is missing
    if (!candidatePassages || candidatePassages.length === 0) {
      releaseLock();
      return executeSkillWorkflow({
        input: {
          topic,
          audience,
          intended_outcome: intendedOutcome,
          proven_approach: provenApproach,
          four_a_path: fourAPath,
          target_word_count: targetWordCount,
          verified_evidence: [],
        },
        generateFn: null,
      });
    }

    const modelsPath = syncModelsConfig();
    let modelRuntime;
    let targetModel;
    try {
      modelRuntime = await ModelRuntime.create({ modelsPath });
      targetModel = modelRuntime.getModel(selectedProvider, selectedModel);
      if (!targetModel) {
        releaseLock();
        const err = new Error(`Model '${selectedModel}' for provider '${selectedProvider}' is not configured in models.json.`);
        err.statusCode = 400;
        err.code = "MODEL_NOT_FOUND";
        throw err;
      }
    } catch (mErr) {
      if (mErr.code === "MODEL_NOT_FOUND" || mErr.statusCode === 400) throw mErr;
      releaseLock();
      const err = new Error(`Failed to load model runtime: ${mErr.message}`);
      err.statusCode = 500;
      err.code = "RUNTIME_INIT_ERROR";
      throw err;
    }

    const cwd = config.agentDataDir;
    const agentDir = config.agentDataDir;
    const settingsManager = SettingsManager.create(cwd, agentDir);

    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
    });
    await resourceLoader.reload();

    let session;
    try {
      // Restrict all system tools: essay generation runs in a completely sandbox-isolated session
      const sessionResult = await createAgentSession({
        cwd,
        agentDir,
        settingsManager,
        resourceLoader,
        model: targetModel,
        modelRuntime,
        sessionManager: SessionManager.inMemory(),
        tools: [],
      });
      session = sessionResult.session;

      // Sequential section generation function
      const generateSectionFn = async ({ section, plan, priorSectionsText, prompt, maxTokens }) => {
        if (session?.agent?.state?.model) {
          const effectiveMaxTokens = maxTokens || section?.maxTokens || 450;
          session.agent.state.model.maxTokens = effectiveMaxTokens;
        }
        let timerId;
        const promptPromise = session.prompt(prompt);
        const timeoutPromise = new Promise((_, reject) => {
          timerId = setTimeout(() => {
            const tErr = new Error(`Section generation timed out after ${config.requestTimeoutMs}ms.`);
            tErr.statusCode = 504;
            tErr.code = "INFERENCE_TIMEOUT";
            reject(tErr);
          }, config.requestTimeoutMs);
        });
        try {
          await Promise.race([promptPromise, timeoutPromise]);
          return session.getLastAssistantText() || "";
        } finally {
          if (timerId) clearTimeout(timerId);
        }
      };

      const skillResult = await executeSkillWorkflow({
        input: {
          topic,
          audience,
          intended_outcome: intendedOutcome,
          proven_approach: provenApproach,
          four_a_path: fourAPath,
          target_word_count: targetWordCount,
          verified_evidence: candidatePassages,
        },
        generateSectionFn,
      });

      return {
        ...skillResult,
        provider: selectedProvider,
        model: selectedModel,
        duration_ms: Date.now() - startTime,
      };
    } catch (err) {
      if (session) {
        try {
          await session.abort();
        } catch (_) {}
      }
      throw err;
    } finally {
      if (session) {
        session.dispose();
      }
      releaseLock();
    }
  }

  /**
   * Generates a constrained HTML or Markdown artifact using the Pi Agent SDK.
   * Executes under strict sandbox-isolated conditions (tools: []).
   */
  async generateArtifact({
    sessionId,
    title,
    artifactType,
    instructions,
    topic = null,
    candidatePassages = [],
    provider = config.defaultProvider,
    model = null,
  }) {
    const releaseLock = await acquireLock(sessionId || "default");
    const startTime = Date.now();

    const selectedProvider = provider || config.defaultProvider;
    if (!SUPPORTED_PROVIDERS.includes(selectedProvider)) {
      releaseLock();
      const err = new Error(`Unsupported provider '${selectedProvider}'. Supported: ${SUPPORTED_PROVIDERS.join(", ")}`);
      err.statusCode = 400;
      err.code = "INVALID_PROVIDER";
      throw err;
    }

    const selectedModel = model || (selectedProvider === "anthropic" ? config.anthropicModel : config.ollamaModel);

    if (selectedProvider === "anthropic" && !config.anthropicApiKey) {
      releaseLock();
      const err = new Error("Anthropic API key is not configured in environment (ANTHROPIC_API_KEY).");
      err.statusCode = 400;
      err.code = "MISSING_CLOUD_CREDENTIALS";
      throw err;
    }

    const modelsPath = syncModelsConfig();
    let modelRuntime;
    let targetModel;
    try {
      modelRuntime = await ModelRuntime.create({ modelsPath });
      targetModel = modelRuntime.getModel(selectedProvider, selectedModel);
      if (!targetModel) {
        releaseLock();
        const err = new Error(`Model '${selectedModel}' for provider '${selectedProvider}' is not configured in models.json.`);
        err.statusCode = 400;
        err.code = "MODEL_NOT_FOUND";
        throw err;
      }
    } catch (mErr) {
      if (mErr.code === "MODEL_NOT_FOUND" || mErr.statusCode === 400) throw mErr;
      releaseLock();
      const err = new Error(`Failed to load model runtime: ${mErr.message}`);
      err.statusCode = 500;
      err.code = "RUNTIME_INIT_ERROR";
      throw err;
    }

    const cwd = config.agentDataDir;
    const agentDir = config.agentDataDir;
    const settingsManager = SettingsManager.create(cwd, agentDir);

    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
    });
    await resourceLoader.reload();

    // Map evidence passages
    let evidenceContext = "";
    if (candidatePassages && candidatePassages.length > 0) {
      evidenceContext = candidatePassages
        .map((p, idx) => `[Evidence #${idx + 1}] chunk_id: "${p.chunk_id}" | Episode: "${p.episode_title}" | Guest: "${p.guest || "Unknown"}"\n"${p.content}"`)
        .join("\n\n");
    }

    // Build constrained prompt
    let prompt;
    if (artifactType === "html") {
      prompt = `You are an expert product design and web artifact engine for Lenny's Growth Assistant.
Your task is to generate a standalone, self-contained HTML/CSS document titled "${title}".

USER INSTRUCTIONS:
${instructions}

${evidenceContext ? `VERIFIED TRANSCRIPT EVIDENCE:\n${evidenceContext}\n` : ""}
STRICT SECURITY & CODING CONSTRAINTS:
1. Return a complete, self-contained HTML document with <!DOCTYPE html>, <html>, <head> with an embedded <style> block, and <body>.
2. DO NOT include any <script> tags or JavaScript code. All interactivity must be pure CSS (e.g. :hover, details/summary, CSS checkboxes/tabs).
3. DO NOT use inline event handlers (NO onclick, onload, onerror, etc.).
4. DO NOT reference external stylesheets, remote fonts, external images, or external scripts (NO <link rel="stylesheet">, NO @import, NO remote url()).
5. DO NOT include forms that submit data, iframes, or frames.
6. Design: Use a clean, modern aesthetic with accessible contrast and responsive layout (cards, tables, metrics, grid).
7. If transcript insights are presented, ground claims in the provided evidence and cite chunk IDs using [chunk_id: <chunk_id>].
8. Distinguish factual advice from any illustrative UI mock data (label fictitious dashboard values as sample/illustrative data).

OUTPUT:
Output ONLY the clean HTML document wrapped inside a \`\`\`html code block.`;
    } else {
      prompt = `You are an expert product strategist for Lenny's Growth Assistant.
Your task is to generate a structured Markdown document titled "${title}".

USER INSTRUCTIONS:
${instructions}

${evidenceContext ? `VERIFIED TRANSCRIPT EVIDENCE:\n${evidenceContext}\n` : ""}
CONSTRAINTS:
1. Provide a well-structured, actionable Markdown document with headings (#, ##, ###), lists, tables, and bold highlights.
2. Ground insights in the verified transcript evidence when available. Cite chunk IDs using [chunk_id: <chunk_id>].
3. Clearly distinguish factual claims grounded in Lenny's Podcast from illustrative examples.

OUTPUT:
Output ONLY the Markdown content.`;
    }

    let session;
    try {
      const sessionResult = await createAgentSession({
        cwd,
        agentDir,
        settingsManager,
        resourceLoader,
        model: targetModel,
        modelRuntime,
        sessionManager: SessionManager.inMemory(),
        tools: [],
      });
      session = sessionResult.session;

      let timerId;
      const promptPromise = session.prompt(prompt);
      const timeoutPromise = new Promise((_, reject) => {
        timerId = setTimeout(() => {
          const tErr = new Error(`Artifact generation timed out after ${config.requestTimeoutMs}ms.`);
          tErr.statusCode = 504;
          tErr.code = "INFERENCE_TIMEOUT";
          reject(tErr);
        }, config.requestTimeoutMs);
      });

      try {
        await Promise.race([promptPromise, timeoutPromise]);
      } finally {
        if (timerId) clearTimeout(timerId);
      }

      const rawText = session.getLastAssistantText() || "";

      // Extract content from code block if present
      let cleanContent = rawText.trim();
      const fenceMatch = cleanContent.match(/```(?:html|markdown)?\s*\n([\s\S]*?)```/);
      if (fenceMatch) {
        cleanContent = fenceMatch[1].trim();
      }

      // Extract cited chunk IDs
      const citedChunks = [];
      const citeRegex = /\[(?:chunk_id|chunk)(?::|=|\s+is\s+|:\s*)["']?([a-zA-Z0-9_-]+)["']?\]/gi;
      let match;
      const seenChunks = new Set();
      while ((match = citeRegex.exec(cleanContent)) !== null) {
        const cId = match[1].toLowerCase();
        if (!seenChunks.has(cId)) {
          seenChunks.add(cId);
          citedChunks.push({ chunk_id: cId });
        }
      }

      return {
        artifact_type: artifactType,
        title,
        source_content: cleanContent,
        citations: citedChunks,
        provider: selectedProvider,
        model: selectedModel,
        duration_ms: Date.now() - startTime,
      };
    } catch (err) {
      if (session) {
        try {
          await session.abort();
        } catch (_) {}
      }
      throw err;
    } finally {
      if (session) {
        session.dispose();
      }
      releaseLock();
    }
  }
}

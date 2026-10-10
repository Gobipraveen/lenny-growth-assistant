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
            input: ["text"]
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

    // Map of all evidence available to the agent during this turn
    const retrievedPassagesMap = new Map();
    for (const p of candidatePassages) {
      if (p.chunk_id) {
        retrievedPassagesMap.set(String(p.chunk_id).toLowerCase(), p);
      }
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
                  if (item.chunk_id) {
                    retrievedPassagesMap.set(String(item.chunk_id).toLowerCase(), item);
                  }
                }

                if (results.length === 0) {
                  return {
                    content: [{ type: "text", text: `No relevant transcript evidence found for '${query}'.` }]
                  };
                }

                const formatted = results.map((r) =>
                  `[PASSAGE chunk_id="${r.chunk_id}"] Episode: "${r.episode_title}" (Guest: ${r.guest || "Lenny Ratchitsky"})\nSpeaker: ${r.speaker || "Unknown"}\nContent: ${r.content}`
                ).join("\n\n---\n\n");

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


      // Format initial evidence block
      let evidenceBlock = "";
      if (candidatePassages.length > 0) {
        evidenceBlock = "\n\n[CANDIDATE TRANSCRIPT PASSAGES FROM PRE-RETRIEVAL]:\n" +
          candidatePassages.map((p) =>
            `[PASSAGE chunk_id="${p.chunk_id}"] Episode: "${p.episode_title}" (Guest: ${p.guest || "Lenny Ratchitsky"})\nSpeaker: ${p.speaker || "Unknown"}\nContent: ${p.content}`
          ).join("\n\n---\n\n");
      } else {
        evidenceBlock = "\n\n[PRE-RETRIEVAL STATUS]: No high-confidence initial passages were found for this query. You may use search_transcripts to find evidence.";
      }

      // Format conversation history
      let historyBlock = "";
      if (history.length > 0) {
        historyBlock = "\n\n[PRIOR CONVERSATION HISTORY]:\n" +
          history.slice(-8).map((h) => `${h.role.toUpperCase()}: ${h.content}`).join("\n");
      }

      const promptPayload = `System Instructions:
You are The Lenny Growth Assistant, an authoritative AI mentor grounded exclusively in Lenny's Podcast transcripts.
CRITICAL OPERATING RULES:
1. Answer the question thoroughly and accurately using ONLY the transcript evidence provided below or retrieved via search_transcripts.
2. Attribute key insights to the relevant guest and episode title. Include chunk references like [chunk_id: <id>] where applicable.
3. If the transcripts do NOT contain sufficient information to answer the question, state honestly:
"I could not find sufficient evidence in the indexed Lenny's Podcast transcripts to answer this question."
Do not guess or use outside knowledge when evidence is missing.
4. Never invent quotes, episode titles, or source links.

${systemInstructions ? `Additional Context: ${systemInstructions}\n` : ""}${historyBlock}${evidenceBlock}

User Question:
${message}`;

      // Bounded inference execution
      const promptPromise = session.prompt(promptPayload);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          const tErr = new Error(`Inference timed out after ${config.requestTimeoutMs}ms.`);
          tErr.statusCode = 504;
          tErr.code = "INFERENCE_TIMEOUT";
          reject(tErr);
        }, config.requestTimeoutMs);
      });

      await Promise.race([promptPromise, timeoutPromise]);

      const rawAnswer = session.getLastAssistantText() || "";
      const durationMs = Date.now() - startTime;

      // Deterministic Citation Validation - Require explicit reference to chunk ID
      const verifiedCitations = [];
      const lowerAnswer = rawAnswer.toLowerCase();

      for (const [chunkIdLower, passage] of retrievedPassagesMap.entries()) {
        const idMatched = lowerAnswer.includes(chunkIdLower);

        // Require explicit reference to the retrieved chunk identifier
        if (idMatched) {
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
            snippet: passage.content ? passage.content.slice(0, 200) + "..." : ""
          });
        }
      }

      return {
        answer: rawAnswer,
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
}

import http from "node:http";
import { pathToFileURL } from "node:url";
import { config, SUPPORTED_PROVIDERS } from "./config.mjs";
import { PiAgentManager } from "./pi_agent.mjs";

// Helper to read and parse JSON body with strict size boundary
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > config.maxBodySizeBytes) {
        const err = new Error("Payload Too Large: maximum body size is 2MB");
        err.statusCode = 413;
        err.code = "PAYLOAD_TOO_LARGE";
        reject(err);
      }
    });
    req.on("end", () => {
      try {
        const json = body ? JSON.parse(body) : {};
        resolve(json);
      } catch (e) {
        const err = new Error("Invalid JSON: malformed request body");
        err.statusCode = 400;
        err.code = "INVALID_JSON";
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    "X-Content-Type-Options": "nosniff"
  });
  res.end(payload);
}

export function createAgentServer(customAgentManager = null) {
  const agentManager = customAgentManager || new PiAgentManager();

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

    // Health check endpoint
    if (req.method === "GET" && url.pathname === "/health") {
      let ollamaOk = false;
      try {
        const oRes = await fetch(`${config.ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
        ollamaOk = oRes.ok;
      } catch (_) {}

      return sendJson(res, 200, {
        status: "ok",
        service: "lenny-pi-agent-service",
        host: config.host,
        port: config.port,
        providers: {
          ollama: {
            available: ollamaOk,
            baseUrl: config.ollamaBaseUrl,
            model: config.ollamaModel
          },
          anthropic: {
            configured: Boolean(config.anthropicApiKey),
            model: config.anthropicModel
          }
        },
        uptime: process.uptime()
      });
    }

    // AI Chat Turn endpoint
    if (req.method === "POST" && url.pathname === "/chat") {
      // Validate Internal Token without echoing secret
      const authHeader = req.headers["x-internal-token"];
      if (!authHeader || authHeader !== config.internalSecret) {
        return sendJson(res, 401, {
          success: false,
          error: "Unauthorized: Invalid internal token",
          code: "UNAUTHORIZED"
        });
      }

      try {
        const payload = await parseJsonBody(req);
        if (!payload.message || typeof payload.message !== "string" || !payload.message.trim()) {
          return sendJson(res, 400, {
            success: false,
            error: "Bad Request: non-empty 'message' string is required",
            code: "BAD_REQUEST"
          });
        }

        // Validate provider restriction if specified
        if (payload.provider && !SUPPORTED_PROVIDERS.includes(payload.provider)) {
          return sendJson(res, 400, {
            success: false,
            error: `Bad Request: unsupported provider '${payload.provider}'. Supported: ${SUPPORTED_PROVIDERS.join(", ")}`,
            code: "INVALID_PROVIDER"
          });
        }

        const result = await agentManager.executeTurn({
          sessionId: payload.session_id,
          message: payload.message.trim(),
          history: Array.isArray(payload.history) ? payload.history : [],
          candidatePassages: Array.isArray(payload.candidate_passages) ? payload.candidate_passages : [],
          provider: payload.provider,
          model: payload.model,
          systemInstructions: payload.system_instructions || ""
        });

        return sendJson(res, 200, {
          success: true,
          data: result
        });
      } catch (err) {
        console.error("[PiAgentService] Error in /chat:", err.message);
        const statusCode = err.statusCode || (err.code === "INFERENCE_TIMEOUT" ? 504 : 500);
        return sendJson(res, statusCode, {
          success: false,
          error: err.message,
          code: err.code || "INTERNAL_ERROR"
        });
      }
    }

    // Not Found
    return sendJson(res, 404, {
      success: false,
      error: "Not Found",
      code: "NOT_FOUND"
    });
  });
}

// Auto-start listener only when executed directly as script
const isMain = process.argv[1] && (pathToFileURL(process.argv[1]).href === import.meta.url || process.argv[1].endsWith("server.mjs"));
if (isMain) {
  const server = createAgentServer();
  server.listen(config.port, config.host, () => {
    console.log(`[PiAgentService] Running on http://${config.host}:${config.port}`);
  });

  process.on("SIGINT", () => {
    console.log("[PiAgentService] Shutting down...");
    server.close(() => process.exit(0));
  });

  process.on("SIGTERM", () => {
    console.log("[PiAgentService] Terminating...");
    server.close(() => process.exit(0));
  });
}

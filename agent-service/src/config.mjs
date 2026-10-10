import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AGENT_SERVICE_ROOT = path.resolve(__dirname, "..");
export const WORKSPACE_ROOT = path.resolve(AGENT_SERVICE_ROOT, "..");

// Explicitly load workspace root .env if present and native loadEnvFile is supported
const rootEnvPath = path.resolve(WORKSPACE_ROOT, ".env");
if (fs.existsSync(rootEnvPath) && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(rootEnvPath);
  } catch (_) {}
}

export const SUPPORTED_PROVIDERS = Object.freeze(["ollama", "anthropic"]);

const internalSecret = process.env.AGENT_INTERNAL_SECRET;

// Fail-closed check: secret must be explicitly configured and non-empty
if (!internalSecret || !internalSecret.trim()) {
  throw new Error("SECURITY FAULT: AGENT_INTERNAL_SECRET must be explicitly configured in environment / .env and non-empty.");
}

export const config = {
  host: process.env.AGENT_SERVICE_HOST || "127.0.0.1",
  port: parseInt(process.env.AGENT_SERVICE_PORT || "8001", 10),
  internalSecret: internalSecret.trim(),
  fastapiUrl: process.env.FASTAPI_INTERNAL_URL || "http://127.0.0.1:8000",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "qwen2.5:1.5b",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
  defaultProvider: process.env.LLM_PROVIDER || "ollama",
  requestTimeoutMs: parseInt(process.env.AGENT_REQUEST_TIMEOUT_MS || "60000", 10),
  agentDataDir: path.resolve(AGENT_SERVICE_ROOT, ".pi_runtime"),
  maxBodySizeBytes: 2 * 1024 * 1024 // 2MB limit
};

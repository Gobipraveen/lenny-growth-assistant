import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverScript = path.resolve(__dirname, "../src/server.mjs");

console.log("[SmokeTest] Starting isolated Node.js server on port 8001...");
const child = spawn("node", [serverScript], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, AGENT_SERVICE_PORT: "8001", AGENT_INTERNAL_SECRET: process.env.AGENT_INTERNAL_SECRET || "test-smoke-secret" }
});

child.stdout.on("data", (d) => process.stdout.write(`[Server] ${d}`));
child.stderr.on("data", (d) => process.stderr.write(`[Server ERR] ${d}`));

const cleanup = () => {
  if (child && !child.killed) {
    console.log("[SmokeTest] Stopping server process...");
    child.kill("SIGTERM");
  }
};
process.on("exit", cleanup);
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

try {
  let ready = false;
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch("http://127.0.0.1:8001/health", { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        ready = true;
        const body = await res.json();
        console.log("[SmokeTest] Health check PASSED:", JSON.stringify(body));
        break;
      }
    } catch (_) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  if (!ready) {
    throw new Error("Server failed to respond to /health within 4 seconds");
  }

  // Verify unauthorized POST /chat is rejected with 401
  const authRes = await fetch("http://127.0.0.1:8001/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Hello" })
  });
  console.log(`[SmokeTest] Unauthorized POST /chat status: ${authRes.status}`);
  if (authRes.status !== 401) {
    throw new Error(`Expected 401, got ${authRes.status}`);
  }
  const authBody = await authRes.json();
  console.log("[SmokeTest] Auth rejection body:", JSON.stringify(authBody));

  console.log("[SmokeTest] SUCCESS: Localhost smoke test completed successfully!");
} finally {
  cleanup();
  await new Promise((r) => setTimeout(r, 500));
  process.exit(0);
}

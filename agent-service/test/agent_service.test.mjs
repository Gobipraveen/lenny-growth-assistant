import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure test environment provides a non-sensitive test secret before loading config
process.env.AGENT_INTERNAL_SECRET = process.env.AGENT_INTERNAL_SECRET || "test-agent-bridge-secret";

const { config, SUPPORTED_PROVIDERS } = await import("../src/config.mjs");
const { createAgentServer } = await import("../src/server.mjs");
const { syncModelsConfig, PiAgentManager } = await import("../src/pi_agent.mjs");
const {
  createAgentSession,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  ModelRuntime
} = await import("@earendil-works/pi-coding-agent");

describe("Agent Service Isolated Tests", () => {
  let server;
  let baseUrl;
  let mockManager;

  // Mock PiAgentManager for testing HTTP server contracts
  class MockPiAgentManager {
    constructor() {
      this.lastExecuteTurnArgs = null;
      this.shouldThrow = null;
      this.mockResult = {
        answer: "Mock answer grounded in transcript.",
        citations: [
          {
            chunk_id: "test-chunk-123",
            episode_title: "Test Episode",
            guest: "Brian Chesky"
          }
        ],
        toolExecutions: [],
        provider: "ollama",
        model: "qwen2.5:1.5b",
        durationMs: 80
      };
    }

    async executeTurn(args) {
      this.lastExecuteTurnArgs = args;
      if (this.shouldThrow) {
        throw this.shouldThrow;
      }
      return this.mockResult;
    }
  }

  before(async () => {
    mockManager = new MockPiAgentManager();
    server = createAgentServer(mockManager);
    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Health Endpoint Tests
  // ---------------------------------------------------------------------------
  test("GET /health returns 200 with service information and provider status", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.equal(body.service, "lenny-pi-agent-service");
    assert.ok(body.providers);
    assert.equal(body.providers.ollama.model, config.ollamaModel);
    assert.equal(typeof body.uptime, "number");
  });

  // ---------------------------------------------------------------------------
  // 2. Authentication & Security Tests
  // ---------------------------------------------------------------------------
  test("POST /chat rejects missing X-Internal-Token with 401", async () => {
    const res = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello" })
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, "UNAUTHORIZED");
    // Ensure internal secret is never leaked
    const rawText = JSON.stringify(body);
    assert.ok(!rawText.includes(config.internalSecret));
  });

  test("POST /chat rejects incorrect X-Internal-Token with 401", async () => {
    const res = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": "invalid-wrong-secret"
      },
      body: JSON.stringify({ message: "Hello" })
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, "UNAUTHORIZED");
    const rawText = JSON.stringify(body);
    assert.ok(!rawText.includes(config.internalSecret));
  });

  test("config.mjs fails closed and throws Error if AGENT_INTERNAL_SECRET is missing or blank", async () => {
    const { execSync } = await import("node:child_process");
    let caught = false;
    try {
      execSync('node -e "delete process.env.AGENT_INTERNAL_SECRET; import(\'./src/config.mjs\');"', {
        cwd: path.resolve(__dirname, ".."),
        env: { ...process.env, AGENT_INTERNAL_SECRET: "" },
        stdio: "pipe"
      });
    } catch (e) {
      caught = true;
      const errOut = (e.stderr || e.stdout || "").toString();
      assert.ok(errOut.includes("SECURITY FAULT"));
    }
    assert.ok(caught, "Importing config without AGENT_INTERNAL_SECRET must fail closed");
  });

  // ---------------------------------------------------------------------------
  // 3. Request Validation Tests
  // ---------------------------------------------------------------------------
  test("POST /chat rejects empty or whitespace message with 400", async () => {
    const res = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": config.internalSecret
      },
      body: JSON.stringify({ message: "    " })
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, "BAD_REQUEST");
  });

  test("POST /chat rejects unsupported provider with 400", async () => {
    const res = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": config.internalSecret
      },
      body: JSON.stringify({ message: "Hello", provider: "unsupported_provider" })
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, "INVALID_PROVIDER");
  });

  test("POST /chat rejects payload exceeding 2MB size limit with 413", async () => {
    const hugeMessage = "A".repeat(2.5 * 1024 * 1024);
    const res = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": config.internalSecret
      },
      body: JSON.stringify({ message: hugeMessage })
    });
    assert.equal(res.status, 413);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, "PAYLOAD_TOO_LARGE");
  });

  // ---------------------------------------------------------------------------
  // 4. Contract Conformance Tests
  // ---------------------------------------------------------------------------
  test("POST /chat successfully executes turn and returns data matching FastAPI contract", async () => {
    const requestPayload = {
      session_id: "e81c01e6-9ab5-46ba-b847-bb0364d26210",
      message: "What did Brian Chesky say about product management?",
      history: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello, how can I help?" }
      ],
      candidate_passages: [
        {
          chunk_id: "test-chunk-123",
          episode_title: "Brian Chesky's new playbook",
          guest: "Brian Chesky",
          content: "We did not eliminate product management, we combined it with product marketing."
        }
      ],
      provider: "ollama"
    };

    const res = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": config.internalSecret
      },
      body: JSON.stringify(requestPayload)
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data);
    assert.equal(body.data.answer, mockManager.mockResult.answer);
    assert.equal(body.data.provider, "ollama");
    assert.equal(body.data.model, "qwen2.5:1.5b");
    assert.equal(body.data.citations.length, 1);
    assert.equal(body.data.citations[0].chunk_id, "test-chunk-123");

    // Verify args passed to manager
    assert.equal(mockManager.lastExecuteTurnArgs.sessionId, requestPayload.session_id);
    assert.equal(mockManager.lastExecuteTurnArgs.message, requestPayload.message);
    assert.equal(mockManager.lastExecuteTurnArgs.history.length, 2);
    assert.equal(mockManager.lastExecuteTurnArgs.candidatePassages.length, 1);
    assert.equal(mockManager.lastExecuteTurnArgs.provider, "ollama");
  });

  // ---------------------------------------------------------------------------
  // 5. Error Mapping Tests
  // ---------------------------------------------------------------------------
  test("POST /chat maps inference timeout to HTTP 504", async () => {
    const tErr = new Error("Inference timed out after 60000ms.");
    tErr.code = "INFERENCE_TIMEOUT";
    tErr.statusCode = 504;
    mockManager.shouldThrow = tErr;

    const res = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": config.internalSecret
      },
      body: JSON.stringify({ message: "Trigger timeout" })
    });

    assert.equal(res.status, 504);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, "INFERENCE_TIMEOUT");
  });

  test("POST /chat maps internal errors to HTTP 500", async () => {
    const genErr = new Error("Unexpected internal crash");
    mockManager.shouldThrow = genErr;

    const res = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": config.internalSecret
      },
      body: JSON.stringify({ message: "Trigger 500" })
    });

    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, "INTERNAL_ERROR");
  });

  // ---------------------------------------------------------------------------
  // 6. Security Isolation: Pi SDK Tool Allowlist
  // ---------------------------------------------------------------------------
  test("Pi SDK session: Built-in coding tools disabled, only custom tool registered", async () => {
    const modelsPath = syncModelsConfig();
    const modelRuntime = await ModelRuntime.create({ modelsPath });
    const targetModel = modelRuntime.getModel("ollama", config.ollamaModel);

    const cwd = config.agentDataDir;
    const agentDir = config.agentDataDir;
    const settingsManager = SettingsManager.create(cwd, agentDir);

    let customToolExecuted = false;
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      extensionFactories: [
        async (pi) => {
          pi.registerTool({
            name: "search_transcripts",
            description: "Custom read-only retrieval tool",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string" }
              },
              required: ["query"]
            },
            async execute() {
              customToolExecuted = true;
              return { content: [{ type: "text", text: "Tool executed successfully" }] };
            }
          });
        }
      ]
    });
    await resourceLoader.reload();

    // Create session with official tool allowlist: tools: ["search_transcripts"]
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

    const session = sessionResult.session;

    // 1. Verify active tool names
    const activeTools = session.getActiveToolNames();
    assert.deepEqual(activeTools, ["search_transcripts"]);

    // 2. Verify callable tools
    const callableTools = session._getCallableTools().map((t) => t.name);
    assert.deepEqual(callableTools, ["search_transcripts"]);

    // 3. Security check: Built-in coding tools must NOT exist
    const dangerousTools = ["read", "bash", "edit", "write", "find", "grep", "ls", "powershell"];
    for (const tool of dangerousTools) {
      assert.ok(!activeTools.includes(tool), `Tool '${tool}' must not be active`);
      assert.ok(!callableTools.includes(tool), `Tool '${tool}' must not be callable`);
      assert.ok(!session._toolDefinitions.has(tool), `Tool '${tool}' must not be in tool definitions`);
    }

    // 4. Verify custom tool execution directly via registered tool
    const customToolDef = session._toolDefinitions.get("search_transcripts");
    assert.ok(customToolDef, "search_transcripts must be in session tool definitions");
    const result = await customToolDef.definition.execute("call-1", { query: "product management" });
    assert.ok(customToolExecuted, "custom tool execute function must be callable");
    assert.equal(result.content[0].text, "Tool executed successfully");

    session.dispose();
  });

  // ---------------------------------------------------------------------------
  // 7. Official Model Selection API Verification
  // ---------------------------------------------------------------------------
  test("Pi SDK: Official model selection and switching via ModelRuntime and setModel", async () => {
    const modelsPath = syncModelsConfig();
    const modelRuntime = await ModelRuntime.create({ modelsPath });
    const targetModel = modelRuntime.getModel("ollama", config.ollamaModel);

    const cwd = config.agentDataDir;
    const agentDir = config.agentDataDir;
    const settingsManager = SettingsManager.create(cwd, agentDir);

    const sessionResult = await createAgentSession({
      cwd,
      agentDir,
      settingsManager,
      model: targetModel,
      modelRuntime,
      sessionManager: SessionManager.inMemory(),
      tools: ["search_transcripts"]
    });

    const session = sessionResult.session;

    // Verify initial model assignment
    assert.equal(session.model.provider, "ollama");
    assert.equal(session.model.id, config.ollamaModel);

    // Verify setModel switching works using official SDK API
    await session.setModel(targetModel);
    assert.equal(session.model.provider, "ollama");
    assert.equal(session.model.id, config.ollamaModel);

    session.dispose();
  });
});

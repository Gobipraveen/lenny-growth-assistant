import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.AGENT_INTERNAL_SECRET = process.env.AGENT_INTERNAL_SECRET || "test-agent-bridge-secret";

const { config, SUPPORTED_PROVIDERS } = await import("../src/config.mjs");
const { createAgentServer } = await import("../src/server.mjs");

describe("Agent Service Artifact Generation Endpoint (/artifact)", () => {
  let server;
  let baseUrl;
  let mockManager;

  class MockPiAgentManager {
    constructor() {
      this.lastArgs = null;
      this.shouldThrow = null;
      this.mockResult = {
        artifact_type: "html",
        title: "Elena Verna Growth Model",
        source_content: "<!DOCTYPE html><html><head><style>h1{color:#BE5103;}</style></head><body><h1>Growth Model</h1></body></html>",
        citations: [{ chunk_id: "chunk-123" }],
        provider: "ollama",
        model: "qwen2.5:1.5b",
        duration_ms: 100,
      };
    }

    async generateArtifact(args) {
      this.lastArgs = args;
      if (this.shouldThrow) {
        throw this.shouldThrow;
      }
      return {
        ...this.mockResult,
        artifact_type: args.artifactType,
        title: args.title,
      };
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

  test("POST /artifact rejects unauthorized requests without internal token", async () => {
    const res = await fetch(`${baseUrl}/artifact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Test",
        artifact_type: "html",
        instructions: "Generate page",
      }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, "UNAUTHORIZED");
  });

  test("POST /artifact rejects missing title", async () => {
    const res = await fetch(`${baseUrl}/artifact`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": config.internalSecret,
      },
      body: JSON.stringify({
        title: "",
        artifact_type: "html",
        instructions: "Generate page",
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, "BAD_REQUEST");
  });

  test("POST /artifact rejects invalid artifact_type", async () => {
    const res = await fetch(`${baseUrl}/artifact`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": config.internalSecret,
      },
      body: JSON.stringify({
        title: "Test",
        artifact_type: "wasm",
        instructions: "Generate binary",
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, "INVALID_ARTIFACT_TYPE");
  });

  test("POST /artifact rejects empty instructions", async () => {
    const res = await fetch(`${baseUrl}/artifact`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": config.internalSecret,
      },
      body: JSON.stringify({
        title: "Test",
        artifact_type: "html",
        instructions: "   ",
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, "BAD_REQUEST");
  });

  test("POST /artifact succeeds with valid HTML artifact payload", async () => {
    const res = await fetch(`${baseUrl}/artifact`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": config.internalSecret,
      },
      body: JSON.stringify({
        session_id: "sess-123",
        title: "B2B Growth Model",
        artifact_type: "html",
        instructions: "Build a comparison table",
        candidate_passages: [{ chunk_id: "chunk-1", content: "Evidence" }],
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.artifact_type, "html");
    assert.equal(body.data.title, "B2B Growth Model");
    assert.equal(mockManager.lastArgs.artifactType, "html");
    assert.equal(mockManager.lastArgs.candidatePassages.length, 1);
  });

  test("POST /artifact succeeds with valid Markdown artifact payload", async () => {
    const res = await fetch(`${baseUrl}/artifact`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": config.internalSecret,
      },
      body: JSON.stringify({
        session_id: "sess-123",
        title: "Product Strategy Playbook",
        artifact_type: "markdown",
        instructions: "Draft 5 growth rules",
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.artifact_type, "markdown");
    assert.equal(mockManager.lastArgs.artifactType, "markdown");
  });
});

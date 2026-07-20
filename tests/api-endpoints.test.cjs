const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn } = require("node:child_process");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function freePort() {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Test server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/provider-status`);
      if (response.ok) return;
    } catch {
      // The child process may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("Timed out waiting for the test server");
}

async function jsonRequest(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { response, data, text };
}

function post(body) {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  };
}

async function run() {
  const providerStub = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const prompt = JSON.parse(body || "{}").messages?.at(-1)?.content || "";
    const content = prompt.includes("Contract Builder")
      ? JSON.stringify({
        goal: "Reply with a short confirmation",
        facts: [],
        constraints: ["Be concise"],
        required_output: ["confirmation"],
        sources: ["user_input"],
        open_questions: [],
        next_action: "Reply OK",
        output_style: "concise",
        token_budget: { executor_max: 200 }
      })
      : "OK";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 }
    }));
  });
  const providerPort = await listen(providerStub);
  const appPort = await freePort();
  const child = spawn(process.execPath, ["server.cjs"], {
    cwd: require("node:path").resolve(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(appPort),
      NODE_ENV: "test",
      TOKEN_OPTIMIZER_TEST_MODE: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let childOutput = "";
  child.stdout.on("data", (chunk) => { childOutput += chunk; });
  child.stderr.on("data", (chunk) => { childOutput += chunk; });
  const baseUrl = `http://127.0.0.1:${appPort}`;

  try {
    await waitForServer(baseUrl, child);

    const pages = [
      "/",
      "/workspace",
      "/prompt-history",
      "/stats",
      "/agent-structure",
      "/open-source",
      "/settings",
      "/privacy",
      "/optimized-ide",
      "/token-optimizer-file-generator.html"
    ];
    for (const path of pages) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type") || "", /text\/html/, path);
    }

    const status = await jsonRequest(baseUrl, "/api/provider-status");
    assert.equal(status.response.status, 200);
    assert.equal(status.data.openaiConfigured, true);

    const overview = await jsonRequest(baseUrl, "/api/system-overview");
    assert.equal(overview.response.status, 200);
    assert.ok(overview.data.architecture.layers.length > 0);

    const prepared = await jsonRequest(baseUrl, "/api/prepare-handoff", post({
      input: "I want you to reply with OK",
      target: "gemini"
    }));
    assert.equal(prepared.response.status, 200);
    assert.equal(prepared.data.tokenReport.modelCalls, 0);
    assert.match(prepared.data.optimizedPrompt, /reply with OK/i);

    const generated = await jsonRequest(baseUrl, "/api/generate", post({
      prompt: "Reply with OK",
      provider: "openai"
    }));
    assert.equal(generated.response.status, 200);
    assert.equal(generated.data.usage.source, "provider");

    const optimized = await jsonRequest(baseUrl, "/api/optimize-run", post({
      input: "Reply with OK",
      provider: "openai"
    }));
    assert.equal(optimized.response.status, 200);
    assert.equal(optimized.data.executionStatus, "completed");
    assert.match(optimized.data.traceId, /^trace_/);
    assert.ok(optimized.data.trace.every((item) => item.agent && item.actionId));

    const streamed = await jsonRequest(baseUrl, "/api/optimize-stream", post({
      input: "Reply with OK",
      provider: "openai"
    }));
    assert.equal(streamed.response.status, 200);
    assert.match(streamed.response.headers.get("content-type") || "", /text\/event-stream/);
    assert.match(streamed.text, /event: result/);
    assert.match(streamed.text, /"executionStatus":"completed"/);
    assert.match(streamed.text, /"traceId":"trace_/);
    assert.match(streamed.text, /"agent":"Coordinator"/);

    const providerConfig = {
      provider: "custom",
      label: "Test provider",
      baseUrl: `http://127.0.0.1:${providerPort}/v1`,
      model: "fixture",
      apiKey: "test-key"
    };
    const workflow = await jsonRequest(baseUrl, "/api/workflow-run", post({
      input: "Reply with OK",
      providerConfig
    }));
    assert.equal(workflow.response.status, 200);
    assert.equal(workflow.data.executionStatus, "completed");
    assert.equal(workflow.data.providerUsage.modelCalls, 3);

    const a2a = await jsonRequest(baseUrl, "/api/a2a-run", post({
      input: "Reply with OK",
      providerConfig,
      options: { mode: "contract-only" }
    }));
    assert.equal(a2a.response.status, 200);
    assert.equal(a2a.data.providerUsage.modelCalls, 1);

    const created = await jsonRequest(baseUrl, "/api/system-runs", post({
      input: "Reply with OK",
      provider: "openai"
    }));
    assert.equal(created.response.status, 202);
    assert.ok(created.data.run.id);

    let completedRun;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const detail = await jsonRequest(baseUrl, `/api/system-runs/${created.data.run.id}`);
      if (detail.data.run?.status === "completed") {
        completedRun = detail.data.run;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(completedRun, "system run did not complete");
    assert.equal(completedRun.stages.some((stage) => stage.status === "running"), false);
    assert.equal(completedRun.stages.find((stage) => stage.id === "contract").status, "skipped");

    const methodCases = [
      ["/api/provider-status", "POST"],
      ["/api/generate", "GET"],
      ["/api/prepare-handoff", "GET"],
      ["/api/optimize-run", "GET"],
      ["/api/optimize-stream", "GET"],
      ["/api/workflow-run", "GET"],
      ["/api/a2a-run", "GET"],
      ["/api/system-runs", "PUT"]
    ];
    for (const [path, method] of methodCases) {
      const invalidMethod = await jsonRequest(baseUrl, path, { method });
      assert.equal(invalidMethod.response.status, 405, `${method} ${path}`);
      assert.ok(invalidMethod.response.headers.get("allow"), `${method} ${path} allow header`);
    }

    const validationCases = [
      ["/api/generate", "Missing prompt"],
      ["/api/prepare-handoff", "Missing input"],
      ["/api/optimize-run", "Missing input"],
      ["/api/optimize-stream", "Missing input"],
      ["/api/workflow-run", "Missing input"],
      ["/api/a2a-run", "Missing input"],
      ["/api/system-runs", "Missing input"]
    ];
    for (const [path, message] of validationCases) {
      const invalidPayload = await jsonRequest(baseUrl, path, post({}));
      assert.equal(invalidPayload.response.status, 400, path);
      assert.equal(invalidPayload.data.error, message, path);
    }

    const missing = await jsonRequest(baseUrl, "/api/not-real");
    assert.equal(missing.response.status, 404);
    console.log("API endpoint smoke tests passed");
  } catch (error) {
    if (childOutput.trim()) console.error(childOutput.trim());
    throw error;
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => providerStub.close(resolve));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

process.env.NODE_ENV = "test";
process.env.TOKEN_OPTIMIZER_TEST_MODE = "1";

const handlers = {
  a2a: require("../api/a2a-run.js"),
  generate: require("../api/generate.js"),
  optimize: require("../api/optimize-run.js"),
  stream: require("../api/optimize-stream.js"),
  prepare: require("../api/prepare-handoff.js"),
  providerStatus: require("../api/provider-status.js"),
  systemOverview: require("../api/system-overview.js"),
  systemRuns: require("../api/system-runs.js"),
  workflow: require("../api/workflow-run.js")
};

let requestNumber = 0;

function request(method, body) {
  requestNumber += 1;
  return {
    method,
    body,
    headers: {},
    socket: { remoteAddress: `198.51.100.${requestNumber}` }
  };
}

class MockResponse extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.chunks = [];
    this.data = undefined;
    this.writableEnded = false;
  }

  setHeader(name, value) {
    this.headers[String(name).toLowerCase()] = String(value);
  }

  writeHead(status, headers = {}) {
    this.statusCode = status;
    for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    return this;
  }

  status(status) {
    this.statusCode = status;
    return this;
  }

  json(data) {
    this.data = data;
    this.writableEnded = true;
    return this;
  }

  write(chunk) {
    this.chunks.push(String(chunk));
    return true;
  }

  end(chunk) {
    if (chunk !== undefined) this.chunks.push(String(chunk));
    this.writableEnded = true;
    return this;
  }

  flushHeaders() {}

  text() {
    return this.chunks.join("");
  }
}

async function invoke(handler, method, body) {
  const response = new MockResponse();
  await handler(request(method, body), response);
  return response;
}

async function run() {
  const methodCases = [
    [handlers.a2a, "GET", "POST"],
    [handlers.generate, "GET", "POST"],
    [handlers.optimize, "GET", "POST"],
    [handlers.stream, "GET", "POST"],
    [handlers.prepare, "GET", "POST"],
    [handlers.providerStatus, "POST", "GET"],
    [handlers.systemOverview, "POST", "GET"],
    [handlers.systemRuns, "PUT", "GET, POST"],
    [handlers.workflow, "GET", "POST"]
  ];
  for (const [handler, method, allow] of methodCases) {
    const response = await invoke(handler, method);
    assert.equal(response.statusCode, 405, `${method} must be rejected`);
    assert.equal(response.headers.allow, allow);
    assert.equal(response.headers["x-content-type-options"], "nosniff");
  }

  const validationCases = [
    [handlers.a2a, "Missing input"],
    [handlers.generate, "Missing prompt"],
    [handlers.optimize, "Missing input"],
    [handlers.prepare, "Missing input"],
    [handlers.stream, "Missing input"],
    [handlers.systemRuns, "Missing input"],
    [handlers.workflow, "Missing input"]
  ];
  for (const [handler, message] of validationCases) {
    const response = await invoke(handler, "POST", {});
    assert.equal(response.statusCode, 400);
    const data = response.data || JSON.parse(response.text());
    assert.equal(data.error, message);
  }

  const status = await invoke(handlers.providerStatus, "GET");
  assert.equal(status.statusCode, 200);
  assert.equal(status.data.openaiConfigured, true);

  const overview = await invoke(handlers.systemOverview, "GET");
  assert.equal(overview.statusCode, 200);
  assert.ok(overview.data.architecture.layers.length > 0);
  assert.deepEqual(overview.data.runs, []);

  const prepared = await invoke(handlers.prepare, "POST", {
    input: "Reply with OK",
    target: "chatgpt"
  });
  assert.equal(prepared.statusCode, 200);
  assert.equal(prepared.data.target, "chatgpt");
  assert.equal(prepared.data.tokenReport.modelCalls, 0);
  assert.equal(prepared.headers["x-ratelimit-scope"], "preparation");

  const generated = await invoke(handlers.generate, "POST", {
    prompt: "Reply with OK",
    provider: "openai"
  });
  assert.equal(generated.statusCode, 200);
  assert.equal(generated.data.usage.source, "provider");
  assert.equal(generated.headers["x-ratelimit-scope"], "billable");

  const optimized = await invoke(handlers.optimize, "POST", {
    input: "Reply with OK",
    provider: "openai",
    options: { routePreference: "fast" }
  });
  assert.equal(optimized.statusCode, 200);
  assert.equal(optimized.data.executionStatus, "completed");
  assert.equal(optimized.data.workflowShape.route, "direct");

  const stream = await invoke(handlers.stream, "POST", {
    input: "Reply with OK",
    provider: "openai",
    options: { routePreference: "fast" }
  });
  assert.equal(stream.statusCode, 200);
  assert.match(stream.headers["content-type"], /text\/event-stream/);
  assert.match(stream.text(), /event: progress/);
  assert.match(stream.text(), /event: result/);
  assert.match(stream.text(), /"executionStatus":"completed"/);

  for (const handler of [handlers.a2a, handlers.workflow]) {
    const response = await invoke(handler, "POST", {
      input: "Prepare a compact contract",
      providerConfig: { provider: "offline" },
      options: { mode: "contract-only" }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.data.executionStatus, "prompt_ready");
    assert.equal(response.data.providerUsage.modelCalls, 0);
  }

  const hostedRuns = await invoke(handlers.systemRuns, "GET");
  assert.equal(hostedRuns.statusCode, 200);
  assert.deepEqual(hostedRuns.data.runs, []);
  assert.match(hostedRuns.data.note, /complete inline/i);

  const systemRun = await invoke(handlers.systemRuns, "POST", {
    input: "Reply with OK",
    provider: "openai",
    options: { routePreference: "fast" }
  });
  assert.equal(systemRun.statusCode, 200);
  assert.equal(systemRun.data.run.status, "completed");
  assert.equal(systemRun.data.run.result.executionStatus, "completed");
  assert.equal(systemRun.data.run.stages.some((stage) => stage.status === "running"), false);

  console.log("hosted API handler tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

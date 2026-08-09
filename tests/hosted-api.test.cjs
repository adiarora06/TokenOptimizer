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

function request(method, body, options = {}) {
  requestNumber += 1;
  return {
    method,
    body,
    headers: options.headers || {},
    socket: { remoteAddress: options.ip || `198.51.100.${requestNumber}` }
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

async function invoke(handler, method, body, options) {
  const response = new MockResponse();
  await handler(request(method, body, options), response);
  return response;
}

function assertSafePublicResult(result) {
  for (const field of ["contractOutput", "executorOutput", "generations", "optimizerOutput"]) {
    assert.equal(field in result, false, `${field} must not cross the public API boundary`);
  }
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
  assert.equal(overview.data.telemetry.privacy, "metadata-only");
  assert.equal(overview.data.telemetry.scope, "process-local");
  assert.ok(overview.data.telemetry.health.status);

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
  assert.match(generated.data.traceId, /^trace_/);
  assert.equal(generated.headers["x-ratelimit-scope"], "billable");

  const optimized = await invoke(handlers.optimize, "POST", {
    input: "Reply with OK",
    provider: "openai",
    options: { routePreference: "fast" }
  });
  assert.equal(optimized.statusCode, 200);
  assert.equal(optimized.data.executionStatus, "completed");
  assert.equal(optimized.data.qualityStatus, "passed");
  assert.equal(optimized.data.workflowShape.route, "direct");
  assert.equal(optimized.data.acceptanceReport.status, "passed");
  assert.equal(optimized.data.repairReport.status, "not_needed");
  assertSafePublicResult(optimized.data);

  const repaired = await invoke(handlers.optimize, "POST", {
    input: "REPAIR_JSON_FIXTURE Return one JSON object. Use exactly the keys status and owner. Set status to open. Set owner to Maya. Do not add Markdown or explanatory prose.",
    provider: "openai",
    options: { routePreference: "fast" }
  });
  assert.equal(repaired.statusCode, 200);
  assert.equal(repaired.data.qualityStatus, "repaired");
  assert.deepEqual(JSON.parse(repaired.data.finalAnswer), { status: "open", owner: "Maya" });
  assertSafePublicResult(repaired.data);
  assert.equal(JSON.stringify(repaired.data).includes('"status":"closed"'), false);

  const idempotentBody = {
    input: "Reply with OK for the idempotency check",
    provider: "openai",
    options: { routePreference: "fast" }
  };
  const idempotencyOptions = {
    ip: "198.51.100.240",
    headers: { "idempotency-key": "hosted_idempotency_0001" }
  };
  const idempotentFirst = await invoke(handlers.optimize, "POST", idempotentBody, idempotencyOptions);
  const idempotentReplay = await invoke(handlers.optimize, "POST", idempotentBody, idempotencyOptions);
  assert.equal(idempotentFirst.statusCode, 200);
  assert.equal(idempotentReplay.statusCode, 200);
  assert.equal(idempotentFirst.headers["x-idempotency-status"], "started");
  assert.equal(idempotentReplay.headers["x-idempotency-status"], "replayed");
  assert.deepEqual(idempotentReplay.data, idempotentFirst.data);
  const idempotencyConflict = await invoke(handlers.optimize, "POST", {
    ...idempotentBody,
    input: "A different request"
  }, idempotencyOptions);
  assert.equal(idempotencyConflict.statusCode, 409);
  assert.equal(idempotencyConflict.data.code, "idempotency_conflict");

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
  assert.match(stream.text(), /"qualityStatus":"passed"/);
  assert.doesNotMatch(stream.text(), /"executorOutput"|"optimizerOutput"|"contractOutput"|"generations"/);

  for (const handler of [handlers.a2a, handlers.workflow]) {
    const response = await invoke(handler, "POST", {
      input: "Prepare a compact contract",
      providerConfig: { provider: "offline" },
      options: { mode: "contract-only" }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.data.executionStatus, "prompt_ready");
    assert.equal(response.data.qualityStatus, "not_run");
    assert.equal(response.data.providerUsage.modelCalls, 0);
    assertSafePublicResult(response.data);
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
  assert.equal(systemRun.data.run.result.qualityStatus, "passed");
  assertSafePublicResult(systemRun.data.run.result);
  assert.equal(systemRun.data.run.stages.some((stage) => stage.status === "running"), false);

  const updatedOverview = await invoke(handlers.systemOverview, "GET");
  assert.ok(updatedOverview.data.telemetry.totals.workflowRuns >= 5);
  assert.ok(updatedOverview.data.telemetry.totals.providerAttempts >= 4);
  assert.ok(["healthy", "warning", "critical", "insufficient_data"].includes(updatedOverview.data.telemetry.health.status));
  assert.equal("events" in updatedOverview.data.telemetry, false);

  console.log("hosted API handler tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

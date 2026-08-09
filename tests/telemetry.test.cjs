const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.TOKEN_OPTIMIZER_TEST_MODE = "1";
process.env.TOKEN_OPTIMIZER_TELEMETRY_LOG = "0";
process.env.TOKEN_OPTIMIZER_TELEMETRY_MAX_EVENTS = "10";

const { generateWithFallback, runSelfOptimizingWorkflow } = require("../optimizer-core.cjs");
const {
  classifyFailure,
  recordProviderAttempt,
  recordWorkflowRun,
  resetTelemetry,
  telemetrySummary
} = require("../core/telemetry.cjs");

async function run() {
  resetTelemetry();
  const secret = ["sk", "telemetry-secret-value-123456789"].join("_");
  const traceId = "trace_telemetry_fixture1";

  await generateWithFallback(`FALLBACK_SECRET_FIXTURE ${secret}`, {
    timeoutMs: 5_000,
    telemetryContext: { endpoint: "/api/generate", traceId, stage: "generate" }
  });

  let summary = telemetrySummary({ includeEvents: true });
  assert.equal(summary.privacy, "metadata-only");
  assert.equal(summary.totals.providerAttempts, 2);
  assert.equal(summary.totals.successfulProviderAttempts, 1);
  assert.equal(summary.totals.failedProviderAttempts, 1);
  assert.equal(summary.totals.fallbackPolicyAttempts, 2);
  assert.equal(summary.totals.fallbackRetries, 1);
  assert.equal(summary.health.status, "insufficient_data");
  assert.equal(summary.providers.groq.failures, 1);
  assert.equal(summary.providers.openai.successes, 1);
  assert.equal(summary.failures.providerAttempts.unknown, 1);
  assert.equal(JSON.stringify(summary).includes(secret), false);
  assert.ok(summary.events.every((event) => !("prompt" in event) && !("result" in event) && !("error" in event)));

  const workflow = await runSelfOptimizingWorkflow({
    rawInput: `Reply with OK. Never repeat ${secret}`,
    provider: "openai",
    options: { routePreference: "fast" },
    telemetryContext: { endpoint: "/api/optimize-run" }
  });
  assert.equal(workflow.executionStatus, "completed");
  assert.equal(workflow.qualityStatus, "passed");

  summary = telemetrySummary({ includeEvents: true });
  assert.equal(summary.totals.workflowRuns, 1);
  assert.equal(summary.totals.completedRuns, 1);
  assert.equal(summary.routes.direct, 1);
  assert.equal(summary.totals.workflowModelCalls, 1);
  assert.equal(summary.totals.acceptanceEvaluatedRuns, 1);
  assert.equal(summary.totals.acceptancePassedRuns, 1);
  assert.equal(summary.totals.acceptancePassPercent, 100);
  assert.equal(summary.totals.qualityPassedRuns, 1);
  assert.equal(summary.events.find((event) => event.type === "workflow_run").repairStatus, "not_needed");
  assert.equal(JSON.stringify(summary).includes(secret), false);

  const repairedWorkflow = await runSelfOptimizingWorkflow({
    rawInput: "REPAIR_JSON_FIXTURE Return one JSON object. Use exactly the keys status and owner. Set status to open. Set owner to Maya. Do not add Markdown or explanatory prose.",
    provider: "openai",
    options: { routePreference: "fast" },
    telemetryContext: { endpoint: "/api/optimize-run" }
  });
  assert.equal(repairedWorkflow.repairReport.status, "repaired");
  assert.equal(repairedWorkflow.qualityStatus, "repaired");
  summary = telemetrySummary({ includeEvents: true });
  assert.equal(summary.totals.locallyRepairedRuns, 1);
  assert.equal(summary.totals.localRepairActions, 3);
  assert.equal(summary.totals.qualityRepairedRuns, 1);

  recordProviderAttempt({
    provider: `custom-${secret}`,
    error: new Error(`Provider echoed ${secret}`),
    elapsedMs: 12,
    context: { endpoint: `/api/${secret}`, stage: secret, traceId: secret }
  });
  recordWorkflowRun({
    executionStatus: "provider_error",
    providerError: `Provider echoed ${secret}`,
    provider: `custom-${secret}`,
    finalAnswer: secret,
    generations: [],
    securityReport: { redactions: 1 },
    tokenReport: { rawInputTokens: 4, optimizedPromptTokens: 3 },
    elapsedMs: 9
  }, { endpoint: `/api/${secret}` });

  summary = telemetrySummary({ includeEvents: true });
  assert.equal(JSON.stringify(summary).includes(secret), false, "telemetry must never retain arbitrary text");
  assert.equal(summary.events.at(-2).provider, "custom");
  assert.equal(summary.events.at(-2).endpoint, "core");
  assert.equal(summary.events.at(-2).traceId, null);
  assert.equal(classifyFailure(new Error("Provider request timed out")), "timeout");
  assert.equal(classifyFailure(new Error("HTTP 429 rate limit")), "rate_limit");
  assert.equal(classifyFailure(new Error("OpenAI API key is not configured")), "configuration");

  for (let index = 0; index < 10; index += 1) {
    recordProviderAttempt({ provider: "openai", result: { usage: {} }, elapsedMs: index });
  }
  summary = telemetrySummary({ includeEvents: true });
  assert.equal(summary.retention.maxEvents, 10);
  assert.equal(summary.retention.retainedEvents, 10);
  assert.ok(summary.retention.droppedEvents > 0);
  assert.equal(summary.events.length, 10);

  console.log("privacy-safe telemetry tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

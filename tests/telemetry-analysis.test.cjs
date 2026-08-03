const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

process.env.NODE_ENV = "test";

const { summarizeTelemetryEvents, telemetryAlertPolicy } = require("../core/telemetry-analysis.cjs");
const {
  exitCodeForHealth,
  formatTelemetryReport,
  parseTelemetryInput
} = require("../scripts/telemetry-report.cjs");

const baseTime = Date.parse("2026-08-03T12:00:00.000Z");

function providerEvent(index, overrides = {}) {
  return {
    kind: "token_optimizer.telemetry",
    schemaVersion: 1,
    type: "provider_attempt",
    at: new Date(baseTime + (index * 1_000)).toISOString(),
    traceId: `trace_test_${String(index).padStart(2, "0")}`,
    endpoint: "/api/optimize-run",
    stage: "execute",
    provider: "openai",
    outcome: "success",
    failureCode: null,
    fallbackPolicy: true,
    fallbackAttempt: 1,
    fallbackRetry: false,
    latencyMs: 1_000 + (index * 100),
    inputTokens: 20,
    outputTokens: 10,
    totalTokens: 30,
    cachedTokens: 0,
    estimatedCostUsd: 0.01,
    ...overrides
  };
}

function workflowEvent(index, overrides = {}) {
  return {
    kind: "token_optimizer.telemetry",
    schemaVersion: 1,
    type: "workflow_run",
    at: new Date(baseTime + (index * 1_000)).toISOString(),
    traceId: `trace_workflow_${String(index).padStart(2, "0")}`,
    endpoint: "/api/optimize-run",
    route: "direct",
    status: "completed",
    failureCode: null,
    provider: "openai",
    modelCalls: 1,
    failedProviderAttempts: 0,
    redactions: 0,
    rawInputTokens: 10,
    optimizedPromptTokens: 12,
    elapsedMs: 2_000,
    ...overrides
  };
}

function run() {
  const events = [];
  for (let index = 0; index < 10; index += 1) {
    events.push(providerEvent(index, index < 2 ? {
      outcome: "failure",
      failureCode: "timeout",
      totalTokens: 0,
      estimatedCostUsd: null
    } : index === 2 ? {
      fallbackAttempt: 2,
      fallbackRetry: true
    } : index === 9 ? {
      latencyMs: 12_000
    } : {}));
    events.push(workflowEvent(index, index < 2 ? {
      status: "provider_error",
      failureCode: "timeout"
    } : {}));
  }

  const summary = summarizeTelemetryEvents(events, { scope: "deployment-log-window" });
  assert.equal(summary.scope, "deployment-log-window");
  assert.equal(summary.totals.providerAttempts, 10);
  assert.equal(summary.totals.failedProviderAttempts, 2);
  assert.equal(summary.totals.fallbackChains, 9);
  assert.equal(summary.totals.fallbackRetries, 1);
  assert.equal(summary.totals.workflowRuns, 10);
  assert.equal(summary.health.status, "warning");
  assert.equal(summary.health.metrics.providerFailurePercent, 20);
  assert.equal(summary.health.metrics.workflowFailurePercent, 20);
  assert.equal(summary.health.metrics.fallbackRetryPercent, 11.11);
  assert.equal(summary.health.metrics.p95ProviderLatencyMs, 12_000);
  assert.deepEqual(
    new Set(summary.health.alerts.map((alert) => alert.id)),
    new Set(["provider_failure_rate", "fallback_retry_rate", "provider_p95_latency", "workflow_failure_rate"])
  );
  assert.equal(exitCodeForHealth("warning", "critical"), 0);
  assert.equal(exitCodeForHealth("warning", "warning"), 1);
  assert.equal(exitCodeForHealth("critical", "critical"), 2);

  const critical = summarizeTelemetryEvents(events, {
    alertPolicy: { providerFailurePercent: { warning: 5, critical: 15 } }
  });
  assert.equal(critical.health.status, "critical");

  const costWarning = summarizeTelemetryEvents(events, {
    alertPolicy: {
      providerFailurePercent: { warning: 50, critical: 75 },
      workflowFailurePercent: { warning: 50, critical: 75 },
      fallbackRetryPercent: { warning: 50, critical: 75 },
      p95ProviderLatencyMs: { warning: 30_000, critical: 60_000 },
      estimatedCostUsd: { warning: 0.05, critical: 0.1 }
    }
  });
  assert.equal(costWarning.health.status, "warning");
  assert.equal(costWarning.health.alerts[0].id, "estimated_cost");

  const policy = telemetryAlertPolicy({}, {
    minimumProviderAttempts: 5,
    p95ProviderLatencyMs: { warning: 30_000, critical: 10_000 },
    estimatedCostUsd: { warning: 1, critical: 0.5 }
  });
  assert.deepEqual(policy.p95ProviderLatencyMs, { warning: 10_000, critical: 30_000 });
  assert.deepEqual(policy.estimatedCostUsd, { warning: 0.5, critical: 1 });

  const secret = ["sk", "report-secret-value-123456789"].join("_");
  const direct = JSON.stringify(providerEvent(20));
  const wrapped = JSON.stringify({ level: "info", message: JSON.stringify(workflowEvent(20)) });
  const prefixed = JSON.stringify({ text: `stdout: ${JSON.stringify(providerEvent(21))}` });
  const forged = JSON.stringify(providerEvent(22, { provider: secret, failureCode: secret, outcome: "failure" }));
  const parsed = parseTelemetryInput([direct, wrapped, prefixed, forged, `unrelated ${secret}`].join("\n"));
  assert.equal(parsed.events.length, 4);
  assert.equal(parsed.recordsRead, 5);
  assert.equal(parsed.ignoredRecords, 1);
  const parsedSummary = summarizeTelemetryEvents(parsed.events);
  const report = formatTelemetryReport(parsedSummary, {
    eventsAccepted: parsed.events.length,
    ignoredRecords: parsed.ignoredRecords
  });
  assert.match(report, /Provider attempts: 3/);
  assert.equal(report.includes(secret), false);
  assert.equal(JSON.stringify(parsedSummary).includes(secret), false);
  assert.equal(JSON.stringify(parsed.events).includes(secret), false);

  const cliPath = path.join(__dirname, "..", "scripts", "telemetry-report.cjs");
  const cli = spawnSync(process.execPath, [cliPath, "--input", "-", "--json"], {
    input: [direct, wrapped].join("\n"),
    encoding: "utf8"
  });
  assert.equal(cli.status, 0, cli.stderr);
  const output = JSON.parse(cli.stdout);
  assert.equal(output.ingestion.eventsAccepted, 2);
  assert.equal(output.summary.scope, "deployment-log-window");

  console.log("deployment telemetry analysis tests passed");
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

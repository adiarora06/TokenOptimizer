#!/usr/bin/env node

const fs = require("node:fs");

const { normalizeTelemetryEvent, summarizeTelemetryEvents } = require("../core/telemetry-analysis.cjs");

const EVENT_KIND = "token_optimizer.telemetry";
const EVENT_TYPES = new Set(["provider_attempt", "workflow_run"]);

function parseJsonCandidate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace <= firstBrace) return null;
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

function collectTelemetryEvent(value, output, depth = 0) {
  if (depth > 4 || value == null) return false;
  if (typeof value === "string") {
    const parsed = parseJsonCandidate(value);
    return parsed ? collectTelemetryEvent(parsed, output, depth + 1) : false;
  }
  if (Array.isArray(value)) {
    let found = false;
    for (const item of value) found = collectTelemetryEvent(item, output, depth + 1) || found;
    return found;
  }
  if (typeof value !== "object") return false;
  if (
    value.kind === EVENT_KIND &&
    Number(value.schemaVersion) === 1 &&
    EVENT_TYPES.has(value.type)
  ) {
    const event = normalizeTelemetryEvent(value);
    if (!event) return false;
    output.push(event);
    return true;
  }

  for (const key of ["message", "text", "payload", "data"]) {
    if (key in value && collectTelemetryEvent(value[key], output, depth + 1)) return true;
  }
  return false;
}

function parseTelemetryInput(input) {
  const text = String(input || "").trim();
  if (!text) return { events: [], recordsRead: 0, ignoredRecords: 0 };
  const events = [];
  let recordsRead = 0;
  let ignoredRecords = 0;
  const whole = parseJsonCandidate(text);
  const records = whole && (Array.isArray(whole) || text.startsWith("{"))
    ? (Array.isArray(whole) ? whole : [whole])
    : text.split(/\r?\n/).filter((line) => line.trim()).map(parseJsonCandidate);

  for (const record of records) {
    recordsRead += 1;
    if (!record || !collectTelemetryEvent(record, events)) ignoredRecords += 1;
  }
  return { events, recordsRead, ignoredRecords };
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value || 0));
}

function formatTelemetryReport(summary, ingestion = {}) {
  const { totals, health } = summary;
  const lines = [
    "Token Optimizer deployment telemetry",
    "",
    `Status: ${health.status.toUpperCase()}`,
    `Window: ${summary.retention.oldestEventAt || "n/a"} -> ${summary.retention.newestEventAt || "n/a"}`,
    `Provider attempts: ${formatNumber(totals.providerAttempts)} (${formatNumber(totals.failedProviderAttempts)} failed, ${health.metrics.providerFailurePercent}%)`,
    `Fallback retries: ${formatNumber(totals.fallbackRetries)} (${health.metrics.fallbackRetryPercent}% of fallback chains)`,
    `Workflow runs: ${formatNumber(totals.workflowRuns)} (${formatNumber(totals.failedRuns)} failed, ${health.metrics.workflowFailurePercent}%)`,
    `Provider latency: ${formatNumber(totals.averageProviderLatencyMs)} ms average, ${formatNumber(health.metrics.p95ProviderLatencyMs)} ms p95`,
    `Usage: ${formatNumber(totals.totalTokens)} tokens, ${totals.estimatedCostUsd == null ? "cost unavailable" : `$${formatNumber(totals.estimatedCostUsd)}`}`
  ];

  const providers = Object.entries(summary.providers);
  if (providers.length) {
    lines.push("", "Providers:");
    for (const [name, provider] of providers) {
      lines.push(
        `- ${name}: ${provider.attempts} attempts, ${provider.failures} failures, ${provider.fallbackRetries} retries, ${provider.averageLatencyMs} ms average`
      );
    }
  }

  if (health.alerts.length) {
    lines.push("", "Alerts:");
    for (const alert of health.alerts) {
      lines.push(
        `- ${alert.severity.toUpperCase()} ${alert.metric}: ${alert.observed} ${alert.unit} (threshold ${alert.threshold}). ${alert.action}`
      );
    }
  } else {
    lines.push("", health.status === "insufficient_data"
      ? "Alerts: waiting for the configured minimum sample."
      : "Alerts: none.");
  }

  lines.push(
    "",
    `Ingestion: ${formatNumber(ingestion.eventsAccepted ?? summary.retention.retainedEvents)} telemetry events accepted; ${formatNumber(ingestion.ignoredRecords)} unrelated records ignored.`
  );
  return lines.join("\n");
}

function parseArguments(argv) {
  const options = { input: null, json: false, failOn: "critical" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") options.json = true;
    else if (argument === "--input" || argument === "-i") options.input = argv[++index];
    else if (argument.startsWith("--input=")) options.input = argument.slice("--input=".length);
    else if (argument === "--fail-on") options.failOn = argv[++index];
    else if (argument.startsWith("--fail-on=")) options.failOn = argument.slice("--fail-on=".length);
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!new Set(["critical", "warning", "never"]).has(options.failOn)) {
    throw new Error("--fail-on must be critical, warning, or never");
  }
  return options;
}

function helpText() {
  return [
    "Usage: node scripts/telemetry-report.cjs --input <path|-> [--json] [--fail-on critical|warning|never]",
    "",
    "Reads Token Optimizer structured telemetry from JSON, NDJSON, or Vercel JSON log wrappers.",
    "Use --input - for stdin. The default exits 2 only for critical health; --fail-on warning exits 1 for warnings."
  ].join("\n");
}

function exitCodeForHealth(status, failOn) {
  if (failOn === "never") return 0;
  if (status === "critical") return 2;
  if (status === "warning" && failOn === "warning") return 1;
  return 0;
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArguments(argv);
    if (options.help) {
      console.log(helpText());
      return 0;
    }
    const inputPath = options.input || (!process.stdin.isTTY ? "-" : null);
    if (!inputPath) throw new Error("Provide --input <path> or pipe logs with --input -");
    const input = inputPath === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(inputPath, "utf8");
    const parsed = parseTelemetryInput(input);
    const summary = summarizeTelemetryEvents(parsed.events, { scope: "deployment-log-window" });
    const ingestion = {
      recordsRead: parsed.recordsRead,
      eventsAccepted: parsed.events.length,
      ignoredRecords: parsed.ignoredRecords
    };
    console.log(options.json
      ? JSON.stringify({ ingestion, summary }, null, 2)
      : formatTelemetryReport(summary, ingestion));
    return exitCodeForHealth(summary.health.status, options.failOn);
  } catch (error) {
    console.error(`Telemetry report failed: ${error.message}`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = {
  collectTelemetryEvent,
  exitCodeForHealth,
  formatTelemetryReport,
  main,
  parseArguments,
  parseTelemetryInput
};

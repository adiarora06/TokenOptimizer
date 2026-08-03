const DEFAULT_MAX_EVENTS = 200;
const MAX_EVENT_LIMIT = 5_000;
const { summarizeTelemetryEvents } = require("./telemetry-analysis.cjs");

const KNOWN_ENDPOINTS = new Set([
  "core",
  "/api/a2a-run",
  "/api/generate",
  "/api/optimize-run",
  "/api/optimize-stream",
  "/api/system-runs",
  "/api/workflow-run"
]);
const KNOWN_PROVIDERS = new Set([
  "custom",
  "groq",
  "litellm",
  "offline",
  "openai",
  "openrouter",
  "test",
  "xai"
]);
const KNOWN_ROUTES = new Set(["direct", "contract", "full", "kit", "unknown"]);
const KNOWN_STAGES = new Set(["contract", "execute", "generate", "verify", "unknown"]);
const KNOWN_STATUSES = new Set(["cancelled", "completed", "prompt_ready", "provider_error"]);

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function flagEnabled(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return /^(?:1|true|yes|on)$/i.test(String(value));
}

const configuration = Object.freeze({
  maxEvents: boundedInteger(
    process.env.TOKEN_OPTIMIZER_TELEMETRY_MAX_EVENTS,
    DEFAULT_MAX_EVENTS,
    10,
    MAX_EVENT_LIMIT
  ),
  structuredLogging: flagEnabled(
    process.env.TOKEN_OPTIMIZER_TELEMETRY_LOG,
    process.env.NODE_ENV === "production"
  )
});

const events = [];
let droppedEvents = 0;

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizeEndpoint(value) {
  return normalizeEnum(value, KNOWN_ENDPOINTS, "core");
}

function normalizeProvider(value) {
  return normalizeEnum(value, KNOWN_PROVIDERS, "custom");
}

function normalizeRoute(value) {
  return normalizeEnum(value, KNOWN_ROUTES, "unknown");
}

function normalizeStage(value) {
  return normalizeEnum(value, KNOWN_STAGES, "unknown");
}

function normalizeStatus(value) {
  return normalizeEnum(value, KNOWN_STATUSES, "provider_error");
}

function normalizeTraceId(value) {
  const traceId = String(value || "");
  return /^trace_[a-z0-9]+_[a-z0-9]+$/i.test(traceId) ? traceId.slice(0, 80) : null;
}

function nonNegativeNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, parsed));
}

function nullableCost(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Number(parsed.toFixed(8));
}

function classifyFailure(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || error || "").toLowerCase();
  if (code === "ABORT_ERR" || /cancelled|canceled|aborted/.test(message)) return "cancelled";
  if (code === "ETIMEDOUT" || /timed out|timeout/.test(message)) return "timeout";
  if (/rate.?limit|\b429\b/.test(message)) return "rate_limit";
  if (/time budget|deadline/.test(message)) return "budget_exhausted";
  if (/truncated|response exceeded|output token limit/.test(message)) return "response_limit";
  if (/api key|not configured|base url is missing|model is missing|\b401\b|\b403\b/.test(message)) {
    return "configuration";
  }
  if (/private provider|redirect|must use https|dns lookup|validated address|url credentials|valid url/.test(message)) {
    return "security_policy";
  }
  if (/unavailable|provider request failed|returned no message|\b5\d\d\b/.test(message)) {
    return "provider_unavailable";
  }
  return "unknown";
}

function storeEvent(event) {
  events.push(event);
  if (events.length > configuration.maxEvents) {
    events.shift();
    droppedEvents += 1;
  }
  if (configuration.structuredLogging) {
    try {
      console.info(JSON.stringify({ kind: "token_optimizer.telemetry", ...event }));
    } catch {
      // Observability must never interrupt a user run.
    }
  }
  return event;
}

function recordProviderAttempt({ provider, result, error, elapsedMs, context = {} } = {}) {
  const usage = result?.usage || {};
  const fallbackAttempt = context.fallbackPolicy
    ? boundedInteger(context.fallbackAttempt, 1, 1, 20)
    : 0;
  return storeEvent({
    schemaVersion: 1,
    type: "provider_attempt",
    at: new Date().toISOString(),
    traceId: normalizeTraceId(context.traceId),
    endpoint: normalizeEndpoint(context.endpoint),
    stage: normalizeStage(context.stage),
    provider: normalizeProvider(provider),
    outcome: error ? "failure" : "success",
    failureCode: error ? classifyFailure(error) : null,
    fallbackPolicy: Boolean(context.fallbackPolicy),
    fallbackAttempt,
    fallbackRetry: fallbackAttempt > 1,
    latencyMs: nonNegativeNumber(result?.latencyMs ?? elapsedMs),
    inputTokens: nonNegativeNumber(usage.inputTokens),
    outputTokens: nonNegativeNumber(usage.outputTokens),
    totalTokens: nonNegativeNumber(usage.totalTokens),
    cachedTokens: nonNegativeNumber(usage.cachedTokens),
    estimatedCostUsd: nullableCost(usage.estimatedCostUsd)
  });
}

function recordWorkflowRun(result = {}, context = {}) {
  const generations = Array.isArray(result.generations) ? result.generations : [];
  const failedProviderAttempts = generations.reduce(
    (total, generation) => total + (Array.isArray(generation?.failedAttempts) ? generation.failedAttempts.length : 0),
    0
  );
  const tokenReport = result.tokenReport || {};
  const status = normalizeStatus(result.executionStatus);
  return storeEvent({
    schemaVersion: 1,
    type: "workflow_run",
    at: new Date().toISOString(),
    traceId: normalizeTraceId(result.traceId || context.traceId),
    endpoint: normalizeEndpoint(context.endpoint),
    route: normalizeRoute(result.workflowShape?.route || (result.mode === "contract-workflow-kit-run" ? "kit" : "unknown")),
    status,
    failureCode: status === "provider_error" || status === "cancelled"
      ? classifyFailure(result.providerError || status)
      : null,
    provider: normalizeProvider(result.provider),
    modelCalls: nonNegativeNumber(result.providerUsage?.modelCalls ?? tokenReport.modelCalls),
    failedProviderAttempts,
    redactions: nonNegativeNumber(result.securityReport?.redactions),
    rawInputTokens: nonNegativeNumber(tokenReport.rawInputTokens),
    optimizedPromptTokens: nonNegativeNumber(tokenReport.optimizedPromptTokens),
    elapsedMs: nonNegativeNumber(result.elapsedMs)
  });
}

function telemetrySummary(options = {}) {
  return summarizeTelemetryEvents(events, {
    scope: "process-local",
    maxEvents: configuration.maxEvents,
    droppedEvents,
    structuredLogging: {
      enabled: configuration.structuredLogging,
      eventKind: "token_optimizer.telemetry"
    },
    includeEvents: options.includeEvents,
    alertPolicy: options.alertPolicy
  });
}

function resetTelemetry() {
  events.length = 0;
  droppedEvents = 0;
}

module.exports = {
  classifyFailure,
  recordProviderAttempt,
  recordWorkflowRun,
  resetTelemetry,
  telemetrySummary
};

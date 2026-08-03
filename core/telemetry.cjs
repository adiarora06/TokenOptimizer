const DEFAULT_MAX_EVENTS = 200;
const MAX_EVENT_LIMIT = 5_000;

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

function increment(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function telemetrySummary(options = {}) {
  const totals = {
    workflowRuns: 0,
    completedRuns: 0,
    promptReadyRuns: 0,
    failedRuns: 0,
    cancelledRuns: 0,
    workflowModelCalls: 0,
    redactions: 0,
    providerAttempts: 0,
    successfulProviderAttempts: 0,
    failedProviderAttempts: 0,
    fallbackPolicyAttempts: 0,
    fallbackRetries: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    pricedProviderAttempts: 0,
    estimatedCostUsd: null,
    providerLatencyMs: 0,
    averageProviderLatencyMs: 0
  };
  const routes = {};
  const providerFailures = {};
  const workflowFailures = {};
  const providers = {};
  let knownCost = 0;

  for (const event of events) {
    if (event.type === "workflow_run") {
      totals.workflowRuns += 1;
      totals.workflowModelCalls += event.modelCalls;
      totals.redactions += event.redactions;
      increment(routes, event.route);
      if (event.status === "completed") totals.completedRuns += 1;
      else if (event.status === "prompt_ready") totals.promptReadyRuns += 1;
      else if (event.status === "cancelled") totals.cancelledRuns += 1;
      else totals.failedRuns += 1;
      if (event.failureCode) increment(workflowFailures, event.failureCode);
      continue;
    }

    totals.providerAttempts += 1;
    totals.providerLatencyMs += event.latencyMs;
    totals.inputTokens += event.inputTokens;
    totals.outputTokens += event.outputTokens;
    totals.totalTokens += event.totalTokens;
    totals.cachedTokens += event.cachedTokens;
    if (event.fallbackPolicy) totals.fallbackPolicyAttempts += 1;
    if (event.fallbackRetry) totals.fallbackRetries += 1;
    if (event.outcome === "success") totals.successfulProviderAttempts += 1;
    else {
      totals.failedProviderAttempts += 1;
      increment(providerFailures, event.failureCode || "unknown");
    }
    if (event.estimatedCostUsd != null) {
      totals.pricedProviderAttempts += 1;
      knownCost += event.estimatedCostUsd;
    }

    const provider = providers[event.provider] || {
      attempts: 0,
      successes: 0,
      failures: 0,
      fallbackRetries: 0,
      totalTokens: 0,
      latencyMs: 0,
      averageLatencyMs: 0
    };
    provider.attempts += 1;
    provider.successes += event.outcome === "success" ? 1 : 0;
    provider.failures += event.outcome === "failure" ? 1 : 0;
    provider.fallbackRetries += event.fallbackRetry ? 1 : 0;
    provider.totalTokens += event.totalTokens;
    provider.latencyMs += event.latencyMs;
    providers[event.provider] = provider;
  }

  totals.estimatedCostUsd = totals.pricedProviderAttempts ? Number(knownCost.toFixed(8)) : null;
  totals.averageProviderLatencyMs = totals.providerAttempts
    ? Math.round(totals.providerLatencyMs / totals.providerAttempts)
    : 0;
  for (const provider of Object.values(providers)) {
    provider.averageLatencyMs = provider.attempts ? Math.round(provider.latencyMs / provider.attempts) : 0;
  }

  const summary = {
    schemaVersion: 1,
    scope: "process-local",
    privacy: "metadata-only",
    retention: {
      maxEvents: configuration.maxEvents,
      retainedEvents: events.length,
      droppedEvents,
      oldestEventAt: events[0]?.at || null,
      newestEventAt: events[events.length - 1]?.at || null
    },
    structuredLogging: {
      enabled: configuration.structuredLogging,
      eventKind: "token_optimizer.telemetry"
    },
    totals,
    routes,
    providers,
    failures: {
      providerAttempts: providerFailures,
      workflows: workflowFailures
    }
  };
  if (options.includeEvents === true) summary.events = events.map((event) => ({ ...event }));
  return summary;
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

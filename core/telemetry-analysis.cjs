const DEFAULT_ALERT_POLICY = Object.freeze({
  minimumProviderAttempts: 10,
  minimumWorkflowRuns: 10,
  providerFailurePercent: { warning: 10, critical: 25 },
  workflowFailurePercent: { warning: 10, critical: 25 },
  fallbackRetryPercent: { warning: 10, critical: 25 },
  p95ProviderLatencyMs: { warning: 10_000, critical: 30_000 },
  estimatedCostUsd: { warning: null, critical: null }
});

const KNOWN_PROVIDERS = new Set(["custom", "groq", "litellm", "offline", "openai", "openrouter", "test", "xai"]);
const KNOWN_ROUTES = new Set(["direct", "contract", "full", "kit", "unknown"]);
const KNOWN_ENDPOINTS = new Set([
  "core",
  "/api/a2a-run",
  "/api/generate",
  "/api/optimize-run",
  "/api/optimize-stream",
  "/api/system-runs",
  "/api/workflow-run"
]);
const KNOWN_STAGES = new Set(["contract", "execute", "generate", "verify", "unknown"]);
const KNOWN_STATUSES = new Set(["cancelled", "completed", "prompt_ready", "provider_error"]);
const KNOWN_QUALITY_STATUSES = new Set(["needs_review", "not_run", "passed", "repaired"]);
const KNOWN_ACCEPTANCE_STATUSES = new Set(["failed", "not_run", "passed"]);
const KNOWN_REPAIR_STATUSES = new Set(["not_run", "not_needed", "partial", "repaired", "unavailable"]);
const KNOWN_FAILURE_CODES = new Set([
  "budget_exhausted",
  "cancelled",
  "configuration",
  "provider_unavailable",
  "rate_limit",
  "response_limit",
  "security_policy",
  "timeout",
  "unknown"
]);

function normalizedEnum(value, allowed, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizedTraceId(value) {
  const traceId = String(value || "");
  return /^trace_[a-z0-9]+_[a-z0-9]+$/i.test(traceId) ? traceId.slice(0, 80) : null;
}

function normalizedTimestamp(value) {
  if (value == null || value === "") return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nonNegativeNumber(value, fallback = 0) {
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, finiteNumber(value, fallback)));
}

function optionalPositiveNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function optionalNonNegativeNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(Number.MAX_SAFE_INTEGER, parsed) : null;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeTelemetryEvent(event) {
  if (!event || Number(event.schemaVersion) !== 1) return null;
  if (event.type === "provider_attempt") {
    const fallbackPolicy = Boolean(event.fallbackPolicy);
    const fallbackAttempt = fallbackPolicy ? boundedInteger(event.fallbackAttempt, 1, 1, 20) : 0;
    return {
      schemaVersion: 1,
      type: "provider_attempt",
      at: normalizedTimestamp(event.at),
      traceId: normalizedTraceId(event.traceId),
      endpoint: normalizedEnum(event.endpoint, KNOWN_ENDPOINTS, "core"),
      stage: normalizedEnum(event.stage, KNOWN_STAGES, "unknown"),
      provider: normalizedEnum(event.provider, KNOWN_PROVIDERS, "custom"),
      outcome: event.outcome === "success" ? "success" : "failure",
      failureCode: event.outcome === "success"
        ? null
        : normalizedEnum(event.failureCode, KNOWN_FAILURE_CODES, "unknown"),
      fallbackPolicy,
      fallbackAttempt,
      fallbackRetry: fallbackPolicy && fallbackAttempt > 1,
      latencyMs: nonNegativeNumber(event.latencyMs),
      inputTokens: nonNegativeNumber(event.inputTokens),
      outputTokens: nonNegativeNumber(event.outputTokens),
      totalTokens: nonNegativeNumber(event.totalTokens),
      cachedTokens: nonNegativeNumber(event.cachedTokens),
      estimatedCostUsd: optionalNonNegativeNumber(event.estimatedCostUsd)
    };
  }
  if (event.type === "workflow_run") {
    const status = normalizedEnum(event.status, KNOWN_STATUSES, "provider_error");
    return {
      schemaVersion: 1,
      type: "workflow_run",
      at: normalizedTimestamp(event.at),
      traceId: normalizedTraceId(event.traceId),
      endpoint: normalizedEnum(event.endpoint, KNOWN_ENDPOINTS, "core"),
      route: normalizedEnum(event.route, KNOWN_ROUTES, "unknown"),
      status,
      qualityStatus: normalizedEnum(event.qualityStatus, KNOWN_QUALITY_STATUSES, "not_run"),
      failureCode: status === "provider_error" || status === "cancelled"
        ? normalizedEnum(event.failureCode, KNOWN_FAILURE_CODES, "unknown")
        : null,
      provider: normalizedEnum(event.provider, KNOWN_PROVIDERS, "custom"),
      modelCalls: nonNegativeNumber(event.modelCalls),
      failedProviderAttempts: nonNegativeNumber(event.failedProviderAttempts),
      redactions: nonNegativeNumber(event.redactions),
      rawInputTokens: nonNegativeNumber(event.rawInputTokens),
      optimizedPromptTokens: nonNegativeNumber(event.optimizedPromptTokens),
      acceptanceStatus: normalizedEnum(event.acceptanceStatus, KNOWN_ACCEPTANCE_STATUSES, "not_run"),
      acceptanceGateCount: nonNegativeNumber(event.acceptanceGateCount),
      acceptanceFailedGates: nonNegativeNumber(event.acceptanceFailedGates),
      repairStatus: normalizedEnum(event.repairStatus, KNOWN_REPAIR_STATUSES, "not_run"),
      repairActionCount: nonNegativeNumber(event.repairActionCount),
      elapsedMs: nonNegativeNumber(event.elapsedMs)
    };
  }
  return null;
}

function thresholdPair(value, fallback, options = {}) {
  const warning = options.optional
    ? optionalPositiveNumber(value?.warning)
    : nonNegativeNumber(value?.warning, fallback.warning);
  const critical = options.optional
    ? optionalPositiveNumber(value?.critical)
    : nonNegativeNumber(value?.critical, fallback.critical);
  if (warning != null && critical != null && critical < warning) {
    return { warning: critical, critical: warning };
  }
  return { warning, critical };
}

function telemetryAlertPolicy(env = process.env, overrides = {}) {
  const fromEnvironment = {
    minimumProviderAttempts: env.TOKEN_OPTIMIZER_ALERT_MIN_PROVIDER_ATTEMPTS,
    minimumWorkflowRuns: env.TOKEN_OPTIMIZER_ALERT_MIN_WORKFLOW_RUNS,
    providerFailurePercent: {
      warning: env.TOKEN_OPTIMIZER_ALERT_PROVIDER_FAILURE_WARNING_PERCENT,
      critical: env.TOKEN_OPTIMIZER_ALERT_PROVIDER_FAILURE_CRITICAL_PERCENT
    },
    workflowFailurePercent: {
      warning: env.TOKEN_OPTIMIZER_ALERT_WORKFLOW_FAILURE_WARNING_PERCENT,
      critical: env.TOKEN_OPTIMIZER_ALERT_WORKFLOW_FAILURE_CRITICAL_PERCENT
    },
    fallbackRetryPercent: {
      warning: env.TOKEN_OPTIMIZER_ALERT_FALLBACK_RETRY_WARNING_PERCENT,
      critical: env.TOKEN_OPTIMIZER_ALERT_FALLBACK_RETRY_CRITICAL_PERCENT
    },
    p95ProviderLatencyMs: {
      warning: env.TOKEN_OPTIMIZER_ALERT_P95_LATENCY_WARNING_MS,
      critical: env.TOKEN_OPTIMIZER_ALERT_P95_LATENCY_CRITICAL_MS
    },
    estimatedCostUsd: {
      warning: env.TOKEN_OPTIMIZER_ALERT_COST_WARNING_USD,
      critical: env.TOKEN_OPTIMIZER_ALERT_COST_CRITICAL_USD
    }
  };
  const merged = {
    ...fromEnvironment,
    ...overrides,
    providerFailurePercent: { ...fromEnvironment.providerFailurePercent, ...overrides.providerFailurePercent },
    workflowFailurePercent: { ...fromEnvironment.workflowFailurePercent, ...overrides.workflowFailurePercent },
    fallbackRetryPercent: { ...fromEnvironment.fallbackRetryPercent, ...overrides.fallbackRetryPercent },
    p95ProviderLatencyMs: { ...fromEnvironment.p95ProviderLatencyMs, ...overrides.p95ProviderLatencyMs },
    estimatedCostUsd: { ...fromEnvironment.estimatedCostUsd, ...overrides.estimatedCostUsd }
  };
  return {
    minimumProviderAttempts: boundedInteger(
      merged.minimumProviderAttempts,
      DEFAULT_ALERT_POLICY.minimumProviderAttempts,
      1,
      100_000
    ),
    minimumWorkflowRuns: boundedInteger(
      merged.minimumWorkflowRuns,
      DEFAULT_ALERT_POLICY.minimumWorkflowRuns,
      1,
      100_000
    ),
    providerFailurePercent: thresholdPair(
      merged.providerFailurePercent,
      DEFAULT_ALERT_POLICY.providerFailurePercent
    ),
    workflowFailurePercent: thresholdPair(
      merged.workflowFailurePercent,
      DEFAULT_ALERT_POLICY.workflowFailurePercent
    ),
    fallbackRetryPercent: thresholdPair(
      merged.fallbackRetryPercent,
      DEFAULT_ALERT_POLICY.fallbackRetryPercent
    ),
    p95ProviderLatencyMs: thresholdPair(
      merged.p95ProviderLatencyMs,
      DEFAULT_ALERT_POLICY.p95ProviderLatencyMs
    ),
    estimatedCostUsd: thresholdPair(
      merged.estimatedCostUsd,
      DEFAULT_ALERT_POLICY.estimatedCostUsd,
      { optional: true }
    )
  };
}

function increment(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function ratePercent(numerator, denominator) {
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function percentile(values, percentileValue) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[index];
}

function alertForMetric({ id, label, value, thresholds, unit, action }) {
  if (thresholds.critical != null && value >= thresholds.critical) {
    return {
      id,
      severity: "critical",
      metric: label,
      observed: value,
      threshold: thresholds.critical,
      unit,
      action
    };
  }
  if (thresholds.warning != null && value >= thresholds.warning) {
    return {
      id,
      severity: "warning",
      metric: label,
      observed: value,
      threshold: thresholds.warning,
      unit,
      action
    };
  }
  return null;
}

function evaluateTelemetryHealth(totals, providerLatencies, policy) {
  const providerSampleSufficient = totals.providerAttempts >= policy.minimumProviderAttempts;
  const workflowSampleSufficient = totals.workflowRuns >= policy.minimumWorkflowRuns;
  const metrics = {
    providerFailurePercent: ratePercent(totals.failedProviderAttempts, totals.providerAttempts),
    workflowFailurePercent: ratePercent(totals.failedRuns, totals.workflowRuns),
    fallbackRetryPercent: ratePercent(totals.fallbackRetries, totals.fallbackChains),
    p95ProviderLatencyMs: percentile(providerLatencies, 0.95),
    estimatedCostUsd: totals.estimatedCostUsd
  };
  const alerts = [];
  if (providerSampleSufficient) {
    alerts.push(alertForMetric({
      id: "provider_failure_rate",
      label: "Provider failure rate",
      value: metrics.providerFailurePercent,
      thresholds: policy.providerFailurePercent,
      unit: "percent",
      action: "Inspect provider and classified-failure breakdowns; fail over or fix configuration before increasing traffic."
    }));
    alerts.push(alertForMetric({
      id: "fallback_retry_rate",
      label: "Fallback retry rate",
      value: metrics.fallbackRetryPercent,
      thresholds: policy.fallbackRetryPercent,
      unit: "percent",
      action: "Inspect the primary provider for rate limits, timeouts, or configuration failures."
    }));
    alerts.push(alertForMetric({
      id: "provider_p95_latency",
      label: "Provider p95 latency",
      value: metrics.p95ProviderLatencyMs,
      thresholds: policy.p95ProviderLatencyMs,
      unit: "milliseconds",
      action: "Compare providers and stages, then reduce timeouts, output limits, or slow workflow routes."
    }));
  }
  if (workflowSampleSufficient) {
    alerts.push(alertForMetric({
      id: "workflow_failure_rate",
      label: "Workflow failure rate",
      value: metrics.workflowFailurePercent,
      thresholds: policy.workflowFailurePercent,
      unit: "percent",
      action: "Inspect workflow failure codes and affected endpoints before promoting another release."
    }));
  }
  if (metrics.estimatedCostUsd != null) {
    alerts.push(alertForMetric({
      id: "estimated_cost",
      label: "Estimated provider cost",
      value: metrics.estimatedCostUsd,
      thresholds: policy.estimatedCostUsd,
      unit: "usd",
      action: "Review route mix, model-call counts, and token totals for unexpected spend."
    }));
  }

  const activeAlerts = alerts.filter(Boolean);
  const status = activeAlerts.some((alert) => alert.severity === "critical")
    ? "critical"
    : activeAlerts.length
      ? "warning"
      : providerSampleSufficient || workflowSampleSufficient
        ? "healthy"
        : "insufficient_data";
  return {
    status,
    sample: {
      providerAttemptsSufficient: providerSampleSufficient,
      workflowRunsSufficient: workflowSampleSufficient
    },
    metrics,
    alerts: activeAlerts,
    policy
  };
}

function summarizeTelemetryEvents(inputEvents = [], options = {}) {
  const events = (Array.isArray(inputEvents) ? inputEvents : []).map(normalizeTelemetryEvent).filter(Boolean);
  const totals = {
    workflowRuns: 0,
    completedRuns: 0,
    promptReadyRuns: 0,
    failedRuns: 0,
    cancelledRuns: 0,
    qualityPassedRuns: 0,
    qualityRepairedRuns: 0,
    qualityNeedsReviewRuns: 0,
    qualityNotRunRuns: 0,
    workflowModelCalls: 0,
    redactions: 0,
    acceptanceEvaluatedRuns: 0,
    acceptancePassedRuns: 0,
    acceptanceFailedRuns: 0,
    acceptanceFailedGates: 0,
    acceptancePassPercent: 0,
    locallyRepairedRuns: 0,
    partiallyRepairedRuns: 0,
    unavailableRepairRuns: 0,
    localRepairActions: 0,
    providerAttempts: 0,
    successfulProviderAttempts: 0,
    failedProviderAttempts: 0,
    fallbackPolicyAttempts: 0,
    fallbackChains: 0,
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
  const providerLatencies = [];
  let knownCost = 0;

  for (const event of events) {
    if (event.type === "workflow_run") {
      totals.workflowRuns += 1;
      totals.workflowModelCalls += nonNegativeNumber(event.modelCalls);
      totals.redactions += nonNegativeNumber(event.redactions);
      if (event.qualityStatus === "passed") totals.qualityPassedRuns += 1;
      else if (event.qualityStatus === "repaired") totals.qualityRepairedRuns += 1;
      else if (event.qualityStatus === "needs_review") totals.qualityNeedsReviewRuns += 1;
      else totals.qualityNotRunRuns += 1;
      if (event.acceptanceStatus !== "not_run") {
        totals.acceptanceEvaluatedRuns += 1;
        totals.acceptanceFailedGates += nonNegativeNumber(event.acceptanceFailedGates);
        if (event.acceptanceStatus === "passed") totals.acceptancePassedRuns += 1;
        else totals.acceptanceFailedRuns += 1;
      }
      totals.localRepairActions += nonNegativeNumber(event.repairActionCount);
      if (event.repairStatus === "repaired") totals.locallyRepairedRuns += 1;
      else if (event.repairStatus === "partial") totals.partiallyRepairedRuns += 1;
      else if (event.repairStatus === "unavailable") totals.unavailableRepairRuns += 1;
      increment(routes, normalizedEnum(event.route, KNOWN_ROUTES, "unknown"));
      if (event.status === "completed") totals.completedRuns += 1;
      else if (event.status === "prompt_ready") totals.promptReadyRuns += 1;
      else if (event.status === "cancelled") totals.cancelledRuns += 1;
      else totals.failedRuns += 1;
      if (event.failureCode) increment(
        workflowFailures,
        normalizedEnum(event.failureCode, KNOWN_FAILURE_CODES, "unknown")
      );
      continue;
    }

    const latencyMs = nonNegativeNumber(event.latencyMs);
    const inputTokens = nonNegativeNumber(event.inputTokens);
    const outputTokens = nonNegativeNumber(event.outputTokens);
    const totalTokens = nonNegativeNumber(event.totalTokens);
    const cachedTokens = nonNegativeNumber(event.cachedTokens);
    totals.providerAttempts += 1;
    totals.providerLatencyMs += latencyMs;
    totals.inputTokens += inputTokens;
    totals.outputTokens += outputTokens;
    totals.totalTokens += totalTokens;
    totals.cachedTokens += cachedTokens;
    providerLatencies.push(latencyMs);
    if (event.fallbackPolicy) totals.fallbackPolicyAttempts += 1;
    if (event.fallbackPolicy && Number(event.fallbackAttempt) === 1) totals.fallbackChains += 1;
    if (event.fallbackRetry) totals.fallbackRetries += 1;
    if (event.outcome === "success") totals.successfulProviderAttempts += 1;
    else {
      totals.failedProviderAttempts += 1;
      increment(providerFailures, normalizedEnum(event.failureCode, KNOWN_FAILURE_CODES, "unknown"));
    }
    if (event.estimatedCostUsd != null && Number.isFinite(Number(event.estimatedCostUsd))) {
      totals.pricedProviderAttempts += 1;
      knownCost += nonNegativeNumber(event.estimatedCostUsd);
    }

    const providerName = normalizedEnum(event.provider, KNOWN_PROVIDERS, "custom");
    const provider = providers[providerName] || {
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
    provider.totalTokens += totalTokens;
    provider.latencyMs += latencyMs;
    providers[providerName] = provider;
  }

  totals.estimatedCostUsd = totals.pricedProviderAttempts ? Number(knownCost.toFixed(8)) : null;
  totals.acceptancePassPercent = ratePercent(totals.acceptancePassedRuns, totals.acceptanceEvaluatedRuns);
  totals.averageProviderLatencyMs = totals.providerAttempts
    ? Math.round(totals.providerLatencyMs / totals.providerAttempts)
    : 0;
  for (const provider of Object.values(providers)) {
    provider.averageLatencyMs = provider.attempts ? Math.round(provider.latencyMs / provider.attempts) : 0;
  }

  const timestamps = events
    .map((event) => new Date(event.at).getTime())
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const policy = telemetryAlertPolicy(process.env, options.alertPolicy || {});
  const summary = {
    schemaVersion: 1,
    scope: options.scope || "process-local",
    privacy: "metadata-only",
    retention: {
      maxEvents: options.maxEvents ?? null,
      retainedEvents: events.length,
      droppedEvents: nonNegativeNumber(options.droppedEvents),
      oldestEventAt: timestamps.length ? new Date(timestamps[0]).toISOString() : null,
      newestEventAt: timestamps.length ? new Date(timestamps.at(-1)).toISOString() : null
    },
    structuredLogging: options.structuredLogging || {
      enabled: false,
      eventKind: "token_optimizer.telemetry"
    },
    totals,
    routes,
    providers,
    failures: {
      providerAttempts: providerFailures,
      workflows: workflowFailures
    },
    health: evaluateTelemetryHealth(totals, providerLatencies, policy)
  };
  if (options.includeEvents === true) summary.events = events.map((event) => ({ ...event }));
  return summary;
}

module.exports = {
  DEFAULT_ALERT_POLICY,
  evaluateTelemetryHealth,
  normalizeTelemetryEvent,
  summarizeTelemetryEvents,
  telemetryAlertPolicy
};

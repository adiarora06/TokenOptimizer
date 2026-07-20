function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || "").length / 4));
}

function createTraceId() {
  return `trace_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeUsage(data = {}) {
  const usage = data.usage || data.x_groq?.usage || {};
  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
  const totalTokens = Number(usage.total_tokens ?? inputTokens + outputTokens) || inputTokens + outputTokens;
  const cachedTokens = Number(
    usage.prompt_tokens_details?.cached_tokens ??
    usage.input_tokens_details?.cached_tokens ??
    usage.cached_tokens ??
    0
  ) || 0;
  const reportedCostUsd = Number(usage.cost ?? data.cost ?? 0) || null;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedTokens,
    reportedCostUsd,
    source: totalTokens > 0 ? "provider" : "unavailable"
  };
}

function modelCost(provider, usage) {
  if (usage.reportedCostUsd != null) return usage.reportedCostUsd;
  const prefix = String(provider || "").toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const inputRate = Number(process.env[`${prefix}_INPUT_COST_PER_MILLION`] || 0);
  const outputRate = Number(process.env[`${prefix}_OUTPUT_COST_PER_MILLION`] || 0);
  if (!inputRate && !outputRate) return null;
  return Number((((usage.inputTokens * inputRate) + (usage.outputTokens * outputRate)) / 1_000_000).toFixed(8));
}

function combineUsage(generations = []) {
  const measured = generations.filter((item) => item?.usage?.source === "provider");
  const totals = measured.reduce((result, item) => {
    result.inputTokens += item.usage.inputTokens || 0;
    result.outputTokens += item.usage.outputTokens || 0;
    result.totalTokens += item.usage.totalTokens || 0;
    result.cachedTokens += item.usage.cachedTokens || 0;
    if (item.usage.estimatedCostUsd != null) result.estimatedCostUsd += item.usage.estimatedCostUsd;
    else result.costComplete = false;
    return result;
  }, {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    estimatedCostUsd: 0,
    costComplete: measured.length > 0
  });

  return {
    ...totals,
    estimatedCostUsd: totals.costComplete ? Number(totals.estimatedCostUsd.toFixed(8)) : null,
    modelCalls: measured.length,
    source: measured.length ? "provider" : "unavailable"
  };
}

function generationRecord(stage, result) {
  return {
    stage,
    provider: result.provider,
    model: result.model,
    finishReason: result.finishReason || null,
    latencyMs: result.latencyMs || 0,
    usage: result.usage || normalizeUsage(),
    failedAttempts: result.attempts || []
  };
}

module.exports = {
  combineUsage,
  createTraceId,
  estimateTokens,
  generationRecord,
  modelCost,
  normalizeUsage
};

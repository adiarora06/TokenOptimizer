const http = require("node:http");
const https = require("node:https");

const { estimateTokens, modelCost, normalizeUsage } = require("./usage.cjs");
const { resolveSafeProviderEndpoint, safeErrorMessage } = require("./security.cjs");
const { recordProviderAttempt } = require("./telemetry.cjs");

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function providerLimits() {
  return {
    maxOutputTokens: boundedNumber(process.env.TOKEN_OPTIMIZER_MAX_OUTPUT_TOKENS, 4_096, 128, 32_768),
    maxResponseBytes: boundedNumber(process.env.TOKEN_OPTIMIZER_MAX_RESPONSE_BYTES, 1_048_576, 16_384, 4_194_304)
  };
}

function createRequestSignal(externalSignal, timeoutMs = 45_000) {
  const controller = new AbortController();
  const abort = () => controller.abort(externalSignal?.reason || new Error("Request cancelled"));
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener?.("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Provider request timed out")), timeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      externalSignal?.removeEventListener?.("abort", abort);
    }
  };
}

function normalizeChatCompletionUrl(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

function pinnedLookup(addresses) {
  if (!addresses?.length) return undefined;
  const ordered = [...addresses].sort((left, right) => left.family - right.family);
  return (_hostname, options, callback) => {
    const requestedFamily = typeof options === "object" ? Number(options.family || 0) : 0;
    const candidates = requestedFamily ? ordered.filter((item) => item.family === requestedFamily) : ordered;
    const selected = candidates[0];
    if (!selected) {
      const error = new Error("Provider endpoint has no validated address for the requested network family");
      error.code = "ENOTFOUND";
      callback(error);
      return;
    }
    if (typeof options === "object" && options.all) callback(null, candidates);
    else callback(null, selected.address, selected.family);
  };
}

function requestProvider({ endpoint, addresses, headers, body, signal, maxResponseBytes }) {
  return new Promise((resolve, reject) => {
    const transport = endpoint.protocol === "https:" ? https : http;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };
    const request = transport.request(endpoint, {
      method: "POST",
      headers: {
        ...headers,
        "content-length": String(Buffer.byteLength(body))
      },
      lookup: pinnedLookup(addresses),
      signal
    }, (response) => {
      const status = Number(response.statusCode || 0);
      if (status >= 300 && status < 400) {
        response.resume();
        finish(new Error("Provider redirects are disabled"));
        return;
      }
      const declaredBytes = Number(response.headers["content-length"] || 0);
      if (declaredBytes > maxResponseBytes) {
        response.resume();
        finish(new Error(`Provider response exceeded the ${maxResponseBytes}-byte limit`));
        return;
      }
      const chunks = [];
      let receivedBytes = 0;
      response.on("data", (chunk) => {
        receivedBytes += chunk.length;
        if (receivedBytes > maxResponseBytes) {
          response.destroy(new Error(`Provider response exceeded the ${maxResponseBytes}-byte limit`));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => finish(null, {
        ok: status >= 200 && status < 300,
        status,
        text: Buffer.concat(chunks).toString("utf8")
      }));
      response.on("error", (error) => finish(error));
    });
    request.on("error", (error) => finish(error));
    request.end(body);
  });
}

function resolveProvider(config = {}) {
  const provider = config.provider || "offline";
  const callerApiKey = String(config.apiKey || "").trim();
  const callerOwnsCredential = Boolean(callerApiKey);
  const callerModel = callerOwnsCredential ? String(config.model || "").trim() : "";
  const callerBaseUrl = callerOwnsCredential ? String(config.baseUrl || "").trim() : "";
  const presets = {
    groq: {
      label: "Groq",
      apiKey: callerApiKey || process.env.GROQ_API_KEY,
      baseUrl: "https://api.groq.com/openai/v1",
      model: callerModel || process.env.GROQ_MODEL || "llama-3.3-70b-versatile"
    },
    openai: {
      label: "OpenAI",
      apiKey: callerApiKey || process.env.OPENAI_API_KEY,
      baseUrl: "https://api.openai.com/v1",
      model: callerModel || process.env.OPENAI_MODEL || "gpt-4.1-mini"
    },
    openrouter: {
      label: "OpenRouter",
      apiKey: callerApiKey || process.env.OPENROUTER_API_KEY,
      baseUrl: "https://openrouter.ai/api/v1",
      model: callerModel || process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini"
    },
    xai: {
      label: "xAI/Grok",
      apiKey: callerApiKey || process.env.XAI_API_KEY,
      baseUrl: "https://api.x.ai/v1",
      model: callerModel || process.env.XAI_MODEL || "grok-4.3"
    },
    litellm: {
      label: "LiteLLM",
      apiKey: callerApiKey || process.env.LITELLM_API_KEY || "",
      baseUrl: callerBaseUrl || process.env.LITELLM_BASE_URL || "http://localhost:4000/v1",
      model: callerModel || process.env.LITELLM_MODEL || "gpt-4.1-mini"
    },
    custom: {
      label: config.label || "Custom OpenAI-compatible",
      apiKey: config.apiKey || "",
      baseUrl: config.baseUrl || "",
      model: config.model || ""
    }
  };

  if (provider === "offline") {
    return {
      provider,
      label: "Local Contract Kit",
      apiKey: "",
      baseUrl: "",
      model: "offline-template"
    };
  }

  const preset = presets[provider] || presets.custom;
  return {
    provider,
    label: preset.label,
    apiKey: preset.apiKey,
    baseUrl: normalizeChatCompletionUrl(preset.baseUrl),
    model: preset.model
  };
}

function testCompletion({ prompt, system, provider }) {
  if (process.env.NODE_ENV !== "test" || process.env.TOKEN_OPTIMIZER_TEST_MODE !== "1") return null;
  if (provider === "groq" && /FALLBACK_SECRET_FIXTURE/.test(prompt)) {
    throw new Error(`Provider echoed ${prompt}`);
  }
  const repairJsonTask = /REPAIR_JSON_FIXTURE/.test(prompt);
  const binarySearchTask = /binary search/i.test(prompt) && /(?:target|find)\s+7/i.test(prompt);
  const content = repairJsonTask
    ? `\`\`\`json
{"status":"closed","owner":"Maya","extra":true}
\`\`\``
    : binarySearchTask
    ? `## Binary Search for 7

The target is found in **3 comparisons** using the inclusive range 0 through 69.

\`\`\`python
def binary_search(values, target):
    low, high = 0, len(values) - 1
    comparisons = 0

    while low <= high:
        mid = (low + high) // 2
        comparisons += 1
        if values[mid] == target:
            return mid, comparisons
        if values[mid] < target:
            low = mid + 1
        else:
            high = mid - 1

    return -1, comparisons

numbers = list(range(70))
index, comparisons = binary_search(numbers, 7)
print(index, comparisons)  # 7 3
\`\`\`

### Search path

\`\`\`text
[0 ........................................................ 69]
                         mid=34  -> 7 < 34
[0 .............. 33]
        mid=16  -> 7 < 16
[0 ....... 15]
   mid=7   -> found
\`\`\``
    : `## Completed result

The request was completed through the test execution route.

- The goal was preserved.
- Required details were included.
- The result is ready to copy, continue, or download.`;
  const inputTokens = estimateTokens(`${system || ""}\n${prompt}`);
  const outputTokens = estimateTokens(content);
  return {
    content,
    provider: "test",
    model: "test-fixture",
    finishReason: "stop",
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cachedTokens: 0,
      reportedCostUsd: 0,
      estimatedCostUsd: 0,
      source: "provider"
    },
    latencyMs: 36
  };
}

// Single provider caller behind every route: named env-configured providers
// (groq, openai) and bring-your-own-endpoint kit providers share the same
// request, timeout, parsing, and usage accounting path.
async function executeModelCall({
  providerConfig = {},
  prompt,
  system,
  signal,
  timeoutMs = 45_000,
  acceptTruncated = false,
  maxOutputTokens
}) {
  const resolved = resolveProvider(providerConfig);
  if (resolved.provider === "offline") {
    throw new Error("Offline provider does not make model calls");
  }
  if (["groq", "openai"].includes(resolved.provider)) {
    const fixture = testCompletion({ prompt, system, provider: resolved.provider });
    if (fixture) return { ...fixture, providerLabel: resolved.label };
  }
  if (!resolved.baseUrl) {
    throw new Error(`${resolved.label} base URL is missing`);
  }
  if (!resolved.model) {
    throw new Error(`${resolved.label} model is missing`);
  }
  if (!resolved.apiKey && resolved.provider !== "litellm") {
    throw new Error(`${resolved.label} API key is not configured`);
  }
  const safeEndpoint = await resolveSafeProviderEndpoint(resolved.baseUrl);
  const limits = providerLimits();
  const outputTokenLimit = boundedNumber(maxOutputTokens, limits.maxOutputTokens, 128, limits.maxOutputTokens);

  const headers = {
    "content-type": "application/json"
  };
  if (resolved.apiKey) {
    headers.authorization = `Bearer ${resolved.apiKey}`;
  }

  const startedAt = Date.now();
  const requestSignal = createRequestSignal(signal, timeoutMs);
  let response;
  try {
    const body = JSON.stringify({
      model: resolved.model,
      messages: [
        {
          role: "system",
          content: system || "You are a precise contract workflow node. Use compact handoffs, preserve intent, and avoid exposing secrets."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.2,
      max_tokens: outputTokenLimit
    });
    response = await requestProvider({
      endpoint: safeEndpoint.endpoint,
      addresses: safeEndpoint.addresses,
      headers,
      body,
      signal: requestSignal.signal,
      maxResponseBytes: limits.maxResponseBytes
    });
  } finally {
    requestSignal.cleanup();
  }

  let data;
  try {
    data = JSON.parse(response.text);
  } catch {
    data = { raw: response.text };
  }

  if (!response.ok) {
    const message = data.error?.message || data.message || `${resolved.label} request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${resolved.label} returned no message content`);
  const finishReason = data.choices?.[0]?.finish_reason || null;
  if (finishReason === "length" && !acceptTruncated) {
    throw new Error(`${resolved.label} response was truncated at the output token limit`);
  }
  const usage = normalizeUsage(data);
  usage.estimatedCostUsd = modelCost(resolved.provider, usage);
  return {
    content,
    provider: resolved.provider,
    providerLabel: resolved.label,
    model: resolved.model,
    finishReason,
    usage,
    latencyMs: Date.now() - startedAt
  };
}

async function callModel(options = {}) {
  const startedAt = Date.now();
  const provider = resolveProvider(options.providerConfig).provider;
  try {
    const result = await executeModelCall(options);
    recordProviderAttempt({
      provider,
      result,
      elapsedMs: Date.now() - startedAt,
      context: options.telemetryContext
    });
    return result;
  } catch (error) {
    recordProviderAttempt({
      provider,
      error,
      elapsedMs: Date.now() - startedAt,
      context: options.telemetryContext
    });
    throw error;
  }
}

async function callChatCompletion({
  provider,
  prompt,
  system,
  signal,
  timeoutMs = 45_000,
  acceptTruncated,
  maxOutputTokens,
  telemetryContext
}) {
  if (!["groq", "openai"].includes(provider)) throw new Error("Unsupported provider route");
  return callModel({
    providerConfig: { provider },
    prompt,
    system: system || "Generate concise, correct outputs. Preserve user intent, avoid secrets, and use as few tokens as practical.",
    signal,
    timeoutMs,
    acceptTruncated,
    maxOutputTokens,
    telemetryContext
  });
}

async function generateWithFallback(prompt, options = {}) {
  const perAttemptMs = options.timeoutMs || 45_000;
  const totalBudgetMs = Math.min(Math.max(perAttemptMs, 5_000), 120_000);
  const deadline = Number(options.deadlineAt) || Date.now() + totalBudgetMs;
  const attempts = [];
  for (const provider of ["groq", "openai"]) {
    if (options.signal?.aborted) {
      attempts.push({ provider, error: "Skipped because the run was cancelled" });
      continue;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs < 1_000) {
      attempts.push({ provider, error: "Skipped because the shared fallback time budget was exhausted" });
      continue;
    }
    try {
      const result = await callChatCompletion({
        provider,
        prompt,
        ...options,
        timeoutMs: Math.min(perAttemptMs, remainingMs),
        telemetryContext: {
          ...options.telemetryContext,
          fallbackPolicy: true,
          fallbackAttempt: attempts.length + 1
        }
      });
      return { ...result, attempts };
    } catch (error) {
      attempts.push({ provider, error: fallbackAttemptMessage(error) });
    }
  }
  const details = attempts.map((attempt) => `${attempt.provider}: ${attempt.error}`).join("; ");
  // A missing key is a setup problem, not an outage: telling the user to retry
  // would send them in circles, so name the real cause.
  const unconfigured = attempts.every((attempt) => /is not configured/i.test(attempt.error));
  const error = new Error(unconfigured
    ? "No model provider is configured. Add GROQ_API_KEY or OPENAI_API_KEY and restart."
    : "Model execution is temporarily unavailable. Please retry in a moment.");
  error.attempts = attempts;
  error.cause = details;
  throw error;
}

function fallbackAttemptMessage(error) {
  const message = safeErrorMessage(error, "Provider request failed");
  const stableMessages = [
    /^(?:Groq|OpenAI) API key is not configured$/,
    /^Provider request timed out$/,
    /^Request cancelled$/,
    /^Provider redirects are disabled$/,
    /^Provider response exceeded the \d+-byte limit$/,
    /^(?:Groq|OpenAI) returned no message content$/,
    /^(?:Groq|OpenAI) response was truncated at the output token limit$/,
    /^Provider endpoint DNS lookup (?:failed|returned no addresses)$/,
    /^Private provider endpoints are disabled in production$/,
    /^Provider endpoints must use HTTPS in production$/
  ];
  if (stableMessages.some((pattern) => pattern.test(message))) return message;
  if (/\b(?:429|rate.?limit)\b/i.test(message)) return "Provider rate limit reached";
  if (/\b(?:timeout|timed out)\b/i.test(message)) return "Provider request timed out";
  return "Provider request failed";
}

async function callWorkflowProvider(selectedProvider, prompt, system, options = {}) {
  if (selectedProvider === "openai") {
    return callChatCompletion({ provider: "openai", prompt, system, ...options });
  }
  if (selectedProvider === "groq") {
    return callChatCompletion({ provider: "groq", prompt, system, ...options });
  }
  return generateWithFallback(prompt, { system, ...options });
}

function providerStatus() {
  const testMode = process.env.NODE_ENV === "test" && process.env.TOKEN_OPTIMIZER_TEST_MODE === "1";
  return {
    groqConfigured: testMode || Boolean(process.env.GROQ_API_KEY),
    openaiConfigured: testMode || Boolean(process.env.OPENAI_API_KEY),
    groqModel: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    openaiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini"
  };
}

module.exports = {
  callChatCompletion,
  callModel,
  callWorkflowProvider,
  createRequestSignal,
  generateWithFallback,
  normalizeChatCompletionUrl,
  providerStatus,
  resolveProvider
};

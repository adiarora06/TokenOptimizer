const { estimateTokens, modelCost, normalizeUsage } = require("./usage.cjs");
const { assertSafeProviderEndpoint } = require("./security.cjs");

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

function resolveProvider(config = {}) {
  const provider = config.provider || "offline";
  const presets = {
    groq: {
      label: "Groq",
      apiKey: config.apiKey || process.env.GROQ_API_KEY,
      baseUrl: "https://api.groq.com/openai/v1",
      model: config.model || process.env.GROQ_MODEL || "llama-3.3-70b-versatile"
    },
    openai: {
      label: "OpenAI",
      apiKey: config.apiKey || process.env.OPENAI_API_KEY,
      baseUrl: "https://api.openai.com/v1",
      model: config.model || process.env.OPENAI_MODEL || "gpt-4.1-mini"
    },
    openrouter: {
      label: "OpenRouter",
      apiKey: config.apiKey || process.env.OPENROUTER_API_KEY,
      baseUrl: "https://openrouter.ai/api/v1",
      model: config.model || process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini"
    },
    xai: {
      label: "xAI/Grok",
      apiKey: config.apiKey || process.env.XAI_API_KEY,
      baseUrl: "https://api.x.ai/v1",
      model: config.model || process.env.XAI_MODEL || "grok-4.3"
    },
    litellm: {
      label: "LiteLLM",
      apiKey: config.apiKey || process.env.LITELLM_API_KEY || "",
      baseUrl: config.baseUrl || process.env.LITELLM_BASE_URL || "http://localhost:4000/v1",
      model: config.model || process.env.LITELLM_MODEL || "gpt-4.1-mini"
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

function testCompletion({ prompt, system }) {
  if (process.env.NODE_ENV !== "test" || process.env.TOKEN_OPTIMIZER_TEST_MODE !== "1") return null;
  const binarySearchTask = /binary search/i.test(prompt) && /(?:target|find)\s+7/i.test(prompt);
  const content = binarySearchTask
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
async function callModel({ providerConfig = {}, prompt, system, signal, timeoutMs = 45_000 }) {
  const resolved = resolveProvider(providerConfig);
  if (resolved.provider === "offline") {
    throw new Error("Offline provider does not make model calls");
  }
  if (["groq", "openai"].includes(resolved.provider)) {
    const fixture = testCompletion({ prompt, system });
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
  assertSafeProviderEndpoint(resolved.baseUrl);

  const headers = {
    "content-type": "application/json"
  };
  if (resolved.apiKey) {
    headers.authorization = `Bearer ${resolved.apiKey}`;
  }

  const startedAt = Date.now();
  const requestSignal = createRequestSignal(signal, timeoutMs);
  let response;
  let text;
  try {
    response = await fetch(resolved.baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
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
        temperature: 0.2
      }),
      signal: requestSignal.signal
    });
    text = await response.text();
  } finally {
    requestSignal.cleanup();
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message = data.error?.message || data.message || `${resolved.label} request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${resolved.label} returned no message content`);
  const usage = normalizeUsage(data);
  usage.estimatedCostUsd = modelCost(resolved.provider, usage);
  return {
    content,
    provider: resolved.provider,
    providerLabel: resolved.label,
    model: resolved.model,
    finishReason: data.choices?.[0]?.finish_reason || null,
    usage,
    latencyMs: Date.now() - startedAt
  };
}

async function callChatCompletion({ provider, prompt, system, signal, timeoutMs = 45_000 }) {
  if (!["groq", "openai"].includes(provider)) throw new Error("Unsupported provider route");
  return callModel({
    providerConfig: { provider },
    prompt,
    system: system || "Generate concise, correct outputs. Preserve user intent, avoid secrets, and use as few tokens as practical.",
    signal,
    timeoutMs
  });
}

async function generateWithFallback(prompt, options = {}) {
  const perAttemptMs = options.timeoutMs || 45_000;
  const totalBudgetMs = Math.min(Math.max(perAttemptMs, 60_000), 120_000);
  const deadline = Date.now() + totalBudgetMs;
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
        timeoutMs: Math.min(perAttemptMs, remainingMs)
      });
      return { ...result, attempts };
    } catch (error) {
      attempts.push({ provider, error: error.message });
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

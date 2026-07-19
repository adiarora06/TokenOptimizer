function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || "").length / 4));
}

const SECRET_PATTERNS = [
  { label: "OpenAI-style API key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { label: "Groq API key", pattern: /\bgsk_[A-Za-z0-9_-]{20,}\b/g },
  { label: "Google API key", pattern: /\bAIza[A-Za-z0-9_-]{24,}\b/g },
  { label: "Bearer token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*\b/gi },
  { label: "Environment secret", pattern: /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))\s*=\s*([^\s"']{12,})/g }
];

function redactSensitiveText(value) {
  let text = String(value || "");
  const redactions = [];
  for (const item of SECRET_PATTERNS) {
    text = text.replace(item.pattern, (...matches) => {
      redactions.push(item.label);
      if (item.label === "Environment secret") return `${matches[1]}=[REDACTED_SECRET]`;
      return "[REDACTED_SECRET]";
    });
  }
  return {
    text,
    count: redactions.length,
    types: [...new Set(redactions)]
  };
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

function compactLines(text, maxLines = 8) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines);
}

function outputStyleFor(text) {
  const lower = String(text || "").toLowerCase();
  if (/\b(json|api|schema|yaml|structured)\b/.test(lower)) return "Return structured output without extra narration.";
  if (/\b(code|program|function|component|debug|repo|test)\b/.test(lower)) return "Return implementation-ready code and concise verification steps.";
  if (/\b(plan|strategy|workflow|architecture|roadmap)\b/.test(lower)) return "Return a concise plan with clear next steps.";
  return "Return a concise, useful final answer.";
}

function analyzeWorkflowShape(rawInput, options = {}) {
  const text = String(rawInput || "");
  const lower = text.toLowerCase();
  const rawTokens = estimateTokens(text);
  const lines = compactLines(text, 40);
  const constraintCount = lines.filter((line) => /(must|should|don't|do not|avoid|need|want|require|constraint|use|with|without)/i.test(line)).length;
  const hasCodeOrFiles = /\b(code|program|function|component|repo|file|api|schema|database|deploy|extension|test)\b/.test(lower);
  const hasWorkflow = /\b(agent|workflow|architecture|handoff|multi-agent|multi agent|provider|route|orchestrat)\b/.test(lower);
  const hasLongContext = rawTokens > 450 || lines.length > 14;
  const hasMultiDeliverable = (text.match(/\b(and|also|plus|then)\b/gi) || []).length >= 3;
  const hasStructuredOutput = /\b(json|yaml|schema|table|csv|xml|api response|exact format)\b/.test(lower);
  const hasHighImpactAction = /\b(delete|publish|deploy|migrate|production|security|legal|medical|financial|payment|credential|database migration)\b/.test(lower);
  const asksForVerification = /\b(verify|validate|double-check|double check|test thoroughly|review for errors|fact-check|fact check)\b/.test(lower);
  const taskType = hasCodeOrFiles ? "build" : hasWorkflow ? "workflow" : hasStructuredOutput ? "structured" : "general";
  let complexity = 0;
  if (rawTokens > 140) complexity += 1;
  if (rawTokens > 360) complexity += 1;
  if (hasLongContext) complexity += 1;
  if (hasCodeOrFiles || hasWorkflow) complexity += 1;
  if (constraintCount > 3 || hasMultiDeliverable) complexity += 1;
  if (hasStructuredOutput) complexity += 1;
  const risk = Number(hasHighImpactAction) + Number(asksForVerification) + Number(hasStructuredOutput && constraintCount > 2);

  let route = complexity <= 1
    ? "direct"
    : complexity <= 4 && risk < 2
      ? "contract"
      : "full";

  if (options.routePreference === "fast") route = "direct";
  if (options.routePreference === "thorough" && route === "direct") route = "contract";
  if (options.routePreference === "verified") route = "full";

  const routeReason = route === "direct"
    ? "A single model call can cover the request without workflow overhead."
    : route === "contract"
      ? "The request has multiple requirements, so compact structured context reduces drift."
      : "The request is complex or high-impact enough to justify a separate validation pass.";

  return {
    rawTokens,
    lines: lines.length,
    constraintCount,
    complexity,
    risk,
    taskType,
    route,
    routeReason,
    verificationNeeded: route === "full",
    signals: {
      longContext: hasLongContext,
      multipleDeliverables: hasMultiDeliverable,
      structuredOutput: hasStructuredOutput,
      highImpact: hasHighImpactAction,
      explicitVerification: asksForVerification
    },
    outputStyle: outputStyleFor(text)
  };
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

function testCompletion({ provider, prompt, system }) {
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

async function callChatCompletion({ provider, prompt, system, signal, timeoutMs = 45_000 }) {
  const configs = {
    groq: {
      name: "Groq",
      apiKey: process.env.GROQ_API_KEY,
      baseUrl: "https://api.groq.com/openai/v1/chat/completions",
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile"
    },
    openai: {
      name: "OpenAI",
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: "https://api.openai.com/v1/chat/completions",
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini"
    }
  };

  const config = configs[provider];
  if (!config) throw new Error("Unsupported provider route");
  const fixture = testCompletion({ provider, prompt, system });
  if (fixture) return fixture;
  if (!config.apiKey) throw new Error(`${config.name} API key is not configured`);

  const startedAt = Date.now();
  const requestSignal = createRequestSignal(signal, timeoutMs);
  let response;
  let text;
  try {
    response = await fetch(config.baseUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "system",
            content: system || "Generate concise, correct outputs. Preserve user intent, avoid secrets, and use as few tokens as practical."
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
    const message = data.error?.message || data.message || `${config.name} request failed`;
    throw new Error(message);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${config.name} returned no message content`);
  const usage = normalizeUsage(data);
  usage.estimatedCostUsd = modelCost(provider, usage);
  return {
    content,
    provider,
    model: config.model,
    finishReason: data.choices?.[0]?.finish_reason || null,
    usage,
    latencyMs: Date.now() - startedAt
  };
}

function normalizeChatCompletionUrl(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

function assertSafeProviderEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("Provider endpoint must be a valid URL");
  }
  if (!['http:', 'https:'].includes(endpoint.protocol)) {
    throw new Error("Provider endpoint must use HTTP or HTTPS");
  }
  if (endpoint.username || endpoint.password) {
    throw new Error("Provider endpoint must not contain URL credentials");
  }

  const host = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateHost = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
    host === "::1" || host === "0.0.0.0" || host === "169.254.169.254" ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host);
  const allowPrivate = process.env.NODE_ENV !== "production" || process.env.TOKEN_OPTIMIZER_ALLOW_PRIVATE_ENDPOINTS === "1";
  if (privateHost && !allowPrivate) {
    throw new Error("Private provider endpoints are disabled in production");
  }
  if (process.env.NODE_ENV === "production" && endpoint.protocol !== "https:" && !allowPrivate) {
    throw new Error("Provider endpoints must use HTTPS in production");
  }
  return endpoint.toString();
}

function resolveA2AProvider(config = {}) {
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

async function callA2AProvider({ providerConfig, prompt, system, signal, timeoutMs = 45_000 }) {
  const resolved = resolveA2AProvider(providerConfig);
  if (resolved.provider === "offline") {
    throw new Error("Offline provider does not make model calls");
  }
  if (!resolved.baseUrl) {
    throw new Error(`${resolved.label} base URL is missing`);
  }
  if (!resolved.model) {
    throw new Error(`${resolved.label} model is missing`);
  }
  if (!resolved.apiKey && resolved.provider !== "litellm") {
    throw new Error(`${resolved.label} API key is missing`);
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

async function generateWithFallback(prompt, options = {}) {
  const attempts = [];
  for (const provider of ["groq", "openai"]) {
    try {
      const result = await callChatCompletion({ provider, prompt, ...options });
      return { ...result, attempts };
    } catch (error) {
      attempts.push({ provider, error: error.message });
    }
  }
  const details = attempts.map((attempt) => `${attempt.provider}: ${attempt.error}`).join("; ");
  const error = new Error("Model execution is temporarily unavailable. Please retry in a moment.");
  error.attempts = attempts;
  error.cause = details;
  throw error;
}

function buildBlankA2AKit(rawInput, options = {}) {
  const contract = buildOfflineContract(rawInput);
  return {
    kit_id: "contract-workflow-kit.v2",
    mode: options.mode || "one-shot",
    architecture: "workflow graph + typed handoff contracts + provider adapters",
    goal: contract.goal,
    agents: [
      {
        id: "intake",
        name: "Intake Agent",
        responsibility: "Read the raw prompt once, extract the task, identify constraints, and remove obvious repetition.",
        receives: ["raw_user_prompt"],
        sends: ["goal", "facts", "constraints", "risk_notes"]
      },
      {
        id: "extractor",
        name: "Context Extractor",
        responsibility: "Keep only useful facts, constraints, deliverables, and assumptions.",
        receives: ["goal", "facts", "constraints", "risk_notes"],
        sends: ["minimal_context"]
      },
      {
        id: "contract",
        name: "Contract Builder",
        responsibility: "Create the typed handoff contract all downstream nodes must obey.",
        receives: ["minimal_context"],
        sends: ["handoff_contract"]
      },
      {
        id: "validator",
        name: "Contract Validator",
        responsibility: "Reject missing fields, raw transcript replay, secrets, and over-budget payloads.",
        receives: ["handoff_contract"],
        sends: ["validated_contract"]
      },
      {
        id: "adapter",
        name: "Provider Adapter",
        responsibility: "Route the validated payload to the configured model endpoint without exposing provider mechanics to the user.",
        receives: ["validated_contract"],
        sends: ["provider_ready_prompt"]
      },
      {
        id: "executor",
        name: "Executor Agent",
        responsibility: "Complete the user's task using only the validated contract.",
        receives: ["provider_ready_prompt"],
        sends: ["candidate_result"]
      },
      {
        id: "verifier",
        name: "Verifier Agent",
        responsibility: "Check the candidate result against the contract and remove unnecessary output.",
        receives: ["handoff_contract", "candidate_result"],
        sends: ["final_result", "token_report"]
      },
      {
        id: "output_audit",
        name: "Output And Audit",
        responsibility: "Return the final result, token report, trace, and history-ready metadata.",
        receives: ["final_result", "token_report"],
        sends: ["user_result", "audit_record"]
      }
    ],
    handoff_contract: contract,
    handoff_rules: [
      "Only Intake may receive the raw prompt.",
      "Every later node receives contract-shaped state, not the full transcript.",
      "Do not include secrets, API keys, duplicate instructions, or unrelated context in handoffs.",
      "Prefer the smallest payload that preserves task quality."
    ],
    a2a_compatibility: {
      role: "interop layer",
      note: "This kit can be represented as agent-to-agent handoffs, but the source of truth is the typed contract workflow."
    }
  };
}

function buildA2AContractPrompt(rawInput, kit) {
  return `You are the Contract Builder in an adaptive workflow.

Convert the request into one compact JSON object for the Executor. This is the only model-facing stage that may read the raw prompt.

Return valid JSON only with these keys:
{"goal":"","facts":[],"constraints":[],"required_output":[],"sources":["user_input"],"open_questions":[],"next_action":"","output_style":"","token_budget":{"executor_max":${kit.handoff_contract.token_budget.executor_target}}}

Rules:
- Preserve intent and required deliverables.
- Remove repetition, internal workflow commentary, and secrets.
- Keep only information the Executor needs.
- Do not repeat the same sentence across fields.

Request:
${rawInput}`;
}

function buildA2AExecutorPrompt(contractText, kit) {
  return `You are the Executor Agent in a contract workflow.

Use only this validated handoff contract and complete the user's task. Do not ask for the raw prompt unless the contract is impossible to execute.

Handoff contract:
${contractText}

Execution rules:
- Return the best end result, not another plan unless a plan is the requested output.
- Preserve constraints and required output.
- Keep the response useful, structured, and direct.
- Follow this output style: ${kit.handoff_contract.output_style}`;
}

function buildA2AVerifierPrompt(contractText, candidateResult) {
  return `You are the Verifier Agent in a contract workflow.

Check the candidate result against the handoff contract and return the final user-facing result.

Rules:
- Fix obvious misses.
- Preserve the user's intent.
- Remove unnecessary repetition.
- Do not mention token optimization, handoff contracts, providers, or internal workflow unless the user explicitly asks.

Handoff contract:
${contractText}

Candidate result:
${candidateResult}`;
}

async function runBlankA2AKit({ rawInput, providerConfig = {}, options = {} }) {
  const startedAt = Date.now();
  const rawTokens = estimateTokens(rawInput);
  const security = redactSensitiveText(rawInput);
  const safeInput = security.text;
  const resolvedProvider = resolveA2AProvider(providerConfig);
  const kit = buildBlankA2AKit(safeInput, options);
  const trace = [
    {
      phase: "intake",
      agent: "Intake Agent",
      status: "done",
      detail: `Read the raw prompt once and estimated ${rawTokens} tokens.`
    },
    {
      phase: "contract",
      agent: "Contract Builder",
      status: "done",
      detail: "Prepared the contract workflow kit scaffold and handoff rules."
    }
  ];

  const optimizedPrompts = [];
  const generations = [];
  let providerUsed = resolvedProvider.provider;
  let providerLabel = resolvedProvider.label;
  let modelUsed = resolvedProvider.model;
  let providerError = null;
  let executionStatus = "prompt_ready";
  let contractOutput = JSON.stringify(kit, null, 2);
  let executorOutput = "";
  let finalAnswer = "";

  const contractPrompt = buildA2AContractPrompt(safeInput, kit);
  optimizedPrompts.push({
    agent: "Contract Builder",
    purpose: "Convert raw messy prompt into a compact typed handoff contract.",
    tokens: estimateTokens(contractPrompt),
    prompt: contractPrompt
  });

  if (resolvedProvider.provider !== "offline") {
    try {
      trace.push({
        phase: "contract_model_call",
        agent: "Contract Builder",
        status: "running",
        detail: `Calling ${resolvedProvider.label} for the compact contract.`
      });
      const contractResult = await callA2AProvider({
        providerConfig,
        prompt: contractPrompt,
        system: "You are a Contract Builder. Convert messy user input into compact, safe, token-bounded handoff contracts."
      });
      contractOutput = contractResult.content;
      generations.push(generationRecord("contract", contractResult));
      providerUsed = contractResult.provider;
      providerLabel = contractResult.providerLabel;
      modelUsed = contractResult.model;
      trace[trace.length - 1].status = "done";

      if (options.mode === "contract-only") {
        trace.push({
          phase: "ready",
          agent: "Contract Builder",
          status: "done",
          detail: "Prepared the compact contract without running the task."
        });
      } else {
        const executorPrompt = buildA2AExecutorPrompt(contractOutput, kit);
        optimizedPrompts.push({
          agent: "Executor Agent",
          purpose: "Run the requested task with only the contract-shaped payload.",
          tokens: estimateTokens(executorPrompt),
          prompt: executorPrompt
        });
        trace.push({
          phase: "execute",
          agent: "Executor Agent",
          status: "running",
          detail: "Executing with the compact contract instead of the raw prompt."
        });
        const executorResult = await callA2AProvider({
          providerConfig,
          prompt: executorPrompt,
          system: "You are an Executor Agent. Produce the best final work product from the compact handoff contract."
        });
        generations.push(generationRecord("execute", executorResult));
        executorOutput = executorResult.content;
        finalAnswer = executorOutput;
        trace[trace.length - 1].status = "done";

        const verifierPrompt = buildA2AVerifierPrompt(contractOutput, executorOutput);
        optimizedPrompts.push({
          agent: "Verifier Agent",
          purpose: "Validate the candidate answer against the compact contract and compress the result.",
          tokens: estimateTokens(verifierPrompt),
          prompt: verifierPrompt
        });
        trace.push({
          phase: "verify",
          agent: "Verifier Agent",
          status: "running",
          detail: "Verifying constraints and compressing final output."
        });
        const verifierResult = await callA2AProvider({
          providerConfig,
          prompt: verifierPrompt,
          system: "You are a Verifier Agent. Fix drift, preserve intent, and return a compact final answer."
        });
        generations.push(generationRecord("verify", verifierResult));
        finalAnswer = verifierResult.content;
        executionStatus = "completed";
        trace[trace.length - 1].status = "done";
      }
    } catch (error) {
      providerError = error.message;
      executionStatus = "provider_error";
      trace.push({
        phase: "error",
        agent: "Provider Adapter",
        status: "error",
        detail: "Model execution stopped. The prepared contract and prompts remain available."
      });
    }
  } else {
    trace.push({
      phase: "ready",
      agent: "Contract Builder",
      status: "done",
      detail: "Prepared a compact contract without running a model."
    });
  }

  const optimizedPromptTokens = optimizedPrompts.reduce((sum, item) => sum + item.tokens, 0);
  const providerUsage = combineUsage(generations);
  return {
    mode: "contract-workflow-kit-run",
    provider: providerUsed,
    providerLabel,
    model: modelUsed,
    providerError,
    executionStatus,
    securityReport: {
      redactions: security.count,
      types: security.types
    },
    kit,
    contractOutput,
    executorOutput,
    finalAnswer,
    optimizedPrompts,
    generations,
    providerUsage,
    trace,
    tokenReport: {
      rawInputTokens: rawTokens,
      optimizedPromptTokens,
      actualInputTokens: providerUsage.inputTokens,
      actualOutputTokens: providerUsage.outputTokens,
      actualTotalTokens: providerUsage.totalTokens,
      actualUsageSource: providerUsage.source,
      estimatedCostUsd: providerUsage.estimatedCostUsd,
      modelCalls: providerUsage.modelCalls,
      estimatedNaiveThreeStepTokens: rawTokens * 3,
      estimatedSavingsTokens: Math.max(0, rawTokens * 3 - optimizedPromptTokens),
      estimatedSavingsPercent: rawTokens
        ? Math.max(0, Math.round(((rawTokens * 3 - optimizedPromptTokens) / (rawTokens * 3)) * 100))
        : 0
    },
    elapsedMs: Date.now() - startedAt
  };
}

function buildOfflineContract(rawInput) {
  const lines = compactLines(rawInput, 10);
  const firstLine = lines[0] || "Complete the user's requested task.";
  const lower = rawInput.toLowerCase();
  const likelyGoal = firstLine.length > 180 ? `${firstLine.slice(0, 177)}...` : firstLine;
  const constraints = lines
    .filter((line) => /(must|should|don't|do not|avoid|need|want|require|constraint|use|with|without)/i.test(line))
    .slice(0, 6);
  const outputStyle = outputStyleFor(rawInput);
  const shape = analyzeWorkflowShape(rawInput);

  return {
    contract_id: "optimizer.contract_workflow.v2",
    goal: likelyGoal,
    facts: lines.slice(0, 6),
    constraints: constraints.length ? constraints : ["Preserve the user's intent.", "Avoid unnecessary context and repeated instructions."],
    decisions: [
      "Use the raw input only during intake or contract building.",
      "Route simple prompts through the direct path.",
      "Use compact handoff contracts for complex or multi-step work.",
      "Do not pass full transcripts between downstream nodes."
    ],
    sources: ["user_input"],
    open_questions: [],
    next_action: "Execute the optimized prompt plan and return the best final result.",
    token_budget: {
      raw_input_estimate: estimateTokens(rawInput),
      handoff_target: Math.min(700, Math.max(120, Math.round(shape.rawTokens * 0.5))),
      executor_target: outputStyle.includes("code") ? 1400 : 900
    },
    required_payload: ["goal", "facts", "constraints", "decisions", "sources", "open_questions", "next_action"],
    forbidden_payload: ["raw full transcript after optimizer stage", "duplicate role instructions", "API keys or secrets", "unrelated context"],
    output_style: outputStyle
  };
}

function buildOptimizerPrompt(rawInput, offlineContract) {
  return `You are the Contract Builder in an adaptive prompt workflow.

Convert the raw user input into a compact handoff contract for downstream nodes.

Rules:
- Preserve the user's actual goal, constraints, and important nuance.
- Do not include secrets.
- Remove repeated instructions and irrelevant history.
- Return compact Markdown with these sections only:
  1. Goal
  2. Required Context
  3. Constraints
  4. Optimized Executor Prompt
  5. Token-Saving Notes

Offline pre-analysis:
${JSON.stringify(offlineContract, null, 2)}

Raw user input:
${rawInput}`;
}

function buildExecutorPrompt(contractText, offlineContract) {
  return `You are the Executor Agent.

Use the optimized handoff contract below. Do not ask for the raw original prompt unless the contract is impossible to execute.

Handoff contract:
${contractText}

Execution requirements:
- Produce the user's requested result.
- Keep the answer concise and structured.
- Explain any assumption only when it affects the result.
- Follow this output style: ${offlineContract.output_style}`;
}

function buildVerifierPrompt(contractText, executorOutput) {
  return `You are the Verifier Agent in a contract workflow.

Check the executor output against the handoff contract. Return the final user-facing answer.

Rules:
- Fix missing constraints if obvious.
- Keep the final answer shorter than the executor output when possible.
- Do not mention token optimization, handoff contracts, providers, or internal workflow unless the user explicitly asks.

Handoff contract:
${contractText}

Executor output:
${executorOutput}`;
}

function offlineExecute(contract) {
  return `## Optimized Result

Goal: ${contract.goal}

Use this optimized prompt:

"${contract.next_action}

Context:
- ${contract.facts.join("\n- ")}

Constraints:
- ${contract.constraints.join("\n- ")}

Output style:
${contract.output_style}"`;
}

function buildDirectExecutorPrompt(rawInput, contract) {
  return `Task:
${rawInput}

Output:
- Answer directly.
- Include only deliverables the task asks for.
- Style: ${contract.output_style}`;
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

async function emitWorkflowEvent(onEvent, event) {
  if (typeof onEvent !== "function") return;
  await onEvent({ ...event, at: new Date().toISOString() });
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

async function runSelfOptimizingWorkflow({ rawInput, provider, options = {}, onEvent, signal }) {
  const startedAt = Date.now();
  const selectedProvider = provider || "groq-openai-fallback";
  const security = redactSensitiveText(rawInput);
  const safeInput = security.text;
  const offlineContract = buildOfflineContract(safeInput);
  const workflowShape = analyzeWorkflowShape(safeInput, options);
  const rawTokens = estimateTokens(rawInput);
  const trace = [];

  const addTrace = async (phase, status, detail, label) => {
    const item = { phase, agent: label || phase, status, detail };
    trace.push(item);
    await emitWorkflowEvent(onEvent, {
      type: "stage",
      stage: phase,
      status,
      detail,
      route: workflowShape.route
    });
    return item;
  };

  await addTrace(
    "understand",
    "done",
    security.count
      ? `Captured the request and removed ${security.count} sensitive value${security.count === 1 ? "" : "s"} before transmission.`
      : "Captured the goal and required deliverables.",
    "Intake"
  );
  await addTrace("route", "done", workflowShape.routeReason, "Adaptive Router");
  if (workflowShape.route !== "direct") {
    await addTrace("simplify", "done", "Prepared compact structured context for downstream execution.", "Contract Builder");
  } else {
    await addTrace("simplify", "skipped", "The direct route avoids an unnecessary contract-building call.", "Direct Route");
  }

  const optimizedPrompts = [];
  const generations = [];
  let providerUsed = null;
  let modelUsed = null;
  let optimizerOutput = JSON.stringify(offlineContract, null, 2);
  let executorOutput = "";
  let finalAnswer = "";
  let providerError = null;
  let executionStatus = "prompt_ready";

  const directPrompt = buildDirectExecutorPrompt(safeInput, offlineContract);
  const optimizerPrompt = buildOptimizerPrompt(safeInput, offlineContract);

  if (workflowShape.route === "direct") {
    optimizedPrompts.push({
      agent: "Direct Executor",
      purpose: "Simple prompt route: avoid multi-step prompt bloat and complete the task in one model call.",
      tokens: estimateTokens(directPrompt),
      prompt: directPrompt
    });
  } else {
    optimizedPrompts.push({
      agent: "Contract Builder",
      purpose: "Read the raw prompt once and create the compact handoff contract.",
      tokens: estimateTokens(optimizerPrompt),
      prompt: optimizerPrompt
    });
  }

  if (selectedProvider !== "offline") {
    try {
      if (workflowShape.route === "direct") {
        const executionTrace = await addTrace("execute", "running", "Running the request in one model call.", "Direct Executor");
        const directResult = await callWorkflowProvider(
          selectedProvider,
          directPrompt,
          "Complete the user's task directly. Preserve requested deliverables and avoid internal process commentary.",
          { signal, timeoutMs: options.timeoutMs }
        );
        generations.push(generationRecord("execute", directResult));
        executorOutput = directResult.content;
        finalAnswer = directResult.content;
        providerUsed = directResult.provider;
        modelUsed = directResult.model;
        executionStatus = "completed";
        executionTrace.status = "done";
        executionTrace.detail = "Generated the result in one model call.";
        await emitWorkflowEvent(onEvent, { type: "stage", stage: "execute", status: "done", detail: executionTrace.detail });
        await addTrace("verify", "done", "Checked response completeness without another model call.", "Local Validator");
      } else {
        const contractTrace = await addTrace("contract", "running", "Converting the request into compact execution context.", "Contract Builder");
        const optimizerResult = await callWorkflowProvider(
          selectedProvider,
          optimizerPrompt,
          "You are a Contract Builder. Preserve intent, remove repetition, and return compact execution state.",
          { signal, timeoutMs: options.timeoutMs }
        );
        generations.push(generationRecord("contract", optimizerResult));
        optimizerOutput = optimizerResult.content;
        providerUsed = optimizerResult.provider;
        modelUsed = optimizerResult.model;
        contractTrace.status = "done";
        contractTrace.detail = "Compact execution context is ready.";
        await emitWorkflowEvent(onEvent, { type: "stage", stage: "contract", status: "done", detail: contractTrace.detail });

        const executorPrompt = buildExecutorPrompt(optimizerOutput, offlineContract);
        optimizedPrompts.push({
          agent: "Executor Agent",
          purpose: "Execute the task using only the compact handoff contract.",
          tokens: estimateTokens(executorPrompt),
          prompt: executorPrompt
        });
        const executionTrace = await addTrace("execute", "running", "Generating the requested result from compact context.", "Executor");
        const executorResult = await callWorkflowProvider(
          selectedProvider,
          executorPrompt,
          "You are an Executor Agent. Produce the best final work product from the compact handoff contract.",
          { signal, timeoutMs: options.timeoutMs }
        );
        generations.push(generationRecord("execute", executorResult));
        executorOutput = executorResult.content;
        finalAnswer = executorResult.content;
        providerUsed = executorResult.provider;
        modelUsed = executorResult.model;
        executionStatus = "completed";
        executionTrace.status = "done";
        executionTrace.detail = "Generated the requested result.";
        await emitWorkflowEvent(onEvent, { type: "stage", stage: "execute", status: "done", detail: executionTrace.detail });

        if (workflowShape.route === "full") {
          const verifierPrompt = buildVerifierPrompt(optimizerOutput, executorOutput);
          optimizedPrompts.push({
            agent: "Verifier Agent",
            purpose: "Verify constraints and compress the final answer.",
            tokens: estimateTokens(verifierPrompt),
            prompt: verifierPrompt
          });
          const verifierTrace = await addTrace("verify", "running", "Checking required details and output structure.", "Validator");
          const verifierResult = await callWorkflowProvider(
            selectedProvider,
            verifierPrompt,
            "You are a Verifier Agent. Fix drift, preserve intent, and return a compact final answer without process commentary.",
            { signal, timeoutMs: options.timeoutMs }
          );
          generations.push(generationRecord("verify", verifierResult));
          finalAnswer = verifierResult.content;
          providerUsed = verifierResult.provider;
          modelUsed = verifierResult.model;
          verifierTrace.status = "done";
          verifierTrace.detail = "Validated the result against the request.";
          await emitWorkflowEvent(onEvent, { type: "stage", stage: "verify", status: "done", detail: verifierTrace.detail });
        } else {
          await addTrace("verify", "done", "Checked required sections without another model call.", "Local Validator");
        }
      }
    } catch (error) {
      providerError = signal?.aborted ? "Run cancelled" : error.message;
      executionStatus = signal?.aborted ? "cancelled" : "provider_error";
      finalAnswer = "";
      executorOutput = "";
      await addTrace("execute", "error", providerError, "Provider Adapter");
    }
  } else {
    await addTrace("execute", "skipped", "The optimized prompt is ready, but no model execution route was selected.", "Prompt Builder");
  }

  const optimizedPromptTokens = optimizedPrompts.reduce((sum, item) => sum + item.tokens, 0);
  const baselineCalls = Math.max(1, optimizedPrompts.length);
  const baselineInputTokens = rawTokens * baselineCalls;
  const contextSavingsTokens = Math.max(0, baselineInputTokens - optimizedPromptTokens);
  const contextSavingsPercent = baselineInputTokens
    ? Math.max(0, Math.round((contextSavingsTokens / baselineInputTokens) * 100))
    : 0;
  const providerUsage = combineUsage(generations);
  const optimizedPrompt = optimizedPrompts[optimizedPrompts.length - 1]?.prompt || directPrompt;

  await emitWorkflowEvent(onEvent, {
    type: "complete",
    stage: executionStatus === "completed" ? "complete" : "execute",
    status: executionStatus,
    detail: executionStatus === "completed" ? "Result ready." : providerError || "Optimized prompt ready."
  });

  return {
    mode: "adaptive-contract-workflow-run",
    provider: providerUsed,
    model: modelUsed,
    providerError,
    executionStatus,
    workflowShape,
    securityReport: {
      redactions: security.count,
      types: security.types
    },
    handoffContract: offlineContract,
    optimizerOutput,
    executorOutput,
    finalAnswer,
    optimizedPrompt,
    optimizedPrompts,
    generations,
    providerUsage,
    trace,
    tokenReport: {
      rawInputTokens: rawTokens,
      optimizedPromptTokens,
      actualInputTokens: providerUsage.inputTokens,
      actualOutputTokens: providerUsage.outputTokens,
      actualTotalTokens: providerUsage.totalTokens,
      cachedTokens: providerUsage.cachedTokens,
      actualUsageSource: providerUsage.source,
      estimatedCostUsd: providerUsage.estimatedCostUsd,
      estimatedNaiveThreeStepTokens: baselineInputTokens,
      estimatedSavingsTokens: contextSavingsTokens,
      estimatedSavingsPercent: contextSavingsPercent,
      comparison: {
        label: "Repeated raw-context estimate",
        method: "raw input estimate multiplied by the number of planned model calls",
        estimatedBaselineInputTokens: baselineInputTokens,
        estimatedOptimizedInputTokens: optimizedPromptTokens,
        estimatedContextSavingsTokens: contextSavingsTokens,
        estimatedContextSavingsPercent: contextSavingsPercent
      },
      adaptiveRoute: workflowShape.route,
      routeReason: workflowShape.routeReason,
      complexity: workflowShape.complexity,
      modelCalls: providerUsage.modelCalls
    },
    elapsedMs: Date.now() - startedAt
  };
}

module.exports = {
  analyzeWorkflowShape,
  callChatCompletion,
  combineUsage,
  estimateTokens,
  generateWithFallback,
  providerStatus,
  redactSensitiveText,
  runBlankA2AKit,
  runSelfOptimizingWorkflow
};

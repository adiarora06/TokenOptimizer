const { estimateTokens } = require("./usage.cjs");
const { redactSensitiveText } = require("./security.cjs");
const { analyzeWorkflowShape, buildOfflineContract } = require("./routing.cjs");
const {
  cleanPromptText,
  compactLines,
  dedupeNaturalLanguageLines,
  promptSection,
  stripListPrefix,
  withoutTrailingEllipsis
} = require("./text.cjs");

function isPreparedWrapper(value) {
  const text = String(value || "").trim();
  const lines = compactLines(text, 80).map(stripListPrefix);
  return /^Complete this task directly/i.test(text) ||
    lines.some((line) => /^(Task|Important context|Requirements|Output):$/i.test(line)) ||
    /token optimization|handoff contracts|internal agent workflow/i.test(text);
}

function isLikelyOriginalTask(line) {
  const cleaned = cleanPromptText(stripListPrefix(line));
  if (!cleaned || cleaned.length < 28) return false;
  if (/^(Task|Important context|Requirements|Output):?$/i.test(cleaned)) return false;
  if (/^(Complete this task directly|Return the answer directly|Include code|Do not mention|If one small assumption)/i.test(cleaned)) return false;
  if (/^(Style:|user_input|source|sources)$/i.test(cleaned)) return false;
  return /\b(create|write|build|make|run|find|tell|display|generate|explain|implement|program|diagram|array|target|analyze|review|fix)\b/i.test(cleaned);
}

function originalTaskScore(value) {
  const cleaned = cleanPromptText(stripListPrefix(value));
  let score = cleaned.length;
  if (/^I want you to|^Please|^Create|^Write|^Build/i.test(cleaned)) score += 80;
  if (/[.!?)]$/.test(cleaned)) score += 20;
  if (/\.\.\.$/.test(String(value || "").trim())) score -= 180;
  if (/\b(range|array|target|diagram|program|binary search)\b/i.test(cleaned)) score += 35;
  if (/token optimization|handoff|internal workflow/i.test(cleaned)) score -= 300;
  return score;
}

function unwrapPreparedPrompt(value) {
  const raw = String(value || "").trim();
  if (!raw || !isPreparedWrapper(raw)) return raw;

  const candidates = [];
  const task = promptSection(raw, "Task", ["Important context", "Requirements", "Output"]);
  if (task && !/^Complete this task directly/i.test(task)) candidates.push(task);
  for (const line of compactLines(raw, 100).map(stripListPrefix)) {
    if (isLikelyOriginalTask(line)) candidates.push(line);
  }

  return candidates
    .map((candidate) => cleanPromptText(withoutTrailingEllipsis(candidate)))
    .filter(Boolean)
    .sort((a, b) => originalTaskScore(b) - originalTaskScore(a))[0] || raw;
}

function cleanDirectRequest(value) {
  return cleanPromptText(value)
    .replace(/^i want you to\s+/i, "Please ")
    .replace(/^i need you to\s+/i, "Please ")
    .replace(/^i want\s+/i, "Please ");
}

function buildPortablePrompt(safeInput, contract, workflowShape) {
  const deduped = dedupeNaturalLanguageLines(safeInput);
  const cleaned = deduped.includes("\n") ? deduped : cleanDirectRequest(deduped);
  if (workflowShape.route === "direct" || estimateTokens(cleaned) <= 220) return cleaned;

  const lines = compactLines(cleaned, 120);
  const goal = lines[0] || contract.goal;
  const details = lines.slice(1).filter((line) => cleanPromptText(line).toLowerCase() !== cleanPromptText(goal).toLowerCase());
  const structured = [
    "Task:",
    goal,
    details.length ? "" : null,
    details.length ? "Requirements and context:" : null,
    ...details.map((line) => `- ${stripListPrefix(line)}`),
    "",
    `Response: ${contract.output_style}`
  ].filter((line) => line != null).join("\n");

  return estimateTokens(structured) < estimateTokens(cleaned) ? structured : cleaned;
}

function preparePortableHandoff({ rawInput, options = {}, target = "ai-assistant" }) {
  const original = String(rawInput || "").trim();
  const unwrapped = unwrapPreparedPrompt(original);
  const security = redactSensitiveText(unwrapped);
  const safeInput = security.text;
  const workflowShape = analyzeWorkflowShape(safeInput, options);
  const handoffContract = buildOfflineContract(safeInput);
  const optimizedPrompt = buildPortablePrompt(safeInput, handoffContract, workflowShape);
  const rawInputTokens = estimateTokens(original);
  const optimizedPromptTokens = estimateTokens(optimizedPrompt);
  // Signed: negative when framing a short prompt costs more than the raw text.
  const deltaTokens = rawInputTokens - optimizedPromptTokens;
  const deltaPercent = rawInputTokens ? Math.round((deltaTokens / rawInputTokens) * 100) : 0;
  const estimatedSavingsTokens = Math.max(0, deltaTokens);
  const estimatedSavingsPercent = Math.max(0, deltaPercent);
  const wrapperRemoved = unwrapped !== original;
  const strategy = wrapperRemoved
    ? "recursive-wrapper-cleanup"
    : optimizedPromptTokens < estimateTokens(safeInput)
      ? "local-deduplication"
      : "pass-through";

  return {
    mode: "portable-handoff-preparation",
    executionStatus: "prompt_ready",
    target,
    strategy,
    workflowShape,
    handoffContract,
    optimizedPrompt,
    provider: null,
    model: null,
    providerUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      estimatedCostUsd: 0,
      modelCalls: 0,
      source: "local"
    },
    securityReport: {
      redactions: security.count,
      types: security.types
    },
    trace: [
      { phase: "understand", agent: "Intake", status: "done", detail: "Captured the requested outcome and deliverables." },
      { phase: "route", agent: "Adaptive Router", status: "done", detail: workflowShape.routeReason },
      { phase: "prepare", agent: "Local Handoff Builder", status: "done", detail: "Prepared a portable prompt without calling a model." }
    ],
    tokenReport: {
      rawInputTokens,
      optimizedPromptTokens,
      estimatedSavingsTokens,
      estimatedSavingsPercent,
      estimatedContextDeltaTokens: deltaTokens,
      estimatedContextDeltaPercent: deltaPercent,
      addsFramingOverhead: deltaTokens < 0,
      adaptiveRoute: workflowShape.route,
      routeReason: workflowShape.routeReason,
      modelCalls: 0,
      actualInputTokens: 0,
      actualOutputTokens: 0,
      actualTotalTokens: 0,
      actualUsageSource: "local"
    }
  };
}

module.exports = {
  buildPortablePrompt,
  cleanDirectRequest,
  isPreparedWrapper,
  preparePortableHandoff,
  unwrapPreparedPrompt
};

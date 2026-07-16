self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type !== "preflight") return;

  const prompt = String(message.prompt || "");
  const analysis = analyzePrompt(prompt, {
    mode: message.mode || "primary",
    wrapperTarget: message.wrapperTarget || "browser"
  });

  self.postMessage({
    type: "preflight-result",
    requestId: message.requestId,
    analysis
  });
};

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || "").length / 4));
}

function lines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function uniqueLines(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = item.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function outputStyle(prompt) {
  const lower = prompt.toLowerCase();
  if (/\b(json|api|schema)\b/.test(lower)) return "structured";
  if (/\b(code|program|function|component|debug|repo)\b/.test(lower)) return "code";
  if (/\b(plan|strategy|workflow|architecture)\b/.test(lower)) return "plan";
  return "answer";
}

function complexityScore(prompt, rawTokens, itemCount) {
  const lower = prompt.toLowerCase();
  let score = rawTokens > 700 ? 3 : rawTokens > 300 ? 2 : rawTokens > 120 ? 1 : 0;
  if (/(file|api|database|deploy|extension|agent|workflow|architecture)/.test(lower)) score += 1;
  if (itemCount > 8) score += 1;
  if (((prompt.match(/\b(and|also|plus|then)\b/gi) || []).length) >= 3) score += 1;
  return Math.min(score, 4);
}

function analyzePrompt(prompt, options) {
  const compact = prompt.replace(/\s+/g, " ").trim();
  const parts = lines(prompt);
  const unique = uniqueLines(parts);
  const rawTokens = estimateTokens(prompt);
  const duplicateLines = Math.max(0, parts.length - unique.length);
  const constraints = unique
    .filter((line) => /(must|should|need|want|avoid|do not|don't|use|without|with|require|constraint)/i.test(line))
    .slice(0, 6);
  const style = outputStyle(prompt);
  const complexity = complexityScore(prompt, rawTokens, unique.length);
  const workflowRoute = complexity <= 1
    ? "direct"
    : complexity <= 3
      ? "contract"
      : "full";
  const recommendedRoute = workflowRoute === "direct" ? "compact-direct" : "system-runner";
  const contract = {
    contract_id: "optimizer.preflight.v1",
    mode: options.mode,
    wrapper_target: options.wrapperTarget,
    goal: compact ? compact.slice(0, 180) : "Waiting for a prompt.",
    facts: unique.slice(0, 6),
    constraints,
    next_action: style === "code"
      ? "Return implementation-ready output and concise verification steps."
      : style === "structured"
        ? "Return structured output and avoid extra narration."
        : "Return the final answer directly and concisely.",
    token_budget: {
      raw_input_estimate: rawTokens,
      handoff_target: Math.min(700, Math.max(180, Math.round(rawTokens * 0.45))),
      final_target: style === "code" ? 1400 : 900
    }
  };

  return {
    ready: Boolean(compact),
    rawTokens,
    duplicateLines,
    constraintsFound: constraints.length,
    outputStyle: style,
    complexity,
    workflowRoute,
    recommendedRoute,
    estimatedContractTokens: estimateTokens(JSON.stringify(contract)),
    estimatedSavingsPercent: rawTokens ? Math.max(0, Math.min(82, Math.round((1 - estimateTokens(JSON.stringify(contract)) / Math.max(rawTokens * 2, 1)) * 100))) : 0,
    contract,
    activity: [
      compact ? "Prompt captured in background preflight." : "Waiting for prompt input.",
      `${rawTokens} estimated raw tokens.`,
      `${constraints.length} constraints detected.`,
      workflowRoute === "direct"
        ? "Use direct one-call route."
        : workflowRoute === "contract"
          ? "Use contract route with compact execution."
          : "Use full route with verification."
    ]
  };
}

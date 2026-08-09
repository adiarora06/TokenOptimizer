(function initializePromptCompiler(root, factory) {
  "use strict";

  const compiler = factory();
  if (typeof module === "object" && module.exports) module.exports = compiler;
  if (root) root.TokenOptimizerCompiler = compiler;
})(typeof globalThis !== "undefined" ? globalThis : this, function createPromptCompiler() {
  "use strict";

  const COMPILER_VERSION = "1.0.0";
  const TOKEN_ESTIMATOR = Object.freeze({
    id: "characters-divided-by-four",
    version: "1",
    charactersPerToken: 4
  });
  const ROUTE_MODEL_CALLS = Object.freeze({ direct: 1, contract: 2, full: 3 });

  function estimateTokens(text) {
    const value = String(text || "");
    return value ? Math.ceil(value.length / TOKEN_ESTIMATOR.charactersPerToken) : 0;
  }

  function compactLines(text, maxLines = 40) {
    return String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, maxLines);
  }

  function uniqueLines(lines) {
    const seen = new Set();
    return lines.filter((line) => {
      const key = line.replace(/\s+/g, " ").trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function outputKindFor(text) {
    const lower = String(text || "").toLowerCase();
    if (/\b(json|api|schema|yaml|structured)\b/.test(lower)) return "structured";
    if (/\b(code|program|function|component|debug|repo|test)\b/.test(lower)) return "code";
    if (/\b(plan|strategy|workflow|architecture|roadmap)\b/.test(lower)) return "plan";
    return "answer";
  }

  function outputStyleFor(text) {
    const kind = outputKindFor(text);
    if (kind === "structured") return "Return structured output without extra narration.";
    if (kind === "code") return "Return implementation-ready code and concise verification steps.";
    if (kind === "plan") return "Return a concise plan with clear next steps.";
    return "Return a concise, useful final answer.";
  }

  function analyzeWorkflowShape(rawInput, options = {}) {
    const text = String(rawInput || "");
    const lower = text.toLowerCase();
    const rawTokens = estimateTokens(text);
    const lines = compactLines(text);
    const constraintPattern = /\b(must|should|don't|do not|avoid|need|want|require|constraint|use|with|without|accept|add|check|define|explain|identify|include|keep|preserve|provide|return|set|support|treat|verify)\b/i;
    const constraints = uniqueLines(lines.filter((line) => constraintPattern.test(line)));
    const constraintCount = constraints.length;
    const hasCodeOrFiles = /\b(code|program|function|component|repo|file|api|schema|database|deploy|extension|test)\b/.test(lower);
    const hasWorkflow = /\b(agent|workflow|architecture|handoff|multi-agent|multi agent|provider|route|orchestrat)\b/.test(lower);
    const hasLongContext = rawTokens > 450 || lines.length > 14;
    const hasMultiDeliverable = (text.match(/\b(and|also|plus|then)\b/gi) || []).length >= 3;
    const hasStructuredOutput = /\b(json|yaml|schema|table|csv|xml|api response|exact format)\b/.test(lower);
    const destructiveText = lower.replace(/\bdelete\s+\/[^\s,;]*/g, "");
    const hasDestructiveAction = /\b(?:delete|drop|truncate|destroy|erase)\b/.test(destructiveText);
    const hasHighImpactAction = hasDestructiveAction || /\b(publish|deploy|migrate|production|security|legal|medical|financial|payment|credential|database migration)\b/.test(lower);
    const asksForVerification = /\b(verify|validate|double-check|double check|test thoroughly|review for errors|fact-check|fact check)\b/.test(lower);
    const taskType = hasCodeOrFiles ? "build" : hasWorkflow ? "workflow" : hasStructuredOutput ? "structured" : "general";

    let complexity = 0;
    if (rawTokens > 140) complexity += 1;
    if (rawTokens > 360) complexity += 1;
    if (hasLongContext) complexity += 1;
    if (hasCodeOrFiles || hasWorkflow) complexity += 1;
    if (constraintCount >= 3 || hasMultiDeliverable) complexity += 1;
    if (hasStructuredOutput) complexity += 1;

    const risk = Number(hasHighImpactAction) + Number(asksForVerification) + Number(hasStructuredOutput && constraintCount >= 3);
    let route = complexity <= 1
      ? "direct"
      : complexity <= 4 && risk < 2
        ? "contract"
        : "full";

    const routePreference = options.routePreference || "auto";
    if (routePreference === "fast") route = "direct";
    if (routePreference === "thorough" && route === "direct") route = "contract";
    if (routePreference === "verified") route = "full";

    const routeReason = route === "direct"
      ? "A single model call can cover the request without workflow overhead."
      : route === "contract"
        ? "The request has multiple requirements, so compact structured context reduces drift."
        : "The request is complex or high-impact enough to justify a separate validation pass.";

    const signals = {
      codeOrFiles: hasCodeOrFiles,
      workflow: hasWorkflow,
      longContext: hasLongContext,
      multipleDeliverables: hasMultiDeliverable,
      structuredOutput: hasStructuredOutput,
      highImpact: hasHighImpactAction,
      explicitVerification: asksForVerification
    };
    const outputStyle = outputStyleFor(text);
    const plannedModelCalls = ROUTE_MODEL_CALLS[route];

    return {
      compilerVersion: COMPILER_VERSION,
      policyVersion: `routing-${COMPILER_VERSION}`,
      tokenEstimator: TOKEN_ESTIMATOR,
      rawTokens,
      lines: lines.length,
      constraintCount,
      constraints: constraints.slice(0, 8),
      complexity,
      risk,
      taskType,
      routePreference,
      route,
      routeReason,
      plannedModelCalls,
      verificationNeeded: route === "full",
      signals,
      activeSignals: Object.keys(signals).filter((name) => signals[name]),
      outputKind: outputKindFor(text),
      outputStyle,
      tokenBudget: {
        rawInputEstimate: rawTokens,
        handoffTarget: Math.min(700, Math.max(120, Math.round(rawTokens * 0.5))),
        executorTarget: outputStyle.includes("code") ? 1400 : 900,
        plannedModelCalls
      }
    };
  }

  function compilePrompt(rawInput, options = {}) {
    const text = String(rawInput || "");
    const lines = compactLines(text, 120);
    const unique = uniqueLines(lines);
    const workflowShape = analyzeWorkflowShape(text, options);
    const contract = {
      contract_id: "optimizer.preflight.v2",
      compiler_version: COMPILER_VERSION,
      mode: options.mode || "primary",
      wrapper_target: options.wrapperTarget || "browser",
      goal: text.trim().replace(/\s+/g, " ").slice(0, 180) || "Waiting for a prompt.",
      facts: unique.slice(0, 6),
      constraints: workflowShape.constraints.slice(0, 6),
      next_action: workflowShape.outputStyle,
      token_budget: {
        raw_input_estimate: workflowShape.tokenBudget.rawInputEstimate,
        handoff_target: workflowShape.tokenBudget.handoffTarget,
        executor_target: workflowShape.tokenBudget.executorTarget,
        planned_model_calls: workflowShape.plannedModelCalls
      }
    };
    const estimatedContractTokens = estimateTokens(JSON.stringify(contract));
    const repeatedRawEstimate = workflowShape.rawTokens * workflowShape.plannedModelCalls;
    const estimatedSavingsPercent = repeatedRawEstimate
      ? Math.max(0, Math.min(82, Math.round((1 - estimatedContractTokens / repeatedRawEstimate) * 100)))
      : 0;

    return {
      ready: Boolean(text.trim()),
      compilerVersion: COMPILER_VERSION,
      rawTokens: workflowShape.rawTokens,
      duplicateLines: Math.max(0, lines.length - unique.length),
      constraintsFound: workflowShape.constraintCount,
      outputStyle: workflowShape.outputKind,
      complexity: workflowShape.complexity,
      risk: workflowShape.risk,
      workflowRoute: workflowShape.route,
      recommendedRoute: workflowShape.route === "direct" ? "compact-direct" : "system-runner",
      plannedModelCalls: workflowShape.plannedModelCalls,
      estimatedContractTokens,
      estimatedSavingsPercent,
      workflowShape,
      contract,
      activity: [
        text.trim() ? "Prompt compiled in local preflight." : "Waiting for prompt input.",
        `${workflowShape.rawTokens} estimated raw tokens.`,
        `${workflowShape.constraintCount} constraints detected.`,
        `${workflowShape.route} route selected with ${workflowShape.plannedModelCalls} planned model call${workflowShape.plannedModelCalls === 1 ? "" : "s"}.`
      ]
    };
  }

  return Object.freeze({
    COMPILER_VERSION,
    TOKEN_ESTIMATOR,
    analyzeWorkflowShape,
    compilePrompt,
    estimateTokens,
    outputKindFor,
    outputStyleFor
  });
});

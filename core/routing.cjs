const { estimateTokens } = require("./usage.cjs");
const { compactLines } = require("./text.cjs");

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

function buildOfflineContract(rawInput) {
  const lines = compactLines(rawInput, 10);
  const firstLine = lines[0] || "Complete the user's requested task.";
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

module.exports = {
  analyzeWorkflowShape,
  buildOfflineContract,
  outputStyleFor
};

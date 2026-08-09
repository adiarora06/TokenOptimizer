const { estimateTokens } = require("./usage.cjs");
const { compactLines } = require("./text.cjs");
const {
  analyzeWorkflowShape,
  outputStyleFor
} = require("../shared/prompt-compiler.js");

function compactContractLine(value, maxLength = 600) {
  const parts = String(value || "").split(/(?<=[.!?])\s+/);
  const seen = new Set();
  const compact = parts.filter((part) => {
    const key = part.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(" ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildOfflineContract(rawInput) {
  const lines = compactLines(rawInput, 10).map((line) => compactContractLine(line));
  const firstLine = lines[0] || "Complete the user's requested task.";
  const likelyGoal = firstLine.length > 180 ? `${firstLine.slice(0, 177)}...` : firstLine;
  const constraints = lines
    .filter((line) => /(must|should|don't|do not|avoid|need|want|require|constraint|use|with|without)/i.test(line))
    .slice(0, 6)
    .map((line) => compactContractLine(line, 400));
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

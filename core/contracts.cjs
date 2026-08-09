const { z } = require("zod");

const { redactSensitiveText } = require("./security.cjs");

const compactString = (max) => z.string().trim().min(1).max(max);
const compactList = (maxItems = 16, maxLength = 1_000) => z.array(compactString(maxLength)).max(maxItems);

const handoffContractSchema = z.object({
  goal: compactString(1_000),
  facts: compactList().default([]),
  constraints: compactList().default([]),
  decisions: compactList().default([]),
  required_output: compactList().default([]),
  sources: compactList(12, 300).default(["user_input"]),
  open_questions: compactList(12, 1_000).default([]),
  next_action: compactString(1_000),
  output_style: compactString(500).default("Return a concise, useful final answer."),
  token_budget: z.object({
    raw_input_estimate: z.number().int().nonnegative().max(10_000_000).optional(),
    handoff_target: z.number().int().positive().max(100_000).optional(),
    executor_target: z.number().int().positive().max(100_000).optional(),
    executor_max: z.number().int().positive().max(100_000).optional()
  }).default({})
});

function parseJsonObject(value) {
  const raw = String(value || "").trim();
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const text = fenced ? fenced[1].trim() : raw;
  const candidates = [text];
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the next bounded JSON candidate.
    }
  }
  throw new Error("Contract output was not valid JSON");
}

function canonicalContract(parsed, fallback) {
  const providerBudget = parsed.token_budget || {};
  const fallbackBudget = fallback.token_budget || {};
  return {
    contract_id: fallback.contract_id || "optimizer.contract_workflow.v2",
    goal: parsed.goal,
    facts: parsed.facts.length ? parsed.facts : fallback.facts,
    constraints: parsed.constraints.length ? parsed.constraints : fallback.constraints,
    decisions: parsed.decisions.length ? parsed.decisions : fallback.decisions,
    required_output: parsed.required_output,
    sources: parsed.sources.length ? parsed.sources : fallback.sources,
    open_questions: parsed.open_questions,
    next_action: parsed.next_action,
    token_budget: {
      raw_input_estimate: fallbackBudget.raw_input_estimate,
      handoff_target: providerBudget.handoff_target || fallbackBudget.handoff_target,
      executor_target: providerBudget.executor_max || providerBudget.executor_target || fallbackBudget.executor_target
    },
    required_payload: fallback.required_payload,
    forbidden_payload: fallback.forbidden_payload,
    output_style: parsed.output_style
  };
}

function validateHandoffContract(value, fallback, options = {}) {
  const issues = [];
  if (options.finishReason === "length") {
    issues.push("Contract response was truncated at the output token limit");
  } else {
    try {
      const redacted = redactSensitiveText(value);
      const result = handoffContractSchema.safeParse(parseJsonObject(redacted.text));
      if (result.success) {
        const contract = canonicalContract(result.data, fallback);
        return {
          contract,
          output: JSON.stringify(contract, null, 2),
          source: "provider",
          issues: redacted.count ? [`Removed ${redacted.count} sensitive value${redacted.count === 1 ? "" : "s"} from the provider contract`] : []
        };
      }
      issues.push(...result.error.issues.slice(0, 8).map((issue) => {
        const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
        return `${path}${issue.message}`;
      }));
    } catch (error) {
      issues.push(error.message);
    }
  }

  return {
    contract: fallback,
    output: JSON.stringify(fallback, null, 2),
    source: "local_fallback",
    issues
  };
}

module.exports = {
  handoffContractSchema,
  parseJsonObject,
  validateHandoffContract
};

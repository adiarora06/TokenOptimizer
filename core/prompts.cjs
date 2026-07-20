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

function buildDirectExecutorPrompt(rawInput, contract) {
  return `Task:
${rawInput}

Output:
- Answer directly.
- Include only deliverables the task asks for.
- Style: ${contract.output_style}`;
}

module.exports = {
  buildA2AContractPrompt,
  buildA2AExecutorPrompt,
  buildA2AVerifierPrompt,
  buildDirectExecutorPrompt,
  buildExecutorPrompt,
  buildOptimizerPrompt,
  buildVerifierPrompt
};

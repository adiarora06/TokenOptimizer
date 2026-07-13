function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || "").length / 4));
}

function compactLines(text, maxLines = 8) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines);
}

function providerStatus() {
  return {
    groqConfigured: Boolean(process.env.GROQ_API_KEY),
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    groqModel: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    openaiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini"
  };
}

async function callChatCompletion({ provider, prompt, system }) {
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
  if (!config.apiKey) throw new Error(`${config.name} API key is not configured`);

  const response = await fetch(config.baseUrl, {
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
    })
  });

  const text = await response.text();
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
  return {
    content,
    provider,
    model: config.model
  };
}

function normalizeChatCompletionUrl(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
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
      label: "Offline A2A Kit",
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

async function callA2AProvider({ providerConfig, prompt, system }) {
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

  const headers = {
    "content-type": "application/json"
  };
  if (resolved.apiKey) {
    headers.authorization = `Bearer ${resolved.apiKey}`;
  }

  const response = await fetch(resolved.baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: resolved.model,
      messages: [
        {
          role: "system",
          content: system || "You are a precise A2A agent. Use compact handoffs, preserve intent, and avoid exposing secrets."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.2
    })
  });

  const text = await response.text();
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
  return {
    content,
    provider: resolved.provider,
    providerLabel: resolved.label,
    model: resolved.model
  };
}

async function generateWithFallback(prompt) {
  const attempts = [];
  for (const provider of ["groq", "openai"]) {
    try {
      const result = await callChatCompletion({ provider, prompt });
      return { ...result, attempts };
    } catch (error) {
      attempts.push({ provider, error: error.message });
    }
  }
  const details = attempts.map((attempt) => `${attempt.provider}: ${attempt.error}`).join("; ");
  throw new Error(`All provider routes failed. ${details}`);
}

function buildBlankA2AKit(rawInput, options = {}) {
  const contract = buildOfflineContract(rawInput);
  return {
    kit_id: "blank-a2a-kit.v1",
    mode: options.mode || "one-shot",
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
        id: "contract",
        name: "Contract Agent",
        responsibility: "Create the compact handoff contract all downstream agents must obey.",
        receives: ["goal", "facts", "constraints", "risk_notes"],
        sends: ["handoff_contract"]
      },
      {
        id: "executor",
        name: "Executor Agent",
        responsibility: "Complete the user's task using only the compact contract.",
        receives: ["handoff_contract"],
        sends: ["candidate_result"]
      },
      {
        id: "verifier",
        name: "Verifier Agent",
        responsibility: "Check the candidate result against the contract and compress the final answer.",
        receives: ["handoff_contract", "candidate_result"],
        sends: ["final_result", "token_report"]
      }
    ],
    handoff_contract: contract,
    handoff_rules: [
      "Only Intake Agent may receive the raw prompt.",
      "Every later agent receives contract-shaped state, not the full transcript.",
      "Do not include secrets, API keys, duplicate instructions, or unrelated context in handoffs.",
      "Prefer the smallest payload that preserves task quality."
    ]
  };
}

function buildA2AContractPrompt(rawInput, kit) {
  return `You are the Contract Agent in a blank A2A kit.

Convert the raw user prompt into a compact agent handoff contract. This is the only stage that may read the full raw prompt.

Return compact Markdown with:
1. Goal
2. Facts
3. Constraints
4. Required Output
5. Handoff Contract JSON
6. Optimized Executor Prompt

Blank kit scaffold:
${JSON.stringify(kit, null, 2)}

Raw user prompt:
${rawInput}`;
}

function buildA2AExecutorPrompt(contractText, kit) {
  return `You are the Executor Agent in a blank A2A kit.

Use only this handoff contract and complete the user's task. Do not ask for the raw prompt unless the contract is impossible to execute.

Handoff contract:
${contractText}

Execution rules:
- Return the best end result, not another plan unless a plan is the requested output.
- Preserve constraints and required output.
- Keep the response useful, structured, and direct.
- Follow this output style: ${kit.handoff_contract.output_style}`;
}

function buildA2AVerifierPrompt(contractText, candidateResult) {
  return `You are the Verifier Agent in a blank A2A kit.

Check the candidate result against the handoff contract and return the final user-facing result.

Rules:
- Fix obvious misses.
- Preserve the user's intent.
- Remove unnecessary repetition.
- Add a compact "A2A optimization used" note.

Handoff contract:
${contractText}

Candidate result:
${candidateResult}`;
}

function offlineA2AResult(kit) {
  const contract = kit.handoff_contract;
  return `## Blank A2A Kit Result

Goal: ${contract.goal}

Optimized execution prompt:
"${contract.next_action}

Context:
- ${contract.facts.join("\n- ")}

Constraints:
- ${contract.constraints.join("\n- ")}

Output style:
${contract.output_style}"

## A2A optimization used
The raw prompt entered the Intake Agent once. The blank kit converted it into a compact handoff contract, then downstream agents used only goal, facts, constraints, decisions, sources, open questions, and next action.`;
}

async function runBlankA2AKit({ rawInput, providerConfig = {}, options = {} }) {
  const startedAt = Date.now();
  const rawTokens = estimateTokens(rawInput);
  const resolvedProvider = resolveA2AProvider(providerConfig);
  const kit = buildBlankA2AKit(rawInput, options);
  const trace = [
    {
      phase: "intake",
      agent: "Intake Agent",
      status: "done",
      detail: `Read the raw prompt once and estimated ${rawTokens} tokens.`
    },
    {
      phase: "contract",
      agent: "Contract Agent",
      status: "done",
      detail: "Prepared the blank A2A kit scaffold and handoff rules."
    }
  ];

  const optimizedPrompts = [];
  let providerUsed = resolvedProvider.provider;
  let providerLabel = resolvedProvider.label;
  let modelUsed = resolvedProvider.model;
  let providerError = null;
  let contractOutput = JSON.stringify(kit, null, 2);
  let executorOutput = offlineA2AResult(kit);
  let finalAnswer = executorOutput;

  const contractPrompt = buildA2AContractPrompt(rawInput, kit);
  optimizedPrompts.push({
    agent: "Contract Agent",
    purpose: "Convert raw messy prompt into a compact A2A handoff contract.",
    tokens: estimateTokens(contractPrompt),
    prompt: contractPrompt
  });

  if (resolvedProvider.provider !== "offline") {
    try {
      trace.push({
        phase: "contract_model_call",
        agent: "Contract Agent",
        status: "running",
        detail: `Calling ${resolvedProvider.label} for the compact contract.`
      });
      const contractResult = await callA2AProvider({
        providerConfig,
        prompt: contractPrompt,
        system: "You are a Contract Agent. Convert messy user input into compact, safe, token-bounded A2A handoff contracts."
      });
      contractOutput = contractResult.content;
      providerUsed = contractResult.provider;
      providerLabel = contractResult.providerLabel;
      modelUsed = contractResult.model;
      trace[trace.length - 1].status = "done";

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
      executorOutput = executorResult.content;
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
      finalAnswer = verifierResult.content;
      trace[trace.length - 1].status = "done";
    } catch (error) {
      providerError = error.message;
      providerUsed = "offline";
      providerLabel = "Offline A2A Kit";
      modelUsed = "offline-template";
      trace.push({
        phase: "fallback",
        agent: "Offline A2A Kit",
        status: "done",
        detail: "Provider call failed, so the blank kit returned a deterministic offline result."
      });
    }
  } else {
    trace.push({
      phase: "offline",
      agent: "Offline A2A Kit",
      status: "done",
      detail: "Generated a deterministic A2A contract and optimized result without provider calls."
    });
  }

  const optimizedPromptTokens = optimizedPrompts.reduce((sum, item) => sum + item.tokens, 0);
  return {
    mode: "blank-a2a-kit-run",
    provider: providerUsed,
    providerLabel,
    model: modelUsed,
    providerError,
    kit,
    contractOutput,
    executorOutput,
    finalAnswer,
    optimizedPrompts,
    trace,
    tokenReport: {
      rawInputTokens: rawTokens,
      optimizedPromptTokens,
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
  const outputStyle = lower.includes("json")
    ? "Return structured JSON when possible."
    : lower.includes("code")
      ? "Return implementation-ready code and concise verification steps."
      : "Return a concise, useful final answer with clear next steps.";

  return {
    contract_id: "optimizer.self_run.v1",
    goal: likelyGoal,
    facts: lines.slice(0, 6),
    constraints: constraints.length ? constraints : ["Preserve the user's intent.", "Avoid unnecessary context and repeated instructions."],
    decisions: [
      "Use the raw input only during the optimizer stage.",
      "Use compact handoff contracts for all later stages.",
      "Do not pass full transcripts between internal agents."
    ],
    sources: ["user_input"],
    open_questions: [],
    next_action: "Execute the optimized prompt plan and return the best final result.",
    token_budget: {
      raw_input_estimate: estimateTokens(rawInput),
      handoff_target: 700,
      executor_target: 1200
    },
    required_payload: ["goal", "facts", "constraints", "decisions", "sources", "open_questions", "next_action"],
    forbidden_payload: ["raw full transcript after optimizer stage", "duplicate role instructions", "API keys or secrets", "unrelated context"],
    output_style: outputStyle
  };
}

function buildOptimizerPrompt(rawInput, offlineContract) {
  return `You are the Optimizer Agent in a token-saving multi-agent workflow.

Convert the raw user input into a compact handoff contract for downstream agents.

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
  return `You are the Verifier Agent in a token optimizer.

Check the executor output against the handoff contract. Return the final user-facing answer.

Rules:
- Fix missing constraints if obvious.
- Keep the final answer shorter than the executor output when possible.
- Include a tiny "Token optimization used" note at the end.

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
${contract.output_style}"

## Token optimization used
The raw input was converted into a handoff contract with goal, facts, constraints, decisions, sources, open questions, and next action. Later agents should use this compact contract instead of the full original prompt.`;
}

async function runSelfOptimizingWorkflow({ rawInput, provider }) {
  const startedAt = Date.now();
  const selectedProvider = provider || "groq-openai-fallback";
  const offlineContract = buildOfflineContract(rawInput);
  const rawTokens = estimateTokens(rawInput);
  const trace = [
    {
      phase: "intake",
      agent: "Intake Agent",
      status: "done",
      detail: `Estimated raw input at ${rawTokens} tokens.`
    },
    {
      phase: "contract",
      agent: "Contract Agent",
      status: "done",
      detail: "Built an offline handoff contract so downstream agents do not need the full prompt."
    }
  ];

  const optimizedPrompts = [];
  let providerUsed = "offline";
  let modelUsed = "offline-template";
  let optimizerOutput = JSON.stringify(offlineContract, null, 2);
  let executorOutput = offlineExecute(offlineContract);
  let finalAnswer = executorOutput;
  let providerError = null;

  const optimizerPrompt = buildOptimizerPrompt(rawInput, offlineContract);
  optimizedPrompts.push({
    agent: "Optimizer Agent",
    purpose: "Read the raw prompt once and create the compact handoff contract.",
    tokens: estimateTokens(optimizerPrompt),
    prompt: optimizerPrompt
  });

  if (selectedProvider !== "offline") {
    try {
      trace.push({
        phase: "optimize",
        agent: "Optimizer Agent",
        status: "running",
        detail: "Sending raw input once to create a compact contract."
      });
      const optimizerResult = selectedProvider === "openai"
        ? await callChatCompletion({ provider: "openai", prompt: optimizerPrompt })
        : selectedProvider === "groq"
          ? await callChatCompletion({ provider: "groq", prompt: optimizerPrompt })
          : await generateWithFallback(optimizerPrompt);
      optimizerOutput = optimizerResult.content;
      providerUsed = optimizerResult.provider;
      modelUsed = optimizerResult.model;
      trace[trace.length - 1].status = "done";

      const executorPrompt = buildExecutorPrompt(optimizerOutput, offlineContract);
      optimizedPrompts.push({
        agent: "Executor Agent",
        purpose: "Execute the task using only the compact handoff contract.",
        tokens: estimateTokens(executorPrompt),
        prompt: executorPrompt
      });
      trace.push({
        phase: "execute",
        agent: "Executor Agent",
        status: "running",
        detail: "Running the optimized prompt without resending the raw input."
      });
      const executorResult = selectedProvider === "openai"
        ? await callChatCompletion({ provider: "openai", prompt: executorPrompt })
        : selectedProvider === "groq"
          ? await callChatCompletion({ provider: "groq", prompt: executorPrompt })
          : await generateWithFallback(executorPrompt);
      executorOutput = executorResult.content;
      providerUsed = executorResult.provider;
      modelUsed = executorResult.model;
      trace[trace.length - 1].status = "done";

      const verifierPrompt = buildVerifierPrompt(optimizerOutput, executorOutput);
      optimizedPrompts.push({
        agent: "Verifier Agent",
        purpose: "Verify constraints and compress the final answer.",
        tokens: estimateTokens(verifierPrompt),
        prompt: verifierPrompt
      });
      trace.push({
        phase: "verify",
        agent: "Verifier Agent",
        status: "running",
        detail: "Checking the result against the compact contract."
      });
      const verifierResult = selectedProvider === "openai"
        ? await callChatCompletion({ provider: "openai", prompt: verifierPrompt })
        : selectedProvider === "groq"
          ? await callChatCompletion({ provider: "groq", prompt: verifierPrompt })
          : await generateWithFallback(verifierPrompt);
      finalAnswer = verifierResult.content;
      providerUsed = verifierResult.provider;
      modelUsed = verifierResult.model;
      trace[trace.length - 1].status = "done";
    } catch (error) {
      providerError = error.message;
      trace.push({
        phase: "fallback",
        agent: "Offline Fallback",
        status: "done",
        detail: "Provider route failed, so the workflow returned the deterministic offline result."
      });
    }
  } else {
    trace.push({
      phase: "offline",
      agent: "Offline Runner",
      status: "done",
      detail: "Generated the optimized result locally without provider calls."
    });
  }

  const optimizedPromptTokens = optimizedPrompts.reduce((sum, item) => sum + item.tokens, 0);
  return {
    mode: "self-optimizing-agent-run",
    provider: providerUsed,
    model: modelUsed,
    providerError,
    handoffContract: offlineContract,
    optimizerOutput,
    executorOutput,
    finalAnswer,
    optimizedPrompts,
    trace,
    tokenReport: {
      rawInputTokens: rawTokens,
      optimizedPromptTokens,
      estimatedNaiveThreeStepTokens: rawTokens * 3,
      estimatedSavingsTokens: Math.max(0, rawTokens * 3 - optimizedPromptTokens),
      estimatedSavingsPercent: rawTokens
        ? Math.max(0, Math.round(((rawTokens * 3 - optimizedPromptTokens) / (rawTokens * 3)) * 100))
        : 0
    },
    elapsedMs: Date.now() - startedAt
  };
}

module.exports = {
  callChatCompletion,
  generateWithFallback,
  providerStatus,
  runBlankA2AKit,
  runSelfOptimizingWorkflow
};

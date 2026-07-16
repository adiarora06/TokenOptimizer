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

function outputStyleFor(text) {
  const lower = String(text || "").toLowerCase();
  if (/\b(json|api|schema|yaml|structured)\b/.test(lower)) return "Return structured output without extra narration.";
  if (/\b(code|program|function|component|debug|repo|test)\b/.test(lower)) return "Return implementation-ready code and concise verification steps.";
  if (/\b(plan|strategy|workflow|architecture|roadmap)\b/.test(lower)) return "Return a concise plan with clear next steps.";
  return "Return a concise, useful final answer.";
}

function analyzeWorkflowShape(rawInput) {
  const text = String(rawInput || "");
  const lower = text.toLowerCase();
  const rawTokens = estimateTokens(text);
  const lines = compactLines(text, 40);
  const constraintCount = lines.filter((line) => /(must|should|don't|do not|avoid|need|want|require|constraint|use|with|without)/i.test(line)).length;
  const hasCodeOrFiles = /\b(code|program|function|component|repo|file|api|schema|database|deploy|extension|test)\b/.test(lower);
  const hasWorkflow = /\b(agent|workflow|architecture|handoff|multi-agent|multi agent|provider|route|orchestrat)\b/.test(lower);
  const hasLongContext = rawTokens > 450 || lines.length > 14;
  const hasMultiDeliverable = (text.match(/\b(and|also|plus|then)\b/gi) || []).length >= 3;
  let complexity = 0;
  if (rawTokens > 140) complexity += 1;
  if (rawTokens > 360) complexity += 1;
  if (hasLongContext) complexity += 1;
  if (hasCodeOrFiles || hasWorkflow) complexity += 1;
  if (constraintCount > 3 || hasMultiDeliverable) complexity += 1;

  const route = complexity <= 1
    ? "direct"
    : complexity <= 3
      ? "contract"
      : "full";

  return {
    rawTokens,
    lines: lines.length,
    constraintCount,
    complexity,
    route,
    outputStyle: outputStyleFor(text)
  };
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
          content: system || "You are a precise contract workflow node. Use compact handoffs, preserve intent, and avoid exposing secrets."
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
  return `You are the Contract Builder in an adaptive token optimizer.

Convert the raw user prompt into a compact typed handoff contract. This is the only model-facing stage that may read the full raw prompt.

Return compact Markdown with:
1. Goal
2. Facts
3. Constraints
4. Required Output
5. Handoff Contract JSON
6. Optimized Executor Prompt

Workflow kit scaffold:
${JSON.stringify(kit, null, 2)}

Raw user prompt:
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

function offlineA2AResult(kit) {
  const contract = kit.handoff_contract;
  return `## Contract Workflow Kit Result

Goal: ${contract.goal}

Optimized executor prompt:
"${contract.next_action}

Context:
- ${contract.facts.join("\n- ")}

Constraints:
- ${contract.constraints.join("\n- ")}

Output style:
${contract.output_style}"`;
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
      agent: "Contract Builder",
      status: "done",
      detail: "Prepared the contract workflow kit scaffold and handoff rules."
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
      providerLabel = "Local Contract Kit";
      modelUsed = "offline-template";
      trace.push({
        phase: "fallback",
        agent: "Local Contract Kit",
        status: "done",
        detail: "Provider call failed, so the contract kit returned a deterministic local result."
      });
    }
  } else {
    trace.push({
      phase: "offline",
      agent: "Local Contract Kit",
      status: "done",
      detail: "Generated a deterministic contract and optimized result without provider calls."
    });
  }

  const optimizedPromptTokens = optimizedPrompts.reduce((sum, item) => sum + item.tokens, 0);
  return {
    mode: "contract-workflow-kit-run",
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

async function callWorkflowProvider(selectedProvider, prompt, system) {
  if (selectedProvider === "openai") {
    return callChatCompletion({ provider: "openai", prompt, system });
  }
  if (selectedProvider === "groq") {
    return callChatCompletion({ provider: "groq", prompt, system });
  }
  return generateWithFallback(prompt);
}

async function runSelfOptimizingWorkflow({ rawInput, provider }) {
  const startedAt = Date.now();
  const selectedProvider = provider || "groq-openai-fallback";
  const offlineContract = buildOfflineContract(rawInput);
  const workflowShape = analyzeWorkflowShape(rawInput);
  const rawTokens = estimateTokens(rawInput);
  const trace = [
    {
      phase: "intake",
      agent: "Intake Agent",
      status: "done",
      detail: `Estimated raw input at ${rawTokens} tokens.`
    },
    {
      phase: "route",
      agent: "Adaptive Router",
      status: "done",
      detail: `Selected ${workflowShape.route} route for complexity ${workflowShape.complexity}.`
    },
    {
      phase: "contract",
      agent: "Contract Builder",
      status: "done",
      detail: "Built a local handoff contract so downstream nodes do not need the full prompt."
    }
  ];

  const optimizedPrompts = [];
  let providerUsed = "offline";
  let modelUsed = "offline-template";
  let optimizerOutput = JSON.stringify(offlineContract, null, 2);
  let executorOutput = offlineExecute(offlineContract);
  let finalAnswer = executorOutput;
  let providerError = null;

  const directPrompt = buildDirectExecutorPrompt(rawInput, offlineContract);
  const optimizerPrompt = buildOptimizerPrompt(rawInput, offlineContract);

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
        trace.push({
          phase: "execute",
          agent: "Direct Executor",
          status: "running",
          detail: "Simple prompt detected, so the workflow is using one lean model call."
        });
        const directResult = await callWorkflowProvider(
          selectedProvider,
          directPrompt,
          "Complete the user's task directly. Preserve requested deliverables and avoid internal process commentary."
        );
        executorOutput = directResult.content;
        finalAnswer = directResult.content;
        providerUsed = directResult.provider;
        modelUsed = directResult.model;
        trace[trace.length - 1].status = "done";
        trace.push({
          phase: "verify",
          agent: "Local Verifier",
          status: "done",
          detail: "Applied local output rules without adding another model call."
        });
      } else {
        trace.push({
          phase: "optimize",
          agent: "Contract Builder",
          status: "running",
          detail: "Sending raw input once to create a compact contract."
        });
        const optimizerResult = await callWorkflowProvider(
          selectedProvider,
          optimizerPrompt,
          "You are a Contract Builder. Preserve intent, remove repetition, and return compact execution state."
        );
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
        const executorResult = await callWorkflowProvider(
          selectedProvider,
          executorPrompt,
          "You are an Executor Agent. Produce the best final work product from the compact handoff contract."
        );
        executorOutput = executorResult.content;
        finalAnswer = executorResult.content;
        providerUsed = executorResult.provider;
        modelUsed = executorResult.model;
        trace[trace.length - 1].status = "done";

        if (workflowShape.route === "full") {
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
          const verifierResult = await callWorkflowProvider(
            selectedProvider,
            verifierPrompt,
            "You are a Verifier Agent. Fix drift, preserve intent, and return a compact final answer without process commentary."
          );
          finalAnswer = verifierResult.content;
          providerUsed = verifierResult.provider;
          modelUsed = verifierResult.model;
          trace[trace.length - 1].status = "done";
        } else {
          trace.push({
            phase: "verify",
            agent: "Local Verifier",
            status: "done",
            detail: "Medium complexity route skipped the extra verifier model call."
          });
        }
      }
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
    mode: "adaptive-contract-workflow-run",
    provider: providerUsed,
    model: modelUsed,
    providerError,
    workflowShape,
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
        : 0,
      adaptiveRoute: workflowShape.route,
      complexity: workflowShape.complexity
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

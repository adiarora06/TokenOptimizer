const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = __dirname;
const outputDir = path.join(rootDir, "outputs");
const port = Number(process.env.PORT || 8787);

loadEnvFile(path.join(rootDir, ".env.local"));

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

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
      "authorization": `Bearer ${config.apiKey}`,
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
    provider: provider,
    model: config.model
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

async function handleApi(req, res) {
  if (req.method === "GET" && req.url === "/api/provider-status") {
    sendJson(res, 200, {
      groqConfigured: Boolean(process.env.GROQ_API_KEY),
      openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
      groqModel: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      openaiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini"
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/generate") {
    try {
      const body = await readJson(req);
      const provider = body.provider || "groq-openai-fallback";
      const prompt = String(body.prompt || "");
      if (!prompt.trim()) {
        sendJson(res, 400, { error: "Missing prompt" });
        return;
      }
      const result = provider === "openai"
        ? await callChatCompletion({ provider: "openai", prompt })
        : provider === "groq"
          ? await callChatCompletion({ provider: "groq", prompt })
          : await generateWithFallback(prompt);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/optimize-run") {
    try {
      const body = await readJson(req);
      const rawInput = String(body.input || "");
      if (!rawInput.trim()) {
        sendJson(res, 400, { error: "Missing input" });
        return;
      }
      const result = await runSelfOptimizingWorkflow({
        rawInput,
        provider: body.provider || "groq-openai-fallback"
      });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://127.0.0.1:${port}`);
  const routeMap = {
    "/": "/token-optimizer-file-generator.html",
    "/agent-structure": "/agent-structure.html"
  };
  const pathname = routeMap[requestUrl.pathname] || requestUrl.pathname;
  const filePath = path.normalize(path.join(outputDir, pathname));
  if (!filePath.startsWith(outputDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const contentType = ext === ".html" ? "text/html; charset=utf-8" : "application/octet-stream";
    res.writeHead(200, {
      "content-type": contentType,
      "content-length": data.length
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Token optimizer running at http://127.0.0.1:${port}/token-optimizer-file-generator.html`);
});

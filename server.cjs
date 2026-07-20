const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = __dirname;
const outputDir = path.join(rootDir, "outputs");
const port = Number(process.env.PORT || 8787);
const {
  callChatCompletion,
  generateWithFallback,
  preparePortableHandoff,
  providerStatus,
  runBlankA2AKit,
  runSelfOptimizingWorkflow
} = require("./optimizer-core.cjs");
const { createOptimizerSystem } = require("./optimizer-system.cjs");

loadEnvFile(path.join(rootDir, ".env.local"));

const optimizerSystem = createOptimizerSystem();
const maxInputChars = Number(process.env.TOKEN_OPTIMIZER_MAX_INPUT_CHARS || 80_000);
const rateWindowMs = Number(process.env.TOKEN_OPTIMIZER_RATE_WINDOW_MS || 60_000);
const rateMax = Number(process.env.TOKEN_OPTIMIZER_RATE_MAX || 20);
const rateBuckets = new Map();
const optimizerProviders = new Set(["groq-openai-fallback", "groq", "openai", "offline"]);
const kitProviders = new Set(["groq", "openai", "openrouter", "xai", "litellm", "custom", "offline"]);
const routePreferences = new Set(["auto", "fast", "thorough", "verified"]);

function commonHeaders(rate) {
  return {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...(rate ? {
      "x-ratelimit-limit": String(rate.limit),
      "x-ratelimit-remaining": String(rate.remaining),
      "x-ratelimit-reset": String(Math.ceil(rate.resetAt / 1_000))
    } : {})
  };
}

function publicError(error) {
  if (!error) return "Unexpected error";
  if (error.name === "AbortError") return "The model request timed out or was cancelled";
  return String(error.message || error).slice(0, 500);
}

function takeRateLimit(req) {
  const now = Date.now();
  const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  const remote = req.socket?.remoteAddress || "unknown";
  const device = String(req.headers?.["x-token-optimizer-device"] || "anonymous").slice(0, 80);
  const key = `${forwarded || remote}:${device}`;
  const current = rateBuckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + rateWindowMs }
    : current;
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  return {
    allowed: bucket.count <= rateMax,
    limit: rateMax,
    remaining: Math.max(0, rateMax - bucket.count),
    resetAt: bucket.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000))
  };
}

function validateText(value, label) {
  if (typeof value !== "string" || !value.trim()) return { ok: false, error: `Missing ${label}` };
  const text = value.trim();
  if (text.length > maxInputChars) return { ok: false, error: `${label} exceeds ${maxInputChars.toLocaleString()} characters` };
  return { ok: true, text };
}

function validateOptions(value) {
  if (value == null) return { ok: true, value: {} };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Invalid options" };
  if (value.routePreference && !routePreferences.has(value.routePreference)) return { ok: false, error: "Invalid route preference" };
  if (value.timeoutMs != null && (!Number.isInteger(value.timeoutMs) || value.timeoutMs < 5_000 || value.timeoutMs > 120_000)) {
    return { ok: false, error: "Invalid timeout" };
  }
  return { ok: true, value };
}

function validateProviderConfig(value) {
  if (value == null) return { ok: true, value: {} };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Invalid provider configuration" };
  if (value.provider && !kitProviders.has(value.provider)) return { ok: false, error: "Invalid provider configuration" };
  for (const [key, max] of [["label", 80], ["baseUrl", 2_048], ["model", 200], ["apiKey", 4_000]]) {
    if (value[key] != null && (typeof value[key] !== "string" || value[key].length > max)) {
      return { ok: false, error: "Invalid provider configuration" };
    }
  }
  return { ok: true, value };
}

function validateOptimizerPayload(body = {}) {
  const input = validateText(body.input, "input");
  if (!input.ok) return input;
  if (body.provider && !optimizerProviders.has(body.provider)) return { ok: false, error: "Invalid provider" };
  const options = validateOptions(body.options);
  if (!options.ok) return options;
  const providerConfig = validateProviderConfig(body.providerConfig);
  if (!providerConfig.ok) return providerConfig;
  return {
    ok: true,
    data: {
      input: input.text,
      provider: body.provider,
      source: typeof body.source === "string" ? body.source.slice(0, 80) : undefined,
      target: typeof body.target === "string" ? body.target.slice(0, 80) : undefined,
      sessionId: typeof body.sessionId === "string" ? body.sessionId.slice(0, 120) : null,
      runType: body.runType === "kit" ? "kit" : "optimizer",
      options: options.value,
      providerConfig: providerConfig.value
    }
  };
}

function validateA2APayload(body = {}) {
  const input = validateText(body.input, "input");
  if (!input.ok) return input;
  const options = validateOptions(body.options);
  if (!options.ok) return options;
  const providerConfig = validateProviderConfig(body.providerConfig);
  if (!providerConfig.ok) return providerConfig;
  return { ok: true, data: { input: input.text, options: options.value, providerConfig: providerConfig.value } };
}

function validateGeneratePayload(body = {}) {
  const prompt = validateText(body.prompt, "prompt");
  if (!prompt.ok) return prompt;
  const provider = body.provider || "groq-openai-fallback";
  if (!new Set(["groq-openai-fallback", "groq", "openai"]).has(provider)) return { ok: false, error: "Invalid provider" };
  return { ok: true, data: { prompt: prompt.text, provider } };
}

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

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    ...commonHeaders(),
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
}

function writeSse(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function allowedApiMethods(pathname) {
  const methods = {
    "/api/provider-status": ["GET"],
    "/api/system-overview": ["GET"],
    "/api/system-runs": ["GET", "POST"],
    "/api/generate": ["POST"],
    "/api/prepare-handoff": ["POST"],
    "/api/optimize-run": ["POST"],
    "/api/optimize-stream": ["POST"],
    "/api/workflow-run": ["POST"],
    "/api/a2a-run": ["POST"]
  };
  if (pathname.startsWith("/api/system-runs/")) return ["GET"];
  return methods[pathname] || null;
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

async function handleApi(req, res) {
  const requestUrl = new URL(req.url, `http://127.0.0.1:${port}`);
  const pathname = requestUrl.pathname;
  const rateLimitedPaths = new Set([
    "/api/system-runs",
    "/api/generate",
    "/api/prepare-handoff",
    "/api/optimize-run",
    "/api/optimize-stream",
    "/api/workflow-run",
    "/api/a2a-run"
  ]);
  const rate = req.method === "POST" && rateLimitedPaths.has(pathname) ? takeRateLimit(req) : null;
  if (rate && !rate.allowed) {
    sendJson(
      res,
      429,
      { error: "Too many runs. Please wait a moment and try again." },
      { ...commonHeaders(rate), "retry-after": String(rate.retryAfterSeconds) }
    );
    return;
  }

  if (req.method === "GET" && pathname === "/api/provider-status") {
    sendJson(res, 200, providerStatus());
    return;
  }

  if (req.method === "GET" && pathname === "/api/system-overview") {
    sendJson(res, 200, {
      architecture: optimizerSystem.architecture,
      runs: optimizerSystem.list()
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/system-runs") {
    sendJson(res, 200, {
      runs: optimizerSystem.list()
    });
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/system-runs/")) {
    const id = decodeURIComponent(pathname.replace("/api/system-runs/", ""));
    const run = optimizerSystem.get(id);
    if (!run) {
      sendJson(res, 404, { error: "Run not found" });
      return;
    }
    sendJson(res, 200, { run });
    return;
  }

  if (req.method === "POST" && pathname === "/api/system-runs") {
    try {
      const body = await readJson(req);
      const parsed = validateOptimizerPayload(body);
      if (!parsed.ok) {
        sendJson(res, 400, { error: parsed.error });
        return;
      }
      const run = optimizerSystem.start({
        rawInput: parsed.data.input,
        runType: parsed.data.runType || "optimizer",
        provider: parsed.data.provider || "groq-openai-fallback",
        providerConfig: parsed.data.providerConfig || {},
        options: parsed.data.options || {},
        source: parsed.data.source || "workspace",
        sessionId: parsed.data.sessionId || null
      });
      sendJson(res, 202, { run }, commonHeaders(rate));
    } catch (error) {
      sendJson(res, 500, { error: publicError(error) });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/optimize-stream") {
    try {
      const body = await readJson(req);
      const parsed = validateOptimizerPayload(body);
      if (!parsed.ok) {
        sendJson(res, 400, { error: parsed.error });
        return;
      }

      res.writeHead(200, {
        ...commonHeaders(rate),
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      const controller = new AbortController();
      req.on("aborted", () => controller.abort());
      writeSse(res, "run", { type: "run", status: "running", detail: "Run accepted." });
      const result = await runSelfOptimizingWorkflow({
        rawInput: parsed.data.input,
        provider: parsed.data.provider || "groq-openai-fallback",
        options: parsed.data.options || {},
        signal: controller.signal,
        onEvent(event) {
          writeSse(res, "progress", event);
        }
      });
      writeSse(res, "result", { result });
      res.end();
    } catch (error) {
      if (!res.headersSent) sendJson(res, 500, { error: publicError(error) });
      else {
        writeSse(res, "error", { error: publicError(error) });
        res.end();
      }
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/generate") {
    try {
      const body = await readJson(req);
      const parsed = validateGeneratePayload(body);
      if (!parsed.ok) {
        sendJson(res, 400, { error: parsed.error });
        return;
      }
      const provider = parsed.data.provider || "groq-openai-fallback";
      const prompt = parsed.data.prompt;
      const result = provider === "openai"
        ? await callChatCompletion({ provider: "openai", prompt })
        : provider === "groq"
          ? await callChatCompletion({ provider: "groq", prompt })
          : await generateWithFallback(prompt);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: publicError(error) });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/prepare-handoff") {
    try {
      const body = await readJson(req);
      const parsed = validateOptimizerPayload(body);
      if (!parsed.ok) {
        sendJson(res, 400, { error: parsed.error });
        return;
      }
      const result = preparePortableHandoff({
        rawInput: parsed.data.input,
        options: parsed.data.options || {},
        target: parsed.data.target || "ai-assistant"
      });
      sendJson(res, 200, result, commonHeaders(rate));
    } catch (error) {
      sendJson(res, 500, { error: publicError(error) });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/optimize-run") {
    try {
      const body = await readJson(req);
      const parsed = validateOptimizerPayload(body);
      if (!parsed.ok) {
        sendJson(res, 400, { error: parsed.error });
        return;
      }
      const result = await runSelfOptimizingWorkflow({
        rawInput: parsed.data.input,
        provider: parsed.data.provider || "groq-openai-fallback",
        options: parsed.data.options || {}
      });
      sendJson(res, 200, result, commonHeaders(rate));
    } catch (error) {
      sendJson(res, 500, { error: publicError(error) });
    }
    return;
  }

  if (req.method === "POST" && (pathname === "/api/workflow-run" || pathname === "/api/a2a-run")) {
    try {
      const body = await readJson(req);
      const parsed = validateA2APayload(body);
      if (!parsed.ok) {
        sendJson(res, 400, { error: parsed.error });
        return;
      }
      const result = await runBlankA2AKit({
        rawInput: parsed.data.input,
        providerConfig: parsed.data.providerConfig || {},
        options: parsed.data.options || {}
      });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: publicError(error) });
    }
    return;
  }

  const allowedMethods = allowedApiMethods(pathname);
  if (allowedMethods) {
    sendJson(res, 405, { error: "Method not allowed" }, { allow: allowedMethods.join(", ") });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://127.0.0.1:${port}`);
  const routeMap = {
    "/": "/home.html",
    "/workspace": "/workspace.html",
    "/token-optimizer-file-generator.html": "/workspace.html",
    "/agent-structure": "/agent-structure.html",
    "/optimized-ide": "/a2a-kit.html",
    "/a2a-kit": "/a2a-kit.html",
    "/open-source": "/open-source.html",
    "/stats": "/stats.html",
    "/audit-log": "/prompt-history.html",
    "/prompt-history": "/prompt-history.html",
    "/settings": "/settings.html",
    "/privacy": "/privacy.html"
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
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png"
    };
    const contentType = contentTypes[ext] || "application/octet-stream";
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
  console.log(`Token optimizer running at http://127.0.0.1:${port}/`);
});

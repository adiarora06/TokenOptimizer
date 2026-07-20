const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = __dirname;
const outputDir = path.join(rootDir, "outputs");
const graphifyDir = path.join(rootDir, "graphify-out");

// Load env before request-guard so its rate/input limits pick up .env.local values.
loadEnvFile(path.join(rootDir, ".env.local"));

const port = Number(process.env.PORT || 8787);
const {
  callChatCompletion,
  createTraceId,
  generateWithFallback,
  preparePortableHandoff,
  providerStatus,
  runBlankA2AKit,
  runSelfOptimizingWorkflow
} = require("./optimizer-core.cjs");
const { createOptimizerSystem } = require("./optimizer-system.cjs");
const {
  commonHeaders,
  publicError,
  takeRateLimit,
  validateA2APayload,
  validateGeneratePayload,
  validateOptimizerPayload
} = require("./request-guard.cjs");

const optimizerSystem = createOptimizerSystem();

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
  if (res.writableEnded || res.destroyed) return;
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
    let heartbeat = null;
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
      const traceId = createTraceId();
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(": ping\n\n");
      }, 15_000);
      writeSse(res, "run", { type: "run", traceId, agent: "Coordinator", status: "running", detail: "Run accepted." });
      const result = await runSelfOptimizingWorkflow({
        rawInput: parsed.data.input,
        provider: parsed.data.provider || "groq-openai-fallback",
        options: parsed.data.options || {},
        traceId,
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
    } finally {
      if (heartbeat) clearInterval(heartbeat);
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
      const controller = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      const result = provider === "openai"
        ? await callChatCompletion({ provider: "openai", prompt, signal: controller.signal })
        : provider === "groq"
          ? await callChatCompletion({ provider: "groq", prompt, signal: controller.signal })
          : await generateWithFallback(prompt, { signal: controller.signal });
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
      const controller = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      const result = await runSelfOptimizingWorkflow({
        rawInput: parsed.data.input,
        provider: parsed.data.provider || "groq-openai-fallback",
        options: parsed.data.options || {},
        signal: controller.signal
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
      const controller = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      const result = await runBlankA2AKit({
        rawInput: parsed.data.input,
        providerConfig: parsed.data.providerConfig || {},
        options: parsed.data.options || {},
        signal: controller.signal
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
  const graphRouteMap = {
    "/code-graph": "/graph.html",
    "/code-graph.json": "/graph.json",
    "/code-graph-report": "/GRAPH_REPORT.md"
  };
  const isGraphRoute = Boolean(graphRouteMap[requestUrl.pathname]);
  const baseDir = isGraphRoute ? graphifyDir : outputDir;
  const pathname = graphRouteMap[requestUrl.pathname] || routeMap[requestUrl.pathname] || requestUrl.pathname;
  const filePath = path.normalize(path.join(baseDir, pathname));
  if (!filePath.startsWith(baseDir + path.sep)) {
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
      ".md": "text/markdown; charset=utf-8",
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

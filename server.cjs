const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = __dirname;
const outputDir = path.join(rootDir, "outputs");
const port = Number(process.env.PORT || 8787);
const {
  callChatCompletion,
  generateWithFallback,
  providerStatus,
  runBlankA2AKit,
  runSelfOptimizingWorkflow
} = require("./optimizer-core.cjs");
const { createOptimizerSystem } = require("./optimizer-system.cjs");

loadEnvFile(path.join(rootDir, ".env.local"));

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

async function handleApi(req, res) {
  const requestUrl = new URL(req.url, `http://127.0.0.1:${port}`);
  const pathname = requestUrl.pathname;

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
      const rawInput = String(body.input || "");
      if (!rawInput.trim()) {
        sendJson(res, 400, { error: "Missing input" });
        return;
      }
      const run = optimizerSystem.start({
        rawInput,
        runType: body.runType || "optimizer",
        provider: body.provider || "groq-openai-fallback",
        providerConfig: body.providerConfig || {},
        options: body.options || {},
        source: body.source || "workspace",
        sessionId: body.sessionId || null
      });
      sendJson(res, 202, { run });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/generate") {
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

  if (req.method === "POST" && pathname === "/api/optimize-run") {
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

  if (req.method === "POST" && pathname === "/api/a2a-run") {
    try {
      const body = await readJson(req);
      const rawInput = String(body.input || "");
      if (!rawInput.trim()) {
        sendJson(res, 400, { error: "Missing input" });
        return;
      }
      const result = await runBlankA2AKit({
        rawInput,
        providerConfig: body.providerConfig || {},
        options: body.options || {}
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
    "/": "/home.html",
    "/workspace": "/workspace.html",
    "/token-optimizer-file-generator.html": "/workspace.html",
    "/agent-structure": "/agent-structure.html",
    "/a2a-kit": "/a2a-kit.html",
    "/open-source": "/open-source.html",
    "/stats": "/stats.html",
    "/audit-log": "/audit-log.html",
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

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

async function callChatCompletion({ provider, prompt }) {
  const configs = {
    groq: {
      name: "Groq",
      apiKey: process.env.GROQ_API_KEY,
      baseUrl: "https://api.groq.com/openai/v1/chat/completions",
      model: process.env.GROQ_MODEL || "openai/gpt-oss-20b"
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
          content: "Generate concise, correct project artifacts. Preserve user intent, avoid secrets, and return only the requested file content."
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

async function handleApi(req, res) {
  if (req.method === "GET" && req.url === "/api/provider-status") {
    sendJson(res, 200, {
      groqConfigured: Boolean(process.env.GROQ_API_KEY),
      openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
      groqModel: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
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

  sendJson(res, 404, { error: "Not found" });
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://127.0.0.1:${port}`);
  const pathname = requestUrl.pathname === "/" ? "/token-optimizer-file-generator.html" : requestUrl.pathname;
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

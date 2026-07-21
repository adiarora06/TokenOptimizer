const { createTraceId, runSelfOptimizingWorkflow } = require("../optimizer-core.cjs");
const {
  abortSignalOnClose,
  commonHeaders,
  publicError,
  takeRateLimit,
  validateOptimizerPayload
} = require("../request-guard.cjs");

function writeEvent(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

module.exports = async function handler(req, res) {
  const rate = takeRateLimit(req);
  if (!rate.allowed) {
    res.writeHead(429, {
      ...commonHeaders(rate),
      "content-type": "application/json; charset=utf-8",
      "retry-after": String(rate.retryAfterSeconds)
    });
    res.end(JSON.stringify({ error: "Too many runs. Please wait a moment and try again." }));
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { ...commonHeaders(rate), "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const parsed = validateOptimizerPayload(req.body);
  if (!parsed.ok) {
    res.writeHead(400, { ...commonHeaders(rate), "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: parsed.error }));
    return;
  }

  res.writeHead(200, {
    ...commonHeaders(rate),
    "content-type": "text/event-stream; charset=utf-8",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  res.flushHeaders?.();

  const traceId = createTraceId();
  const signal = abortSignalOnClose(res);
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": ping\n\n");
  }, 15_000);
  writeEvent(res, "run", { type: "run", traceId, agent: "Coordinator", status: "running", detail: "Run accepted." });

  try {
    const result = await runSelfOptimizingWorkflow({
      rawInput: parsed.data.input,
      provider: parsed.data.provider || "groq-openai-fallback",
      options: parsed.data.options || {},
      traceId,
      signal,
      onEvent(event) {
        writeEvent(res, "progress", event);
      }
    });
    writeEvent(res, "result", { result });
  } catch (error) {
    writeEvent(res, "error", { error: publicError(error) });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
};

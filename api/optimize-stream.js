const { createTraceId, runSelfOptimizingWorkflow } = require("../optimizer-core.cjs");
const { projectPublicResult } = require("../core/public-result.cjs");
const {
  abortSignalOnClose,
  commonHeaders,
  publicError,
  runBillableRequest,
  validateOptimizerPayload
} = require("../request-guard.cjs");

function writeEvent(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, {
      ...commonHeaders(),
      allow: "POST",
      "content-type": "application/json; charset=utf-8"
    });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  const parsed = validateOptimizerPayload(req.body);
  if (!parsed.ok) {
    res.writeHead(400, { ...commonHeaders(), "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: parsed.error }));
    return;
  }

  const traceId = createTraceId();
  let heartbeat = null;
  let streamStarted = false;

  function startStream(rate, idempotencyStatus) {
    if (streamStarted) return;
    const idempotencyHeader = idempotencyStatus ? { "x-idempotency-status": idempotencyStatus } : {};
    res.writeHead(200, {
      ...commonHeaders(rate),
      ...idempotencyHeader,
      "content-type": "text/event-stream; charset=utf-8",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    res.flushHeaders?.();
    streamStarted = true;
    heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(": ping\n\n");
    }, 15_000);
  }

  try {
    const disconnectSignal = abortSignalOnClose(res);
    const guarded = await runBillableRequest({
      req,
      signal: disconnectSignal,
      payload: parsed.data,
      endpoint: "/api/optimize-stream",
      funding: parsed.data.provider === "offline" ? "offline" : "server",
      execute: async ({ rate, signal }) => {
        startStream(rate);
        writeEvent(res, "run", { type: "run", traceId, agent: "Coordinator", status: "running", detail: "Run accepted." });
        const result = await runSelfOptimizingWorkflow({
          rawInput: parsed.data.input,
          provider: parsed.data.provider || "groq-openai-fallback",
          options: parsed.data.options || {},
          traceId,
          signal,
          telemetryContext: { endpoint: "/api/optimize-stream" },
          onEvent(event) {
            writeEvent(res, "progress", event);
          }
        });
        return projectPublicResult(result, { includePreparedArtifacts: true });
      }
    });

    if (!guarded.ok) {
      if (streamStarted) {
        writeEvent(res, "error", { error: guarded.error, code: guarded.code });
      } else {
        res.writeHead(guarded.status, {
          ...commonHeaders(guarded.rate),
          "content-type": "application/json; charset=utf-8",
          ...(guarded.retryAfterSeconds ? { "retry-after": String(guarded.retryAfterSeconds) } : {})
        });
        res.end(JSON.stringify({ error: guarded.error, code: guarded.code }));
      }
      return;
    }

    startStream(guarded.rate, guarded.idempotencyStatus);
    if (guarded.replayed || guarded.coalesced) {
      writeEvent(res, "progress", {
        type: "stage",
        traceId: guarded.value.traceId,
        agent: "Request Guard",
        stage: "deduplicate",
        status: "done",
        detail: guarded.replayed ? "Returned the completed idempotent result." : "Joined the matching in-flight run."
      });
    }
    writeEvent(res, "result", { result: guarded.value, idempotencyStatus: guarded.idempotencyStatus });
  } catch (error) {
    if (streamStarted) writeEvent(res, "error", { error: publicError(error) });
    else {
      res.writeHead(500, { ...commonHeaders(), "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: publicError(error) }));
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
};

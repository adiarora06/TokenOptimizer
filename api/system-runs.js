const { SYSTEM_ARCHITECTURE, runSystemRunInline } = require("../optimizer-system.cjs");
const {
  abortSignalOnClose,
  classifyProviderConfigFunding,
  commonHeaders,
  publicError,
  runBillableRequest,
  validateOptimizerPayload
} = require("../request-guard.cjs");

module.exports = async function handler(req, res) {
  for (const [name, value] of Object.entries(commonHeaders())) res.setHeader(name, value);
  if (req.method === "GET") {
    res.status(200).json({
      runs: [],
      architecture: SYSTEM_ARCHITECTURE,
      note: "Hosted runs complete inline because serverless functions do not keep an in-memory background queue between requests."
    });
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const parsed = validateOptimizerPayload(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const runType = parsed.data.runType || "optimizer";
    const disconnectSignal = abortSignalOnClose(res);
    const guarded = await runBillableRequest({
      req,
      signal: disconnectSignal,
      payload: parsed.data,
      endpoint: "/api/system-runs",
      funding: runType === "kit"
        ? classifyProviderConfigFunding(parsed.data.providerConfig)
        : parsed.data.provider === "offline" ? "offline" : "server",
      execute: ({ signal }) => runSystemRunInline({
        rawInput: parsed.data.input,
        runType,
        provider: parsed.data.provider || "groq-openai-fallback",
        providerConfig: parsed.data.providerConfig || {},
        options: parsed.data.options || {},
        source: parsed.data.source || "workspace",
        sessionId: parsed.data.sessionId || null,
        signal,
        telemetryContext: { endpoint: "/api/system-runs" }
      })
    });
    for (const [name, value] of Object.entries(commonHeaders(guarded.rate))) res.setHeader(name, value);
    if (!guarded.ok) {
      if (guarded.retryAfterSeconds) res.setHeader("retry-after", String(guarded.retryAfterSeconds));
      res.status(guarded.status).json({ error: guarded.error, code: guarded.code });
      return;
    }
    res.setHeader("x-idempotency-status", guarded.idempotencyStatus);
    res.status(200).json({ run: guarded.value });
  } catch (error) {
    res.status(500).json({ error: publicError(error) });
  }
};

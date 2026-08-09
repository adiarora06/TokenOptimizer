const { runSelfOptimizingWorkflow } = require("../optimizer-core.cjs");
const { projectPublicResult } = require("../core/public-result.cjs");
const {
  abortSignalOnClose,
  commonHeaders,
  publicError,
  runBillableRequest,
  validateOptimizerPayload
} = require("../request-guard.cjs");

module.exports = async function handler(req, res) {
  for (const [name, value] of Object.entries(commonHeaders())) res.setHeader(name, value);
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const parsed = validateOptimizerPayload(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const disconnectSignal = abortSignalOnClose(res);
    const guarded = await runBillableRequest({
      req,
      signal: disconnectSignal,
      payload: parsed.data,
      endpoint: "/api/optimize-run",
      funding: parsed.data.provider === "offline" ? "offline" : "server",
      execute: async ({ signal }) => {
        const result = await runSelfOptimizingWorkflow({
          rawInput: parsed.data.input,
          provider: parsed.data.provider || "groq-openai-fallback",
          options: parsed.data.options || {},
          signal,
          telemetryContext: { endpoint: "/api/optimize-run" }
        });
        return projectPublicResult(result, { includePreparedArtifacts: true });
      }
    });
    for (const [name, value] of Object.entries(commonHeaders(guarded.rate))) res.setHeader(name, value);
    if (!guarded.ok) {
      if (guarded.retryAfterSeconds) res.setHeader("retry-after", String(guarded.retryAfterSeconds));
      res.status(guarded.status).json({ error: guarded.error, code: guarded.code });
      return;
    }
    res.setHeader("x-idempotency-status", guarded.idempotencyStatus);
    res.status(200).json(guarded.value);
  } catch (error) {
    res.status(500).json({ error: publicError(error) });
  }
};

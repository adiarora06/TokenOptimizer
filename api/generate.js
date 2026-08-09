const { callChatCompletion, createTraceId, generateWithFallback } = require("../optimizer-core.cjs");
const { collectConfiguredSecretValues, redactPublicValue } = require("../core/public-result.cjs");
const {
  abortSignalOnClose,
  commonHeaders,
  publicError,
  runBillableRequest,
  validateGeneratePayload
} = require("../request-guard.cjs");

module.exports = async function handler(req, res) {
  for (const [name, value] of Object.entries(commonHeaders())) res.setHeader(name, value);
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const parsed = validateGeneratePayload(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const disconnectSignal = abortSignalOnClose(res);
    const guarded = await runBillableRequest({
      req,
      signal: disconnectSignal,
      payload: parsed.data,
      endpoint: "/api/generate",
      funding: "server",
      execute: async ({ signal }) => {
        const provider = parsed.data.provider || "groq-openai-fallback";
        const prompt = parsed.data.prompt;
        const traceId = createTraceId();
        const telemetryContext = { endpoint: "/api/generate", traceId, stage: "generate" };
        const result = provider === "openai"
          ? await callChatCompletion({ provider: "openai", prompt, signal, telemetryContext })
          : provider === "groq"
            ? await callChatCompletion({ provider: "groq", prompt, signal, telemetryContext })
            : await generateWithFallback(prompt, { signal, telemetryContext });
        return redactPublicValue(
          { ...result, traceId },
          collectConfiguredSecretValues()
        );
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

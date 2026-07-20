const { runSelfOptimizingWorkflow } = require("../optimizer-core.cjs");
const {
  commonHeaders,
  publicError,
  takeRateLimit,
  validateOptimizerPayload
} = require("../request-guard.cjs");

module.exports = async function handler(req, res) {
  const rate = takeRateLimit(req);
  for (const [name, value] of Object.entries(commonHeaders(rate))) res.setHeader(name, value);
  if (!rate.allowed) {
    res.setHeader("retry-after", String(rate.retryAfterSeconds));
    res.status(429).json({ error: "Too many runs. Please wait a moment and try again." });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const parsed = validateOptimizerPayload(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const controller = new AbortController();
    res.on?.("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    const result = await runSelfOptimizingWorkflow({
      rawInput: parsed.data.input,
      provider: parsed.data.provider || "groq-openai-fallback",
      options: parsed.data.options || {},
      signal: controller.signal
    });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: publicError(error) });
  }
};

const { SYSTEM_ARCHITECTURE, runSystemRunInline } = require("../optimizer-system.cjs");
const {
  commonHeaders,
  publicError,
  takeRateLimit,
  validateOptimizerPayload
} = require("../api-guard.cjs");

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
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const rate = takeRateLimit(req);
    for (const [name, value] of Object.entries(commonHeaders(rate))) res.setHeader(name, value);
    if (!rate.allowed) {
      res.setHeader("retry-after", String(rate.retryAfterSeconds));
      res.status(429).json({ error: "Too many runs. Please wait a moment and try again." });
      return;
    }
    const parsed = validateOptimizerPayload(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const run = await runSystemRunInline({
      rawInput: parsed.data.input,
      runType: parsed.data.runType || "optimizer",
      provider: parsed.data.provider || "groq-openai-fallback",
      providerConfig: parsed.data.providerConfig || {},
      options: parsed.data.options || {},
      source: parsed.data.source || "workspace",
      sessionId: parsed.data.sessionId || null
    });

    res.status(200).json({ run });
  } catch (error) {
    res.status(500).json({ error: publicError(error) });
  }
};

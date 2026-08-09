const { preparePortableHandoff } = require("../optimizer-core.cjs");
const {
  commonHeaders,
  publicError,
  takeRateLimit,
  validateOptimizerPayload
} = require("../request-guard.cjs");

module.exports = async function handler(req, res) {
  for (const [name, value] of Object.entries(commonHeaders())) res.setHeader(name, value);
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  let rate;
  try {
    rate = await Promise.resolve(takeRateLimit(req, { scope: "preparation" }));
  } catch (error) {
    if (error?.retryAfterSeconds) res.setHeader("retry-after", String(error.retryAfterSeconds));
    res.status(Number.isInteger(error?.status) ? error.status : 503).json({
      error: publicError(error),
      code: error?.code || "coordination_unavailable"
    });
    return;
  }
  for (const [name, value] of Object.entries(commonHeaders(rate))) res.setHeader(name, value);
  if (!rate.allowed) {
    res.setHeader("retry-after", String(rate.retryAfterSeconds));
    res.status(429).json({ error: "Too many preparations. Please wait a moment and try again." });
    return;
  }
  try {
    const parsed = validateOptimizerPayload(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const result = preparePortableHandoff({
      rawInput: parsed.data.input,
      options: parsed.data.options || {},
      target: parsed.data.target || "ai-assistant"
    });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: publicError(error) });
  }
};

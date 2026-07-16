const { SYSTEM_ARCHITECTURE, runSystemRunInline } = require("../optimizer-system.cjs");

module.exports = async function handler(req, res) {
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
    const rawInput = String(req.body?.input || "");
    if (!rawInput.trim()) {
      res.status(400).json({ error: "Missing input" });
      return;
    }

    const run = await runSystemRunInline({
      rawInput,
      runType: req.body?.runType || "optimizer",
      provider: req.body?.provider || "groq-openai-fallback",
      providerConfig: req.body?.providerConfig || {},
      options: req.body?.options || {},
      source: req.body?.source || "workspace",
      sessionId: req.body?.sessionId || null
    });

    res.status(200).json({ run });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

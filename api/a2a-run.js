const { runBlankA2AKit } = require("../optimizer-core.cjs");

module.exports = async function handler(req, res) {
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

    const result = await runBlankA2AKit({
      rawInput,
      providerConfig: req.body?.providerConfig || {},
      options: req.body?.options || {}
    });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

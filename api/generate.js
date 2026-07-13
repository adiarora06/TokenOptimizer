const { callChatCompletion, generateWithFallback } = require("../optimizer-core.cjs");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const provider = req.body?.provider || "groq-openai-fallback";
    const prompt = String(req.body?.prompt || "");
    if (!prompt.trim()) {
      res.status(400).json({ error: "Missing prompt" });
      return;
    }

    const result = provider === "openai"
      ? await callChatCompletion({ provider: "openai", prompt })
      : provider === "groq"
        ? await callChatCompletion({ provider: "groq", prompt })
        : await generateWithFallback(prompt);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

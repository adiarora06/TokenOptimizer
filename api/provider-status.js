const { providerStatus } = require("../optimizer-core.cjs");
const { commonHeaders } = require("../request-guard.cjs");

module.exports = function handler(req, res) {
  for (const [name, value] of Object.entries(commonHeaders())) res.setHeader(name, value);
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  res.status(200).json(providerStatus());
};

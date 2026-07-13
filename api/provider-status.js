const { providerStatus } = require("../optimizer-core.cjs");

module.exports = function handler(_req, res) {
  res.status(200).json(providerStatus());
};

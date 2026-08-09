const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "shared", "prompt-compiler.js");
const targets = [
  path.join(root, "outputs", "prompt-compiler.js"),
  path.join(root, "extensions", "gemini-token-optimizer", "prompt-compiler.js")
];

for (const target of targets) fs.copyFileSync(source, target);
console.log(`Synchronized prompt compiler ${targets.length} browser targets.`);

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflowDirectory = path.resolve(__dirname, "..", ".github", "workflows");
const workflowFiles = fs.readdirSync(workflowDirectory)
  .filter((file) => /\.ya?ml$/i.test(file))
  .sort();
const references = [];
const violations = [];

for (const file of workflowFiles) {
  const lines = fs.readFileSync(path.join(workflowDirectory, file), "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = line.match(/^\s*(?:-\s*)?uses:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/);
    if (!match) return;

    const reference = match[1] || match[2] || match[3];
    if (reference.startsWith("./")) return;

    references.push(reference);
    if (!/^[^@\s]+@[0-9a-f]{40}$/i.test(reference)) {
      violations.push(`${file}:${index + 1} ${reference}`);
    }
  });
}

assert.ok(references.length > 0, "Expected at least one external workflow action reference");
assert.deepEqual(
  violations,
  [],
  `External workflow actions must use immutable 40-character commit SHAs:\n${violations.join("\n")}`
);

console.log(`Verified ${references.length} immutable workflow action references`);

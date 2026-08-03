const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const outputsDir = path.resolve(__dirname, "../outputs");
const htmlFiles = fs.readdirSync(outputsDir)
  .filter((file) => file.endsWith(".html"))
  .sort();

let checkedScripts = 0;

for (const file of htmlFiles) {
  const source = fs.readFileSync(path.join(outputsDir, file), "utf8");
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  let inlineIndex = 0;

  while ((match = scriptPattern.exec(source))) {
    const attributes = match[1];
    const script = match[2];
    if (/\bsrc\s*=/i.test(attributes)) continue;
    if (/\btype\s*=\s*["'](?:application\/json|importmap)["']/i.test(attributes)) continue;

    inlineIndex += 1;
    assert.doesNotThrow(
      () => new vm.Script(script, { filename: `${file}#inline-${inlineIndex}` }),
      `Inline script syntax failed in ${file}#inline-${inlineIndex}`
    );
    checkedScripts += 1;
  }
}

assert.ok(checkedScripts > 0, "Expected at least one inline script to be checked.");
console.log(`frontend static tests passed (${checkedScripts} inline scripts)`);

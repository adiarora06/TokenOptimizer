const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const outputsDir = path.resolve(__dirname, "../outputs");
const privacySource = fs.readFileSync(path.join(outputsDir, "privacy.html"), "utf8");
const retiredGenerator = path.join(outputsDir, "token-optimizer-file-generator.html");
const faviconPath = path.join(outputsDir, "favicon.svg");
const vercelConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../vercel.json"), "utf8"));

assert.match(privacySource, /Token Optimizer for Gemini and ChatGPT/);
assert.match(privacySource, /does not persist raw or prepared prompt text/i);
assert.doesNotMatch(privacySource, /stores the latest raw prompt/i);
assert.equal(fs.existsSync(retiredGenerator), false, "The retired browser-key generator must not be shipped.");
assert.match(fs.readFileSync(faviconPath, "utf8"), /<svg\b/);
assert.ok(
  vercelConfig.rewrites.some((rewrite) => rewrite.source === "/favicon.ico" && rewrite.destination === "/outputs/favicon.svg"),
  "Vercel should serve the branded favicon at the browser-default path."
);

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

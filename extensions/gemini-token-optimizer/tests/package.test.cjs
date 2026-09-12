const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  PACKAGE_FILES,
  archiveEntries,
  buildPackage,
  extensionRoot,
  validateSourceReferences
} = require("../../../scripts/package-chrome-extension.cjs");

(async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "token-optimizer-package-test-"));
  const originalTimezone = process.env.TZ;
  try {
    const manifest = validateSourceReferences();
    assert.deepEqual(manifest.permissions, ["sidePanel"]);
    assert.equal(manifest.version, "0.3.0");
    assert(PACKAGE_FILES.includes("prompt-compiler.js"));

    const firstPath = path.join(temporaryRoot, "first.zip");
    const secondPath = path.join(temporaryRoot, "second.zip");
    process.env.TZ = "America/New_York";
    const first = await buildPackage({ outputPath: firstPath, quiet: true });
    process.env.TZ = "Asia/Tokyo";
    const second = await buildPackage({ outputPath: secondPath, quiet: true });

    assert.deepEqual(archiveEntries(firstPath), [...PACKAGE_FILES]);
    assert.deepEqual(archiveEntries(secondPath), [...PACKAGE_FILES]);
    assert.equal(first.sha256, second.sha256);
    assert.deepEqual(fs.readFileSync(firstPath), fs.readFileSync(secondPath));

    const sidepanel = fs.readFileSync(path.join(extensionRoot, "sidepanel.html"), "utf8");
    assert.match(sidepanel, /Before you capture, type, or prepare/);
    assert.match(sidepanel, /I understand and agree to this prompt, metric, and request-data handling/);
    assert.match(sidepanel, /<textarea id="rawPrompt" disabled/);
    assert.match(sidepanel, /<button id="capturePrompt" disabled/);
    assert.match(sidepanel, /id="preparePrompt"/);
    assert.match(sidepanel, /id="promptDiff"/);
    assert.match(sidepanel, /Review changes/);
    assert.doesNotMatch(sidepanel, /id="optimize(?:Prompt|Insert)"/);
    assert.match(sidepanel, /tok-pi-gilt\.vercel\.app\/privacy/);

    console.log(`extension package tests passed (${first.size} bytes, ${first.sha256.slice(0, 12)}…)`);
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");
const checkOnly = process.argv.includes("--check");

const vendorFiles = Object.freeze([
  ["node_modules/dompurify/dist/purify.min.js", "outputs/vendor/dompurify/purify.min.js"],
  ["node_modules/dompurify/LICENSE", "outputs/vendor/dompurify/LICENSE"],
  ["node_modules/dompurify/LICENSE-MPL", "outputs/vendor/dompurify/LICENSE-MPL"],
  ["node_modules/marked/lib/marked.umd.js", "outputs/vendor/marked/marked.umd.js"],
  ["node_modules/marked/LICENSE", "outputs/vendor/marked/LICENSE"],
  ["node_modules/@tabler/icons-webfont/dist/tabler-icons.min.css", "outputs/vendor/tabler/tabler-icons.min.css"],
  ["node_modules/@tabler/icons-webfont/dist/fonts/tabler-icons.woff2", "outputs/vendor/tabler/fonts/tabler-icons.woff2"],
  ["node_modules/@tabler/icons-webfont/LICENSE", "outputs/vendor/tabler/LICENSE"]
]);

const staleFiles = [];

for (const [sourceRelative, destinationRelative] of vendorFiles) {
  const source = path.join(repositoryRoot, sourceRelative);
  const destination = path.join(repositoryRoot, destinationRelative);

  if (!fs.existsSync(source)) {
    throw new Error(`Missing installed vendor source: ${sourceRelative}. Run npm ci first.`);
  }

  const matches = fs.existsSync(destination)
    && fs.readFileSync(source).equals(fs.readFileSync(destination));

  if (matches) continue;
  if (checkOnly) {
    staleFiles.push(destinationRelative);
    continue;
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

if (staleFiles.length > 0) {
  throw new Error(`Vendored browser assets are stale:\n${staleFiles.map((file) => `- ${file}`).join("\n")}\nRun npm run sync:vendor.`);
}

console.log(checkOnly ? "vendored browser assets are current" : "vendored browser assets synchronized");

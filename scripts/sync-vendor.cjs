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
  ["node_modules/@tabler/icons-webfont/dist/fonts/tabler-icons.woff", "outputs/vendor/tabler/fonts/tabler-icons.woff"],
  ["node_modules/@tabler/icons-webfont/dist/fonts/tabler-icons.ttf", "outputs/vendor/tabler/fonts/tabler-icons.ttf"],
  ["node_modules/@tabler/icons-webfont/LICENSE", "outputs/vendor/tabler/LICENSE"]
]);

const vendorMapping = new Map(vendorFiles.map(([source, destination]) => [
  path.normalize(source),
  path.normalize(destination)
]));

function localCssUrls(sourceRelative) {
  const source = fs.readFileSync(path.join(repositoryRoot, sourceRelative), "utf8");
  const urls = [];
  const urlPattern = /url\(\s*["']?([^"')]+)["']?\s*\)/g;
  let match;

  while ((match = urlPattern.exec(source))) {
    const reference = match[1].trim();
    if (/^(?:data:|https?:|#)/i.test(reference)) continue;
    urls.push(reference.split(/[?#]/, 1)[0]);
  }

  return urls;
}

for (const [sourceRelative, destinationRelative] of vendorFiles) {
  if (!sourceRelative.endsWith(".css")) continue;

  for (const reference of localCssUrls(sourceRelative)) {
    const referencedSource = path.normalize(path.join(path.dirname(sourceRelative), reference));
    const referencedDestination = path.normalize(path.join(path.dirname(destinationRelative), reference));

    if (vendorMapping.get(referencedSource) !== referencedDestination) {
      throw new Error(
        `Vendored CSS asset is not mapped: ${sourceRelative} references ${reference}. `
        + "Add its source and destination to vendorFiles."
      );
    }
  }
}

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

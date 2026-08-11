const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repositoryRoot = path.resolve(__dirname, "..");
const extensionRoot = path.join(repositoryRoot, "extensions", "gemini-token-optimizer");
const fixedTimestamp = new Date("2000-01-01T00:00:00.000Z");

const PACKAGE_FILES = Object.freeze([
  "manifest.json",
  "service-worker.js",
  "content-bridge.js",
  "platforms.js",
  "prompt-compiler.js",
  "adapters/base.js",
  "adapters/gemini.js",
  "adapters/chatgpt.js",
  "sidepanel.html",
  "sidepanel.css",
  "sidepanel.js",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png"
]);

function fail(message) {
  throw new Error(`Chrome extension package error: ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: { ...process.env, ...(options.env || {}) },
    stdio: options.capture ? "pipe" : ["ignore", "pipe", "pipe"]
  });
  if (result.error) fail(`${command} is unavailable: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} failed${result.stderr?.trim() ? `: ${result.stderr.trim()}` : ""}`);
  }
  return String(result.stdout || "");
}

function localReference(value) {
  const reference = String(value || "").trim();
  if (!reference || reference.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(reference)) return null;
  const withoutQuery = reference.split(/[?#]/, 1)[0];
  const normalized = path.posix.normalize(withoutQuery);
  if (normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    fail(`unsafe local reference ${JSON.stringify(reference)}`);
  }
  return normalized;
}

function validateSourceReferences() {
  const manifestPath = path.join(extensionRoot, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const references = new Set([
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
    ...(manifest.content_scripts || []).flatMap((entry) => entry.js || [])
  ].map(localReference).filter(Boolean));

  const sidepanelPath = localReference(manifest.side_panel?.default_path);
  if (!sidepanelPath) fail("manifest side panel path is missing");
  const sidepanel = fs.readFileSync(path.join(extensionRoot, sidepanelPath), "utf8");
  for (const match of sidepanel.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) {
    const reference = localReference(match[1]);
    if (reference) references.add(reference);
  }

  for (const reference of references) {
    if (!PACKAGE_FILES.includes(reference)) fail(`${reference} is referenced but absent from the allowlist`);
  }

  for (const relativePath of PACKAGE_FILES) {
    const absolutePath = path.join(extensionRoot, relativePath);
    if (!fs.statSync(absolutePath, { throwIfNoEntry: false })?.isFile()) {
      fail(`required file is missing: ${relativePath}`);
    }
  }

  const executableSources = PACKAGE_FILES.filter((file) => /\.(?:html|js)$/.test(file));
  for (const relativePath of executableSources) {
    const source = fs.readFileSync(path.join(extensionRoot, relativePath), "utf8");
    if (/<script\b[^>]*\bsrc=["']https?:/i.test(source)) fail(`remote script found in ${relativePath}`);
    if (/\b(?:eval|Function)\s*\(/.test(source)) fail(`dynamic code execution found in ${relativePath}`);
    if (/\bimport\s*\(\s*["']https?:/i.test(source)) fail(`remote module import found in ${relativePath}`);
  }

  return manifest;
}

function archiveEntries(archivePath) {
  return run("unzip", ["-Z1", archivePath], { capture: true })
    .split(/\r?\n/)
    .filter(Boolean);
}

async function buildPackage(options = {}) {
  const manifest = validateSourceReferences();
  const defaultName = `token-optimizer-chrome-v${manifest.version}.zip`;
  const outputPath = path.resolve(options.outputPath || path.join(repositoryRoot, defaultName));
  if (path.extname(outputPath).toLowerCase() !== ".zip") fail("output must end in .zip");

  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "token-optimizer-extension-"));
  const stagingRoot = path.join(temporaryRoot, "package");
  try {
    for (const relativePath of PACKAGE_FILES) {
      const sourcePath = path.join(extensionRoot, relativePath);
      const stagedPath = path.join(stagingRoot, relativePath);
      await fs.promises.mkdir(path.dirname(stagedPath), { recursive: true });
      await fs.promises.copyFile(sourcePath, stagedPath);
      await fs.promises.chmod(stagedPath, 0o644);
      await fs.promises.utimes(stagedPath, fixedTimestamp, fixedTimestamp);
    }

    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.promises.rm(outputPath, { force: true });
    run("zip", ["-X", "-q", "-9", outputPath, ...PACKAGE_FILES], {
      cwd: stagingRoot,
      env: { TZ: "UTC" }
    });
    run("unzip", ["-tqq", outputPath], { capture: true });

    const entries = archiveEntries(outputPath);
    if (JSON.stringify(entries) !== JSON.stringify(PACKAGE_FILES)) {
      fail(`archive contents differ from the release allowlist: ${entries.join(", ")}`);
    }

    const bytes = await fs.promises.readFile(outputPath);
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    if (!options.quiet) {
      process.stdout.write(`Built ${outputPath}\nSHA-256 ${sha256}\n${PACKAGE_FILES.length} verified runtime files\n`);
    }
    return { outputPath, sha256, entries, size: bytes.length };
  } finally {
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
  }
}

function outputArgument(argv) {
  let outputPath;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output") {
      outputPath = argv[index + 1];
      if (!outputPath) fail("--output requires a path");
      index += 1;
    } else if (argument.startsWith("--output=")) {
      outputPath = argument.slice("--output=".length);
    } else {
      fail(`unknown argument ${JSON.stringify(argument)}`);
    }
  }
  return outputPath;
}

if (require.main === module) {
  buildPackage({ outputPath: outputArgument(process.argv.slice(2)) }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  PACKAGE_FILES,
  archiveEntries,
  buildPackage,
  extensionRoot,
  validateSourceReferences
};

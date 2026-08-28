const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const graphDirectory = path.join(root, "graphify-out");
const removableDirectories = [
  path.join(root, "audit"),
  path.join(root, "tmp"),
  path.join(graphDirectory, "cache"),
  path.join(graphDirectory, ".graphify_python"),
  path.join(graphDirectory, ".graphify_root"),
];

if (fs.existsSync(graphDirectory)) {
  for (const entry of fs.readdirSync(graphDirectory, { withFileTypes: true })) {
    if (entry.isDirectory() && /^20\d{2}-\d{2}-\d{2}$/.test(entry.name)) {
      removableDirectories.push(path.join(graphDirectory, entry.name));
    }
  }
}

const removableFiles = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /^token-optimizer-chrome-v[\w.-]+\.zip$/.test(entry.name))
  .map((entry) => path.join(root, entry.name));

const targets = [...removableDirectories, ...removableFiles];
let removed = 0;

for (const target of targets) {
  if (!fs.existsSync(target)) continue;
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`removed ${path.relative(root, target)}`);
  removed += 1;
}

console.log(removed ? `cleaned ${removed} generated target(s)` : "already clean");

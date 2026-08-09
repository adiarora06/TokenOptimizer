const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const extensionDir = path.resolve(__dirname, "..");
const panelOptions = [];

const context = {
  console,
  globalThis: null,
  URL,
  chrome: {
    runtime: { onInstalled: { addListener() {} } },
    tabs: {
      onUpdated: { addListener() {} },
      onActivated: { addListener() {} },
      get: async () => ({})
    },
    sidePanel: {
      setPanelBehavior: async () => {},
      setOptions: async (options) => { panelOptions.push(options); }
    }
  }
};
context.globalThis = context;

const platformsCode = fs.readFileSync(path.join(extensionDir, "platforms.js"), "utf8");
const serviceWorkerCode = fs
  .readFileSync(path.join(extensionDir, "service-worker.js"), "utf8")
  .replace(/^import\s+["']\.\/platforms\.js["'];\s*/, "");

vm.runInNewContext(`${platformsCode}\n${serviceWorkerCode}`, context);

context.setPanelForTab(1, "https://gemini.google.com/app");
context.setPanelForTab(2, "https://chatgpt.com/");
context.setPanelForTab(3, "https://chat.openai.com/c/example");
context.setPanelForTab(4, "https://example.com/");

assert.deepEqual(
  panelOptions.map(({ tabId, enabled }) => ({ tabId, enabled })),
  [
    { tabId: 1, enabled: true },
    { tabId: 2, enabled: true },
    { tabId: 3, enabled: true },
    { tabId: 4, enabled: false }
  ]
);

console.log("service worker platform tests passed");

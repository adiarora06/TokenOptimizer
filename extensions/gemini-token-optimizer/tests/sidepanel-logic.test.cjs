const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const extensionDir = path.resolve(__dirname, "..");
const elements = new Map();

function element(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      id,
      textContent: "",
      value: "",
      hidden: false,
      disabled: false,
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {},
      setAttribute() {},
      removeAttribute() {}
    });
  }
  return elements.get(id);
}

let fetchRequest = null;
const preparedResponse = {
  optimizedPrompt: "Please create a binary search program for range(0, 70).",
  strategy: "pass-through",
  tokenReport: {
    rawInputTokens: 24,
    optimizedPromptTokens: 14,
    estimatedSavingsTokens: 10,
    estimatedSavingsPercent: 42,
    modelCalls: 0
  }
};

const context = {
  console,
  globalThis: null,
  document: {
    getElementById: element,
    querySelectorAll: () => []
  },
  chrome: {
    storage: { local: { get: async () => ({}), set: async () => {} } },
    tabs: { query: async () => [] }
  },
  navigator: { clipboard: { writeText: async () => {} } },
  fetch: async (url, options) => {
    fetchRequest = { url, options };
    return { json: async () => preparedResponse, ok: true };
  },
  clearTimeout,
  setTimeout
};
context.globalThis = context;

const platformsCode = fs.readFileSync(path.join(extensionDir, "platforms.js"), "utf8");
const sidepanelCode = fs
  .readFileSync(path.join(extensionDir, "sidepanel.js"), "utf8")
  .replace(/\ninit\(\);\s*$/, "\n");

vm.runInNewContext(`${platformsCode}\n${sidepanelCode}
this.__looksPrepared = looksPrepared;
this.__platformForUrl = platformForUrl;
this.__requestPreparation = requestPreparation;
this.__renderMetrics = renderMetrics;
`, context);

assert.equal(context.__platformForUrl("https://gemini.google.com/app").id, "gemini");
assert.equal(context.__platformForUrl("https://example.com"), null);
assert.equal(context.__looksPrepared("Complete this task directly.\nTask:\nBuild it."), true);
assert.equal(context.__looksPrepared("Build a clean implementation."), false);

context.__renderMetrics(preparedResponse);
assert.equal(element("rawTokenMetric").textContent, 24);
assert.equal(element("readyTokenMetric").textContent, 14);
assert.equal(element("savedTokenMetric").textContent, "10 (42%)");
assert.equal(element("modelCallMetric").textContent, 0);
assert.equal(element("routeNote").textContent, "Prepared without calling a model.");

(async () => {
  const result = await context.__requestPreparation(
    "Create a binary search program for range(0, 70).",
    { id: "gemini" }
  );
  assert.equal(result.optimizedPrompt, preparedResponse.optimizedPrompt);
  assert.match(fetchRequest.url, /\/api\/prepare-handoff$/);
  const body = JSON.parse(fetchRequest.options.body);
  assert.equal(body.target, "gemini");
  assert.equal(body.source, "browser-extension");
  assert.equal(body.provider, undefined);
  console.log("sidepanel logic tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

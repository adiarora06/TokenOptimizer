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
      checked: false,
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
let tabQueryCalls = 0;
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
    tabs: { query: async () => { tabQueryCalls += 1; return []; } }
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
const compilerCode = fs.readFileSync(path.join(extensionDir, "prompt-compiler.js"), "utf8");
const sidepanelCode = fs
  .readFileSync(path.join(extensionDir, "sidepanel.js"), "utf8")
  .replace(/\ninit\(\);\s*$/, "\n");

vm.runInNewContext(`${platformsCode}\n${compilerCode}\n${sidepanelCode}
this.__platformForUrl = platformForUrl;
this.__requestPreparation = requestPreparation;
this.__renderMetrics = renderMetrics;
this.__rawPromptForPreparation = rawPromptForPreparation;
this.__preparePrompt = preparePrompt;
this.__capturePrompt = capturePrompt;
this.__syncDataConsentControls = syncDataConsentControls;
`, context);

assert.equal(context.__platformForUrl("https://gemini.google.com/app").id, "gemini");
assert.equal(context.__platformForUrl("https://chatgpt.com/").id, "chatgpt");
assert.equal(context.__platformForUrl("https://chat.openai.com/c/example").id, "chatgpt");
assert.equal(context.__platformForUrl("https://example.com"), null);

context.__renderMetrics(preparedResponse);
assert.equal(element("rawTokenMetric").textContent, 24);
assert.equal(element("readyTokenMetric").textContent, 14);
assert.equal(element("savedTokenMetric").textContent, "10 (42%)");
assert.equal(element("modelCallMetric").textContent, 0);
assert.equal(element("routeNote").textContent, "Prepared without calling a model.");

(async () => {
  fetchRequest = null;
  element("dataConsent").checked = false;
  context.__syncDataConsentControls();
  assert.equal(element("rawPrompt").disabled, true);
  assert.equal(element("capturePrompt").disabled, true);
  await context.__preparePrompt({ insert: false });
  assert.equal(fetchRequest, null);
  await assert.rejects(context.__capturePrompt(), /consent/i);
  assert.equal(tabQueryCalls, 0);
  assert.equal(element("statusTitle").textContent, "Consent required before preparation");

  const promptAboutOptimization = "Explain token optimization and handoff contracts.";
  element("rawPrompt").value = promptAboutOptimization;
  assert.equal(await context.__rawPromptForPreparation(), promptAboutOptimization);

  const result = await context.__requestPreparation(
    "Create a binary search program for range(0, 70)."
  );
  assert.equal(result.optimizedPrompt, preparedResponse.optimizedPrompt);
  assert.match(fetchRequest.url, /\/api\/prepare-handoff$/);
  const body = JSON.parse(fetchRequest.options.body);
  assert.equal(body.target, undefined);
  assert.equal(body.source, "browser-extension");
  assert.equal(body.provider, undefined);
  console.log("sidepanel logic tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

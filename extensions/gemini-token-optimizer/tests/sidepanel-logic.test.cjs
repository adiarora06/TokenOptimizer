const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const extensionDir = path.resolve(__dirname, "..");
const elements = new Map();

function createElement(id = "", tagName = "DIV") {
  return {
    id,
    tagName,
    textContent: "",
    value: "",
    checked: false,
    hidden: false,
    disabled: false,
    children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) {
      this.children = children.flatMap((child) => child?.isFragment ? child.children : [child]);
    },
    setAttribute() {},
    removeAttribute() {}
  };
}

function element(id) {
  if (!elements.has(id)) elements.set(id, createElement(id));
  return elements.get(id);
}

let fetchRequest = null;
let tabQueryCalls = 0;
let activeTabs = [];
let activationListener = null;
let updateListener = null;
const preparedResponse = {
  optimizedPrompt: "Please create a binary search program for range(0, 70).",
  strategy: "pass-through",
  workflowShape: { route: "direct" },
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
  window: { addEventListener() {} },
  document: {
    hidden: false,
    addEventListener() {},
    createElement: (tagName) => createElement("", tagName.toUpperCase()),
    createDocumentFragment: () => ({ isFragment: true, children: [], appendChild(child) { this.children.push(child); } }),
    getElementById: element,
    querySelectorAll: () => []
  },
  chrome: {
    tabs: {
      onActivated: { addListener(listener) { activationListener = listener; } },
      onUpdated: { addListener(listener) { updateListener = listener; } },
      query: async () => { tabQueryCalls += 1; return activeTabs; },
      sendMessage: async () => ({ ok: true, hasInput: true })
    }
  },
  navigator: { clipboard: { writeText: async () => {} } },
  fetch: async (url, options) => {
    fetchRequest = { url, options };
    return { json: async () => preparedResponse, ok: true };
  },
  clearTimeout,
  setTimeout,
  Uint16Array
};
context.globalThis = context;

const platformsCode = fs.readFileSync(path.join(extensionDir, "platforms.js"), "utf8");
const compilerCode = fs.readFileSync(path.join(extensionDir, "prompt-compiler.js"), "utf8");
const sidepanelCode = fs
  .readFileSync(path.join(extensionDir, "sidepanel.js"), "utf8")
  .replace(/\ninit\(\);\s*$/, "\n");

vm.runInNewContext(`${platformsCode}\n${compilerCode}\n${sidepanelCode}
this.__platformForUrl = platformForUrl;
this.__diffPromptTokens = diffPromptTokens;
this.__renderPromptDiff = renderPromptDiff;
this.__requestPreparation = requestPreparation;
this.__renderMetrics = renderMetrics;
this.__rawPromptForPreparation = rawPromptForPreparation;
this.__preparePrompt = preparePrompt;
this.__capturePrompt = capturePrompt;
this.__syncActionControls = syncActionControls;
this.__checkConnection = checkConnection;
this.__bindEvents = bindEvents;
this.__state = state;
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
assert.equal(element("routeNote").textContent, "Direct route · Prepared without calling a model.");

const diff = context.__diffPromptTokens(
  "Build the fast API. Keep the repeated repeated instruction.",
  "Build the reliable API. Keep the repeated instruction."
);
assert(diff.some((part) => part.type === "removed" && part.text.includes("fast")));
assert(diff.some((part) => part.type === "added" && part.text.includes("reliable")));
assert(diff.some((part) => part.type === "same" && part.text.includes("Build")));
context.__renderPromptDiff("Ship fast code", "Ship reliable code");
assert.equal(element("diffView").hidden, false);
assert(element("promptDiff").children.some((node) => node.tagName === "DEL"));
assert(element("promptDiff").children.some((node) => node.tagName === "INS"));

(async () => {
  fetchRequest = null;
  element("dataConsent").checked = false;
  context.__syncActionControls();
  assert.equal(element("rawPrompt").disabled, true);
  assert.equal(element("capturePrompt").disabled, true);
  assert.equal(element("preparePrompt").disabled, true);
  await context.__preparePrompt();
  assert.equal(fetchRequest, null);
  await assert.rejects(context.__capturePrompt(), /consent/i);
  assert.equal(tabQueryCalls, 0);
  assert.equal(element("statusTitle").textContent, "Consent required before preparation");

  element("dataConsent").checked = true;
  context.__syncActionControls();
  assert.equal(element("rawPrompt").disabled, false);
  assert.equal(element("preparePrompt").disabled, false);
  assert.equal(element("capturePrompt").disabled, true, "Capture requires a connected assistant");

  context.__state.target = { label: "ChatGPT" };
  context.__syncActionControls();
  assert.equal(element("capturePrompt").disabled, false);
  assert.equal(element("insertTarget").disabled, true, "Insert requires a prepared result");

  const promptAboutOptimization = "Explain token optimization and handoff contracts.";
  element("rawPrompt").value = promptAboutOptimization;
  assert.equal(await context.__rawPromptForPreparation(), promptAboutOptimization);

  context.__state.target = null;
  await context.__preparePrompt();
  assert.match(fetchRequest.url, /\/api\/prepare-handoff$/);
  assert.equal(element("statusTitle").textContent, "Review what changed");
  assert.equal(element("copyPrepared").disabled, false);
  assert.equal(element("insertTarget").disabled, true);
  assert.equal(tabQueryCalls, 0, "Pasted prompts prepare without a connected assistant");

  const body = JSON.parse(fetchRequest.options.body);
  assert.equal(body.target, undefined);
  assert.equal(body.source, "browser-extension");
  assert.equal(body.provider, undefined);

  context.__state.lastResult = null;
  activeTabs = [{ id: 7, url: "https://chatgpt.com/" }];
  await context.__checkConnection();
  assert.equal(element("connectionPill").textContent, "ChatGPT ready");
  assert.equal(element("capturePrompt").disabled, false);

  context.__bindEvents();
  assert.equal(typeof activationListener, "function");
  assert.equal(typeof updateListener, "function");
  activeTabs = [{ id: 8, url: "https://example.com/" }];
  activationListener();
  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.equal(element("connectionPill").textContent, "No assistant");
  assert.equal(element("capturePrompt").disabled, true);
  console.log("sidepanel logic tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

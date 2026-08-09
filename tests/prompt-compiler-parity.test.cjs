const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const canonicalPath = path.join(root, "shared", "prompt-compiler.js");
const browserPath = path.join(root, "outputs", "prompt-compiler.js");
const extensionPath = path.join(root, "extensions", "gemini-token-optimizer", "prompt-compiler.js");
const canonicalSource = fs.readFileSync(canonicalPath, "utf8");

assert.equal(fs.readFileSync(browserPath, "utf8"), canonicalSource, "Browser compiler artifact is stale");
assert.equal(fs.readFileSync(extensionPath, "utf8"), canonicalSource, "Extension compiler artifact is stale");

const nodeCompiler = require(canonicalPath);
const browserContext = { globalThis: null };
browserContext.globalThis = browserContext;
vm.runInNewContext(canonicalSource, browserContext, { filename: "prompt-compiler.browser.js" });
const browserCompiler = browserContext.TokenOptimizerCompiler;

const prompts = [
  "Summarize this paragraph in three bullets.",
  [
    "Build a JavaScript function named parseRows.",
    "Must preserve input order.",
    "Must reject malformed rows.",
    "Must include three tests."
  ].join("\n"),
  "Deploy this database migration to production, verify every constraint, return JSON, and review it for security errors.",
  "Explain token optimization and handoff contracts.\nRequirements:\n- Compare their purposes.\n- Include one practical example.\n- Avoid internal implementation claims."
];

for (const prompt of prompts) {
  for (const routePreference of ["auto", "fast", "thorough", "verified"]) {
    const options = { routePreference };
    const server = nodeCompiler.analyzeWorkflowShape(prompt, options);
    const browser = browserCompiler.analyzeWorkflowShape(prompt, options);
    assert.deepEqual(JSON.parse(JSON.stringify(browser)), server, `${routePreference} parity failed for ${prompt.slice(0, 40)}`);
  }
}

const formerlyDivergent = nodeCompiler.analyzeWorkflowShape(prompts[1]);
assert.equal(formerlyDivergent.route, "contract");
assert.equal(formerlyDivergent.constraintCount, 3);
assert.equal(formerlyDivergent.plannedModelCalls, 2);
assert.equal(formerlyDivergent.policyVersion, "routing-1.0.0");

const compiled = nodeCompiler.compilePrompt(prompts[1]);
assert.equal(compiled.workflowRoute, formerlyDivergent.route);
assert.equal(compiled.contract.token_budget.planned_model_calls, 2);
assert.equal(compiled.contract.compiler_version, nodeCompiler.COMPILER_VERSION);

let workerMessage = null;
const workerContext = {
  globalThis: null,
  self: null,
  importScripts(source) {
    assert.equal(source, "/prompt-compiler.js");
    vm.runInNewContext(canonicalSource, workerContext, { filename: "prompt-compiler.worker.js" });
  }
};
workerContext.globalThis = workerContext;
workerContext.self = workerContext;
workerContext.postMessage = (message) => { workerMessage = message; };
const workerSource = fs.readFileSync(path.join(root, "outputs", "system-worker.js"), "utf8");
vm.runInNewContext(workerSource, workerContext, { filename: "system-worker.js" });
workerContext.onmessage({
  data: {
    type: "preflight",
    requestId: "parity-check",
    prompt: prompts[1],
    routePreference: "auto"
  }
});
assert.equal(workerMessage.requestId, "parity-check");
assert.equal(workerMessage.analysis.workflowRoute, formerlyDivergent.route);
assert.equal(workerMessage.analysis.workflowShape.policyVersion, formerlyDivergent.policyVersion);

console.log(`prompt compiler parity tests passed (${prompts.length * 4} route decisions)`);

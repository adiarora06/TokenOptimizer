const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const extensionDir = path.resolve(__dirname, "..");
const code = fs
  .readFileSync(path.join(extensionDir, "sidepanel.js"), "utf8")
  .replace(/\ninit\(\);\s*$/, "\n");

const context = {
  console,
  document: {
    getElementById: () => ({
      textContent: "",
      value: "",
      classList: { add() {}, remove() {}, toggle() {} }
    }),
    querySelectorAll: () => []
  },
  chrome: {
    storage: {
      sync: { get: async () => ({}), set: async () => {} },
      local: { get: async () => ({}), set: async () => {} }
    },
    tabs: { query: async () => [] }
  },
  navigator: { clipboard: { writeText: async () => {} } },
  fetch: async () => ({ json: async () => ({}), ok: true }),
  clearTimeout,
  setTimeout
};

vm.runInNewContext(`${code}
this.__buildSidecarPrompt = buildSidecarPrompt;
this.__unwrapOptimizerPrompt = unwrapOptimizerPrompt;
this.__isOptimizerWrappedPrompt = isOptimizerWrappedPrompt;
`, context);

const binarySearchPrompt = "I want you to create a program that runs binary search on this array to find the target 7, and tell me how many tries it took. Also create a diagram that displays the binary searches. The array is all numbers in range(0, 70)";

const clean = context.__buildSidecarPrompt({}, binarySearchPrompt);
assert.match(clean, /^Please create a program/);
assert.match(clean, /range\(0, 70\)/);
assert.doesNotMatch(clean, /Important context:/);
assert.doesNotMatch(clean, /Requirements:/);
assert.doesNotMatch(clean, /user_input/);
assert.doesNotMatch(clean, /handoff/i);
assert.doesNotMatch(clean, /token optimization|internal workflow/i);

const wrapped = `Complete this task directly and concisely.
Task:
Complete this task directly and concisely.
Important context:
- Task:
- I want you to create a program that runs binary search on this array to find the target 7, and tell me how many tries it took. Also create a diagram that displays the binary sea
- Important context:
- - I want you to create a program that runs binary search on this array to find the target 7, and tell me how many tries it took. Also create a diagram that displays the binary searches. The array is all numbers in range
Requirements:
- I want you to create a program that runs binary search on this array to find the target 7, and tell me how many tries it took. Also create a diagram that displays the binary sea
- - user_input
Output:
- Give the final answer directly.
- Do not mention token optimization, handoff contracts, or internal agent workflow.`;

const unwrapped = context.__unwrapOptimizerPrompt(wrapped);
assert.match(unwrapped, /binary search/);
assert.doesNotMatch(unwrapped, /^Complete this task directly/);
assert.doesNotMatch(unwrapped, /Important context:/);

const rebuilt = context.__buildSidecarPrompt({}, wrapped);
assert.doesNotMatch(rebuilt, /Important context:/);
assert.doesNotMatch(rebuilt, /Requirements:/);
assert.doesNotMatch(rebuilt, /user_input/);
assert.doesNotMatch(rebuilt, /token optimization|handoff contracts|internal agent workflow/i);

const longPrompt = [
  "Build a Chrome extension MVP for Gemini.",
  "It must use a side panel.",
  "It should capture prompt text.",
  "It should insert only after user confirmation.",
  "Avoid storing provider keys in the extension.",
  "Add a privacy note."
].join("\n");
const longResult = {
  handoffContract: {
    goal: "Build a Chrome extension MVP for Gemini.",
    facts: ["It must use a side panel.", "It should capture prompt text."],
    constraints: ["Avoid storing provider keys in the extension."],
    output_style: "Return implementation-ready steps."
  }
};
const structured = context.__buildSidecarPrompt(longResult, longPrompt.repeat(20));
assert.match(structured, /Task:/);
assert.match(structured, /Important context:/);
assert.match(structured, /Requirements:/);
assert.doesNotMatch(structured, /user_input/);
assert.doesNotMatch(structured, /token optimization|handoff contracts|internal agent workflow/i);

console.log("sidepanel logic tests passed");

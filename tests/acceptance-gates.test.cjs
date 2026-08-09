const assert = require("node:assert/strict");
const {
  compileAcceptanceGates,
  evaluateAcceptanceGates,
  repairAcceptanceFailures
} = require("../core/acceptance.cjs");

const jsonPrompt = `Return one JSON object describing this incident.
Requirements:
- Use exactly the keys status and owner.
- Set status to open.
- Set owner to Maya.
- Do not add Markdown or explanatory prose.`;
const jsonDefinition = compileAcceptanceGates(jsonPrompt);
assert.ok(jsonDefinition.gates.some((gate) => gate.type === "valid_json"));
assert.ok(jsonDefinition.gates.some((gate) => gate.type === "json_only"));
assert.ok(jsonDefinition.gates.some((gate) => gate.type === "json_keys"));
assert.equal(jsonDefinition.gates.filter((gate) => gate.type === "json_value").length, 2);

const validJson = evaluateAcceptanceGates({
  rawInput: jsonPrompt,
  output: '{"status":"open","owner":"Maya"}'
});
assert.equal(validJson.status, "passed");
assert.equal(validJson.failedCount, 0);

const invalidJson = evaluateAcceptanceGates({
  rawInput: jsonPrompt,
  output: '```json\n{"status":"closed","owner":"Maya","extra":true}\n```'
});
assert.equal(invalidJson.status, "failed");
assert.ok(invalidJson.gates.find((gate) => gate.type === "json_only" && !gate.passed));
assert.ok(invalidJson.gates.find((gate) => gate.type === "json_keys" && !gate.passed));
assert.ok(invalidJson.gates.find((gate) => gate.type === "json_value" && !gate.passed));

const codePrompt = `Build a JavaScript function named groupBy.
Requirements:
- Include three Node.js assert tests.`;
const passingCode = evaluateAcceptanceGates({
  rawInput: codePrompt,
  output: `function groupBy(items) { return items; }
assert.equal(groupBy([]).length, 0);
assert.deepEqual(groupBy([1]), [1]);
assert.ok(groupBy([1]));`
});
assert.equal(passingCode.passed, true);
assert.ok(passingCode.gates.find((gate) => gate.type === "named_function"));
assert.ok(passingCode.gates.find((gate) => gate.type === "minimum_tests"));

const noCodePrompt = "Explain the design without implementation code.";
const lexicalCodeWordsOnly = evaluateAcceptanceGates({
  rawInput: noCodePrompt,
  output: "The function belongs to this class, and the interface explains which constant the module can export."
});
assert.equal(lexicalCodeWordsOnly.passed, true, "code vocabulary in prose must not fail the no-code gate");
const fencedProseOnly = evaluateAcceptanceGates({
  rawInput: noCodePrompt,
  output: "```text\nThe function belongs to this class.\n```"
});
assert.equal(fencedProseOnly.passed, true, "a text fence without code structure must not fail the no-code gate");

for (const implementation of [
  "```js\nconst ready = true;\n```",
  "function groupBy(items) { return items; }",
  "const groupBy = (items) => items;",
  "interface User { id: string; }",
  "type UserId = string;",
  "def group_by(items):\n    return {}",
  "CREATE TABLE users (id INTEGER);",
  "SELECT id, name FROM users;"
]) {
  const report = evaluateAcceptanceGates({ rawInput: noCodePrompt, output: implementation });
  assert.ok(
    report.gates.find((gate) => gate.type === "no_code" && !gate.passed),
    `structural implementation code must fail the no-code gate: ${implementation}`
  );
}

const oneTestPrompt = "Include one test.";
for (const prose of [
  "Call test(foo) once and describe the result.",
  "The suite uses assert.equal(foo, bar) to compare the values.",
  "A test(foo) example would be useful later.",
  '// test("ignored", () => {});',
  "# assert result == expected"
]) {
  const report = evaluateAcceptanceGates({ rawInput: oneTestPrompt, output: prose });
  const gate = report.gates.find((item) => item.type === "minimum_tests");
  assert.equal(gate.passed, false, `prose must not count as an executable test: ${prose}`);
  assert.equal(gate.observed.tests, 0);
}

for (const executableTest of [
  'test("groups values", () => {});',
  'it("preserves order", () => {});',
  "assert.equal(groupBy([]).length, 0);",
  "def test_groups_values():\n    pass",
  "assert group_by([]) == {}"
]) {
  const report = evaluateAcceptanceGates({ rawInput: oneTestPrompt, output: executableTest });
  const gate = report.gates.find((item) => item.type === "minimum_tests");
  assert.equal(gate.passed, true, `executable test syntax must count: ${executableTest}`);
  assert.equal(gate.observed.tests, 1);
}

const formatPrompt = `Return only the integer result in no more than 3 words.
Must include the phrase "391".
Do not include the word "approximately".`;
assert.equal(evaluateAcceptanceGates({ rawInput: formatPrompt, output: "391" }).passed, true);
const badFormat = evaluateAcceptanceGates({ rawInput: formatPrompt, output: "Approximately 391 total" });
assert.equal(badFormat.passed, false);
assert.ok(badFormat.gates.find((gate) => gate.type === "integer_only" && !gate.passed));
assert.ok(badFormat.gates.find((gate) => gate.type === "forbidden_literal" && !gate.passed));

const endpointReport = evaluateAcceptanceGates({
  rawInput: "Include POST /exports and DELETE /exports/{id}. Do not include implementation code.",
  output: "POST /exports\nDELETE /exports/{id}"
});
assert.equal(endpointReport.passed, true);
assert.equal(endpointReport.gates.filter((gate) => gate.type === "required_literal").length, 2);

const proseWithoutMarkdown = compileAcceptanceGates("Write one short paragraph. Do not add Markdown.");
assert.ok(proseWithoutMarkdown.gates.some((gate) => gate.type === "no_markdown"));
assert.equal(proseWithoutMarkdown.gates.some((gate) => gate.type === "json_only"), false);

const leakedSecret = ["sk", "abcdefghijklmnopqrstuvwxyz123456789"].join("-");
const securityReport = evaluateAcceptanceGates({
  rawInput: "Return a safe confirmation.",
  output: `Confirmation: ${leakedSecret}`
});
assert.equal(securityReport.passed, false);
assert.ok(securityReport.gates.find((gate) => gate.type === "secret_absent" && !gate.passed));
assert.equal(JSON.stringify(securityReport).includes(leakedSecret), false);

const repairedJson = repairAcceptanceFailures({
  rawInput: jsonPrompt,
  output: '```json\n{"status":"closed","owner":"Maya","extra":true}\n```'
});
assert.equal(repairedJson.repairReport.status, "repaired");
assert.equal(repairedJson.repairReport.modelCalls, 0);
assert.equal(repairedJson.repairReport.actionCount, 3);
assert.equal(repairedJson.acceptanceReport.status, "passed");
assert.deepEqual(JSON.parse(repairedJson.output), { status: "open", owner: "Maya" });

const repairedSecret = repairAcceptanceFailures({
  rawInput: "Return a safe confirmation.",
  output: `Confirmation: ${leakedSecret}`
});
assert.equal(repairedSecret.repairReport.status, "repaired");
assert.equal(repairedSecret.acceptanceReport.status, "passed");
assert.equal(repairedSecret.output.includes(leakedSecret), false);
assert.equal(JSON.stringify(repairedSecret).includes(leakedSecret), false);

const incompleteCode = "Here is a description, but no implementation.";
const unavailableRepair = repairAcceptanceFailures({
  rawInput: codePrompt,
  output: incompleteCode
});
assert.equal(unavailableRepair.repairReport.status, "unavailable");
assert.equal(unavailableRepair.output, incompleteCode);
assert.equal(unavailableRepair.acceptanceReport.status, "failed");

const repairedMarkdown = repairAcceptanceFailures({
  rawInput: "Write one short paragraph. Do not add Markdown.",
  output: "## Ready\n\n**Everything** is complete."
});
assert.equal(repairedMarkdown.repairReport.status, "repaired");
assert.equal(repairedMarkdown.output, "Ready\n\nEverything is complete.");

const partialRepair = repairAcceptanceFailures({
  rawInput: "Build a JavaScript function named groupBy. Do not add Markdown.",
  output: "## Implementation pending"
});
assert.equal(partialRepair.repairReport.status, "partial");
assert.equal(partialRepair.output, "Implementation pending");
assert.equal(partialRepair.acceptanceReport.failedCount, 1);

const repairedInteger = repairAcceptanceFailures({
  rawInput: "Return only the integer result.",
  output: "The result is 391."
});
assert.equal(repairedInteger.repairReport.status, "repaired");
assert.equal(repairedInteger.output, "391");

const ambiguousInteger = repairAcceptanceFailures({
  rawInput: "Return only the integer result.",
  output: "Choose 391, not 392."
});
assert.equal(ambiguousInteger.repairReport.status, "unavailable");
assert.equal(ambiguousInteger.output, "Choose 391, not 392.");

const unsafeTradeoff = repairAcceptanceFailures({
  rawInput: 'Return only the integer result. Must include the phrase "391". Do not include the phrase "39".',
  output: "391"
});
assert.equal(unsafeTradeoff.repairReport.status, "unavailable");
assert.equal(unsafeTradeoff.output, "391", "a repair that introduces a new gate failure must not be adopted");

console.log("acceptance gate tests passed");

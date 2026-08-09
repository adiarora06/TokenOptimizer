const assert = require("node:assert/strict");

const {
  loadCases,
  runDeterministicEvaluation,
  scoreOutput
} = require("../evals/harness.cjs");

const cases = loadCases();
const report = runDeterministicEvaluation({ cases });

assert.ok(cases.length >= 10, "The benchmark should cover a representative prompt set.");
assert.equal(report.summary.passed, true, report.summary.failures.join("; "));
assert.equal(report.summary.passedCases, cases.length);
assert.ok(report.summary.routes.direct > 0);
assert.ok(report.summary.routes.contract > 0);
assert.ok(report.summary.routes.full > 0);
assert.ok(report.summary.tokens.savings > 0);

const jsonScore = scoreOutput('{"status":"open","owner":"Maya"}', [
  { type: "jsonKeys", keys: ["status", "owner"] },
  { type: "regex", pattern: '"status"\\s*:\\s*"open"', flags: "i" }
]);
assert.equal(jsonScore.passed, true);
assert.equal(jsonScore.score, 1);

const failedScore = scoreOutput("secret abc123", [
  { type: "notContains", value: "abc123" }
]);
assert.equal(failedScore.passed, false);
assert.equal(failedScore.score, 0);

const extraJsonKey = scoreOutput('{"status":"open","owner":"Maya","extra":true}', [
  { type: "jsonKeys", keys: ["status", "owner"], exact: true }
]);
assert.equal(extraJsonKey.passed, false);

console.log(`evaluation harness tests passed (${cases.length} cases, ${report.summary.tokens.savingsPercent}% aggregate preparation savings)`);

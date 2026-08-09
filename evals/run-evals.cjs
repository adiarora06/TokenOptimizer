#!/usr/bin/env node

const {
  formatDeterministicReport,
  formatLiveReport,
  loadCases,
  loadThresholds,
  runDeterministicEvaluation,
  runLiveEvaluation
} = require("./harness.cjs");

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const live = args.includes("--live");
  const selectedId = argumentValue(args, "--case");
  let cases = loadCases();
  if (selectedId) {
    cases = cases.filter((item) => item.id === selectedId);
    if (!cases.length) throw new Error(`Unknown evaluation case: ${selectedId}`);
  }

  const thresholds = loadThresholds();
  const diagnosticThresholds = selectedId && !live
    ? { ...thresholds, minimumReducedCases: 0, minimumAggregateSavingsPercent: 0 }
    : thresholds;
  const report = live
    ? await runLiveEvaluation({
      cases,
      provider: argumentValue(args, "--provider") || process.env.TOKEN_OPTIMIZER_EVAL_PROVIDER || "openai",
      timeoutMs: Number(argumentValue(args, "--timeout-ms") || 45_000),
      includeAll: Boolean(selectedId),
      thresholds
    })
    : runDeterministicEvaluation({ cases, thresholds: diagnosticThresholds });

  console.log(json
    ? JSON.stringify(report, null, 2)
    : live
      ? formatLiveReport(report)
      : formatDeterministicReport(report));
  if (!report.summary.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

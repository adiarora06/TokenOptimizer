const fs = require("node:fs");
const path = require("node:path");

const {
  callChatCompletion,
  preparePortableHandoff,
  runSelfOptimizingWorkflow
} = require("../optimizer-core.cjs");
const { safeErrorMessage } = require("../core/security.cjs");

const evalDir = __dirname;

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadCases(file = path.join(evalDir, "cases.json")) {
  const cases = loadJson(file);
  if (!Array.isArray(cases) || !cases.length) throw new Error("Evaluation cases must be a non-empty array");
  const ids = new Set();
  for (const item of cases) {
    if (!item?.id || !item?.prompt) throw new Error("Every evaluation case needs an id and prompt");
    if (ids.has(item.id)) throw new Error(`Duplicate evaluation case id: ${item.id}`);
    ids.add(item.id);
  }
  return cases;
}

function loadThresholds(file = path.join(evalDir, "thresholds.json")) {
  return loadJson(file);
}

function normalized(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function includesValue(text, value) {
  return normalized(text).includes(normalized(value));
}

function retentionCheck(text, anchors = []) {
  const missing = anchors.filter((anchor) => !includesValue(text, anchor));
  return { passed: missing.length === 0, missing };
}

function removalCheck(text, forbidden = []) {
  const present = forbidden.filter((value) => includesValue(text, value));
  return { passed: present.length === 0, present };
}

function evaluatePreparedCase(item) {
  const prepared = preparePortableHandoff({ rawInput: item.prompt, target: "evaluation" });
  const repeated = preparePortableHandoff({ rawInput: prepared.optimizedPrompt, target: "evaluation" });
  const expectedRoutes = Array.isArray(item.expectedRoutes) ? item.expectedRoutes : [item.expectedRoute].filter(Boolean);
  const routePass = expectedRoutes.length === 0 || expectedRoutes.includes(prepared.workflowShape.route);
  const retention = retentionCheck(prepared.optimizedPrompt, item.mustRetain);
  const removal = removalCheck(prepared.optimizedPrompt, item.mustRemove);
  const repeatedRetention = retentionCheck(repeated.optimizedPrompt, item.mustRetain);
  const expectedRedactions = Number(item.expectedRedactions || 0);
  const redactionPass = Number(prepared.securityReport?.redactions || 0) === expectedRedactions;
  const zeroCallPass = Number(prepared.tokenReport?.modelCalls || 0) === 0;
  const idempotencePass = repeatedRetention.passed &&
    repeated.tokenReport.optimizedPromptTokens <= prepared.tokenReport.optimizedPromptTokens;
  const rawTokens = Number(prepared.tokenReport.rawInputTokens || 0);
  const preparedTokens = Number(prepared.tokenReport.optimizedPromptTokens || 0);
  const deltaTokens = rawTokens - preparedTokens;
  const passed = routePass && retention.passed && removal.passed && redactionPass && zeroCallPass && idempotencePass;

  return {
    id: item.id,
    category: item.category || "general",
    passed,
    route: prepared.workflowShape.route,
    expectedRoutes,
    rawTokens,
    preparedTokens,
    deltaTokens,
    savingsPercent: rawTokens ? Math.round((deltaTokens / rawTokens) * 100) : 0,
    strategy: prepared.strategy,
    checks: {
      route: routePass,
      retention: retention.passed,
      removal: removal.passed,
      redaction: redactionPass,
      zeroCalls: zeroCallPass,
      idempotence: idempotencePass
    },
    details: {
      missingAfterPreparation: retention.missing,
      forbiddenAfterPreparation: removal.present,
      missingAfterRepeat: repeatedRetention.missing,
      expectedRedactions,
      actualRedactions: Number(prepared.securityReport?.redactions || 0),
      repeatedTokens: Number(repeated.tokenReport.optimizedPromptTokens || 0)
    }
  };
}

function rate(results, selector) {
  if (!results.length) return 0;
  return results.filter(selector).length / results.length;
}

function roundRate(value) {
  return Number(value.toFixed(4));
}

function summarizeDeterministic(results, thresholds) {
  const rawTokens = results.reduce((sum, item) => sum + item.rawTokens, 0);
  const preparedTokens = results.reduce((sum, item) => sum + item.preparedTokens, 0);
  const savingsTokens = rawTokens - preparedTokens;
  const aggregateSavingsPercent = rawTokens ? Math.round((savingsTokens / rawTokens) * 100) : 0;
  const passRate = rate(results, (item) => item.passed);
  const routePassRate = rate(results, (item) => item.checks.route);
  const retentionPassRate = rate(results, (item) => item.checks.retention && item.checks.removal);
  const redactionPassRate = rate(results, (item) => item.checks.redaction);
  const idempotencePassRate = rate(results, (item) => item.checks.idempotence);
  const reducedCases = results.filter((item) => item.deltaTokens > 0).length;
  const increasedCases = results.filter((item) => item.deltaTokens < 0).length;
  const failures = [];

  const requireAtLeast = (label, actual, minimum) => {
    if (actual < minimum) failures.push(`${label} ${actual} is below ${minimum}`);
  };
  requireAtLeast("case pass rate", passRate, thresholds.minimumCasePassRate);
  requireAtLeast("route pass rate", routePassRate, thresholds.minimumRoutePassRate);
  requireAtLeast("retention pass rate", retentionPassRate, thresholds.minimumRetentionPassRate);
  requireAtLeast("redaction pass rate", redactionPassRate, thresholds.minimumRedactionPassRate);
  requireAtLeast("idempotence pass rate", idempotencePassRate, thresholds.minimumIdempotencePassRate);
  requireAtLeast("reduced cases", reducedCases, thresholds.minimumReducedCases);
  requireAtLeast("aggregate savings percent", aggregateSavingsPercent, thresholds.minimumAggregateSavingsPercent);
  if (increasedCases > thresholds.maximumIncreasedCases) {
    failures.push(`increased cases ${increasedCases} exceeds ${thresholds.maximumIncreasedCases}`);
  }

  return {
    mode: "deterministic",
    suiteVersion: thresholds.suiteVersion,
    passed: failures.length === 0,
    caseCount: results.length,
    passedCases: results.filter((item) => item.passed).length,
    failedCases: results.filter((item) => !item.passed).map((item) => item.id),
    rates: {
      casePass: roundRate(passRate),
      route: roundRate(routePassRate),
      retention: roundRate(retentionPassRate),
      redaction: roundRate(redactionPassRate),
      idempotence: roundRate(idempotencePassRate)
    },
    routes: results.reduce((counts, item) => {
      counts[item.route] = (counts[item.route] || 0) + 1;
      return counts;
    }, {}),
    tokens: {
      raw: rawTokens,
      prepared: preparedTokens,
      savings: savingsTokens,
      savingsPercent: aggregateSavingsPercent,
      reducedCases,
      unchangedCases: results.filter((item) => item.deltaTokens === 0).length,
      increasedCases
    },
    failures
  };
}

function runDeterministicEvaluation(options = {}) {
  const cases = options.cases || loadCases();
  const thresholds = options.thresholds || loadThresholds();
  const results = cases.map(evaluatePreparedCase);
  return { summary: summarizeDeterministic(results, thresholds), results };
}

function parseJsonOutput(value) {
  const source = String(value || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(source);
}

function evaluateOutputCheck(output, check) {
  const weight = Number(check.weight || 1);
  let passed = false;
  let detail = check.type;
  try {
    if (check.type === "contains") {
      passed = includesValue(output, check.value);
      detail = `contains ${check.value}`;
    } else if (check.type === "notContains") {
      passed = !includesValue(output, check.value);
      detail = `does not contain ${check.value}`;
    } else if (check.type === "regex") {
      passed = new RegExp(check.pattern, check.flags || "").test(String(output || ""));
      detail = `matches /${check.pattern}/${check.flags || ""}`;
    } else if (check.type === "maxWords") {
      const words = String(output || "").trim().split(/\s+/).filter(Boolean).length;
      passed = words <= Number(check.value);
      detail = `${words} words <= ${check.value}`;
    } else if (check.type === "jsonKeys") {
      const parsed = parseJsonOutput(output);
      const keys = Object.keys(parsed || {});
      passed = Array.isArray(check.keys) && check.keys.every((key) => keys.includes(key)) &&
        (!check.exact || keys.length === check.keys.length);
      detail = `JSON ${check.exact ? "has exactly" : "contains"} keys ${(check.keys || []).join(", ")}`;
    } else {
      detail = `unknown check type ${check.type}`;
    }
  } catch (error) {
    detail = `${detail}: ${safeErrorMessage(error, "check failed")}`;
  }
  return { type: check.type, passed, weight, detail };
}

function scoreOutput(output, checks = []) {
  if (!checks.length) return { passed: true, score: 1, checks: [] };
  const results = checks.map((check) => evaluateOutputCheck(output, check));
  const totalWeight = results.reduce((sum, item) => sum + item.weight, 0);
  const passedWeight = results.filter((item) => item.passed).reduce((sum, item) => sum + item.weight, 0);
  const score = totalWeight ? passedWeight / totalWeight : 1;
  return {
    passed: results.every((item) => item.passed),
    score: roundRate(score),
    checks: results
  };
}

async function evaluateLiveCase(item, options) {
  const provider = options.provider;
  const timeoutMs = options.timeoutMs || 45_000;
  try {
    const baselineStarted = Date.now();
    const baseline = await callChatCompletion({
      provider,
      prompt: item.prompt,
      system: "Complete the user's task directly. Preserve every requested constraint and return only the requested deliverable.",
      timeoutMs,
      maxOutputTokens: item.maxOutputTokens || 1_200
    });
    const baselineElapsedMs = Date.now() - baselineStarted;
    const optimized = await runSelfOptimizingWorkflow({
      rawInput: item.prompt,
      provider,
      options: { routePreference: "auto", timeoutMs }
    });
    const baselineQuality = scoreOutput(baseline.content, item.outputChecks);
    const optimizedQuality = scoreOutput(optimized.finalAnswer, item.outputChecks);
    return {
      id: item.id,
      category: item.category || "general",
      completed: optimized.executionStatus === "completed",
      route: optimized.workflowShape?.route || null,
      quality: {
        baseline: baselineQuality.score,
        optimized: optimizedQuality.score,
        delta: roundRate(optimizedQuality.score - baselineQuality.score),
        baselineChecks: baselineQuality.checks,
        optimizedChecks: optimizedQuality.checks
      },
      baseline: {
        provider: baseline.provider,
        model: baseline.model,
        inputTokens: Number(baseline.usage?.inputTokens || 0),
        outputTokens: Number(baseline.usage?.outputTokens || 0),
        totalTokens: Number(baseline.usage?.totalTokens || 0),
        costUsd: baseline.usage?.estimatedCostUsd ?? null,
        elapsedMs: baselineElapsedMs
      },
      optimized: {
        provider: optimized.provider,
        model: optimized.model,
        modelCalls: Number(optimized.providerUsage?.modelCalls || 0),
        inputTokens: Number(optimized.providerUsage?.inputTokens || 0),
        outputTokens: Number(optimized.providerUsage?.outputTokens || 0),
        totalTokens: Number(optimized.providerUsage?.totalTokens || 0),
        costUsd: optimized.providerUsage?.estimatedCostUsd ?? null,
        elapsedMs: Number(optimized.elapsedMs || 0)
      },
      error: optimized.providerError || null
    };
  } catch (error) {
    return {
      id: item.id,
      category: item.category || "general",
      completed: false,
      route: null,
      quality: { baseline: 0, optimized: 0, delta: 0, baselineChecks: [], optimizedChecks: [] },
      baseline: null,
      optimized: null,
      error: safeErrorMessage(error, "Live evaluation failed")
    };
  }
}

function sumMetric(results, side, field) {
  return results.reduce((sum, item) => sum + Number(item[side]?.[field] || 0), 0);
}

function sumCost(results, side) {
  const costs = results.map((item) => item[side]?.costUsd).filter((value) => value != null);
  return costs.length === results.length ? Number(costs.reduce((sum, value) => sum + Number(value), 0).toFixed(8)) : null;
}

function summarizeLive(results, thresholds) {
  const completed = results.filter((item) => item.completed);
  const average = (field) => completed.length
    ? completed.reduce((sum, item) => sum + item.quality[field], 0) / completed.length
    : 0;
  const averageBaselineQuality = roundRate(average("baseline"));
  const averageOptimizedQuality = roundRate(average("optimized"));
  const qualityDrop = averageBaselineQuality - averageOptimizedQuality;
  const failures = [];
  if (completed.length !== results.length) failures.push(`${results.length - completed.length} live case(s) did not complete`);
  const lowQuality = completed.filter((item) => item.quality.optimized < thresholds.minimumOptimizedQuality);
  const qualityRegressions = completed.filter((item) =>
    item.quality.baseline - item.quality.optimized > thresholds.maximumQualityDrop);
  if (lowQuality.length) failures.push(`optimized quality is below ${thresholds.minimumOptimizedQuality}: ${lowQuality.map((item) => item.id).join(", ")}`);
  if (qualityRegressions.length) failures.push(`quality drop exceeds ${thresholds.maximumQualityDrop}: ${qualityRegressions.map((item) => item.id).join(", ")}`);
  return {
    mode: "live",
    passed: failures.length === 0,
    caseCount: results.length,
    completedCases: completed.length,
    quality: {
      baseline: averageBaselineQuality,
      optimized: averageOptimizedQuality,
      delta: roundRate(averageOptimizedQuality - averageBaselineQuality)
    },
    baseline: {
      inputTokens: sumMetric(results, "baseline", "inputTokens"),
      outputTokens: sumMetric(results, "baseline", "outputTokens"),
      totalTokens: sumMetric(results, "baseline", "totalTokens"),
      costUsd: sumCost(results, "baseline"),
      elapsedMs: sumMetric(results, "baseline", "elapsedMs")
    },
    optimized: {
      inputTokens: sumMetric(results, "optimized", "inputTokens"),
      outputTokens: sumMetric(results, "optimized", "outputTokens"),
      totalTokens: sumMetric(results, "optimized", "totalTokens"),
      costUsd: sumCost(results, "optimized"),
      elapsedMs: sumMetric(results, "optimized", "elapsedMs"),
      modelCalls: sumMetric(results, "optimized", "modelCalls")
    },
    failures
  };
}

async function runLiveEvaluation(options = {}) {
  if (!["groq", "openai"].includes(options.provider)) {
    throw new Error("Live evaluation provider must be groq or openai");
  }
  const allCases = options.cases || loadCases();
  const selected = options.includeAll ? allCases : allCases.filter((item) => item.live === true);
  if (!selected.length) throw new Error("No cases are enabled for live evaluation");
  const results = [];
  for (const item of selected) results.push(await evaluateLiveCase(item, options));
  const thresholds = (options.thresholds || loadThresholds()).live;
  return { summary: summarizeLive(results, thresholds), results };
}

function percent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function formatDeterministicReport(report) {
  const lines = [
    "Token Optimizer deterministic evaluation",
    "",
    "status  case                              route      raw  ready  delta",
    "------  --------------------------------  ---------  ---  -----  -----"
  ];
  for (const item of report.results) {
    const status = item.passed ? "PASS" : "FAIL";
    lines.push([
      status.padEnd(6),
      item.id.slice(0, 32).padEnd(32),
      item.route.padEnd(9),
      String(item.rawTokens).padStart(3),
      String(item.preparedTokens).padStart(5),
      String(item.deltaTokens).padStart(5)
    ].join("  "));
  }
  const summary = report.summary;
  lines.push(
    "",
    `${summary.passed ? "PASS" : "FAIL"} ${summary.passedCases}/${summary.caseCount} cases`,
    `Routes: ${Object.entries(summary.routes).map(([name, count]) => `${name}=${count}`).join(" · ")}`,
    `Tokens: ${summary.tokens.raw} raw -> ${summary.tokens.prepared} prepared · ${summary.tokens.savings} saved (${summary.tokens.savingsPercent}%)`,
    `Checks: route ${percent(summary.rates.route)} · retention ${percent(summary.rates.retention)} · redaction ${percent(summary.rates.redaction)} · repeat ${percent(summary.rates.idempotence)}`
  );
  if (summary.failures.length) lines.push("Failures:", ...summary.failures.map((item) => `- ${item}`));
  return lines.join("\n");
}

function formatLiveReport(report) {
  const lines = [
    "Token Optimizer live evaluation",
    "",
    "status  case                              route      base q  opt q  delta",
    "------  --------------------------------  ---------  ------  -----  -----"
  ];
  for (const item of report.results) {
    const status = item.completed ? "DONE" : "FAIL";
    lines.push([
      status.padEnd(6),
      item.id.slice(0, 32).padEnd(32),
      String(item.route || "-").padEnd(9),
      item.quality.baseline.toFixed(2).padStart(6),
      item.quality.optimized.toFixed(2).padStart(5),
      item.quality.delta.toFixed(2).padStart(5)
    ].join("  "));
  }
  const summary = report.summary;
  lines.push(
    "",
    `${summary.passed ? "PASS" : "FAIL"} ${summary.completedCases}/${summary.caseCount} completed`,
    `Quality: ${summary.quality.baseline.toFixed(2)} baseline -> ${summary.quality.optimized.toFixed(2)} optimized (${summary.quality.delta >= 0 ? "+" : ""}${summary.quality.delta.toFixed(2)})`,
    `Input tokens: ${summary.baseline.inputTokens} baseline -> ${summary.optimized.inputTokens} optimized`,
    `Elapsed: ${summary.baseline.elapsedMs}ms baseline -> ${summary.optimized.elapsedMs}ms optimized`
  );
  if (summary.failures.length) lines.push("Failures:", ...summary.failures.map((item) => `- ${item}`));
  return lines.join("\n");
}

module.exports = {
  evaluatePreparedCase,
  formatDeterministicReport,
  formatLiveReport,
  loadCases,
  loadThresholds,
  runDeterministicEvaluation,
  runLiveEvaluation,
  scoreOutput,
  summarizeDeterministic,
  summarizeLive
};

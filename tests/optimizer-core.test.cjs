const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.TOKEN_OPTIMIZER_TEST_MODE = "1";

const {
  analyzeWorkflowShape,
  combineUsage,
  preparePortableHandoff,
  redactSensitiveText,
  runBlankA2AKit,
  runSelfOptimizingWorkflow
} = require("../optimizer-core.cjs");
const { assertSafeProviderEndpoint } = require("../core/security.cjs");
const { contextComparison } = require("../core/usage.cjs");
const { takeRateLimit } = require("../request-guard.cjs");

async function run() {
  const secret = ["gsk", "abcdefghijklmnopqrstuvwxyz123456"].join("_");
  const redacted = redactSensitiveText(`Use ${secret} and API_TOKEN=abcdefghijklmnopqrstuvwxyz123456`);
  assert.equal(redacted.count, 2);
  assert.equal(redacted.text.includes(secret), false);
  assert.match(redacted.text, /\[REDACTED_SECRET\]/);

  const modernSecrets = [
    ["AKIA", "ABCDEFGHIJKLMNOP"].join(""),
    ["ghp", "abcdefghijklmnopqrstuvwxyz0123456789"].join("_"),
    ["xoxb", "1234567890-abcdefghijklmnop"].join("-"),
    ["sk_live", "abcdefghijklmnop0123"].join("_"),
    ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "TJVA95OrM7E2cBab30RMHrHDcEfxjoYZgeFONFh7HgQ"].join("."),
    "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----"
  ];
  const modernRedacted = redactSensitiveText(modernSecrets.join("\n"));
  assert.equal(modernRedacted.count, 6);
  assert.equal(modernRedacted.types.length, 6);
  for (const value of modernSecrets) {
    assert.equal(modernRedacted.text.includes(value), false, value.slice(0, 12));
  }

  assert.throws(() => assertSafeProviderEndpoint("not a url"), /valid URL/);
  assert.throws(() => assertSafeProviderEndpoint("ftp://example.com/v1"), /HTTP or HTTPS/);
  assert.throws(() => assertSafeProviderEndpoint("https://user:pass@example.com/v1"), /URL credentials/);
  assert.equal(assertSafeProviderEndpoint("http://localhost:4000/v1"), "http://localhost:4000/v1");
  const priorEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    for (const blocked of [
      "http://localhost:4000/v1",
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.5/v1",
      "https://192.168.1.10/v1",
      "https://172.16.0.1/v1",
      "http://[::1]/v1"
    ]) {
      assert.throws(() => assertSafeProviderEndpoint(blocked), /disabled in production/, blocked);
    }
    assert.throws(() => assertSafeProviderEndpoint("http://api.example.com/v1"), /HTTPS in production/);
    assert.equal(assertSafeProviderEndpoint("https://api.example.com/v1"), "https://api.example.com/v1");
  } finally {
    process.env.NODE_ENV = priorEnv;
  }

  const rateRequest = (ip, device) => ({
    headers: device ? { "x-token-optimizer-device": device } : {},
    socket: { remoteAddress: ip }
  });
  let lastRate = null;
  for (let i = 0; i < 21; i += 1) {
    lastRate = takeRateLimit(rateRequest("203.0.113.9", `device_${i}`));
  }
  assert.equal(lastRate.allowed, false, "rotating device headers must not mint fresh rate buckets");
  assert.equal(takeRateLimit(rateRequest("203.0.113.10")).allowed, true, "a different IP gets its own bucket");

  const direct = analyzeWorkflowShape("Summarize this paragraph in three bullets.");
  assert.equal(direct.route, "direct");
  assert.equal(direct.verificationNeeded, false);

  const verified = analyzeWorkflowShape(
    "Deploy this database migration to production, verify every constraint, return JSON, and review it for security errors.",
    { routePreference: "verified" }
  );
  assert.equal(verified.route, "full");
  assert.equal(verified.verificationNeeded, true);
  assert.equal(verified.signals.highImpact, true);

  const portable = preparePortableHandoff({
    rawInput: "I want you to create Python code that runs binary search for target 7 in range(0, 70).",
    target: "gemini"
  });
  assert.equal(portable.executionStatus, "prompt_ready");
  assert.equal(portable.target, "gemini");
  assert.equal(portable.provider, null);
  assert.equal(portable.model, null);
  assert.equal(portable.tokenReport.modelCalls, 0);
  assert.equal(portable.providerUsage.modelCalls, 0);
  assert.match(portable.optimizedPrompt, /^Please create Python code/);
  assert.match(portable.optimizedPrompt, /range\(0, 70\)/);

  const repeatedRequest = [
    "Build an extendable browser wrapper for AI applications.",
    "Keep provider keys out of the extension.",
    "Keep provider keys out of the extension.",
    "Insert prompts only after a user action.",
    "Insert prompts only after a user action."
  ].join("\n");
  const compactPortable = preparePortableHandoff({ rawInput: repeatedRequest, target: "gemini" });
  assert.equal(compactPortable.tokenReport.modelCalls, 0);
  assert.ok(compactPortable.tokenReport.optimizedPromptTokens < compactPortable.tokenReport.rawInputTokens);
  assert.equal((compactPortable.optimizedPrompt.match(/Keep provider keys/g) || []).length, 1);

  const wrappedPortable = preparePortableHandoff({
    rawInput: `Complete this task directly and concisely.
Task:
I want you to create a binary search program for target 7 in range(0, 70).
Output:
- Give the final answer directly.`,
    target: "gemini"
  });
  assert.equal(wrappedPortable.strategy, "recursive-wrapper-cleanup");
  assert.doesNotMatch(wrappedPortable.optimizedPrompt, /^Complete this task directly/i);
  assert.doesNotMatch(wrappedPortable.optimizedPrompt, /handoff contracts|internal agent workflow/i);

  const portableSecret = preparePortableHandoff({
    rawInput: `Summarize this request and use ${secret}.`,
    target: "gemini"
  });
  assert.equal(portableSecret.securityReport.redactions, 1);
  assert.equal(portableSecret.optimizedPrompt.includes(secret), false);

  // Honest context math: multi-call routes report real reductions; a single
  // compact prompt that costs more than the raw baseline reports signed
  // overhead instead of a clamped zero.
  const saving = contextComparison(100, 60, 3);
  assert.equal(saving.estimatedBaselineInputTokens, 300);
  assert.equal(saving.estimatedContextDeltaTokens, 240);
  assert.equal(saving.estimatedContextSavingsTokens, 240);
  assert.equal(saving.estimatedContextSavingsPercent, 80);
  assert.equal(saving.addsFramingOverhead, false);

  const overhead = contextComparison(10, 40, 1);
  assert.equal(overhead.estimatedContextDeltaTokens, -30);
  assert.equal(overhead.estimatedContextDeltaPercent, -300);
  assert.equal(overhead.estimatedContextSavingsTokens, 0, "overhead must never be reported as a saving");
  assert.equal(overhead.estimatedContextSavingsPercent, 0);
  assert.equal(overhead.addsFramingOverhead, true);
  assert.equal(contextComparison(0, 0, 0).plannedModelCalls, 1);

  const events = [];
  const result = await runSelfOptimizingWorkflow({
    rawInput: `Create Python code that runs binary search for target 7 in range(0, 70). Secret: ${secret}`,
    provider: "groq-openai-fallback",
    options: { routePreference: "fast" },
    onEvent: (event) => events.push(event)
  });

  assert.equal(result.executionStatus, "completed");
  assert.match(result.traceId, /^trace_[a-z0-9]+_[a-z0-9]+$/);
  assert.equal(result.workflowShape.route, "direct");
  assert.equal(result.securityReport.redactions, 1);
  assert.equal(result.optimizedPrompt.includes(secret), false);
  assert.match(result.finalAnswer, /3 comparisons/i);
  assert.equal(result.tokenReport.actualUsageSource, "provider");
  assert.equal(result.tokenReport.modelCalls, 1);
  assert.ok(result.tokenReport.actualInputTokens > 0);
  assert.ok(result.tokenReport.actualOutputTokens > 0);
  // Direct route: one call, so the wrapper is pure framing overhead and the
  // report must not claim a context reduction.
  assert.equal(result.tokenReport.comparison.plannedModelCalls, 1);
  assert.ok(result.tokenReport.estimatedContextDeltaTokens <= 0, "direct route adds framing, cannot save context");
  assert.equal(result.tokenReport.estimatedSavingsTokens, 0);
  assert.equal(result.tokenReport.addsFramingOverhead, result.tokenReport.estimatedContextDeltaTokens < 0);
  assert.ok(events.some((event) => event.stage === "execute"));
  assert.ok(events.some((event) => event.type === "complete"));
  assert.ok(events.every((event) => event.traceId === result.traceId));
  assert.ok(result.trace.every((item) => item.actionId.startsWith(result.traceId)));
  assert.ok(result.trace.every((item) => item.agent && item.at && Number.isFinite(item.durationMs)));
  assert.ok(result.trace.find((item) => item.phase === "execute").finishedAt);

  const verifiedResult = await runSelfOptimizingWorkflow({
    rawInput: "Prepare a production database migration, return the exact JSON change plan, verify every constraint, and review it for security errors.",
    provider: "groq-openai-fallback",
    options: { routePreference: "verified" }
  });
  assert.equal(verifiedResult.executionStatus, "completed");
  assert.equal(verifiedResult.workflowShape.route, "full");
  assert.equal(verifiedResult.tokenReport.modelCalls, 3);
  assert.ok(verifiedResult.trace.some((item) => item.phase === "verify"));
  // Full route plans three calls, so the repeated-context baseline is 3x raw.
  assert.equal(verifiedResult.tokenReport.comparison.plannedModelCalls, 3);
  assert.equal(
    verifiedResult.tokenReport.estimatedNaiveThreeStepTokens,
    verifiedResult.tokenReport.rawInputTokens * 3
  );

  const combined = combineUsage(result.generations);
  assert.equal(combined.totalTokens, result.tokenReport.actualTotalTokens);
  assert.equal(combined.modelCalls, 1);

  const prepared = await runBlankA2AKit({
    rawInput: `Prepare a JSON API contract. Secret: ${secret}`,
    providerConfig: { provider: "offline" }
  });
  assert.equal(prepared.executionStatus, "prompt_ready");
  assert.equal(prepared.finalAnswer, "");
  assert.equal(JSON.stringify(prepared.kit).includes(secret), false);
  assert.equal(prepared.securityReport.redactions, 1);
  // Offline kit builds a single prompt, so its baseline is 1x raw, not a
  // hardcoded three-step estimate.
  assert.equal(prepared.tokenReport.comparison.plannedModelCalls, 1);
  assert.equal(
    prepared.tokenReport.estimatedNaiveThreeStepTokens,
    prepared.tokenReport.rawInputTokens
  );

  process.env.NODE_ENV = "production";
  process.env.TOKEN_OPTIMIZER_ALLOW_PRIVATE_ENDPOINTS = "0";
  const blockedEndpoint = await runBlankA2AKit({
    rawInput: "Prepare and run a short test task.",
    providerConfig: {
      provider: "custom",
      baseUrl: "http://127.0.0.1:4000/v1",
      model: "test-model",
      apiKey: "test-only-key"
    }
  });
  assert.equal(blockedEndpoint.executionStatus, "provider_error");
  assert.equal(blockedEndpoint.finalAnswer, "");
  assert.match(blockedEndpoint.providerError, /private provider endpoints are disabled/i);
  process.env.NODE_ENV = "test";

  console.log("optimizer core tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

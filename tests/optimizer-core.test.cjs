const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.TOKEN_OPTIMIZER_TEST_MODE = "1";

const {
  analyzeWorkflowShape,
  combineUsage,
  redactSensitiveText,
  runBlankA2AKit,
  runSelfOptimizingWorkflow
} = require("../optimizer-core.cjs");

async function run() {
  const secret = ["gsk", "abcdefghijklmnopqrstuvwxyz123456"].join("_");
  const redacted = redactSensitiveText(`Use ${secret} and API_TOKEN=abcdefghijklmnopqrstuvwxyz123456`);
  assert.equal(redacted.count, 2);
  assert.equal(redacted.text.includes(secret), false);
  assert.match(redacted.text, /\[REDACTED_SECRET\]/);

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

  const events = [];
  const result = await runSelfOptimizingWorkflow({
    rawInput: `Create Python code that runs binary search for target 7 in range(0, 70). Secret: ${secret}`,
    provider: "groq-openai-fallback",
    options: { routePreference: "fast" },
    onEvent: (event) => events.push(event)
  });

  assert.equal(result.executionStatus, "completed");
  assert.equal(result.workflowShape.route, "direct");
  assert.equal(result.securityReport.redactions, 1);
  assert.equal(result.optimizedPrompt.includes(secret), false);
  assert.match(result.finalAnswer, /3 comparisons/i);
  assert.equal(result.tokenReport.actualUsageSource, "provider");
  assert.equal(result.tokenReport.modelCalls, 1);
  assert.ok(result.tokenReport.actualInputTokens > 0);
  assert.ok(result.tokenReport.actualOutputTokens > 0);
  assert.ok(events.some((event) => event.stage === "execute"));
  assert.ok(events.some((event) => event.type === "complete"));

  const verifiedResult = await runSelfOptimizingWorkflow({
    rawInput: "Prepare a production database migration, return the exact JSON change plan, verify every constraint, and review it for security errors.",
    provider: "groq-openai-fallback",
    options: { routePreference: "verified" }
  });
  assert.equal(verifiedResult.executionStatus, "completed");
  assert.equal(verifiedResult.workflowShape.route, "full");
  assert.equal(verifiedResult.tokenReport.modelCalls, 3);
  assert.ok(verifiedResult.trace.some((item) => item.phase === "verify"));

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

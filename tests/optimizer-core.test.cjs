const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.TOKEN_OPTIMIZER_TEST_MODE = "1";

const {
  analyzeWorkflowShape,
  combineUsage,
  generateWithFallback,
  preparePortableHandoff,
  redactSensitiveText,
  runBlankA2AKit,
  runSelfOptimizingWorkflow
} = require("../optimizer-core.cjs");
const {
  assertSafeProviderEndpoint,
  isPublicIpAddress,
  resolveSafeProviderEndpoint,
  safeErrorMessage
} = require("../core/security.cjs");
const { resolveProvider } = require("../core/providers.cjs");
const { validateHandoffContract } = require("../core/contracts.cjs");
const { buildOfflineContract } = require("../core/routing.cjs");
const { createWorkflowBudget } = require("../core/workflow.cjs");
const { contextComparison } = require("../core/usage.cjs");
const { clientKey, takeRateLimit } = require("../request-guard.cjs");

async function run() {
  const secret = ["gsk", "abcdefghijklmnopqrstuvwxyz123456"].join("_");
  const redacted = redactSensitiveText(`Use ${secret} and API_TOKEN=abcdefghijklmnopqrstuvwxyz123456`);
  assert.equal(redacted.count, 2);
  assert.equal(redacted.text.includes(secret), false);
  assert.match(redacted.text, /\[REDACTED_SECRET\]/);
  assert.equal(safeErrorMessage(new Error(`Provider echoed Bearer ${secret}`)).includes(secret), false);

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

  const fallbackResult = await generateWithFallback(`FALLBACK_SECRET_FIXTURE ${secret}`, { timeoutMs: 5_000 });
  assert.equal(fallbackResult.attempts.length, 1);
  assert.equal(fallbackResult.attempts[0].provider, "groq");
  assert.equal(fallbackResult.attempts[0].error, "Provider request failed");
  assert.equal(JSON.stringify(fallbackResult.attempts).includes(secret), false);

  const priorProviderEnv = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    LITELLM_API_KEY: process.env.LITELLM_API_KEY,
    LITELLM_BASE_URL: process.env.LITELLM_BASE_URL,
    LITELLM_MODEL: process.env.LITELLM_MODEL
  };
  process.env.OPENAI_API_KEY = "server-openai-key";
  process.env.OPENAI_MODEL = "server-approved-model";
  process.env.LITELLM_API_KEY = "server-litellm-key";
  process.env.LITELLM_BASE_URL = "https://trusted-litellm.example/v1";
  process.env.LITELLM_MODEL = "server-litellm-model";
  try {
    const serverFunded = resolveProvider({ provider: "openai", model: "caller-premium-model" });
    assert.equal(serverFunded.apiKey, "server-openai-key");
    assert.equal(serverFunded.model, "server-approved-model");

    const callerFunded = resolveProvider({
      provider: "openai",
      apiKey: "caller-openai-key",
      model: "caller-selected-model"
    });
    assert.equal(callerFunded.apiKey, "caller-openai-key");
    assert.equal(callerFunded.model, "caller-selected-model");

    const protectedLiteLlm = resolveProvider({
      provider: "litellm",
      baseUrl: "https://caller-endpoint.example/v1",
      model: "caller-selected-model"
    });
    assert.equal(protectedLiteLlm.apiKey, "server-litellm-key");
    assert.equal(protectedLiteLlm.baseUrl, "https://trusted-litellm.example/v1/chat/completions");
    assert.equal(protectedLiteLlm.model, "server-litellm-model");
  } finally {
    for (const [name, value] of Object.entries(priorProviderEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  assert.throws(() => assertSafeProviderEndpoint("not a url"), /valid URL/);
  assert.throws(() => assertSafeProviderEndpoint("ftp://example.com/v1"), /HTTP or HTTPS/);
  assert.throws(() => assertSafeProviderEndpoint("https://user:pass@example.com/v1"), /URL credentials/);
  assert.equal(assertSafeProviderEndpoint("http://localhost:4000/v1"), "http://localhost:4000/v1");
  const priorEnv = process.env.NODE_ENV;
  const priorPrivateEndpointFlag = process.env.TOKEN_OPTIMIZER_ALLOW_PRIVATE_ENDPOINTS;
  process.env.NODE_ENV = "production";
  process.env.TOKEN_OPTIMIZER_ALLOW_PRIVATE_ENDPOINTS = "0";
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
    for (const address of ["::", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1", "203.0.113.5"]) {
      assert.equal(isPublicIpAddress(address), false, address);
    }
    assert.equal(isPublicIpAddress("8.8.8.8"), true);
    assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);

    await assert.rejects(
      resolveSafeProviderEndpoint("https://provider.example/v1", {
        lookup: async () => [{ address: "10.0.0.8", family: 4 }]
      }),
      /private provider endpoints/i
    );
    const resolvedEndpoint = await resolveSafeProviderEndpoint("https://provider.example/v1", {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }]
    });
    assert.deepEqual(resolvedEndpoint.addresses, [{ address: "93.184.216.34", family: 4 }]);
  } finally {
    process.env.NODE_ENV = priorEnv;
    if (priorPrivateEndpointFlag === undefined) delete process.env.TOKEN_OPTIMIZER_ALLOW_PRIVATE_ENDPOINTS;
    else process.env.TOKEN_OPTIMIZER_ALLOW_PRIVATE_ENDPOINTS = priorPrivateEndpointFlag;
  }

  const fallbackContract = buildOfflineContract("Create a concise JSON migration plan.");
  const validContract = validateHandoffContract(`\`\`\`json
${JSON.stringify({
    goal: "Create the migration plan",
    facts: [secret],
    constraints: ["Return JSON"],
    decisions: [],
    required_output: ["migration plan"],
    sources: ["user_input"],
    open_questions: [],
    next_action: "Create the plan",
    output_style: "JSON only",
    token_budget: { executor_max: 500 }
  })}
\`\`\``, fallbackContract);
  assert.equal(validContract.source, "provider");
  assert.equal(validContract.output.includes(secret), false);
  assert.equal(validContract.contract.token_budget.executor_target, 500);

  const invalidContract = validateHandoffContract("not JSON", fallbackContract);
  assert.equal(invalidContract.source, "local_fallback");
  assert.deepEqual(invalidContract.contract, fallbackContract);
  const truncatedContract = validateHandoffContract("{}", fallbackContract, { finishReason: "length" });
  assert.equal(truncatedContract.source, "local_fallback");
  assert.match(truncatedContract.issues[0], /truncated/i);

  const realDateNow = Date.now;
  let fakeNow = 10_000;
  Date.now = () => fakeNow;
  try {
    const budget = createWorkflowBudget(5_000);
    assert.equal(budget.remaining("contract"), 5_000);
    fakeNow += 4_100;
    assert.throws(() => budget.remaining("execution"), /exhausted before the execution stage/i);
  } finally {
    Date.now = realDateNow;
  }

  const rateRequest = (ip, device, headers = {}) => ({
    headers: { ...(device ? { "x-token-optimizer-device": device } : {}), ...headers },
    socket: { remoteAddress: ip }
  });
  const priorVercel = process.env.VERCEL;
  const priorTrustProxy = process.env.TOKEN_OPTIMIZER_TRUST_PROXY;
  delete process.env.VERCEL;
  delete process.env.TOKEN_OPTIMIZER_TRUST_PROXY;
  assert.equal(
    clientKey(rateRequest("203.0.113.20", null, { "x-forwarded-for": "8.8.8.8" })),
    "203.0.113.20",
    "standalone servers must ignore spoofable forwarding headers"
  );
  process.env.VERCEL = "1";
  assert.equal(
    clientKey(rateRequest("127.0.0.1", null, { "x-forwarded-for": "8.8.4.4" })),
    "8.8.4.4",
    "Vercel-overwritten forwarding headers identify the public client"
  );
  if (priorVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = priorVercel;
  if (priorTrustProxy === undefined) delete process.env.TOKEN_OPTIMIZER_TRUST_PROXY;
  else process.env.TOKEN_OPTIMIZER_TRUST_PROXY = priorTrustProxy;

  let lastRate = null;
  for (let i = 0; i < 21; i += 1) {
    lastRate = takeRateLimit(rateRequest("203.0.113.9", `device_${i}`));
  }
  assert.equal(lastRate.allowed, false, "rotating device headers must not mint fresh rate buckets");
  assert.equal(takeRateLimit(rateRequest("203.0.113.10")).allowed, true, "a different IP gets its own bucket");
  const preparationRate = takeRateLimit(rateRequest("203.0.113.9"), { scope: "preparation" });
  assert.equal(preparationRate.allowed, true, "free prompt preparation must not share the billable model-call bucket");
  assert.equal(preparationRate.scope, "preparation");

  const direct = analyzeWorkflowShape("Summarize this paragraph in three bullets.");
  assert.equal(direct.route, "direct");
  assert.equal(direct.verificationNeeded, false);

  const apiContractRoute = analyzeWorkflowShape(`Design an API contract.
Requirements:
- Include POST /exports.
- Include DELETE /exports/{id}.
- Return JSON examples.`);
  assert.equal(apiContractRoute.route, "contract");
  assert.equal(apiContractRoute.signals.highImpact, false, "documenting a DELETE endpoint is not a destructive action");

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

  const requirementsPortable = preparePortableHandoff({
    rawInput: `Build a JavaScript function named groupBy.
Requirements:
- Accept an array and a key selector function.
- Do not mutate the input array.
- Support missing keys.
- Include three tests.`,
    target: "chatgpt"
  });
  assert.equal(requirementsPortable.workflowShape.route, "contract");
  assert.match(requirementsPortable.optimizedPrompt, /key selector function/i);
  assert.match(requirementsPortable.optimizedPrompt, /Do not mutate/i);
  assert.match(requirementsPortable.optimizedPrompt, /Include three tests/i);

  const topicalPortable = preparePortableHandoff({
    rawInput: `Explain token optimization and handoff contracts.
Requirements:
- Compare their purposes.
- Include one practical example.
- Avoid internal implementation claims.`,
    target: "chatgpt"
  });
  assert.match(topicalPortable.optimizedPrompt, /token optimization and handoff contracts/i);
  assert.match(topicalPortable.optimizedPrompt, /Compare their purposes/i);
  assert.match(topicalPortable.optimizedPrompt, /practical example/i);

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
  assert.equal(result.acceptanceReport.status, "passed");
  assert.equal(result.acceptanceReport.failedCount, 0);
  assert.ok(result.trace.some((item) => item.phase === "acceptance" && item.status === "done"));
  assert.ok(events.some((event) => event.stage === "execute"));
  assert.ok(events.some((event) => event.type === "complete"));
  assert.ok(events.every((event) => event.traceId === result.traceId));
  assert.ok(result.trace.every((item) => item.actionId.startsWith(result.traceId)));
  assert.ok(result.trace.every((item) => item.agent && item.at && Number.isFinite(item.durationMs)));
  assert.ok(result.trace.find((item) => item.phase === "execute").finishedAt);

  const repairedResult = await runSelfOptimizingWorkflow({
    rawInput: "REPAIR_JSON_FIXTURE Return one JSON object. Use exactly the keys status and owner. Set status to open. Set owner to Maya. Do not add Markdown or explanatory prose.",
    provider: "openai",
    options: { routePreference: "fast" }
  });
  assert.equal(repairedResult.executionStatus, "completed");
  assert.equal(repairedResult.tokenReport.modelCalls, 1);
  assert.equal(repairedResult.repairReport.status, "repaired");
  assert.equal(repairedResult.repairReport.modelCalls, 0);
  assert.equal(repairedResult.repairReport.actionCount, 3);
  assert.equal(repairedResult.acceptanceReport.status, "passed");
  assert.deepEqual(JSON.parse(repairedResult.finalAnswer), { status: "open", owner: "Maya" });
  assert.ok(repairedResult.trace.some((item) => item.phase === "repair" && item.status === "done"));
  assert.equal(repairedResult.trace.filter((item) => item.phase === "acceptance").length, 2);

  const verifiedResult = await runSelfOptimizingWorkflow({
    rawInput: "Prepare a production database migration, return the exact JSON change plan, verify every constraint, and review it for security errors.",
    provider: "groq-openai-fallback",
    options: { routePreference: "verified" }
  });
  assert.equal(verifiedResult.executionStatus, "completed");
  assert.equal(verifiedResult.workflowShape.route, "full");
  assert.equal(verifiedResult.tokenReport.modelCalls, 3);
  assert.ok(verifiedResult.trace.some((item) => item.phase === "verify"));
  assert.equal(verifiedResult.acceptanceReport.status, "failed", "the generic fixture is not the requested exact JSON");
  assert.ok(verifiedResult.trace.some((item) => item.phase === "acceptance" && item.status === "error"));
  // Full route plans three calls, so the repeated-context baseline is 3x raw.
  assert.equal(verifiedResult.tokenReport.comparison.plannedModelCalls, 3);
  assert.equal(
    verifiedResult.tokenReport.estimatedNaiveThreeStepTokens,
    verifiedResult.tokenReport.rawInputTokens * 3
  );

  // With a large body, the compact workflow must beat the repeated-context
  // baseline: the contract builder embeds the raw input once, not twice.
  const largeBody = "Refactor the legacy billing service into a modular architecture with clear seams. "
    .repeat(30);
  const largeResult = await runSelfOptimizingWorkflow({
    rawInput: `${largeBody}\nReturn the exact JSON migration plan, verify every constraint, and review for security.`,
    provider: "groq-openai-fallback",
    options: { routePreference: "verified" }
  });
  assert.equal(largeResult.workflowShape.route, "full");
  assert.ok(
    largeResult.tokenReport.estimatedContextDeltaTokens > 0,
    "large multi-call route should genuinely save context, not add overhead"
  );
  assert.equal(largeResult.tokenReport.addsFramingOverhead, false);
  assert.ok(largeResult.tokenReport.estimatedSavingsPercent > 0);

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

  const repairedKit = await runBlankA2AKit({
    rawInput: "REPAIR_JSON_FIXTURE Return one JSON object. Use exactly the keys status and owner. Set status to open. Set owner to Maya. Do not add Markdown or explanatory prose.",
    providerConfig: { provider: "openai" }
  });
  assert.equal(repairedKit.executionStatus, "completed");
  assert.equal(repairedKit.providerUsage.modelCalls, 3);
  assert.equal(repairedKit.repairReport.status, "repaired");
  assert.equal(repairedKit.acceptanceReport.status, "passed");
  assert.deepEqual(JSON.parse(repairedKit.finalAnswer), { status: "open", owner: "Maya" });
  assert.ok(repairedKit.trace.some((item) => item.phase === "repair" && item.status === "done"));

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

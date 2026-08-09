const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.TOKEN_OPTIMIZER_TEST_MODE = "1";
process.env.TOKEN_OPTIMIZER_TELEMETRY_LOG = "0";

const { projectPublicResult } = require("../core/public-result.cjs");
const {
  deriveQualityStatus,
  runSelfOptimizingWorkflow
} = require("../core/workflow.cjs");

async function run() {
  const configuredSecret = "literal-from-config-8675309";
  const explicitSecret = "explicit-provider-secret-24680";
  const patternedSecret = `sk-${"a".repeat(24)}`;
  const internalFields = [
    "contractOutput",
    "executorOutput",
    "generations",
    "optimizerOutput",
    "rawProviderResponse"
  ];
  const source = {
    traceId: "trace_public_fixture",
    mode: "adaptive-contract-workflow-run",
    provider: "openai",
    model: "fixture-model",
    providerError: `safe wrapper ${configuredSecret}`,
    executionStatus: "completed",
    qualityStatus: "repaired",
    acceptanceReport: {
      status: "passed",
      evidence: [{ detail: `checked ${explicitSecret}` }]
    },
    repairReport: { status: "repaired", summary: `removed ${patternedSecret}` },
    workflowShape: { route: "full", routeReason: configuredSecret },
    securityReport: { redactions: 1, types: ["fixture"] },
    finalAnswer: `Public result ${configuredSecret} ${explicitSecret} ${patternedSecret}`,
    providerUsage: { modelCalls: 3 },
    trace: [{ phase: "execute", detail: { nested: [configuredSecret] } }],
    tokenReport: { rawInputTokens: 12, note: explicitSecret },
    elapsedMs: 42,
    handoffContract: {
      contract_id: "optimizer.contract_workflow.v2",
      goal: `private goal ${configuredSecret}`,
      facts: [configuredSecret, "second fact"],
      constraints: ["Return JSON"],
      token_budget: { executor_target: 900 },
      required_payload: ["goal", "facts"],
      forbidden_payload: ["secrets"]
    },
    kit: {
      kit_id: "contract-workflow-kit.v2",
      mode: "one-shot",
      architecture: "typed workflow",
      agents: [{ id: "executor", name: "Executor", systemPrompt: configuredSecret }],
      handoff_rules: ["Keep handoffs compact"],
      a2a_compatibility: { role: "interop layer", rawProviderState: explicitSecret },
      goal: `private kit goal ${explicitSecret}`,
      handoff_contract: {
        contract_id: "optimizer.contract_workflow.v2",
        goal: `validated goal ${explicitSecret}`,
        facts: [explicitSecret],
        token_budget: { executor_target: 900, rawPrompt: explicitSecret }
      }
    },
    contractValidation: {
      source: "provider",
      issues: [`sanitized ${configuredSecret}`],
      output: `raw serialized contract ${configuredSecret}`,
      contract: { goal: configuredSecret }
    },
    optimizedPrompt: `prepared ${configuredSecret}`,
    optimizedPrompts: [{ agent: "Executor", prompt: `prepared ${explicitSecret}` }],
    optimizerOutput: `internal ${configuredSecret}`,
    executorOutput: `internal ${explicitSecret}`,
    contractOutput: `internal ${patternedSecret}`,
    generations: [{ content: configuredSecret, raw: { token: explicitSecret } }],
    rawProviderResponse: { content: configuredSecret },
    unknownFutureIntermediate: explicitSecret
  };

  const options = {
    env: {
      OPENAI_API_KEY: configuredSecret,
      TOKEN_OPTIMIZER_TELEMETRY_LOG: "0",
      PUBLIC_SETTING: "visible-setting"
    },
    secretValues: { customProvider: explicitSecret }
  };
  const projected = projectPublicResult(source, options);
  const serialized = JSON.stringify(projected);

  assert.equal(projected.finalAnswer.includes(configuredSecret), false);
  assert.equal(projected.finalAnswer.includes(explicitSecret), false);
  assert.equal(projected.finalAnswer.includes(patternedSecret), false);
  assert.match(projected.finalAnswer, /\[REDACTED_SECRET\]/);
  assert.equal(serialized.includes(configuredSecret), false);
  assert.equal(serialized.includes(explicitSecret), false);
  assert.equal(serialized.includes(patternedSecret), false);
  assert.equal(serialized.includes("visible-setting"), false);
  assert.equal(projected.qualityStatus, "repaired");
  assert.equal(projected.acceptanceReport.status, "passed");
  assert.equal(projected.workflowShape.route, "full");
  assert.deepEqual(projected.handoffContract.token_budget, { executor_target: 900 });
  assert.equal("goal" in projected.handoffContract, false);
  assert.equal(projected.handoffContract.content_counts.facts, 2);
  assert.equal(projected.kit.kit_id, "contract-workflow-kit.v2");
  assert.equal("goal" in projected.kit, false);
  assert.equal("systemPrompt" in projected.kit.agents[0], false);
  assert.equal("rawProviderState" in projected.kit.a2a_compatibility, false);
  assert.equal("goal" in projected.kit.handoff_contract, false);
  assert.equal("rawPrompt" in projected.kit.handoff_contract.token_budget, false);
  assert.deepEqual(Object.keys(projected.contractValidation).sort(), ["issues", "source"]);
  assert.equal("optimizedPrompt" in projected, false);
  assert.equal("optimizedPrompts" in projected, false);
  assert.equal("unknownFutureIntermediate" in projected, false);
  for (const field of internalFields) assert.equal(field in projected, false, field);

  const inspectable = projectPublicResult(source, {
    ...options,
    includePreparedArtifacts: true
  });
  const inspectableJson = JSON.stringify(inspectable);
  assert.equal(inspectable.optimizedPrompt, "prepared [REDACTED_SECRET]");
  assert.equal(inspectable.optimizedPrompts[0].prompt, "prepared [REDACTED_SECRET]");
  assert.equal(inspectable.handoffContract.goal, "private goal [REDACTED_SECRET]");
  assert.equal(inspectable.kit.handoff_contract.goal, "validated goal [REDACTED_SECRET]");
  assert.equal(inspectableJson.includes(configuredSecret), false);
  assert.equal(inspectableJson.includes(explicitSecret), false);
  for (const field of internalFields) assert.equal(field in inspectable, false, field);
  assert.equal(source.finalAnswer.includes(configuredSecret), true, "projection must not mutate its input");
  assert.equal(source.kit.handoff_contract.goal.includes(explicitSecret), true);

  assert.equal(deriveQualityStatus({
    executionStatus: "provider_error",
    acceptanceReport: { status: "passed" },
    repairReport: { status: "not_needed" }
  }), "not_run", "quality is not claimed when execution did not complete");
  assert.equal(deriveQualityStatus({
    executionStatus: "completed",
    acceptanceReport: { status: "passed" },
    repairReport: { status: "repaired" }
  }), "repaired");
  assert.equal(deriveQualityStatus({
    executionStatus: "completed",
    acceptanceReport: { status: "failed" },
    repairReport: { status: "partial" }
  }), "needs_review");
  assert.equal(deriveQualityStatus({
    executionStatus: "completed",
    acceptanceReport: { status: "not_run" },
    repairReport: { status: "not_run" }
  }), "not_run");

  const offline = await runSelfOptimizingWorkflow({
    rawInput: "Prepare a concise plan.",
    provider: "offline"
  });
  assert.equal(offline.executionStatus, "prompt_ready");
  assert.equal(offline.qualityStatus, "not_run");

  console.log("public workflow result tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

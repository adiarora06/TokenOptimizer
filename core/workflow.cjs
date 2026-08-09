const { combineUsage, contextComparison, createTraceId, estimateTokens, generationRecord } = require("./usage.cjs");
const { redactSensitiveText, safeErrorMessage } = require("./security.cjs");
const { callModel, callWorkflowProvider, resolveProvider } = require("./providers.cjs");
const { analyzeWorkflowShape, buildOfflineContract } = require("./routing.cjs");
const { validateHandoffContract } = require("./contracts.cjs");
const {
  compileAcceptanceGates,
  evaluateAcceptanceGates,
  repairAcceptanceFailures,
  skippedAcceptanceReport,
  skippedRepairReport
} = require("./acceptance.cjs");
const { recordWorkflowRun } = require("./telemetry.cjs");
const {
  buildA2AContractPrompt,
  buildA2AExecutorPrompt,
  buildA2AVerifierPrompt,
  buildDirectExecutorPrompt,
  buildExecutorPrompt,
  buildOptimizerPrompt,
  buildVerifierPrompt
} = require("./prompts.cjs");

async function emitWorkflowEvent(onEvent, event) {
  if (typeof onEvent !== "function") return;
  await onEvent({ ...event, at: new Date().toISOString() });
}

function createWorkflowBudget(timeoutMs) {
  const requested = Number(timeoutMs);
  const totalMs = Number.isFinite(requested)
    ? Math.min(120_000, Math.max(5_000, Math.round(requested)))
    : 45_000;
  const deadlineAt = Date.now() + totalMs;
  return {
    deadlineAt,
    totalMs,
    remaining(stage) {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs < 1_000) {
        throw new Error(`Workflow time budget was exhausted before the ${stage} stage`);
      }
      return remainingMs;
    }
  };
}

function deriveQualityStatus({ executionStatus, acceptanceReport, repairReport } = {}) {
  if (executionStatus !== "completed") return "not_run";
  if (acceptanceReport?.status === "failed") return "needs_review";
  if (acceptanceReport?.status !== "passed") return "not_run";
  if (repairReport?.status === "repaired") return "repaired";
  return "passed";
}

function buildBlankA2AKit(rawInput, options = {}) {
  const contract = buildOfflineContract(rawInput);
  return {
    kit_id: "contract-workflow-kit.v2",
    mode: options.mode || "one-shot",
    architecture: "workflow graph + typed handoff contracts + provider adapters",
    goal: contract.goal,
    agents: [
      {
        id: "intake",
        name: "Intake Agent",
        responsibility: "Read the raw prompt once, extract the task, identify constraints, and remove obvious repetition.",
        receives: ["raw_user_prompt"],
        sends: ["goal", "facts", "constraints", "risk_notes"]
      },
      {
        id: "extractor",
        name: "Context Extractor",
        responsibility: "Keep only useful facts, constraints, deliverables, and assumptions.",
        receives: ["goal", "facts", "constraints", "risk_notes"],
        sends: ["minimal_context"]
      },
      {
        id: "contract",
        name: "Contract Builder",
        responsibility: "Create the typed handoff contract all downstream nodes must obey.",
        receives: ["minimal_context"],
        sends: ["handoff_contract"]
      },
      {
        id: "validator",
        name: "Contract Validator",
        responsibility: "Reject missing fields, raw transcript replay, secrets, and over-budget payloads.",
        receives: ["handoff_contract"],
        sends: ["validated_contract"]
      },
      {
        id: "adapter",
        name: "Provider Adapter",
        responsibility: "Route the validated payload to the configured model endpoint without exposing provider mechanics to the user.",
        receives: ["validated_contract"],
        sends: ["provider_ready_prompt"]
      },
      {
        id: "executor",
        name: "Executor Agent",
        responsibility: "Complete the user's task using only the validated contract.",
        receives: ["provider_ready_prompt"],
        sends: ["candidate_result"]
      },
      {
        id: "verifier",
        name: "Verifier Agent",
        responsibility: "Check the candidate result against the contract and remove unnecessary output.",
        receives: ["handoff_contract", "candidate_result"],
        sends: ["final_result", "token_report"]
      },
      {
        id: "output_audit",
        name: "Output And Audit",
        responsibility: "Return the final result, token report, trace, and history-ready metadata.",
        receives: ["final_result", "token_report"],
        sends: ["user_result", "audit_record"]
      }
    ],
    handoff_contract: contract,
    handoff_rules: [
      "Only Intake may receive the raw prompt.",
      "Every later node receives contract-shaped state, not the full transcript.",
      "Do not include secrets, API keys, duplicate instructions, or unrelated context in handoffs.",
      "Prefer the smallest payload that preserves task quality."
    ],
    a2a_compatibility: {
      role: "interop layer",
      note: "This kit can be represented as agent-to-agent handoffs, but the source of truth is the typed contract workflow."
    }
  };
}

async function runBlankA2AKit({
  rawInput,
  providerConfig = {},
  options = {},
  signal,
  traceId = createTraceId(),
  telemetryContext = {}
}) {
  const startedAt = Date.now();
  const workflowBudget = createWorkflowBudget(options.timeoutMs);
  const rawTokens = estimateTokens(rawInput);
  const security = redactSensitiveText(rawInput);
  const safeInput = security.text;
  const resolvedProvider = resolveProvider(providerConfig);
  const kit = buildBlankA2AKit(safeInput, options);
  const trace = [
    {
      phase: "intake",
      agent: "Intake Agent",
      status: "done",
      detail: `Read the raw prompt once and estimated ${rawTokens} tokens.`
    },
    {
      phase: "contract",
      agent: "Contract Builder",
      status: "done",
      detail: "Prepared the contract workflow kit scaffold and handoff rules."
    }
  ];

  const optimizedPrompts = [];
  const generations = [];
  let providerUsed = resolvedProvider.provider;
  let providerLabel = resolvedProvider.label;
  let modelUsed = resolvedProvider.model;
  let providerError = null;
  let executionStatus = "prompt_ready";
  let contractOutput = JSON.stringify(kit, null, 2);
  let executorOutput = "";
  let finalAnswer = "";
  let contractValidation = { source: "local_fallback", issues: [] };

  const contractPrompt = buildA2AContractPrompt(safeInput, kit);
  optimizedPrompts.push({
    agent: "Contract Builder",
    purpose: "Convert raw messy prompt into a compact typed handoff contract.",
    tokens: estimateTokens(contractPrompt),
    prompt: contractPrompt
  });

  if (resolvedProvider.provider !== "offline") {
    try {
      trace.push({
        phase: "contract_model_call",
        agent: "Contract Builder",
        status: "running",
        detail: `Calling ${resolvedProvider.label} for the compact contract.`
      });
      const contractResult = await callModel({
        providerConfig,
        prompt: contractPrompt,
        system: "You are a Contract Builder. Convert messy user input into compact, safe, token-bounded handoff contracts.",
        signal,
        timeoutMs: workflowBudget.remaining("contract"),
        acceptTruncated: true,
        maxOutputTokens: 2_000,
        telemetryContext: { ...telemetryContext, traceId, stage: "contract" }
      });
      contractValidation = validateHandoffContract(contractResult.content, kit.handoff_contract, {
        finishReason: contractResult.finishReason
      });
      contractOutput = contractValidation.output;
      kit.handoff_contract = contractValidation.contract;
      kit.goal = contractValidation.contract.goal;
      generations.push(generationRecord("contract", contractResult));
      providerUsed = contractResult.provider;
      providerLabel = contractResult.providerLabel;
      modelUsed = contractResult.model;
      trace[trace.length - 1].status = "done";
      trace[trace.length - 1].detail = contractValidation.source === "provider"
        ? "Validated the provider contract against the typed handoff schema."
        : "Provider contract validation failed; substituted the safe local contract.";

      if (options.mode === "contract-only") {
        trace.push({
          phase: "ready",
          agent: "Contract Builder",
          status: "done",
          detail: "Prepared the compact contract without running the task."
        });
      } else {
        const executorPrompt = buildA2AExecutorPrompt(contractOutput, kit);
        optimizedPrompts.push({
          agent: "Executor Agent",
          purpose: "Run the requested task with only the contract-shaped payload.",
          tokens: estimateTokens(executorPrompt),
          prompt: executorPrompt
        });
        trace.push({
          phase: "execute",
          agent: "Executor Agent",
          status: "running",
          detail: "Executing with the compact contract instead of the raw prompt."
        });
        const executorResult = await callModel({
          providerConfig,
          prompt: executorPrompt,
          system: "You are an Executor Agent. Produce the best final work product from the compact handoff contract.",
          signal,
          timeoutMs: workflowBudget.remaining("execution"),
          maxOutputTokens: contractValidation.contract.token_budget.executor_target,
          telemetryContext: { ...telemetryContext, traceId, stage: "execute" }
        });
        generations.push(generationRecord("execute", executorResult));
        executorOutput = executorResult.content;
        finalAnswer = executorOutput;
        trace[trace.length - 1].status = "done";

        const verifierPrompt = buildA2AVerifierPrompt(contractOutput, executorOutput);
        optimizedPrompts.push({
          agent: "Verifier Agent",
          purpose: "Validate the candidate answer against the compact contract and compress the result.",
          tokens: estimateTokens(verifierPrompt),
          prompt: verifierPrompt
        });
        trace.push({
          phase: "verify",
          agent: "Verifier Agent",
          status: "running",
          detail: "Verifying constraints and compressing final output."
        });
        const verifierResult = await callModel({
          providerConfig,
          prompt: verifierPrompt,
          system: "You are a Verifier Agent. Fix drift, preserve intent, and return a compact final answer.",
          signal,
          timeoutMs: workflowBudget.remaining("verification"),
          maxOutputTokens: contractValidation.contract.token_budget.executor_target,
          telemetryContext: { ...telemetryContext, traceId, stage: "verify" }
        });
        generations.push(generationRecord("verify", verifierResult));
        finalAnswer = verifierResult.content;
        executionStatus = "completed";
        trace[trace.length - 1].status = "done";
      }
    } catch (error) {
      providerError = signal?.aborted ? "Run cancelled" : safeErrorMessage(error, "Model execution stopped");
      executionStatus = signal?.aborted ? "cancelled" : "provider_error";
      trace.push({
        phase: "error",
        agent: "Provider Adapter",
        status: "error",
        detail: "Model execution stopped. The prepared contract and prompts remain available."
      });
    }
  } else {
    trace.push({
      phase: "ready",
      agent: "Contract Builder",
      status: "done",
      detail: "Prepared a compact contract without running a model."
    });
  }

  let acceptanceReport = skippedAcceptanceReport();
  let repairReport = skippedRepairReport();
  if (executionStatus === "completed") {
    const compiledAcceptance = compileAcceptanceGates(safeInput);
    acceptanceReport = evaluateAcceptanceGates({
      rawInput: safeInput,
      output: finalAnswer,
      compiled: compiledAcceptance
    });
    trace.push({
      phase: "acceptance",
      agent: "Acceptance Gates",
      status: acceptanceReport.passed ? "done" : "error",
      detail: acceptanceReport.summary
    });
    if (!acceptanceReport.passed) {
      const repair = repairAcceptanceFailures({
        rawInput: safeInput,
        output: finalAnswer,
        compiled: compiledAcceptance,
        acceptanceReport
      });
      finalAnswer = repair.output;
      acceptanceReport = repair.acceptanceReport;
      repairReport = repair.repairReport;
      trace.push({
        phase: "repair",
        agent: "Local Repair",
        status: repairReport.improved ? "done" : "skipped",
        detail: repairReport.summary
      });
      if (repairReport.improved) {
        trace.push({
          phase: "acceptance",
          agent: "Acceptance Gates",
          status: acceptanceReport.passed ? "done" : "error",
          detail: `Re-check: ${acceptanceReport.summary}`
        });
      }
    } else {
      repairReport = repairAcceptanceFailures({
        rawInput: safeInput,
        output: finalAnswer,
        compiled: compiledAcceptance,
        acceptanceReport
      }).repairReport;
    }
  }

  const optimizedPromptTokens = optimizedPrompts.reduce((sum, item) => sum + item.tokens, 0);
  const comparison = contextComparison(rawTokens, optimizedPromptTokens, optimizedPrompts.length);
  const providerUsage = combineUsage(generations);
  const qualityStatus = deriveQualityStatus({ executionStatus, acceptanceReport, repairReport });
  const result = {
    traceId,
    mode: "contract-workflow-kit-run",
    provider: providerUsed,
    providerLabel,
    model: modelUsed,
    providerError,
    executionStatus,
    qualityStatus,
    acceptanceReport,
    repairReport,
    securityReport: {
      redactions: security.count,
      types: security.types
    },
    kit,
    contractOutput,
    contractValidation,
    executorOutput,
    finalAnswer,
    optimizedPrompts,
    generations,
    providerUsage,
    trace,
    tokenReport: {
      rawInputTokens: rawTokens,
      optimizedPromptTokens,
      actualInputTokens: providerUsage.inputTokens,
      actualOutputTokens: providerUsage.outputTokens,
      actualTotalTokens: providerUsage.totalTokens,
      actualUsageSource: providerUsage.source,
      estimatedCostUsd: providerUsage.estimatedCostUsd,
      modelCalls: providerUsage.modelCalls,
      estimatedNaiveThreeStepTokens: comparison.estimatedBaselineInputTokens,
      estimatedSavingsTokens: comparison.estimatedContextSavingsTokens,
      estimatedSavingsPercent: comparison.estimatedContextSavingsPercent,
      estimatedContextDeltaTokens: comparison.estimatedContextDeltaTokens,
      estimatedContextDeltaPercent: comparison.estimatedContextDeltaPercent,
      addsFramingOverhead: comparison.addsFramingOverhead,
      comparison
    },
    elapsedMs: Date.now() - startedAt
  };
  recordWorkflowRun(result, telemetryContext);
  return result;
}

async function runSelfOptimizingWorkflow({
  rawInput,
  provider,
  options = {},
  onEvent,
  signal,
  traceId = createTraceId(),
  telemetryContext = {}
}) {
  const startedAt = Date.now();
  const workflowBudget = createWorkflowBudget(options.timeoutMs);
  const selectedProvider = provider || "groq-openai-fallback";
  const security = redactSensitiveText(rawInput);
  const safeInput = security.text;
  const offlineContract = buildOfflineContract(safeInput);
  const workflowShape = analyzeWorkflowShape(safeInput, options);
  const rawTokens = estimateTokens(rawInput);
  const trace = [];

  const addTrace = async (phase, status, detail, label) => {
    const at = new Date().toISOString();
    const item = {
      actionId: `${traceId}.${trace.length + 1}`,
      phase,
      agent: label || phase,
      status,
      detail,
      at,
      startedAt: at,
      finishedAt: status === "running" ? null : at,
      durationMs: 0
    };
    trace.push(item);
    await emitWorkflowEvent(onEvent, {
      type: "stage",
      traceId,
      actionId: item.actionId,
      stage: phase,
      agent: item.agent,
      status,
      detail,
      route: workflowShape.route
    });
    return item;
  };

  const finishTrace = async (item, status, detail) => {
    item.status = status;
    item.detail = detail || item.detail;
    item.finishedAt = new Date().toISOString();
    item.durationMs = Math.max(0, new Date(item.finishedAt).getTime() - new Date(item.startedAt).getTime());
    await emitWorkflowEvent(onEvent, {
      type: "stage",
      traceId,
      actionId: item.actionId,
      stage: item.phase,
      agent: item.agent,
      status: item.status,
      detail: item.detail,
      durationMs: item.durationMs,
      route: workflowShape.route
    });
  };

  await addTrace(
    "understand",
    "done",
    security.count
      ? `Captured the request and removed ${security.count} sensitive value${security.count === 1 ? "" : "s"} before transmission.`
      : "Captured the goal and required deliverables.",
    "Intake"
  );
  await addTrace("route", "done", workflowShape.routeReason, "Adaptive Router");
  if (workflowShape.route !== "direct") {
    await addTrace("simplify", "done", "Prepared compact structured context for downstream execution.", "Contract Builder");
  } else {
    await addTrace("simplify", "skipped", "The direct route avoids an unnecessary contract-building call.", "Direct Route");
  }

  const optimizedPrompts = [];
  const generations = [];
  let providerUsed = null;
  let modelUsed = null;
  let optimizerOutput = JSON.stringify(offlineContract, null, 2);
  let handoffContract = offlineContract;
  let contractValidation = { source: "not_used", issues: [] };
  let executorOutput = "";
  let finalAnswer = "";
  let providerError = null;
  let executionStatus = "prompt_ready";

  const directPrompt = buildDirectExecutorPrompt(safeInput, offlineContract);
  const optimizerPrompt = buildOptimizerPrompt(safeInput, offlineContract);

  if (workflowShape.route === "direct") {
    optimizedPrompts.push({
      agent: "Direct Executor",
      purpose: "Simple prompt route: avoid multi-step prompt bloat and complete the task in one model call.",
      tokens: estimateTokens(directPrompt),
      prompt: directPrompt
    });
  } else {
    optimizedPrompts.push({
      agent: "Contract Builder",
      purpose: "Read the raw prompt once and create the compact handoff contract.",
      tokens: estimateTokens(optimizerPrompt),
      prompt: optimizerPrompt
    });
  }

  if (selectedProvider !== "offline") {
    try {
      if (workflowShape.route === "direct") {
        const executionTrace = await addTrace("execute", "running", "Running the request in one model call.", "Direct Executor");
        const directResult = await callWorkflowProvider(
          selectedProvider,
          directPrompt,
          "Complete the user's task directly. Preserve requested deliverables and avoid internal process commentary.",
          {
            signal,
            timeoutMs: workflowBudget.remaining("execution"),
            deadlineAt: workflowBudget.deadlineAt,
            maxOutputTokens: offlineContract.token_budget.executor_target,
            telemetryContext: { ...telemetryContext, traceId, stage: "execute" }
          }
        );
        generations.push(generationRecord("execute", directResult));
        executorOutput = directResult.content;
        finalAnswer = directResult.content;
        providerUsed = directResult.provider;
        modelUsed = directResult.model;
        executionStatus = "completed";
        await finishTrace(executionTrace, "done", "Generated the result in one model call.");
      } else {
        const contractTrace = await addTrace("contract", "running", "Converting the request into compact execution context.", "Contract Builder");
        const optimizerResult = await callWorkflowProvider(
          selectedProvider,
          optimizerPrompt,
          "You are a Contract Builder. Preserve intent, remove repetition, and return compact execution state.",
          {
            signal,
            timeoutMs: workflowBudget.remaining("contract"),
            deadlineAt: workflowBudget.deadlineAt,
            acceptTruncated: true,
            maxOutputTokens: 2_000,
            telemetryContext: { ...telemetryContext, traceId, stage: "contract" }
          }
        );
        generations.push(generationRecord("contract", optimizerResult));
        contractValidation = validateHandoffContract(optimizerResult.content, offlineContract, {
          finishReason: optimizerResult.finishReason
        });
        handoffContract = contractValidation.contract;
        optimizerOutput = contractValidation.output;
        providerUsed = optimizerResult.provider;
        modelUsed = optimizerResult.model;
        await finishTrace(
          contractTrace,
          "done",
          contractValidation.source === "provider"
            ? "Validated compact execution context against the typed handoff schema."
            : "Provider contract validation failed; substituted the safe local contract."
        );

        const executorPrompt = buildExecutorPrompt(optimizerOutput, handoffContract);
        optimizedPrompts.push({
          agent: "Executor Agent",
          purpose: "Execute the task using only the compact handoff contract.",
          tokens: estimateTokens(executorPrompt),
          prompt: executorPrompt
        });
        const executionTrace = await addTrace("execute", "running", "Generating the requested result from compact context.", "Executor");
        const executorResult = await callWorkflowProvider(
          selectedProvider,
          executorPrompt,
          "You are an Executor Agent. Produce the best final work product from the compact handoff contract.",
          {
            signal,
            timeoutMs: workflowBudget.remaining("execution"),
            deadlineAt: workflowBudget.deadlineAt,
            maxOutputTokens: handoffContract.token_budget.executor_target,
            telemetryContext: { ...telemetryContext, traceId, stage: "execute" }
          }
        );
        generations.push(generationRecord("execute", executorResult));
        executorOutput = executorResult.content;
        finalAnswer = executorResult.content;
        providerUsed = executorResult.provider;
        modelUsed = executorResult.model;
        executionStatus = "completed";
        await finishTrace(executionTrace, "done", "Generated the requested result.");

        if (workflowShape.route === "full") {
          const verifierPrompt = buildVerifierPrompt(optimizerOutput, executorOutput);
          optimizedPrompts.push({
            agent: "Verifier Agent",
            purpose: "Verify constraints and compress the final answer.",
            tokens: estimateTokens(verifierPrompt),
            prompt: verifierPrompt
          });
          const verifierTrace = await addTrace("verify", "running", "Checking required details and output structure.", "Validator");
          const verifierResult = await callWorkflowProvider(
            selectedProvider,
            verifierPrompt,
            "You are a Verifier Agent. Fix drift, preserve intent, and return a compact final answer without process commentary.",
            {
              signal,
              timeoutMs: workflowBudget.remaining("verification"),
              deadlineAt: workflowBudget.deadlineAt,
              maxOutputTokens: handoffContract.token_budget.executor_target,
              telemetryContext: { ...telemetryContext, traceId, stage: "verify" }
            }
          );
          generations.push(generationRecord("verify", verifierResult));
          finalAnswer = verifierResult.content;
          providerUsed = verifierResult.provider;
          modelUsed = verifierResult.model;
          await finishTrace(verifierTrace, "done", "Validated the result against the request.");
        }
      }
    } catch (error) {
      providerError = signal?.aborted ? "Run cancelled" : safeErrorMessage(error, "Model execution stopped");
      executionStatus = signal?.aborted ? "cancelled" : "provider_error";
      finalAnswer = "";
      executorOutput = "";
      const activeTrace = [...trace].reverse().find((item) => item.status === "running");
      if (activeTrace) await finishTrace(activeTrace, "error", providerError);
      await addTrace("execute", "error", providerError, "Provider Adapter");
    }
  } else {
    await addTrace("execute", "skipped", "The optimized prompt is ready, but no model execution route was selected.", "Prompt Builder");
  }

  let acceptanceReport = skippedAcceptanceReport();
  let repairReport = skippedRepairReport();
  if (executionStatus === "completed") {
    const compiledAcceptance = compileAcceptanceGates(safeInput);
    acceptanceReport = evaluateAcceptanceGates({
      rawInput: safeInput,
      output: finalAnswer,
      compiled: compiledAcceptance
    });
    await addTrace(
      "acceptance",
      acceptanceReport.passed ? "done" : "error",
      acceptanceReport.summary,
      "Acceptance Gates"
    );
    if (!acceptanceReport.passed) {
      const repair = repairAcceptanceFailures({
        rawInput: safeInput,
        output: finalAnswer,
        compiled: compiledAcceptance,
        acceptanceReport
      });
      finalAnswer = repair.output;
      acceptanceReport = repair.acceptanceReport;
      repairReport = repair.repairReport;
      await addTrace(
        "repair",
        repairReport.improved ? "done" : "skipped",
        repairReport.summary,
        "Local Repair"
      );
      if (repairReport.improved) {
        await addTrace(
          "acceptance",
          acceptanceReport.passed ? "done" : "error",
          `Re-check: ${acceptanceReport.summary}`,
          "Acceptance Gates"
        );
      }
    } else {
      repairReport = repairAcceptanceFailures({
        rawInput: safeInput,
        output: finalAnswer,
        compiled: compiledAcceptance,
        acceptanceReport
      }).repairReport;
    }
  }

  const optimizedPromptTokens = optimizedPrompts.reduce((sum, item) => sum + item.tokens, 0);
  const comparison = contextComparison(rawTokens, optimizedPromptTokens, optimizedPrompts.length);
  const providerUsage = combineUsage(generations);
  const optimizedPrompt = optimizedPrompts[optimizedPrompts.length - 1]?.prompt || directPrompt;
  const qualityStatus = deriveQualityStatus({ executionStatus, acceptanceReport, repairReport });

  await emitWorkflowEvent(onEvent, {
    type: "complete",
    traceId,
    agent: "Coordinator",
    stage: executionStatus === "completed" ? "complete" : "execute",
    status: executionStatus,
    qualityStatus,
    detail: executionStatus === "completed"
      ? acceptanceReport.passed
        ? "Result ready and acceptance gates passed."
        : "Result generated; acceptance gates need review."
      : providerError || "Optimized prompt ready."
  });

  const result = {
    traceId,
    mode: "adaptive-contract-workflow-run",
    provider: providerUsed,
    model: modelUsed,
    providerError,
    executionStatus,
    qualityStatus,
    acceptanceReport,
    repairReport,
    workflowShape,
    securityReport: {
      redactions: security.count,
      types: security.types
    },
    handoffContract,
    contractValidation,
    optimizerOutput,
    executorOutput,
    finalAnswer,
    optimizedPrompt,
    optimizedPrompts,
    generations,
    providerUsage,
    trace,
    tokenReport: {
      rawInputTokens: rawTokens,
      optimizedPromptTokens,
      actualInputTokens: providerUsage.inputTokens,
      actualOutputTokens: providerUsage.outputTokens,
      actualTotalTokens: providerUsage.totalTokens,
      cachedTokens: providerUsage.cachedTokens,
      actualUsageSource: providerUsage.source,
      estimatedCostUsd: providerUsage.estimatedCostUsd,
      estimatedNaiveThreeStepTokens: comparison.estimatedBaselineInputTokens,
      estimatedSavingsTokens: comparison.estimatedContextSavingsTokens,
      estimatedSavingsPercent: comparison.estimatedContextSavingsPercent,
      estimatedContextDeltaTokens: comparison.estimatedContextDeltaTokens,
      estimatedContextDeltaPercent: comparison.estimatedContextDeltaPercent,
      addsFramingOverhead: comparison.addsFramingOverhead,
      comparison,
      adaptiveRoute: workflowShape.route,
      routeReason: workflowShape.routeReason,
      complexity: workflowShape.complexity,
      modelCalls: providerUsage.modelCalls
    },
    elapsedMs: Date.now() - startedAt
  };
  recordWorkflowRun(result, telemetryContext);
  return result;
}

module.exports = {
  buildBlankA2AKit,
  createWorkflowBudget,
  deriveQualityStatus,
  runBlankA2AKit,
  runSelfOptimizingWorkflow
};

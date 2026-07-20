// Public entry point for the optimizer core. The implementation lives in
// focused modules under core/: usage accounting, security filters, provider
// adapters, adaptive routing, handoff preparation, prompt library, and the
// workflow runners.
const { combineUsage, createTraceId, estimateTokens } = require("./core/usage.cjs");
const { redactSensitiveText } = require("./core/security.cjs");
const { callChatCompletion, generateWithFallback, providerStatus } = require("./core/providers.cjs");
const { analyzeWorkflowShape } = require("./core/routing.cjs");
const { preparePortableHandoff } = require("./core/handoff.cjs");
const { runBlankA2AKit, runSelfOptimizingWorkflow } = require("./core/workflow.cjs");

module.exports = {
  analyzeWorkflowShape,
  callChatCompletion,
  combineUsage,
  createTraceId,
  estimateTokens,
  generateWithFallback,
  preparePortableHandoff,
  providerStatus,
  redactSensitiveText,
  runBlankA2AKit,
  runSelfOptimizingWorkflow
};

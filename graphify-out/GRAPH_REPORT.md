# Graph Report - .  (2026-07-22)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 406 nodes · 645 edges · 25 communities (21 shown, 4 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 60 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `179763b2`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- workspace.js
- request-guard.cjs
- optimizer-core.cjs
- manifest.json
- content-chatgpt.test.cjs
- content-gemini.test.cjs
- handoff.cjs
- sidepanel.js
- package.json
- server.cjs
- optimizer-system.cjs
- sidepanel-logic.test.cjs
- api-endpoints.test.cjs
- prompts.cjs
- system-worker.js
- optimizer-core.test.cjs
- chatgpt.js
- gemini.js
- canonical-graph.cjs
- graphify
- vercel.json

## God Nodes (most connected - your core abstractions)
1. `run()` - 18 edges
2. `el()` - 11 edges
3. `preparePrompt()` - 11 edges
4. `estimateTokens()` - 11 edges
5. `renderCompleted()` - 11 edges
6. `FakeElement` - 11 edges
7. `FakeElement` - 11 edges
8. `bindEvents()` - 10 edges
9. `setStatus()` - 9 edges
10. `capturePrompt()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `runBlankA2AKit()` --calls--> `estimateTokens()`  [EXTRACTED]
  core/workflow.cjs → core/usage.cjs
- `runSelfOptimizingWorkflow()` --calls--> `estimateTokens()`  [EXTRACTED]
  core/workflow.cjs → core/usage.cjs
- `analyzeWorkflowShape()` --calls--> `compactLines()`  [EXTRACTED]
  core/routing.cjs → core/text.cjs
- `analyzeWorkflowShape()` --calls--> `estimateTokens()`  [EXTRACTED]
  core/routing.cjs → core/usage.cjs
- `buildOfflineContract()` --calls--> `compactLines()`  [EXTRACTED]
  core/routing.cjs → core/text.cjs

## Import Cycles
- None detected.

## Communities (25 total, 4 thin omitted)

### Community 0 - "workspace.js"
Cohesion: 0.11
Nodes (45): bindEvents(), checkService(), compactNumber(), contextComparisonText(), contextInput(), continueFromResult(), coordinatorActions(), copyText() (+37 more)

### Community 1 - "request-guard.cjs"
Cohesion: 0.08
Nodes (36): {
  abortSignalOnClose,
  commonHeaders,
  publicError,
  takeRateLimit,
  validateA2APayload
}, { runBlankA2AKit }, {
  abortSignalOnClose,
  commonHeaders,
  publicError,
  takeRateLimit,
  validateGeneratePayload
}, { callChatCompletion, generateWithFallback }, {
  abortSignalOnClose,
  commonHeaders,
  publicError,
  takeRateLimit,
  validateOptimizerPayload
}, { runSelfOptimizingWorkflow }, {
  abortSignalOnClose,
  commonHeaders,
  publicError,
  takeRateLimit,
  validateOptimizerPayload
}, { createTraceId, runSelfOptimizingWorkflow } (+28 more)

### Community 2 - "optimizer-core.cjs"
Cohesion: 0.09
Nodes (33): { providerStatus }, { assertSafeProviderEndpoint }, callChatCompletion(), callModel(), callWorkflowProvider(), createRequestSignal(), { estimateTokens, modelCost, normalizeUsage }, generateWithFallback() (+25 more)

### Community 3 - "manifest.json"
Cohesion: 0.06
Nodes (33): action, default_icon, default_title, background, service_worker, type, content_scripts, content_security_policy (+25 more)

### Community 4 - "content-chatgpt.test.cjs"
Cohesion: 0.07
Nodes (14): adapterCode, assert, baseCode, bridgeCode, composerForm, context, FakeElement, fs (+6 more)

### Community 5 - "content-gemini.test.cjs"
Cohesion: 0.07
Nodes (14): adapterCode, assert, baseCode, bridgeCode, context, FakeElement, fs, hugeEditor (+6 more)

### Community 6 - "handoff.cjs"
Cohesion: 0.13
Nodes (21): { analyzeWorkflowShape, buildOfflineContract }, buildPortablePrompt(), cleanDirectRequest(), {
  cleanPromptText,
  compactLines,
  dedupeNaturalLanguageLines,
  promptSection,
  stripListPrefix,
  withoutTrailingEllipsis
}, { estimateTokens }, isLikelyOriginalTask(), isPreparedWrapper(), originalTaskScore() (+13 more)

### Community 7 - "sidepanel.js"
Cohesion: 0.24
Nodes (24): bindEvents(), capturePrompt(), checkConnection(), copyPrepared(), currentContext(), el(), estimateTokens(), getRecentRawPrompt() (+16 more)

### Community 8 - "package.json"
Cohesion: 0.08
Nodes (23): dompurify, marked, dependencies, zod, description, //devDependencies, dompurify, marked (+15 more)

### Community 9 - "server.cjs"
Cohesion: 0.12
Nodes (17): {
  abortSignalOnClose,
  commonHeaders,
  publicError,
  takeRateLimit,
  validateA2APayload,
  validateGeneratePayload,
  validateOptimizerPayload
}, allowedApiMethods(), {
  callChatCompletion,
  createTraceId,
  generateWithFallback,
  preparePortableHandoff,
  providerStatus,
  runBlankA2AKit,
  runSelfOptimizingWorkflow
}, { createOptimizerSystem }, fs, graphifyDir, handleApi(), http (+9 more)

### Community 10 - "optimizer-system.cjs"
Cohesion: 0.29
Nodes (12): applyResultTrace(), baseStages(), compactTitle(), createId(), createRun(), {
  estimateTokens,
  runBlankA2AKit,
  runSelfOptimizingWorkflow
}, executeSystemRun(), nowIso() (+4 more)

### Community 11 - "sidepanel-logic.test.cjs"
Cohesion: 0.17
Nodes (10): assert, context, elements, extensionDir, fs, path, platformsCode, preparedResponse (+2 more)

### Community 12 - "api-endpoints.test.cjs"
Cohesion: 0.33
Nodes (9): assert, freePort(), http, jsonRequest(), listen(), post(), run(), { spawn } (+1 more)

### Community 14 - "system-worker.js"
Cohesion: 0.52
Nodes (6): analyzePrompt(), complexityScore(), estimateTokens(), lines(), outputStyle(), uniqueLines()

### Community 15 - "optimizer-core.test.cjs"
Cohesion: 0.29
Nodes (5): {
  analyzeWorkflowShape,
  combineUsage,
  preparePortableHandoff,
  redactSensitiveText,
  runBlankA2AKit,
  runSelfOptimizingWorkflow
}, assert, { assertSafeProviderEndpoint }, { contextComparison }, { takeRateLimit }

### Community 16 - "chatgpt.js"
Cohesion: 0.67
Nodes (5): hasPromptLabel(), isCandidate(), isHugeEditable(), isNearPromptArea(), score()

### Community 17 - "gemini.js"
Cohesion: 0.67
Nodes (5): hasPromptLabel(), isCandidate(), isHugeEditable(), isNearPromptArea(), score()

## Knowledge Gaps
- **146 isolated node(s):** `uvx`, `{ preparePortableHandoff }`, `{
  commonHeaders,
  publicError,
  takeRateLimit,
  validateOptimizerPayload
}`, `{ providerStatus }`, `{ SYSTEM_ARCHITECTURE, runSystemRunInline }` (+141 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `uvx`, `{ preparePortableHandoff }`, `{
  commonHeaders,
  publicError,
  takeRateLimit,
  validateOptimizerPayload
}` to the rest of the system?**
  _146 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `workspace.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11193339500462535 - nodes in this community are weakly interconnected._
- **Should `request-guard.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.08181818181818182 - nodes in this community are weakly interconnected._
- **Should `optimizer-core.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.08536585365853659 - nodes in this community are weakly interconnected._
- **Should `manifest.json` be split into smaller, more focused modules?**
  _Cohesion score 0.058823529411764705 - nodes in this community are weakly interconnected._
- **Should `content-chatgpt.test.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._
- **Should `content-gemini.test.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._
# Graph Report - .  (2026-07-20)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 408 nodes · 684 edges · 24 communities (20 shown, 4 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 59 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `deda1f80`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- request-guard.cjs
- optimizer-core.cjs
- workspace.js
- manifest.json
- content-chatgpt.test.cjs
- content-gemini.test.cjs
- sidepanel.js
- package.json
- optimizer-system.cjs
- handoff.cjs
- sidepanel-logic.test.cjs
- chatgpt.js
- gemini.js
- api-endpoints.test.cjs
- prompts.cjs
- system-worker.js
- optimizer-core.test.cjs
- text.cjs
- canonical-graph.cjs
- graphify
- vercel.json

## God Nodes (most connected - your core abstractions)
1. `run()` - 18 edges
2. `estimateTokens()` - 13 edges
3. `el()` - 11 edges
4. `preparePrompt()` - 11 edges
5. `FakeElement` - 11 edges
6. `takeRateLimit()` - 11 edges
7. `commonHeaders()` - 11 edges
8. `handleApi()` - 11 edges
9. `renderCompleted()` - 11 edges
10. `FakeElement` - 11 edges

## Surprising Connections (you probably didn't know these)
- `handleApi()` --calls--> `takeRateLimit()`  [EXTRACTED]
  server.cjs → request-guard.cjs
- `handleApi()` --calls--> `validateOptimizerPayload()`  [EXTRACTED]
  server.cjs → request-guard.cjs
- `handleApi()` --calls--> `validateA2APayload()`  [EXTRACTED]
  server.cjs → request-guard.cjs
- `handleApi()` --calls--> `validateGeneratePayload()`  [EXTRACTED]
  server.cjs → request-guard.cjs
- `handleApi()` --calls--> `publicError()`  [EXTRACTED]
  server.cjs → request-guard.cjs

## Import Cycles
- None detected.

## Communities (24 total, 4 thin omitted)

### Community 0 - "request-guard.cjs"
Cohesion: 0.06
Nodes (49): {
  commonHeaders,
  publicError,
  takeRateLimit,
  validateA2APayload
}, { runBlankA2AKit }, { callChatCompletion, generateWithFallback }, {
  commonHeaders,
  publicError,
  takeRateLimit,
  validateGeneratePayload
}, {
  commonHeaders,
  publicError,
  takeRateLimit,
  validateOptimizerPayload
}, { runSelfOptimizingWorkflow }, {
  commonHeaders,
  publicError,
  takeRateLimit,
  validateOptimizerPayload
}, { createTraceId, runSelfOptimizingWorkflow } (+41 more)

### Community 1 - "optimizer-core.cjs"
Cohesion: 0.09
Nodes (42): { providerStatus }, { assertSafeProviderEndpoint }, callChatCompletion(), callModel(), callWorkflowProvider(), createRequestSignal(), { estimateTokens, modelCost, normalizeUsage }, generateWithFallback() (+34 more)

### Community 2 - "workspace.js"
Cohesion: 0.11
Nodes (45): bindEvents(), checkService(), compactNumber(), contextComparisonText(), contextInput(), continueFromResult(), coordinatorActions(), copyText() (+37 more)

### Community 3 - "manifest.json"
Cohesion: 0.06
Nodes (33): action, default_icon, default_title, background, service_worker, type, content_scripts, content_security_policy (+25 more)

### Community 4 - "content-chatgpt.test.cjs"
Cohesion: 0.08
Nodes (13): adapterCode, assert, bridgeCode, composerForm, context, FakeElement, fs, hugeEditor (+5 more)

### Community 5 - "content-gemini.test.cjs"
Cohesion: 0.08
Nodes (13): adapterCode, assert, bridgeCode, context, FakeElement, fs, hugeEditor, inserted (+5 more)

### Community 6 - "sidepanel.js"
Cohesion: 0.24
Nodes (24): bindEvents(), capturePrompt(), checkConnection(), copyPrepared(), currentContext(), el(), estimateTokens(), getRecentRawPrompt() (+16 more)

### Community 7 - "package.json"
Cohesion: 0.09
Nodes (22): dompurify, marked, dependencies, dompurify, marked, @tabler/icons-webfont, zod, description (+14 more)

### Community 8 - "optimizer-system.cjs"
Cohesion: 0.21
Nodes (15): {
  commonHeaders,
  publicError,
  takeRateLimit,
  validateOptimizerPayload
}, { SYSTEM_ARCHITECTURE, runSystemRunInline }, applyResultTrace(), baseStages(), compactTitle(), createId(), createRun(), {
  estimateTokens,
  runBlankA2AKit,
  runSelfOptimizingWorkflow
} (+7 more)

### Community 9 - "handoff.cjs"
Cohesion: 0.26
Nodes (11): { analyzeWorkflowShape, buildOfflineContract }, buildPortablePrompt(), cleanDirectRequest(), {
  cleanPromptText,
  compactLines,
  dedupeNaturalLanguageLines,
  promptSection,
  stripListPrefix,
  withoutTrailingEllipsis
}, { estimateTokens }, isLikelyOriginalTask(), isPreparedWrapper(), originalTaskScore() (+3 more)

### Community 10 - "sidepanel-logic.test.cjs"
Cohesion: 0.17
Nodes (10): assert, context, elements, extensionDir, fs, path, platformsCode, preparedResponse (+2 more)

### Community 11 - "chatgpt.js"
Cohesion: 0.38
Nodes (10): capturePrompt(), findPromptBox(), hasPromptLabel(), insertPrompt(), isHugeEditable(), isNearPromptArea(), isPromptCandidate(), isVisible() (+2 more)

### Community 12 - "gemini.js"
Cohesion: 0.38
Nodes (10): capturePrompt(), findPromptBox(), hasPromptLabel(), insertPrompt(), isHugeEditable(), isNearPromptArea(), isPromptCandidate(), isVisible() (+2 more)

### Community 13 - "api-endpoints.test.cjs"
Cohesion: 0.33
Nodes (9): assert, freePort(), http, jsonRequest(), listen(), post(), run(), { spawn } (+1 more)

### Community 15 - "system-worker.js"
Cohesion: 0.52
Nodes (6): analyzePrompt(), complexityScore(), estimateTokens(), lines(), outputStyle(), uniqueLines()

### Community 16 - "optimizer-core.test.cjs"
Cohesion: 0.29
Nodes (5): {
  analyzeWorkflowShape,
  combineUsage,
  preparePortableHandoff,
  redactSensitiveText,
  runBlankA2AKit,
  runSelfOptimizingWorkflow
}, assert, { assertSafeProviderEndpoint }, { contextComparison }, { takeRateLimit }

### Community 17 - "text.cjs"
Cohesion: 0.47
Nodes (3): cleanPromptText(), dedupeNaturalLanguageLines(), stripListPrefix()

## Knowledge Gaps
- **144 isolated node(s):** `uvx`, `{ preparePortableHandoff }`, `{
  commonHeaders,
  publicError,
  takeRateLimit,
  validateOptimizerPayload
}`, `{ providerStatus }`, `{ SYSTEM_ARCHITECTURE, runSystemRunInline }` (+139 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `commonHeaders()` connect `request-guard.cjs` to `optimizer-system.cjs`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Why does `takeRateLimit()` connect `request-guard.cjs` to `optimizer-system.cjs`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **Why does `estimateTokens()` connect `optimizer-core.cjs` to `handoff.cjs`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **What connects `uvx`, `{ preparePortableHandoff }`, `{
  commonHeaders,
  publicError,
  takeRateLimit,
  validateOptimizerPayload
}` to the rest of the system?**
  _144 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `request-guard.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05875706214689266 - nodes in this community are weakly interconnected._
- **Should `optimizer-core.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.08673469387755102 - nodes in this community are weakly interconnected._
- **Should `workspace.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11193339500462535 - nodes in this community are weakly interconnected._
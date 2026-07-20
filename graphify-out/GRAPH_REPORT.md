# Graph Report - .  (2026-07-20)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 335 nodes · 645 edges · 18 communities (15 shown, 3 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 30 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5665e578`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- server.cjs
- optimizer-core.cjs
- workspace.js
- manifest.json
- content-gemini.test.cjs
- sidepanel.js
- package.json
- optimizer-system.cjs
- sidepanel-logic.test.cjs
- gemini.js
- api-endpoints.test.cjs
- system-worker.js
- canonical-graph.cjs
- graphify
- vercel.json

## God Nodes (most connected - your core abstractions)
1. `runSelfOptimizingWorkflow()` - 21 edges
2. `runBlankA2AKit()` - 19 edges
3. `run()` - 18 edges
4. `handleApi()` - 18 edges
5. `preparePortableHandoff()` - 12 edges
6. `el()` - 11 edges
7. `preparePrompt()` - 11 edges
8. `FakeElement` - 11 edges
9. `takeRateLimit()` - 11 edges
10. `commonHeaders()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `executeSystemRun()` --calls--> `runBlankA2AKit()`  [EXTRACTED]
  optimizer-system.cjs → optimizer-core.cjs
- `executeSystemRun()` --calls--> `runSelfOptimizingWorkflow()`  [EXTRACTED]
  optimizer-system.cjs → optimizer-core.cjs
- `handleApi()` --calls--> `preparePortableHandoff()`  [EXTRACTED]
  server.cjs → optimizer-core.cjs
- `handleApi()` --calls--> `providerStatus()`  [EXTRACTED]
  server.cjs → optimizer-core.cjs
- `handleApi()` --calls--> `callChatCompletion()`  [EXTRACTED]
  server.cjs → optimizer-core.cjs

## Import Cycles
- None detected.

## Communities (18 total, 3 thin omitted)

### Community 0 - "server.cjs"
Cohesion: 0.06
Nodes (51): {
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
}, { createTraceId, runSelfOptimizingWorkflow } (+43 more)

### Community 1 - "optimizer-core.cjs"
Cohesion: 0.10
Nodes (48): { providerStatus }, analyzeWorkflowShape(), assertSafeProviderEndpoint(), buildA2AContractPrompt(), buildA2AExecutorPrompt(), buildA2AVerifierPrompt(), buildBlankA2AKit(), buildDirectExecutorPrompt() (+40 more)

### Community 2 - "workspace.js"
Cohesion: 0.11
Nodes (44): bindEvents(), checkService(), compactNumber(), contextInput(), continueFromResult(), coordinatorActions(), copyText(), downloadResult() (+36 more)

### Community 3 - "manifest.json"
Cohesion: 0.06
Nodes (31): action, default_icon, default_title, background, service_worker, type, content_scripts, content_security_policy (+23 more)

### Community 4 - "content-gemini.test.cjs"
Cohesion: 0.08
Nodes (13): adapterCode, assert, bridgeCode, context, FakeElement, fs, hugeEditor, inserted (+5 more)

### Community 5 - "sidepanel.js"
Cohesion: 0.24
Nodes (24): bindEvents(), capturePrompt(), checkConnection(), copyPrepared(), currentContext(), el(), estimateTokens(), getRecentRawPrompt() (+16 more)

### Community 6 - "package.json"
Cohesion: 0.09
Nodes (21): dompurify, marked, dependencies, dompurify, marked, @tabler/icons-webfont, zod, description (+13 more)

### Community 7 - "optimizer-system.cjs"
Cohesion: 0.27
Nodes (13): applyResultTrace(), baseStages(), compactTitle(), createId(), createRun(), estimateTokens(), executeSystemRun(), nowIso() (+5 more)

### Community 8 - "sidepanel-logic.test.cjs"
Cohesion: 0.17
Nodes (10): assert, context, elements, extensionDir, fs, path, platformsCode, preparedResponse (+2 more)

### Community 9 - "gemini.js"
Cohesion: 0.38
Nodes (10): capturePrompt(), findPromptBox(), hasPromptLabel(), insertPrompt(), isHugeEditable(), isNearPromptArea(), isPromptCandidate(), isVisible() (+2 more)

### Community 10 - "api-endpoints.test.cjs"
Cohesion: 0.33
Nodes (9): assert, freePort(), http, jsonRequest(), listen(), post(), run(), { spawn } (+1 more)

### Community 11 - "system-worker.js"
Cohesion: 0.52
Nodes (6): analyzePrompt(), complexityScore(), estimateTokens(), lines(), outputStyle(), uniqueLines()

## Knowledge Gaps
- **106 isolated node(s):** `uvx`, `{ preparePortableHandoff }`, `{
  commonHeaders,
  publicError,
  takeRateLimit,
  validateOptimizerPayload
}`, `{ providerStatus }`, `{ SYSTEM_ARCHITECTURE, runSystemRunInline }` (+101 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `runSelfOptimizingWorkflow()` connect `optimizer-core.cjs` to `server.cjs`, `optimizer-system.cjs`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `runBlankA2AKit()` connect `optimizer-core.cjs` to `server.cjs`, `optimizer-system.cjs`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `handleApi()` connect `server.cjs` to `optimizer-core.cjs`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **What connects `uvx`, `{ preparePortableHandoff }`, `{
  commonHeaders,
  publicError,
  takeRateLimit,
  validateOptimizerPayload
}` to the rest of the system?**
  _106 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `server.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.057859703020993344 - nodes in this community are weakly interconnected._
- **Should `optimizer-core.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.10407239819004525 - nodes in this community are weakly interconnected._
- **Should `workspace.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11207729468599034 - nodes in this community are weakly interconnected._
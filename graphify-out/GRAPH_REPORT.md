# Graph Report - .  (2026-07-20)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 339 nodes · 652 edges · 18 communities (16 shown, 2 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 30 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5d233bad`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Optimizer Core
- Workspace UI
- APIs And Request Guard
- Local Server And Providers
- Extension Manifest And Permissions
- Gemini Content Tests
- Extension Side Panel
- Dependencies And Scripts
- Background Run System
- Side Panel Tests
- Gemini Page Adapter
- API Integration Tests
- Browser Preflight Worker
- Graphify MCP Configuration
- Vercel Routing

## God Nodes (most connected - your core abstractions)
1. `runSelfOptimizingWorkflow()` - 21 edges
2. `runBlankA2AKit()` - 19 edges
3. `run()` - 18 edges
4. `handleApi()` - 18 edges
5. `preparePortableHandoff()` - 12 edges
6. `el()` - 11 edges
7. `preparePrompt()` - 11 edges
8. `FakeElement` - 11 edges
9. `unwrapPreparedPrompt()` - 10 edges
10. `callChatCompletion()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `handleApi()` --calls--> `createTraceId()`  [EXTRACTED]
  server.cjs → optimizer-core.cjs
- `handleApi()` --calls--> `preparePortableHandoff()`  [EXTRACTED]
  server.cjs → optimizer-core.cjs
- `handleApi()` --calls--> `callChatCompletion()`  [EXTRACTED]
  server.cjs → optimizer-core.cjs
- `handleApi()` --calls--> `generateWithFallback()`  [EXTRACTED]
  server.cjs → optimizer-core.cjs
- `executeSystemRun()` --calls--> `runBlankA2AKit()`  [EXTRACTED]
  optimizer-system.cjs → optimizer-core.cjs

## Import Cycles
- None detected.

## Communities (18 total, 2 thin omitted)

### Community 0 - "Optimizer Core"
Cohesion: 0.11
Nodes (46): analyzeWorkflowShape(), assertSafeProviderEndpoint(), buildA2AContractPrompt(), buildA2AExecutorPrompt(), buildA2AVerifierPrompt(), buildBlankA2AKit(), buildDirectExecutorPrompt(), buildExecutorPrompt() (+38 more)

### Community 1 - "Workspace UI"
Cohesion: 0.11
Nodes (44): bindEvents(), checkService(), compactNumber(), contextInput(), continueFromResult(), coordinatorActions(), copyText(), downloadResult() (+36 more)

### Community 2 - "APIs And Request Guard"
Cohesion: 0.08
Nodes (35): {
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
}, { createTraceId, runSelfOptimizingWorkflow } (+27 more)

### Community 3 - "Local Server And Providers"
Cohesion: 0.08
Nodes (33): { providerStatus }, providerStatus(), allowedApiMethods(), {
  callChatCompletion,
  createTraceId,
  generateWithFallback,
  preparePortableHandoff,
  providerStatus,
  runBlankA2AKit,
  runSelfOptimizingWorkflow
}, commonHeaders(), { createOptimizerSystem }, fs, graphifyDir (+25 more)

### Community 4 - "Extension Manifest And Permissions"
Cohesion: 0.06
Nodes (31): action, default_icon, default_title, background, service_worker, type, content_scripts, content_security_policy (+23 more)

### Community 5 - "Gemini Content Tests"
Cohesion: 0.08
Nodes (13): adapterCode, assert, bridgeCode, context, FakeElement, fs, hugeEditor, inserted (+5 more)

### Community 6 - "Extension Side Panel"
Cohesion: 0.24
Nodes (24): bindEvents(), capturePrompt(), checkConnection(), copyPrepared(), currentContext(), el(), estimateTokens(), getRecentRawPrompt() (+16 more)

### Community 7 - "Dependencies And Scripts"
Cohesion: 0.12
Nodes (15): dompurify, marked, dependencies, dompurify, marked, @tabler/icons-webfont, zod, scripts (+7 more)

### Community 8 - "Background Run System"
Cohesion: 0.27
Nodes (14): applyResultTrace(), baseStages(), compactTitle(), createId(), createOptimizerSystem(), createRun(), estimateTokens(), executeSystemRun() (+6 more)

### Community 9 - "Side Panel Tests"
Cohesion: 0.17
Nodes (10): assert, context, elements, extensionDir, fs, path, platformsCode, preparedResponse (+2 more)

### Community 10 - "Gemini Page Adapter"
Cohesion: 0.38
Nodes (10): capturePrompt(), findPromptBox(), hasPromptLabel(), insertPrompt(), isHugeEditable(), isNearPromptArea(), isPromptCandidate(), isVisible() (+2 more)

### Community 11 - "API Integration Tests"
Cohesion: 0.33
Nodes (9): assert, freePort(), http, jsonRequest(), listen(), post(), run(), { spawn } (+1 more)

### Community 12 - "Browser Preflight Worker"
Cohesion: 0.52
Nodes (6): analyzePrompt(), complexityScore(), estimateTokens(), lines(), outputStyle(), uniqueLines()

## Knowledge Gaps
- **105 isolated node(s):** `uvx`, `{ runBlankA2AKit }`, `{
  commonHeaders,
  publicError,
  takeRateLimit,
  validateA2APayload
}`, `{ callChatCompletion, generateWithFallback }`, `{
  commonHeaders,
  publicError,
  takeRateLimit,
  validateGeneratePayload
}` (+100 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `runSelfOptimizingWorkflow()` connect `Optimizer Core` to `Background Run System`, `APIs And Request Guard`, `Local Server And Providers`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `runBlankA2AKit()` connect `Optimizer Core` to `Background Run System`, `APIs And Request Guard`, `Local Server And Providers`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Why does `handleApi()` connect `Local Server And Providers` to `Optimizer Core`, `APIs And Request Guard`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **What connects `uvx`, `{ runBlankA2AKit }`, `{
  commonHeaders,
  publicError,
  takeRateLimit,
  validateA2APayload
}` to the rest of the system?**
  _105 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Optimizer Core` be split into smaller, more focused modules?**
  _Cohesion score 0.11394557823129252 - nodes in this community are weakly interconnected._
- **Should `Workspace UI` be split into smaller, more focused modules?**
  _Cohesion score 0.11207729468599034 - nodes in this community are weakly interconnected._
- **Should `APIs And Request Guard` be split into smaller, more focused modules?**
  _Cohesion score 0.08194905869324474 - nodes in this community are weakly interconnected._
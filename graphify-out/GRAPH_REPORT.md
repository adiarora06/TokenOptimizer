# Graph Report - .  (2026-08-03)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 624 nodes · 939 edges · 37 communities (32 shown, 5 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 86 edges (avg confidence: 0.51)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `73106d12`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- providers.cjs
- request-guard.cjs
- workspace.js
- harness.cjs
- manifest.json
- scripts
- telemetry.cjs
- handoff.cjs
- content-chatgpt.test.cjs
- content-gemini.test.cjs
- server.cjs
- sidepanel.js
- optimizer-system.cjs
- MockResponse
- Token Optimizer
- sidepanel-logic.test.cjs
- api-endpoints.test.cjs
- Design QA
- Publishing Token Optimizer for Gemini and ChatGPT
- service-worker.test.cjs
- prompts.cjs
- Chrome Web Store Listing Copy
- frontend-static.test.cjs
- usage.cjs
- Token Optimizer for Gemini and ChatGPT
- text.cjs
- system-worker.js
- chatgpt.js
- gemini.js
- optimize-stream.js
- Site Adapter Architecture
- canonical-graph.cjs
- provider-status.js
- vercel.json

## God Nodes (most connected - your core abstractions)
1. `run()` - 18 edges
2. `recordProviderAttempt()` - 14 edges
3. `recordWorkflowRun()` - 14 edges
4. `Token Optimizer` - 13 edges
5. `scripts` - 13 edges
6. `handleApi()` - 12 edges
7. `FakeElement` - 11 edges
8. `FakeElement` - 11 edges
9. `renderCompleted()` - 11 edges
10. `el()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `run()` --calls--> `callModel()`  [EXTRACTED]
  tests/api-endpoints.test.cjs → core/providers.cjs
- `build()` --indirect_call--> `capturePrompt()`  [INFERRED]
  extensions/gemini-token-optimizer/adapters/base.js → extensions/gemini-token-optimizer/sidepanel.js
- `publicError()` --calls--> `safeErrorMessage()`  [EXTRACTED]
  request-guard.cjs → core/security.cjs
- `run()` --calls--> `analyzeWorkflowShape()`  [EXTRACTED]
  tests/optimizer-core.test.cjs → core/routing.cjs
- `run()` --calls--> `buildOfflineContract()`  [EXTRACTED]
  tests/optimizer-core.test.cjs → core/routing.cjs

## Import Cycles
- None detected.

## Communities (37 total, 5 thin omitted)

### Community 0 - "providers.cjs"
Cohesion: 0.06
Nodes (46): {
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
}, { callChatCompletion, createTraceId, generateWithFallback }, {
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
  validateA2APayload
}, { runBlankA2AKit } (+38 more)

### Community 1 - "request-guard.cjs"
Cohesion: 0.06
Nodes (42): {
  commonHeaders,
  publicError,
  takeRateLimit,
  validateOptimizerPayload
}, { preparePortableHandoff }, canonicalContract(), compactList(), compactString(), handoffContractSchema, parseJsonObject(), { redactSensitiveText } (+34 more)

### Community 2 - "workspace.js"
Cohesion: 0.11
Nodes (45): bindEvents(), checkService(), compactNumber(), contextComparisonText(), contextInput(), continueFromResult(), coordinatorActions(), copyText() (+37 more)

### Community 3 - "harness.cjs"
Cohesion: 0.11
Nodes (37): {
  callChatCompletion,
  preparePortableHandoff,
  runSelfOptimizingWorkflow
}, evaluateLiveCase(), evaluateOutputCheck(), evaluatePreparedCase(), formatDeterministicReport(), formatLiveReport(), fs, includesValue() (+29 more)

### Community 4 - "manifest.json"
Cohesion: 0.06
Nodes (33): action, default_icon, default_title, background, service_worker, type, content_scripts, content_security_policy (+25 more)

### Community 5 - "scripts"
Cohesion: 0.06
Nodes (31): dompurify, marked, dependencies, zod, description, //devDependencies, dompurify, marked (+23 more)

### Community 6 - "telemetry.cjs"
Cohesion: 0.14
Nodes (28): boundedInteger(), classifyFailure(), configuration, events, increment(), KNOWN_ENDPOINTS, KNOWN_PROVIDERS, KNOWN_ROUTES (+20 more)

### Community 7 - "handoff.cjs"
Cohesion: 0.11
Nodes (27): { analyzeWorkflowShape, buildOfflineContract }, buildPortablePrompt(), cleanDirectRequest(), {
  cleanPromptText,
  compactLines,
  dedupeNaturalLanguageLines,
  promptSection,
  stripListPrefix,
  withoutTrailingEllipsis
}, { estimateTokens }, isLikelyOriginalTask(), isPreparedWrapper(), originalTaskScore() (+19 more)

### Community 8 - "content-chatgpt.test.cjs"
Cohesion: 0.07
Nodes (14): adapterCode, assert, baseCode, bridgeCode, composerForm, context, FakeElement, fs (+6 more)

### Community 9 - "content-gemini.test.cjs"
Cohesion: 0.07
Nodes (14): adapterCode, assert, baseCode, bridgeCode, context, FakeElement, fs, hugeEditor (+6 more)

### Community 10 - "server.cjs"
Cohesion: 0.11
Nodes (24): abortSignalOnClose(), allowedApiMethods(), {
  callChatCompletion,
  createTraceId,
  generateWithFallback,
  preparePortableHandoff,
  providerStatus,
  runBlankA2AKit,
  runSelfOptimizingWorkflow,
  telemetrySummary
}, commonHeaders(), { createOptimizerSystem }, fs, graphifyDir, guard (+16 more)

### Community 11 - "sidepanel.js"
Cohesion: 0.21
Nodes (22): build(), bindEvents(), capturePrompt(), checkConnection(), copyPrepared(), currentContext(), el(), estimateTokens() (+14 more)

### Community 12 - "optimizer-system.cjs"
Cohesion: 0.15
Nodes (20): { commonHeaders }, { SYSTEM_ARCHITECTURE }, { telemetrySummary }, {
  commonHeaders,
  publicError,
  takeRateLimit,
  validateOptimizerPayload
}, { SYSTEM_ARCHITECTURE, runSystemRunInline }, { telemetrySummary }, applyResultTrace(), baseStages() (+12 more)

### Community 13 - "MockResponse"
Cohesion: 0.16
Nodes (7): assert, { EventEmitter }, handlers, invoke(), MockResponse, request(), run()

### Community 14 - "Token Optimizer"
Cohesion: 0.14
Nodes (13): Assistant Extension MVP, Contributing Principle, Execution Flow, Graphify Code Graph, License, Optional Provider Keys, Product Shape, Run Locally (+5 more)

### Community 15 - "sidepanel-logic.test.cjs"
Cohesion: 0.17
Nodes (10): assert, context, elements, extensionDir, fs, path, platformsCode, preparedResponse (+2 more)

### Community 16 - "api-endpoints.test.cjs"
Cohesion: 0.29
Nodes (10): assert, { callModel }, freePort(), http, jsonRequest(), listen(), post(), run() (+2 more)

### Community 17 - "Design QA"
Cohesion: 0.20
Nodes (9): Comparison History, Comparison Target, Design QA, Findings, Focused Evidence, Follow-up Polish, Implementation Checklist, Interaction And Runtime Checks (+1 more)

### Community 18 - "Publishing Token Optimizer for Gemini and ChatGPT"
Cohesion: 0.20
Nodes (9): Current Wrapper, Local Test Notes, Open Source Use, Package Command, Privacy Policy Notes, Publication Types, Publishing Token Optimizer for Gemini and ChatGPT, Store Listing Assets (+1 more)

### Community 19 - "service-worker.test.cjs"
Cohesion: 0.20
Nodes (9): assert, context, extensionDir, fs, panelOptions, path, platformsCode, serviceWorkerCode (+1 more)

### Community 21 - "Chrome Web Store Listing Copy"
Cohesion: 0.22
Nodes (8): Chrome Web Store Listing Copy, Detailed Description, Extension Name, Permission Justification, Privacy Policy URL, Short Description, Single Purpose Statement, Store Assets

### Community 22 - "frontend-static.test.cjs"
Cohesion: 0.22
Nodes (8): assert, fs, htmlFiles, outputsDir, path, privacySource, retiredGenerator, vm

### Community 24 - "Token Optimizer for Gemini and ChatGPT"
Cohesion: 0.25
Nodes (7): Backend, Extend The Wrapper, Load Locally, Package For Upload Later, Privacy Shape, Token Optimizer for Gemini and ChatGPT, What It Does

### Community 25 - "text.cjs"
Cohesion: 0.38
Nodes (3): cleanPromptText(), dedupeNaturalLanguageLines(), stripListPrefix()

### Community 26 - "system-worker.js"
Cohesion: 0.52
Nodes (6): analyzePrompt(), complexityScore(), estimateTokens(), lines(), outputStyle(), uniqueLines()

### Community 27 - "chatgpt.js"
Cohesion: 0.67
Nodes (5): hasPromptLabel(), isCandidate(), isHugeEditable(), isNearPromptArea(), score()

### Community 28 - "gemini.js"
Cohesion: 0.67
Nodes (5): hasPromptLabel(), isCandidate(), isHugeEditable(), isNearPromptArea(), score()

### Community 29 - "optimize-stream.js"
Cohesion: 0.50
Nodes (4): {
  abortSignalOnClose,
  commonHeaders,
  publicError,
  takeRateLimit,
  validateOptimizerPayload
}, { createTraceId, runSelfOptimizingWorkflow }, onEvent(), writeEvent()

### Community 30 - "Site Adapter Architecture"
Cohesion: 0.40
Nodes (4): Adapter Contract, Add Another Assistant, Layers, Site Adapter Architecture

## Knowledge Gaps
- **257 isolated node(s):** `assert`, `fs`, `path`, `vm`, `promptBox` (+252 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `MockResponse` connect `MockResponse` to `providers.cjs`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `runSelfOptimizingWorkflow()` connect `providers.cjs` to `telemetry.cjs`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **What connects `assert`, `fs`, `path` to the rest of the system?**
  _257 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `providers.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.06009783368273934 - nodes in this community are weakly interconnected._
- **Should `request-guard.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.06377551020408163 - nodes in this community are weakly interconnected._
- **Should `workspace.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11193339500462535 - nodes in this community are weakly interconnected._
- **Should `harness.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.10512820512820513 - nodes in this community are weakly interconnected._
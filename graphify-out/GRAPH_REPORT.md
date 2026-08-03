# Graph Report - .  (2026-08-03)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 587 nodes · 849 edges · 41 communities (31 shown, 10 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 79 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a1a1efe3`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- workspace.js
- optimizer-core.cjs
- harness.cjs
- security.cjs
- manifest.json
- scripts
- providers.cjs
- content-chatgpt.test.cjs
- content-gemini.test.cjs
- server.cjs
- sidepanel.js
- request-guard.cjs
- MockResponse
- optimizer-system.cjs
- Token Optimizer
- sidepanel-logic.test.cjs
- Design QA
- Publishing Token Optimizer for Gemini and ChatGPT
- service-worker.test.cjs
- prompts.cjs
- Chrome Web Store Listing Copy
- frontend-static.test.cjs
- Token Optimizer for Gemini and ChatGPT
- text.cjs
- system-worker.js
- chatgpt.js
- gemini.js
- optimize-stream.js
- Site Adapter Architecture
- canonical-graph.cjs
- a2a-run.js
- generate.js
- optimize-run.js
- provider-status.js
- system-overview.js
- system-runs.js
- workflow-run.js
- vercel.json

## God Nodes (most connected - your core abstractions)
1. `run()` - 18 edges
2. `Token Optimizer` - 13 edges
3. `handleApi()` - 12 edges
4. `scripts` - 12 edges
5. `FakeElement` - 11 edges
6. `FakeElement` - 11 edges
7. `renderCompleted()` - 11 edges
8. `el()` - 11 edges
9. `preparePrompt()` - 11 edges
10. `bindEvents()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `build()` --indirect_call--> `capturePrompt()`  [INFERRED]
  extensions/gemini-token-optimizer/adapters/base.js → extensions/gemini-token-optimizer/sidepanel.js
- `publicError()` --calls--> `safeErrorMessage()`  [EXTRACTED]
  request-guard.cjs → core/security.cjs
- `run()` --calls--> `callModel()`  [EXTRACTED]
  tests/api-endpoints.test.cjs → core/providers.cjs
- `run()` --calls--> `analyzeWorkflowShape()`  [EXTRACTED]
  tests/optimizer-core.test.cjs → core/routing.cjs
- `run()` --calls--> `buildOfflineContract()`  [EXTRACTED]
  tests/optimizer-core.test.cjs → core/routing.cjs

## Import Cycles
- None detected.

## Communities (41 total, 10 thin omitted)

### Community 0 - "workspace.js"
Cohesion: 0.11
Nodes (45): bindEvents(), checkService(), compactNumber(), contextComparisonText(), contextInput(), continueFromResult(), coordinatorActions(), copyText() (+37 more)

### Community 1 - "optimizer-core.cjs"
Cohesion: 0.07
Nodes (38): { analyzeWorkflowShape, buildOfflineContract }, buildPortablePrompt(), cleanDirectRequest(), {
  cleanPromptText,
  compactLines,
  dedupeNaturalLanguageLines,
  promptSection,
  stripListPrefix,
  withoutTrailingEllipsis
}, { estimateTokens }, isLikelyOriginalTask(), isPreparedWrapper(), originalTaskScore() (+30 more)

### Community 2 - "harness.cjs"
Cohesion: 0.11
Nodes (37): {
  callChatCompletion,
  preparePortableHandoff,
  runSelfOptimizingWorkflow
}, evaluateLiveCase(), evaluateOutputCheck(), evaluatePreparedCase(), formatDeterministicReport(), formatLiveReport(), fs, includesValue() (+29 more)

### Community 3 - "security.cjs"
Cohesion: 0.10
Nodes (33): canonicalContract(), compactList(), compactString(), handoffContractSchema, parseJsonObject(), { redactSensitiveText }, validateHandoffContract(), { z } (+25 more)

### Community 4 - "manifest.json"
Cohesion: 0.06
Nodes (33): action, default_icon, default_title, background, service_worker, type, content_scripts, content_security_policy (+25 more)

### Community 5 - "scripts"
Cohesion: 0.06
Nodes (30): dompurify, marked, dependencies, zod, description, //devDependencies, dompurify, marked (+22 more)

### Community 6 - "providers.cjs"
Cohesion: 0.12
Nodes (28): boundedNumber(), callChatCompletion(), callModel(), callWorkflowProvider(), createRequestSignal(), { estimateTokens, modelCost, normalizeUsage }, fallbackAttemptMessage(), generateWithFallback() (+20 more)

### Community 7 - "content-chatgpt.test.cjs"
Cohesion: 0.07
Nodes (14): adapterCode, assert, baseCode, bridgeCode, composerForm, context, FakeElement, fs (+6 more)

### Community 8 - "content-gemini.test.cjs"
Cohesion: 0.07
Nodes (14): adapterCode, assert, baseCode, bridgeCode, context, FakeElement, fs, hugeEditor (+6 more)

### Community 9 - "server.cjs"
Cohesion: 0.11
Nodes (24): abortSignalOnClose(), allowedApiMethods(), {
  callChatCompletion,
  createTraceId,
  generateWithFallback,
  preparePortableHandoff,
  providerStatus,
  runBlankA2AKit,
  runSelfOptimizingWorkflow
}, commonHeaders(), { createOptimizerSystem }, fs, graphifyDir, guard (+16 more)

### Community 10 - "sidepanel.js"
Cohesion: 0.21
Nodes (22): build(), bindEvents(), capturePrompt(), checkConnection(), copyPrepared(), currentContext(), el(), estimateTokens() (+14 more)

### Community 11 - "request-guard.cjs"
Cohesion: 0.10
Nodes (20): {
  commonHeaders,
  publicError,
  takeRateLimit,
  validateOptimizerPayload
}, { preparePortableHandoff }, a2aPayloadSchema, buckets, clientKey(), commonHeaders(), generatePayloadSchema, MAX_INPUT_CHARS (+12 more)

### Community 12 - "MockResponse"
Cohesion: 0.15
Nodes (7): assert, { EventEmitter }, handlers, invoke(), MockResponse, request(), run()

### Community 13 - "optimizer-system.cjs"
Cohesion: 0.26
Nodes (13): applyResultTrace(), baseStages(), compactTitle(), createId(), createRun(), {
  estimateTokens,
  runBlankA2AKit,
  runSelfOptimizingWorkflow
}, executeSystemRun(), nowIso() (+5 more)

### Community 14 - "Token Optimizer"
Cohesion: 0.14
Nodes (13): Assistant Extension MVP, Contributing Principle, Execution Flow, Graphify Code Graph, License, Optional Provider Keys, Product Shape, Run Locally (+5 more)

### Community 15 - "sidepanel-logic.test.cjs"
Cohesion: 0.17
Nodes (10): assert, context, elements, extensionDir, fs, path, platformsCode, preparedResponse (+2 more)

### Community 16 - "Design QA"
Cohesion: 0.20
Nodes (9): Comparison History, Comparison Target, Design QA, Findings, Focused Evidence, Follow-up Polish, Implementation Checklist, Interaction And Runtime Checks (+1 more)

### Community 17 - "Publishing Token Optimizer for Gemini and ChatGPT"
Cohesion: 0.20
Nodes (9): Current Wrapper, Local Test Notes, Open Source Use, Package Command, Privacy Policy Notes, Publication Types, Publishing Token Optimizer for Gemini and ChatGPT, Store Listing Assets (+1 more)

### Community 18 - "service-worker.test.cjs"
Cohesion: 0.20
Nodes (9): assert, context, extensionDir, fs, panelOptions, path, platformsCode, serviceWorkerCode (+1 more)

### Community 20 - "Chrome Web Store Listing Copy"
Cohesion: 0.22
Nodes (8): Chrome Web Store Listing Copy, Detailed Description, Extension Name, Permission Justification, Privacy Policy URL, Short Description, Single Purpose Statement, Store Assets

### Community 21 - "frontend-static.test.cjs"
Cohesion: 0.22
Nodes (8): assert, fs, htmlFiles, outputsDir, path, privacySource, retiredGenerator, vm

### Community 22 - "Token Optimizer for Gemini and ChatGPT"
Cohesion: 0.25
Nodes (7): Backend, Extend The Wrapper, Load Locally, Package For Upload Later, Privacy Shape, Token Optimizer for Gemini and ChatGPT, What It Does

### Community 23 - "text.cjs"
Cohesion: 0.38
Nodes (3): cleanPromptText(), dedupeNaturalLanguageLines(), stripListPrefix()

### Community 24 - "system-worker.js"
Cohesion: 0.52
Nodes (6): analyzePrompt(), complexityScore(), estimateTokens(), lines(), outputStyle(), uniqueLines()

### Community 25 - "chatgpt.js"
Cohesion: 0.67
Nodes (5): hasPromptLabel(), isCandidate(), isHugeEditable(), isNearPromptArea(), score()

### Community 26 - "gemini.js"
Cohesion: 0.67
Nodes (5): hasPromptLabel(), isCandidate(), isHugeEditable(), isNearPromptArea(), score()

### Community 27 - "optimize-stream.js"
Cohesion: 0.50
Nodes (4): {
  abortSignalOnClose,
  commonHeaders,
  publicError,
  takeRateLimit,
  validateOptimizerPayload
}, { createTraceId, runSelfOptimizingWorkflow }, onEvent(), writeEvent()

### Community 28 - "Site Adapter Architecture"
Cohesion: 0.40
Nodes (4): Adapter Contract, Add Another Assistant, Layers, Site Adapter Architecture

## Knowledge Gaps
- **245 isolated node(s):** `assert`, `fs`, `path`, `vm`, `promptBox` (+240 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `redactSensitiveText()` connect `security.cjs` to `optimizer-core.cjs`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **Why does `safeErrorMessage()` connect `security.cjs` to `request-guard.cjs`?**
  _High betweenness centrality (0.002) - this node is a cross-community bridge._
- **What connects `assert`, `fs`, `path` to the rest of the system?**
  _245 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `workspace.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11193339500462535 - nodes in this community are weakly interconnected._
- **Should `optimizer-core.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.06868686868686869 - nodes in this community are weakly interconnected._
- **Should `harness.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.10512820512820513 - nodes in this community are weakly interconnected._
- **Should `security.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.09841269841269841 - nodes in this community are weakly interconnected._
# Graph Report - .  (2026-08-03)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 539 nodes · 804 edges · 40 communities (30 shown, 10 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 70 edges (avg confidence: 0.51)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `59320883`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- request-guard.cjs
- workspace.js
- manifest.json
- optimizer-core.cjs
- handoff.cjs
- package.json
- content-chatgpt.test.cjs
- content-gemini.test.cjs
- server.cjs
- sidepanel.js
- MockResponse
- optimizer-system.cjs
- Token Optimizer
- sidepanel-logic.test.cjs
- api-endpoints.test.cjs
- Design QA
- Publishing Token Optimizer for Gemini and ChatGPT
- service-worker.test.cjs
- contracts.cjs
- prompts.cjs
- Chrome Web Store Listing Copy
- Token Optimizer for Gemini and ChatGPT
- system-worker.js
- frontend-static.test.cjs
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
4. `FakeElement` - 11 edges
5. `FakeElement` - 11 edges
6. `renderCompleted()` - 11 edges
7. `el()` - 11 edges
8. `preparePrompt()` - 11 edges
9. `redactSensitiveText()` - 11 edges
10. `run()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `build()` --indirect_call--> `capturePrompt()`  [INFERRED]
  extensions/gemini-token-optimizer/adapters/base.js → extensions/gemini-token-optimizer/sidepanel.js
- `run()` --calls--> `redactSensitiveText()`  [EXTRACTED]
  tests/optimizer-core.test.cjs → core/security.cjs
- `publicError()` --calls--> `safeErrorMessage()`  [EXTRACTED]
  request-guard.cjs → core/security.cjs
- `run()` --calls--> `safeErrorMessage()`  [EXTRACTED]
  tests/optimizer-core.test.cjs → core/security.cjs
- `run()` --calls--> `isPublicIpAddress()`  [EXTRACTED]
  tests/optimizer-core.test.cjs → core/security.cjs

## Import Cycles
- None detected.

## Communities (40 total, 10 thin omitted)

### Community 0 - "request-guard.cjs"
Cohesion: 0.06
Nodes (54): {
  commonHeaders,
  publicError,
  takeRateLimit,
  validateOptimizerPayload
}, { preparePortableHandoff }, assertSafeProviderEndpoint(), isPublicIpAddress(), isPublicIpv4(), isPublicIpv6(), matchesIpv6Prefix(), net (+46 more)

### Community 1 - "workspace.js"
Cohesion: 0.11
Nodes (45): bindEvents(), checkService(), compactNumber(), contextComparisonText(), contextInput(), continueFromResult(), coordinatorActions(), copyText() (+37 more)

### Community 2 - "manifest.json"
Cohesion: 0.06
Nodes (33): action, default_icon, default_title, background, service_worker, type, content_scripts, content_security_policy (+25 more)

### Community 3 - "optimizer-core.cjs"
Cohesion: 0.10
Nodes (27): boundedNumber(), callChatCompletion(), callModel(), callWorkflowProvider(), createRequestSignal(), { estimateTokens, modelCost, normalizeUsage }, generateWithFallback(), http (+19 more)

### Community 4 - "handoff.cjs"
Cohesion: 0.19
Nodes (24): { analyzeWorkflowShape, buildOfflineContract }, buildPortablePrompt(), cleanDirectRequest(), {
  cleanPromptText,
  compactLines,
  dedupeNaturalLanguageLines,
  promptSection,
  stripListPrefix,
  withoutTrailingEllipsis
}, { estimateTokens }, isLikelyOriginalTask(), isPreparedWrapper(), originalTaskScore() (+16 more)

### Community 5 - "package.json"
Cohesion: 0.07
Nodes (26): dompurify, marked, dependencies, zod, description, //devDependencies, dompurify, marked (+18 more)

### Community 6 - "content-chatgpt.test.cjs"
Cohesion: 0.07
Nodes (14): adapterCode, assert, baseCode, bridgeCode, composerForm, context, FakeElement, fs (+6 more)

### Community 7 - "content-gemini.test.cjs"
Cohesion: 0.07
Nodes (14): adapterCode, assert, baseCode, bridgeCode, context, FakeElement, fs, hugeEditor (+6 more)

### Community 8 - "server.cjs"
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

### Community 9 - "sidepanel.js"
Cohesion: 0.21
Nodes (22): build(), bindEvents(), capturePrompt(), checkConnection(), copyPrepared(), currentContext(), el(), estimateTokens() (+14 more)

### Community 10 - "MockResponse"
Cohesion: 0.15
Nodes (7): assert, { EventEmitter }, handlers, invoke(), MockResponse, request(), run()

### Community 11 - "optimizer-system.cjs"
Cohesion: 0.26
Nodes (13): applyResultTrace(), baseStages(), compactTitle(), createId(), createRun(), {
  estimateTokens,
  runBlankA2AKit,
  runSelfOptimizingWorkflow
}, executeSystemRun(), nowIso() (+5 more)

### Community 12 - "Token Optimizer"
Cohesion: 0.14
Nodes (13): Assistant Extension MVP, Contributing Principle, Execution Flow, Graphify Code Graph, License, Optional Provider Keys, Product Shape, Run Locally (+5 more)

### Community 13 - "sidepanel-logic.test.cjs"
Cohesion: 0.17
Nodes (10): assert, context, elements, extensionDir, fs, path, platformsCode, preparedResponse (+2 more)

### Community 14 - "api-endpoints.test.cjs"
Cohesion: 0.29
Nodes (10): assert, { callModel }, freePort(), http, jsonRequest(), listen(), post(), run() (+2 more)

### Community 15 - "Design QA"
Cohesion: 0.20
Nodes (9): Comparison History, Comparison Target, Design QA, Findings, Focused Evidence, Follow-up Polish, Implementation Checklist, Interaction And Runtime Checks (+1 more)

### Community 16 - "Publishing Token Optimizer for Gemini and ChatGPT"
Cohesion: 0.20
Nodes (9): Current Wrapper, Local Test Notes, Open Source Use, Package Command, Privacy Policy Notes, Publication Types, Publishing Token Optimizer for Gemini and ChatGPT, Store Listing Assets (+1 more)

### Community 17 - "service-worker.test.cjs"
Cohesion: 0.20
Nodes (9): assert, context, extensionDir, fs, panelOptions, path, platformsCode, serviceWorkerCode (+1 more)

### Community 18 - "contracts.cjs"
Cohesion: 0.31
Nodes (8): canonicalContract(), compactList(), compactString(), handoffContractSchema, parseJsonObject(), { redactSensitiveText }, validateHandoffContract(), { z }

### Community 20 - "Chrome Web Store Listing Copy"
Cohesion: 0.22
Nodes (8): Chrome Web Store Listing Copy, Detailed Description, Extension Name, Permission Justification, Privacy Policy URL, Short Description, Single Purpose Statement, Store Assets

### Community 21 - "Token Optimizer for Gemini and ChatGPT"
Cohesion: 0.25
Nodes (7): Backend, Extend The Wrapper, Load Locally, Package For Upload Later, Privacy Shape, Token Optimizer for Gemini and ChatGPT, What It Does

### Community 22 - "system-worker.js"
Cohesion: 0.52
Nodes (6): analyzePrompt(), complexityScore(), estimateTokens(), lines(), outputStyle(), uniqueLines()

### Community 23 - "frontend-static.test.cjs"
Cohesion: 0.29
Nodes (6): assert, fs, htmlFiles, outputsDir, path, vm

### Community 24 - "chatgpt.js"
Cohesion: 0.67
Nodes (5): hasPromptLabel(), isCandidate(), isHugeEditable(), isNearPromptArea(), score()

### Community 25 - "gemini.js"
Cohesion: 0.67
Nodes (5): hasPromptLabel(), isCandidate(), isHugeEditable(), isNearPromptArea(), score()

### Community 26 - "optimize-stream.js"
Cohesion: 0.50
Nodes (4): {
  abortSignalOnClose,
  commonHeaders,
  publicError,
  takeRateLimit,
  validateOptimizerPayload
}, { createTraceId, runSelfOptimizingWorkflow }, onEvent(), writeEvent()

### Community 27 - "Site Adapter Architecture"
Cohesion: 0.40
Nodes (4): Adapter Contract, Add Another Assistant, Layers, Site Adapter Architecture

## Knowledge Gaps
- **226 isolated node(s):** `{ estimateTokens }`, `{ redactSensitiveText }`, `{ analyzeWorkflowShape, buildOfflineContract }`, `{
  cleanPromptText,
  compactLines,
  dedupeNaturalLanguageLines,
  promptSection,
  stripListPrefix,
  withoutTrailingEllipsis
}`, `assert` (+221 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `redactSensitiveText()` connect `request-guard.cjs` to `contracts.cjs`, `optimizer-core.cjs`, `handoff.cjs`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **What connects `{ estimateTokens }`, `{ redactSensitiveText }`, `{ analyzeWorkflowShape, buildOfflineContract }` to the rest of the system?**
  _226 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `request-guard.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.059227921734531994 - nodes in this community are weakly interconnected._
- **Should `workspace.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11193339500462535 - nodes in this community are weakly interconnected._
- **Should `manifest.json` be split into smaller, more focused modules?**
  _Cohesion score 0.058823529411764705 - nodes in this community are weakly interconnected._
- **Should `optimizer-core.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.10080645161290322 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._
# Graph Report - .  (2026-08-10)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 938 nodes · 1571 edges · 49 communities (44 shown, 5 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 145 edges (avg confidence: 0.52)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `66a97b03`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- server.cjs
- telemetry-analysis.cjs
- workspace.js
- providers.cjs
- scripts
- harness.cjs
- shared-request-guard.cjs
- telemetry.cjs
- request-guard.cjs
- handoff.cjs
- manifest.json
- optimize-stream.js
- sidepanel.js
- content-chatgpt.test.cjs
- content-gemini.test.cjs
- workflow.cjs
- security.cjs
- package-chrome-extension.cjs
- acceptance.cjs
- acceptance-gates.test.cjs
- FakeRedisRestClient
- request-guard.test.cjs
- MockResponse
- prompt-compiler-parity.test.cjs
- Token Optimizer
- sidepanel-logic.test.cjs
- redis-lua-smoke.test.cjs
- public-result.cjs
- api-endpoints.test.cjs
- Design QA
- Publishing Token Optimizer for Gemini and ChatGPT
- service-worker.test.cjs
- frontend-static.test.cjs
- prompts.cjs
- Chrome Web Store Listing Copy
- Token Optimizer for Gemini and ChatGPT
- generate.js
- text.cjs
- chatgpt.js
- gemini.js
- sync-prompt-compiler.cjs
- Site Adapter Architecture
- canonical-graph.cjs
- provider-status.js
- vercel.json

## God Nodes (most connected - your core abstractions)
1. `scripts` - 21 edges
2. `FakeRedisRestClient` - 20 edges
3. `run()` - 18 edges
4. `recordWorkflowRun()` - 17 edges
5. `handleApi()` - 16 edges
6. `repairAcceptanceFailures()` - 15 edges
7. `runSelfOptimizingWorkflow()` - 15 edges
8. `run()` - 15 edges
9. `createSharedRequestGuardAdapters()` - 15 edges
10. `summarizeTelemetryEvents()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `run()` --calls--> `resolveProvider()`  [EXTRACTED]
  tests/optimizer-core.test.cjs → core/providers.cjs
- `run()` --calls--> `generateWithFallback()`  [EXTRACTED]
  tests/optimizer-core.test.cjs → core/providers.cjs
- `run()` --calls--> `projectPublicResult()`  [EXTRACTED]
  tests/public-result.test.cjs → core/public-result.cjs
- `startStream()` --calls--> `commonHeaders()`  [EXTRACTED]
  api/optimize-stream.js → request-guard.cjs
- `run()` --calls--> `createBillableRequestGuard()`  [EXTRACTED]
  tests/shared-request-guard.test.cjs → request-guard.cjs

## Import Cycles
- None detected.

## Communities (49 total, 5 thin omitted)

### Community 0 - "server.cjs"
Cohesion: 0.06
Nodes (48): { commonHeaders, requestGuardBackend }, { SYSTEM_ARCHITECTURE }, { telemetrySummary }, applyResultTrace(), baseStages(), compactTitle(), createId(), createOptimizerSystem() (+40 more)

### Community 1 - "telemetry-analysis.cjs"
Cohesion: 0.07
Nodes (48): alertForMetric(), boundedInteger(), DEFAULT_ALERT_POLICY, evaluateTelemetryHealth(), finiteNumber(), increment(), KNOWN_ACCEPTANCE_STATUSES, KNOWN_ENDPOINTS (+40 more)

### Community 2 - "workspace.js"
Cohesion: 0.11
Nodes (46): bindEvents(), checkService(), compactNumber(), contextComparisonText(), contextInput(), continueFromResult(), coordinatorActions(), copyText() (+38 more)

### Community 3 - "providers.cjs"
Cohesion: 0.08
Nodes (38): boundedNumber(), callChatCompletion(), callModel(), callWorkflowProvider(), createRequestSignal(), { estimateTokens, modelCost, normalizeUsage }, executeModelCall(), fallbackAttemptMessage() (+30 more)

### Community 4 - "scripts"
Cohesion: 0.05
Nodes (39): dompurify, marked, dependencies, zod, description, //devDependencies, dompurify, marked (+31 more)

### Community 5 - "harness.cjs"
Cohesion: 0.11
Nodes (37): {
  callChatCompletion,
  preparePortableHandoff,
  runSelfOptimizingWorkflow
}, evaluateLiveCase(), evaluateOutputCheck(), evaluatePreparedCase(), formatDeterministicReport(), formatLiveReport(), fs, includesValue() (+29 more)

### Community 6 - "shared-request-guard.cjs"
Cohesion: 0.12
Nodes (34): boundedInteger(), cancellationError(), createKeySpace(), createRedisConcurrencyGate(), createRedisDailyBudget(), createRedisIdempotencyStore(), createRedisRateLimiter(), createRedisRestClient() (+26 more)

### Community 7 - "telemetry.cjs"
Cohesion: 0.11
Nodes (34): boundedInteger(), classifyFailure(), configuration, events, KNOWN_ACCEPTANCE_STATUSES, KNOWN_ENDPOINTS, KNOWN_PROVIDERS, KNOWN_QUALITY_STATUSES (+26 more)

### Community 8 - "request-guard.cjs"
Cohesion: 0.07
Nodes (29): a2aPayloadSchema, bearerCredential(), canonicalFingerprintValue(), clientKey(), crypto, DAILY_CALL_LIMIT, DAILY_TOKEN_LIMIT, defaultBillableRequestGuard (+21 more)

### Community 9 - "handoff.cjs"
Cohesion: 0.11
Nodes (26): { analyzeWorkflowShape, buildOfflineContract }, buildPortablePrompt(), cleanDirectRequest(), {
  cleanPromptText,
  compactLines,
  dedupeNaturalLanguageLines,
  promptSection,
  stripListPrefix,
  withoutTrailingEllipsis
}, { estimateTokens }, isLikelyOriginalTask(), isPreparedWrapper(), originalTaskScore() (+18 more)

### Community 10 - "manifest.json"
Cohesion: 0.06
Nodes (32): action, default_icon, default_title, background, service_worker, type, content_scripts, content_security_policy (+24 more)

### Community 11 - "optimize-stream.js"
Cohesion: 0.10
Nodes (26): {
  abortSignalOnClose,
  classifyProviderConfigFunding,
  commonHeaders,
  publicError,
  runBillableRequest,
  validateA2APayload
}, { projectPublicResult }, { runBlankA2AKit }, {
  abortSignalOnClose,
  commonHeaders,
  publicError,
  runBillableRequest,
  validateOptimizerPayload
}, { projectPublicResult }, { runSelfOptimizingWorkflow }, {
  abortSignalOnClose,
  commonHeaders,
  publicError,
  runBillableRequest,
  validateOptimizerPayload
}, { createTraceId, runSelfOptimizingWorkflow } (+18 more)

### Community 12 - "sidepanel.js"
Cohesion: 0.21
Nodes (24): build(), bindEvents(), capturePrompt(), checkConnection(), copyPrepared(), currentContext(), el(), estimateTokens() (+16 more)

### Community 13 - "content-chatgpt.test.cjs"
Cohesion: 0.07
Nodes (14): adapterCode, assert, baseCode, bridgeCode, composerForm, context, FakeElement, fs (+6 more)

### Community 14 - "content-gemini.test.cjs"
Cohesion: 0.07
Nodes (14): adapterCode, assert, baseCode, bridgeCode, context, FakeElement, fs, hugeEditor (+6 more)

### Community 15 - "workflow.cjs"
Cohesion: 0.15
Nodes (21): skippedAcceptanceReport(), skippedRepairReport(), { analyzeWorkflowShape, buildOfflineContract }, {
  buildA2AContractPrompt,
  buildA2AExecutorPrompt,
  buildA2AVerifierPrompt,
  buildDirectExecutorPrompt,
  buildExecutorPrompt,
  buildOptimizerPrompt,
  buildVerifierPrompt
}, buildBlankA2AKit(), { callModel, callWorkflowProvider, resolveProvider }, { combineUsage, contextComparison, createTraceId, estimateTokens, generationRecord }, {
  compileAcceptanceGates,
  evaluateAcceptanceGates,
  repairAcceptanceFailures,
  skippedAcceptanceReport,
  skippedRepairReport
} (+13 more)

### Community 16 - "security.cjs"
Cohesion: 0.15
Nodes (21): canonicalContract(), compactList(), compactString(), handoffContractSchema, parseJsonObject(), { redactSensitiveText }, validateHandoffContract(), { z } (+13 more)

### Community 17 - "package-chrome-extension.cjs"
Cohesion: 0.15
Nodes (21): assert, fs, os, {
  PACKAGE_FILES,
  archiveEntries,
  buildPackage,
  extensionRoot,
  validateSourceReferences
}, path, archiveEntries(), buildPackage(), crypto (+13 more)

### Community 18 - "acceptance.cjs"
Cohesion: 0.18
Nodes (21): addGate(), compactSource(), compileAcceptanceGates(), containsImplementationCode(), containsMarkdown(), countExecutableTests(), evaluateAcceptanceGates(), evaluateGate() (+13 more)

### Community 19 - "acceptance-gates.test.cjs"
Cohesion: 0.09
Nodes (21): ambiguousInteger, assert, badFormat, {
  compileAcceptanceGates,
  evaluateAcceptanceGates,
  repairAcceptanceFailures
}, endpointReport, fencedProseOnly, invalidJson, jsonDefinition (+13 more)

### Community 21 - "request-guard.test.cjs"
Cohesion: 0.23
Nodes (19): authorizeBillableRequest(), boundedInteger(), classifyProviderConfigFunding(), classifyRequestFunding(), constantTimeSecretEqual(), createBillableRequestGuard(), createConcurrencyGate(), createDailyBudget() (+11 more)

### Community 22 - "MockResponse"
Cohesion: 0.15
Nodes (8): assert, assertSafePublicResult(), { EventEmitter }, handlers, invoke(), MockResponse, request(), run()

### Community 23 - "prompt-compiler-parity.test.cjs"
Cohesion: 0.12
Nodes (16): assert, browserContext, browserPath, canonicalPath, canonicalSource, compiled, extensionPath, formerlyDivergent (+8 more)

### Community 24 - "Token Optimizer"
Cohesion: 0.14
Nodes (13): Assistant Extension MVP, Contributing Principle, Execution Flow, Graphify Code Graph, License, Optional Provider Keys, Product Shape, Run Locally (+5 more)

### Community 25 - "sidepanel-logic.test.cjs"
Cohesion: 0.15
Nodes (11): assert, compilerCode, context, elements, extensionDir, fs, path, platformsCode (+3 more)

### Community 26 - "redis-lua-smoke.test.cjs"
Cohesion: 0.23
Nodes (12): assert, command(), crypto, encodeCommand(), evaluate(), IncompleteReply, lineEnd(), net (+4 more)

### Community 27 - "public-result.cjs"
Cohesion: 0.29
Nodes (11): appendSecretValues(), collectConfiguredSecretValues(), contractMetadata(), kitMetadata(), PREPARED_ARTIFACT_FIELDS, projectPublicResult(), PUBLIC_RESULT_FIELDS, redactPublicValue() (+3 more)

### Community 28 - "api-endpoints.test.cjs"
Cohesion: 0.27
Nodes (11): assert, assertSafePublicResult(), { callModel }, freePort(), http, jsonRequest(), listen(), post() (+3 more)

### Community 29 - "Design QA"
Cohesion: 0.20
Nodes (9): Comparison History, Comparison Target, Design QA, Findings, Focused Evidence, Follow-up Polish, Implementation Checklist, Interaction And Runtime Checks (+1 more)

### Community 30 - "Publishing Token Optimizer for Gemini and ChatGPT"
Cohesion: 0.20
Nodes (9): Current Wrapper, Local Test Notes, Open Source Use, Package Command, Privacy Policy Notes, Publication Types, Publishing Token Optimizer for Gemini and ChatGPT, Store Listing Assets (+1 more)

### Community 31 - "service-worker.test.cjs"
Cohesion: 0.20
Nodes (9): assert, context, extensionDir, fs, panelOptions, path, platformsCode, serviceWorkerCode (+1 more)

### Community 32 - "frontend-static.test.cjs"
Cohesion: 0.20
Nodes (9): assert, faviconPath, fs, htmlFiles, outputsDir, path, privacySource, retiredGenerator (+1 more)

### Community 34 - "Chrome Web Store Listing Copy"
Cohesion: 0.22
Nodes (8): Chrome Web Store Listing Copy, Detailed Description, Extension Name, Permission Justification, Privacy Policy URL, Short Description, Single Purpose Statement, Store Assets

### Community 35 - "Token Optimizer for Gemini and ChatGPT"
Cohesion: 0.25
Nodes (7): Backend, Extend The Wrapper, Load Locally, Package For Upload Later, Privacy Shape, Token Optimizer for Gemini and ChatGPT, What It Does

### Community 36 - "generate.js"
Cohesion: 0.29
Nodes (6): {
  abortSignalOnClose,
  commonHeaders,
  publicError,
  runBillableRequest,
  validateGeneratePayload
}, { callChatCompletion, createTraceId, generateWithFallback }, { collectConfiguredSecretValues, redactPublicValue }, validateA2APayload(), validateGeneratePayload(), validateWith()

### Community 37 - "text.cjs"
Cohesion: 0.38
Nodes (3): cleanPromptText(), dedupeNaturalLanguageLines(), stripListPrefix()

### Community 38 - "chatgpt.js"
Cohesion: 0.67
Nodes (5): hasPromptLabel(), isCandidate(), isHugeEditable(), isNearPromptArea(), score()

### Community 39 - "gemini.js"
Cohesion: 0.67
Nodes (5): hasPromptLabel(), isCandidate(), isHugeEditable(), isNearPromptArea(), score()

### Community 40 - "sync-prompt-compiler.cjs"
Cohesion: 0.33
Nodes (5): fs, path, root, source, targets

### Community 41 - "Site Adapter Architecture"
Cohesion: 0.40
Nodes (4): Adapter Contract, Add Another Assistant, Layers, Site Adapter Architecture

## Knowledge Gaps
- **382 isolated node(s):** `assert`, `fs`, `path`, `vm`, `promptBox` (+377 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `runSelfOptimizingWorkflow()` connect `workflow.cjs` to `acceptance.cjs`, `providers.cjs`, `telemetry.cjs`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Why does `summarizeTelemetryEvents()` connect `telemetry-analysis.cjs` to `telemetry.cjs`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Why does `MockResponse` connect `MockResponse` to `providers.cjs`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **What connects `assert`, `fs`, `path` to the rest of the system?**
  _382 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `server.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.0602322206095791 - nodes in this community are weakly interconnected._
- **Should `telemetry-analysis.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.07137254901960784 - nodes in this community are weakly interconnected._
- **Should `workspace.js` be split into smaller, more focused modules?**
  _Cohesion score 0.1099290780141844 - nodes in this community are weakly interconnected._
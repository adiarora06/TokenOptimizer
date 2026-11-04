# Graph Report - .  (2026-11-04)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 982 nodes · 1607 edges · 55 communities (50 shown, 5 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 146 edges (avg confidence: 0.53)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from source commit: `db575a72` (before the generated Graphify artifact commit).
- Check for source changes after that commit; a newer `HEAD` containing only
  `graphify-out/` refreshes does not make this graph stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- telemetry-analysis.cjs
- workspace.js
- scripts
- harness.cjs
- request-guard.cjs
- shared-request-guard.cjs
- telemetry.cjs
- server.cjs
- handoff.cjs
- manifest.json
- a2a-run.js
- sidepanel.js
- content-chatgpt.test.cjs
- content-gemini.test.cjs
- workflow.cjs
- security.cjs
- package-chrome-extension.cjs
- acceptance.cjs
- providers.cjs
- acceptance-gates.test.cjs
- optimizer-system.cjs
- FakeRedisRestClient
- optimizer-core.cjs
- hosted-api.test.cjs
- request-guard.test.cjs
- prompt-compiler-parity.test.cjs
- Token Optimizer
- sidepanel-logic.test.cjs
- api-endpoints.test.cjs
- frontend-static.test.cjs
- redis-lua-smoke.test.cjs
- public-result.cjs
- Design QA
- Publishing Token Optimizer for Gemini and ChatGPT
- service-worker.test.cjs
- prompts.cjs
- Chrome Web Store Listing Copy
- sync-vendor.cjs
- optimize-stream.js
- workflow-run.js
- Token Optimizer for Gemini and ChatGPT
- workflow-security.test.cjs
- text.cjs
- chatgpt.js
- gemini.js
- sync-prompt-compiler.cjs
- vercel.json
- Site Adapter Architecture
- canonical-graph.cjs
- provider-status.js
- RequestGuardError

## God Nodes (most connected - your core abstractions)
1. `scripts` - 24 edges
2. `FakeRedisRestClient` - 20 edges
3. `run()` - 19 edges
4. `recordWorkflowRun()` - 17 edges
5. `handleApi()` - 16 edges
6. `repairAcceptanceFailures()` - 15 edges
7. `runSelfOptimizingWorkflow()` - 15 edges
8. `run()` - 15 edges
9. `summarizeTelemetryEvents()` - 14 edges
10. `recordProviderAttempt()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `createBillableRequestGuard()` --indirect_call--> `run()`  [INFERRED]
  request-guard.cjs → outputs/workspace.js
- `run()` --calls--> `resolveProvider()`  [EXTRACTED]
  tests/optimizer-core.test.cjs → core/providers.cjs
- `run()` --calls--> `generateWithFallback()`  [EXTRACTED]
  tests/optimizer-core.test.cjs → core/providers.cjs
- `run()` --calls--> `projectPublicResult()`  [EXTRACTED]
  tests/public-result.test.cjs → core/public-result.cjs
- `run()` --calls--> `createBillableRequestGuard()`  [EXTRACTED]
  tests/shared-request-guard.test.cjs → request-guard.cjs

## Import Cycles
- None detected.

## Communities (55 total, 5 thin omitted)

### Community 0 - "telemetry-analysis.cjs"
Cohesion: 0.07
Nodes (48): alertForMetric(), boundedInteger(), DEFAULT_ALERT_POLICY, evaluateTelemetryHealth(), finiteNumber(), increment(), KNOWN_ACCEPTANCE_STATUSES, KNOWN_ENDPOINTS (+40 more)

### Community 1 - "workspace.js"
Cohesion: 0.11
Nodes (46): bindEvents(), checkService(), compactNumber(), contextComparisonText(), contextInput(), continueFromResult(), coordinatorActions(), copyText() (+38 more)

### Community 2 - "scripts"
Cohesion: 0.05
Nodes (42): dompurify, marked, dependencies, zod, description, //devDependencies, dompurify, marked (+34 more)

### Community 3 - "harness.cjs"
Cohesion: 0.11
Nodes (37): {
  callChatCompletion,
  preparePortableHandoff,
  runSelfOptimizingWorkflow
}, evaluateLiveCase(), evaluateOutputCheck(), evaluatePreparedCase(), formatDeterministicReport(), formatLiveReport(), fs, includesValue() (+29 more)

### Community 4 - "request-guard.cjs"
Cohesion: 0.06
Nodes (34): a2aPayloadSchema, bearerCredential(), canonicalFingerprintValue(), clientKey(), configuredCredentialTagKey, credentialTag(), crypto, DAILY_CALL_LIMIT (+26 more)

### Community 5 - "shared-request-guard.cjs"
Cohesion: 0.12
Nodes (34): boundedInteger(), cancellationError(), createKeySpace(), createRedisConcurrencyGate(), createRedisDailyBudget(), createRedisIdempotencyStore(), createRedisRateLimiter(), createRedisRestClient() (+26 more)

### Community 6 - "telemetry.cjs"
Cohesion: 0.11
Nodes (34): boundedInteger(), classifyFailure(), configuration, events, KNOWN_ACCEPTANCE_STATUSES, KNOWN_ENDPOINTS, KNOWN_PROVIDERS, KNOWN_QUALITY_STATUSES (+26 more)

### Community 7 - "server.cjs"
Cohesion: 0.08
Nodes (32): abortSignalOnClose(), allowedApiMethods(), authorizeBillableRequest(), {
  callChatCompletion,
  createTraceId,
  generateWithFallback,
  preparePortableHandoff,
  providerStatus,
  runBlankA2AKit,
  runSelfOptimizingWorkflow,
  telemetrySummary
}, classifyProviderConfigFunding(), {
  collectConfiguredSecretValues,
  projectPublicResult,
  redactPublicValue
}, commonHeaders(), { createOptimizerSystem } (+24 more)

### Community 8 - "handoff.cjs"
Cohesion: 0.11
Nodes (26): { analyzeWorkflowShape, buildOfflineContract }, buildPortablePrompt(), cleanDirectRequest(), {
  cleanPromptText,
  compactLines,
  dedupeNaturalLanguageLines,
  promptSection,
  stripListPrefix,
  withoutTrailingEllipsis
}, { estimateTokens }, isLikelyOriginalTask(), isPreparedWrapper(), originalTaskScore() (+18 more)

### Community 9 - "manifest.json"
Cohesion: 0.06
Nodes (32): action, default_icon, default_title, background, service_worker, type, content_scripts, content_security_policy (+24 more)

### Community 10 - "a2a-run.js"
Cohesion: 0.11
Nodes (24): {
  abortSignalOnClose,
  classifyProviderConfigFunding,
  commonHeaders,
  runBillableRequest,
  validateA2APayload
}, { INTERNAL_API_ERROR }, { projectPublicResult }, { runBlankA2AKit }, {
  abortSignalOnClose,
  commonHeaders,
  runBillableRequest,
  validateGeneratePayload
}, { callChatCompletion, createTraceId, generateWithFallback }, { collectConfiguredSecretValues, redactPublicValue }, { INTERNAL_API_ERROR } (+16 more)

### Community 11 - "sidepanel.js"
Cohesion: 0.21
Nodes (24): build(), bindEvents(), capturePrompt(), checkConnection(), copyPrepared(), currentContext(), el(), estimateTokens() (+16 more)

### Community 12 - "content-chatgpt.test.cjs"
Cohesion: 0.07
Nodes (14): adapterCode, assert, baseCode, bridgeCode, composerForm, context, FakeElement, fs (+6 more)

### Community 13 - "content-gemini.test.cjs"
Cohesion: 0.07
Nodes (14): adapterCode, assert, baseCode, bridgeCode, context, FakeElement, fs, hugeEditor (+6 more)

### Community 14 - "workflow.cjs"
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

### Community 15 - "security.cjs"
Cohesion: 0.15
Nodes (21): canonicalContract(), compactList(), compactString(), handoffContractSchema, parseJsonObject(), { redactSensitiveText }, validateHandoffContract(), { z } (+13 more)

### Community 16 - "package-chrome-extension.cjs"
Cohesion: 0.15
Nodes (21): assert, fs, os, {
  PACKAGE_FILES,
  archiveEntries,
  buildPackage,
  extensionRoot,
  validateSourceReferences
}, path, archiveEntries(), buildPackage(), crypto (+13 more)

### Community 17 - "acceptance.cjs"
Cohesion: 0.18
Nodes (21): addGate(), compactSource(), compileAcceptanceGates(), containsImplementationCode(), containsMarkdown(), countExecutableTests(), evaluateAcceptanceGates(), evaluateGate() (+13 more)

### Community 18 - "providers.cjs"
Cohesion: 0.16
Nodes (20): boundedNumber(), callChatCompletion(), callModel(), callWorkflowProvider(), createRequestSignal(), { estimateTokens, modelCost, normalizeUsage }, executeModelCall(), fallbackAttemptMessage() (+12 more)

### Community 19 - "acceptance-gates.test.cjs"
Cohesion: 0.09
Nodes (21): ambiguousInteger, assert, badFormat, {
  compileAcceptanceGates,
  evaluateAcceptanceGates,
  repairAcceptanceFailures
}, endpointReport, fencedProseOnly, invalidJson, jsonDefinition (+13 more)

### Community 20 - "optimizer-system.cjs"
Cohesion: 0.16
Nodes (18): { commonHeaders, requestGuardBackend }, { SYSTEM_ARCHITECTURE }, { telemetrySummary }, applyResultTrace(), baseStages(), compactTitle(), createId(), createRun() (+10 more)

### Community 22 - "optimizer-core.cjs"
Cohesion: 0.12
Nodes (18): { analyzeWorkflowShape }, { callChatCompletion, generateWithFallback, providerStatus }, { combineUsage, createTraceId, estimateTokens }, {
  compileAcceptanceGates,
  evaluateAcceptanceGates,
  repairAcceptanceFailures
}, { compilePrompt, COMPILER_VERSION }, { preparePortableHandoff }, { redactSensitiveText }, { runBlankA2AKit, runSelfOptimizingWorkflow } (+10 more)

### Community 23 - "hosted-api.test.cjs"
Cohesion: 0.14
Nodes (10): assert, assertSafePublicResult(), { EventEmitter }, fs, handlers, invoke(), MockResponse, path (+2 more)

### Community 24 - "request-guard.test.cjs"
Cohesion: 0.26
Nodes (17): authorizeBillableRequest(), boundedInteger(), classifyProviderConfigFunding(), classifyRequestFunding(), constantTimeSecretEqual(), createBillableRequestGuard(), createConcurrencyGate(), createDailyBudget() (+9 more)

### Community 25 - "prompt-compiler-parity.test.cjs"
Cohesion: 0.12
Nodes (16): assert, browserContext, browserPath, canonicalPath, canonicalSource, compiled, extensionPath, formerlyDivergent (+8 more)

### Community 26 - "Token Optimizer"
Cohesion: 0.14
Nodes (13): Assistant Extension MVP, Contributing Principle, Execution Flow, Graphify Code Graph, License, Optional Provider Keys, Product Shape, Run Locally (+5 more)

### Community 27 - "sidepanel-logic.test.cjs"
Cohesion: 0.15
Nodes (11): assert, compilerCode, context, elements, extensionDir, fs, path, platformsCode (+3 more)

### Community 28 - "api-endpoints.test.cjs"
Cohesion: 0.26
Nodes (12): assert, assertSafePublicResult(), { callModel }, freePort(), http, jsonRequest(), listen(), persistentJsonRequest() (+4 more)

### Community 29 - "frontend-static.test.cjs"
Cohesion: 0.15
Nodes (11): assert, faviconPath, fs, htmlFiles, outputsDir, path, privacySource, retiredGenerator (+3 more)

### Community 30 - "redis-lua-smoke.test.cjs"
Cohesion: 0.23
Nodes (12): assert, command(), crypto, encodeCommand(), evaluate(), IncompleteReply, lineEnd(), net (+4 more)

### Community 31 - "public-result.cjs"
Cohesion: 0.29
Nodes (11): appendSecretValues(), collectConfiguredSecretValues(), contractMetadata(), kitMetadata(), PREPARED_ARTIFACT_FIELDS, projectPublicResult(), PUBLIC_RESULT_FIELDS, redactPublicValue() (+3 more)

### Community 32 - "Design QA"
Cohesion: 0.20
Nodes (9): Comparison History, Comparison Target, Design QA, Findings, Focused Evidence, Follow-up Polish, Implementation Checklist, Interaction And Runtime Checks (+1 more)

### Community 33 - "Publishing Token Optimizer for Gemini and ChatGPT"
Cohesion: 0.20
Nodes (9): Current Wrapper, Local Test Notes, Open Source Use, Package Command, Privacy Policy Notes, Publication Types, Publishing Token Optimizer for Gemini and ChatGPT, Store Listing Assets (+1 more)

### Community 34 - "service-worker.test.cjs"
Cohesion: 0.20
Nodes (9): assert, context, extensionDir, fs, panelOptions, path, platformsCode, serviceWorkerCode (+1 more)

### Community 36 - "Chrome Web Store Listing Copy"
Cohesion: 0.22
Nodes (8): Chrome Web Store Listing Copy, Detailed Description, Extension Name, Permission Justification, Privacy Policy URL, Short Description, Single Purpose Statement, Store Assets

### Community 37 - "sync-vendor.cjs"
Cohesion: 0.22
Nodes (7): checkOnly, fs, path, repositoryRoot, staleFiles, vendorFiles, vendorMapping

### Community 38 - "optimize-stream.js"
Cohesion: 0.29
Nodes (6): {
  abortSignalOnClose,
  commonHeaders,
  runBillableRequest,
  validateOptimizerPayload
}, { createTraceId, runSelfOptimizingWorkflow }, { INTERNAL_API_ERROR }, onEvent(), { projectPublicResult }, writeEvent()

### Community 39 - "workflow-run.js"
Cohesion: 0.25
Nodes (7): {
  abortSignalOnClose,
  classifyProviderConfigFunding,
  commonHeaders,
  runBillableRequest,
  validateA2APayload
}, { INTERNAL_API_ERROR }, { projectPublicResult }, { runBlankA2AKit }, validateA2APayload(), validateGeneratePayload(), validateWith()

### Community 40 - "Token Optimizer for Gemini and ChatGPT"
Cohesion: 0.25
Nodes (7): Backend, Extend The Wrapper, Load Locally, Package For Upload Later, Privacy Shape, Token Optimizer for Gemini and ChatGPT, What It Does

### Community 41 - "workflow-security.test.cjs"
Cohesion: 0.25
Nodes (7): assert, fs, path, references, violations, workflowDirectory, workflowFiles

### Community 42 - "text.cjs"
Cohesion: 0.38
Nodes (3): cleanPromptText(), dedupeNaturalLanguageLines(), stripListPrefix()

### Community 43 - "chatgpt.js"
Cohesion: 0.67
Nodes (5): hasPromptLabel(), isCandidate(), isHugeEditable(), isNearPromptArea(), score()

### Community 44 - "gemini.js"
Cohesion: 0.67
Nodes (5): hasPromptLabel(), isCandidate(), isHugeEditable(), isNearPromptArea(), score()

### Community 45 - "sync-prompt-compiler.cjs"
Cohesion: 0.33
Nodes (5): fs, path, root, source, targets

### Community 46 - "vercel.json"
Cohesion: 0.33
Nodes (5): functions, server.cjs, headers, $schema, includeFiles

### Community 47 - "Site Adapter Architecture"
Cohesion: 0.40
Nodes (4): Adapter Contract, Add Another Assistant, Layers, Site Adapter Architecture

## Knowledge Gaps
- **415 isolated node(s):** `assert`, `fs`, `path`, `vm`, `promptBox` (+410 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createBillableRequestGuard()` connect `request-guard.test.cjs` to `workspace.js`, `request-guard.cjs`, `shared-request-guard.cjs`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `run()` connect `workspace.js` to `request-guard.test.cjs`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Why does `runSelfOptimizingWorkflow()` connect `workflow.cjs` to `acceptance.cjs`, `providers.cjs`, `telemetry.cjs`, `optimizer-core.cjs`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `run()` (e.g. with `bindEvents()` and `createBillableRequestGuard()`) actually correct?**
  _`run()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `assert`, `fs`, `path` to the rest of the system?**
  _415 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `telemetry-analysis.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.07137254901960784 - nodes in this community are weakly interconnected._
- **Should `workspace.js` be split into smaller, more focused modules?**
  _Cohesion score 0.1099290780141844 - nodes in this community are weakly interconnected._

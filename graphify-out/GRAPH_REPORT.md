# Graph Report - .  (2026-11-04)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 980 nodes · 1617 edges · 52 communities (48 shown, 4 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 146 edges (avg confidence: 0.53)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from source commit: `2157d5d7` (before the generated Graphify artifact commit).
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
- optimize-stream.js
- telemetry.cjs
- server.cjs
- handoff.cjs
- manifest.json
- api-endpoints.test.cjs
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
- request-guard.test.cjs
- prompt-compiler-parity.test.cjs
- Token Optimizer
- sidepanel-logic.test.cjs
- redis-lua-smoke.test.cjs
- public-result.cjs
- frontend-static.test.cjs
- Design QA
- Publishing Token Optimizer for Gemini and ChatGPT
- service-worker.test.cjs
- prompts.cjs
- Chrome Web Store Listing Copy
- sync-vendor.cjs
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

## God Nodes (most connected - your core abstractions)
1. `scripts` - 24 edges
2. `FakeRedisRestClient` - 20 edges
3. `run()` - 18 edges
4. `recordWorkflowRun()` - 17 edges
5. `handleApi()` - 17 edges
6. `repairAcceptanceFailures()` - 15 edges
7. `runSelfOptimizingWorkflow()` - 15 edges
8. `run()` - 15 edges
9. `summarizeTelemetryEvents()` - 14 edges
10. `recordProviderAttempt()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `run()` --calls--> `resolveProvider()`  [EXTRACTED]
  tests/optimizer-core.test.cjs → core/providers.cjs
- `run()` --calls--> `generateWithFallback()`  [EXTRACTED]
  tests/optimizer-core.test.cjs → core/providers.cjs
- `run()` --calls--> `projectPublicResult()`  [EXTRACTED]
  tests/public-result.test.cjs → core/public-result.cjs
- `run()` --calls--> `createBillableRequestGuard()`  [EXTRACTED]
  tests/shared-request-guard.test.cjs → request-guard.cjs
- `run()` --indirect_call--> `createRedisConcurrencyGate()`  [INFERRED]
  tests/shared-request-guard.test.cjs → shared-request-guard.cjs

## Import Cycles
- None detected.

## Communities (52 total, 4 thin omitted)

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
Nodes (33): a2aPayloadSchema, bearerCredential(), canonicalFingerprintValue(), clientKey(), crypto, DAILY_CALL_LIMIT, DAILY_TOKEN_LIMIT, defaultBillableRequestGuard (+25 more)

### Community 5 - "shared-request-guard.cjs"
Cohesion: 0.12
Nodes (34): boundedInteger(), cancellationError(), createKeySpace(), createRedisConcurrencyGate(), createRedisDailyBudget(), createRedisIdempotencyStore(), createRedisRateLimiter(), createRedisRestClient() (+26 more)

### Community 6 - "optimize-stream.js"
Cohesion: 0.09
Nodes (31): {
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
}, { callChatCompletion, createTraceId, generateWithFallback }, { collectConfiguredSecretValues, redactPublicValue }, { INTERNAL_API_ERROR } (+23 more)

### Community 7 - "telemetry.cjs"
Cohesion: 0.11
Nodes (34): boundedInteger(), classifyFailure(), configuration, events, KNOWN_ACCEPTANCE_STATUSES, KNOWN_ENDPOINTS, KNOWN_PROVIDERS, KNOWN_QUALITY_STATUSES (+26 more)

### Community 8 - "server.cjs"
Cohesion: 0.08
Nodes (33): abortSignalOnClose(), allowedApiMethods(), authorizeBillableRequest(), {
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
}, commonHeaders(), { createOptimizerSystem } (+25 more)

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

### Community 11 - "api-endpoints.test.cjs"
Cohesion: 0.09
Nodes (22): assert, assertSafePublicResult(), { callModel }, freePort(), http, jsonRequest(), listen(), persistentJsonRequest() (+14 more)

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

### Community 19 - "providers.cjs"
Cohesion: 0.16
Nodes (20): boundedNumber(), callChatCompletion(), callModel(), callWorkflowProvider(), createRequestSignal(), { estimateTokens, modelCost, normalizeUsage }, executeModelCall(), fallbackAttemptMessage() (+12 more)

### Community 20 - "acceptance-gates.test.cjs"
Cohesion: 0.09
Nodes (21): ambiguousInteger, assert, badFormat, {
  compileAcceptanceGates,
  evaluateAcceptanceGates,
  repairAcceptanceFailures
}, endpointReport, fencedProseOnly, invalidJson, jsonDefinition (+13 more)

### Community 21 - "optimizer-system.cjs"
Cohesion: 0.16
Nodes (18): { commonHeaders, requestGuardBackend }, { SYSTEM_ARCHITECTURE }, { telemetrySummary }, applyResultTrace(), baseStages(), compactTitle(), createId(), createRun() (+10 more)

### Community 23 - "optimizer-core.cjs"
Cohesion: 0.12
Nodes (18): { analyzeWorkflowShape }, { callChatCompletion, generateWithFallback, providerStatus }, { combineUsage, createTraceId, estimateTokens }, {
  compileAcceptanceGates,
  evaluateAcceptanceGates,
  repairAcceptanceFailures
}, { compilePrompt, COMPILER_VERSION }, { preparePortableHandoff }, { redactSensitiveText }, { runBlankA2AKit, runSelfOptimizingWorkflow } (+10 more)

### Community 24 - "request-guard.test.cjs"
Cohesion: 0.25
Nodes (18): authorizeBillableRequest(), boundedInteger(), classifyProviderConfigFunding(), classifyRequestFunding(), constantTimeSecretEqual(), createBillableRequestGuard(), createConcurrencyGate(), createDailyBudget() (+10 more)

### Community 25 - "prompt-compiler-parity.test.cjs"
Cohesion: 0.12
Nodes (16): assert, browserContext, browserPath, canonicalPath, canonicalSource, compiled, extensionPath, formerlyDivergent (+8 more)

### Community 26 - "Token Optimizer"
Cohesion: 0.14
Nodes (13): Assistant Extension MVP, Contributing Principle, Execution Flow, Graphify Code Graph, License, Optional Provider Keys, Product Shape, Run Locally (+5 more)

### Community 27 - "sidepanel-logic.test.cjs"
Cohesion: 0.15
Nodes (11): assert, compilerCode, context, elements, extensionDir, fs, path, platformsCode (+3 more)

### Community 28 - "redis-lua-smoke.test.cjs"
Cohesion: 0.23
Nodes (12): assert, command(), crypto, encodeCommand(), evaluate(), IncompleteReply, lineEnd(), net (+4 more)

### Community 29 - "public-result.cjs"
Cohesion: 0.29
Nodes (11): appendSecretValues(), collectConfiguredSecretValues(), contractMetadata(), kitMetadata(), PREPARED_ARTIFACT_FIELDS, projectPublicResult(), PUBLIC_RESULT_FIELDS, redactPublicValue() (+3 more)

### Community 30 - "frontend-static.test.cjs"
Cohesion: 0.18
Nodes (10): assert, faviconPath, fs, htmlFiles, outputsDir, path, privacySource, retiredGenerator (+2 more)

### Community 31 - "Design QA"
Cohesion: 0.20
Nodes (9): Comparison History, Comparison Target, Design QA, Findings, Focused Evidence, Follow-up Polish, Implementation Checklist, Interaction And Runtime Checks (+1 more)

### Community 32 - "Publishing Token Optimizer for Gemini and ChatGPT"
Cohesion: 0.20
Nodes (9): Current Wrapper, Local Test Notes, Open Source Use, Package Command, Privacy Policy Notes, Publication Types, Publishing Token Optimizer for Gemini and ChatGPT, Store Listing Assets (+1 more)

### Community 33 - "service-worker.test.cjs"
Cohesion: 0.20
Nodes (9): assert, context, extensionDir, fs, panelOptions, path, platformsCode, serviceWorkerCode (+1 more)

### Community 35 - "Chrome Web Store Listing Copy"
Cohesion: 0.22
Nodes (8): Chrome Web Store Listing Copy, Detailed Description, Extension Name, Permission Justification, Privacy Policy URL, Short Description, Single Purpose Statement, Store Assets

### Community 36 - "sync-vendor.cjs"
Cohesion: 0.22
Nodes (7): checkOnly, fs, path, repositoryRoot, staleFiles, vendorFiles, vendorMapping

### Community 37 - "workflow-run.js"
Cohesion: 0.25
Nodes (7): {
  abortSignalOnClose,
  classifyProviderConfigFunding,
  commonHeaders,
  runBillableRequest,
  validateA2APayload
}, { INTERNAL_API_ERROR }, { projectPublicResult }, { runBlankA2AKit }, validateA2APayload(), validateGeneratePayload(), validateWith()

### Community 38 - "Token Optimizer for Gemini and ChatGPT"
Cohesion: 0.25
Nodes (7): Backend, Extend The Wrapper, Load Locally, Package For Upload Later, Privacy Shape, Token Optimizer for Gemini and ChatGPT, What It Does

### Community 39 - "workflow-security.test.cjs"
Cohesion: 0.25
Nodes (7): assert, fs, path, references, violations, workflowDirectory, workflowFiles

### Community 40 - "text.cjs"
Cohesion: 0.38
Nodes (3): cleanPromptText(), dedupeNaturalLanguageLines(), stripListPrefix()

### Community 41 - "chatgpt.js"
Cohesion: 0.67
Nodes (5): hasPromptLabel(), isCandidate(), isHugeEditable(), isNearPromptArea(), score()

### Community 42 - "gemini.js"
Cohesion: 0.67
Nodes (5): hasPromptLabel(), isCandidate(), isHugeEditable(), isNearPromptArea(), score()

### Community 43 - "sync-prompt-compiler.cjs"
Cohesion: 0.33
Nodes (5): fs, path, root, source, targets

### Community 44 - "vercel.json"
Cohesion: 0.33
Nodes (5): functions, server.cjs, headers, $schema, includeFiles

### Community 45 - "Site Adapter Architecture"
Cohesion: 0.40
Nodes (4): Adapter Contract, Add Another Assistant, Layers, Site Adapter Architecture

## Knowledge Gaps
- **413 isolated node(s):** `assert`, `fs`, `path`, `vm`, `promptBox` (+408 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `MockResponse` connect `api-endpoints.test.cjs` to `providers.cjs`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `runSelfOptimizingWorkflow()` connect `workflow.cjs` to `acceptance.cjs`, `providers.cjs`, `optimizer-core.cjs`, `telemetry.cjs`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `summarizeTelemetryEvents()` connect `telemetry-analysis.cjs` to `telemetry.cjs`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **What connects `assert`, `fs`, `path` to the rest of the system?**
  _413 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `telemetry-analysis.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.07137254901960784 - nodes in this community are weakly interconnected._
- **Should `workspace.js` be split into smaller, more focused modules?**
  _Cohesion score 0.1099290780141844 - nodes in this community are weakly interconnected._
- **Should `scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.046511627906976744 - nodes in this community are weakly interconnected._

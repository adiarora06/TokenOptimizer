const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";

const {
  authorizeBillableRequest,
  classifyProviderConfigFunding,
  constantTimeSecretEqual,
  createBillableRequestGuard,
  createConcurrencyGate,
  createDailyBudget,
  createIdempotencyStore,
  createRateLimiter,
  estimateBillableTokens,
  idempotencyFingerprint,
  tokenUsageFromResult,
  validateIdempotencyKey
} = require("../request-guard.cjs");

function request(ip, headers = {}) {
  return { headers, method: "POST", socket: { remoteAddress: ip } };
}

async function run() {
  let now = Date.parse("2026-08-08T12:00:00.000Z");
  const limiter = createRateLimiter({
    now: () => now,
    bucketCap: 2,
    profiles: {
      billable: { limit: 2, windowMs: 100 },
      preparation: { limit: 3, windowMs: 100 }
    }
  });
  assert.equal(limiter.take(request("203.0.113.1")).allowed, true);
  assert.equal(limiter.take(request("203.0.113.2")).allowed, true);
  const capacity = limiter.take(request("203.0.113.3"));
  assert.equal(capacity.allowed, false);
  assert.equal(capacity.capacityExceeded, true);
  assert.equal(limiter.inspect().size, 2, "the bucket map must never exceed its cap");
  now += 101;
  assert.equal(limiter.take(request("203.0.113.3")).allowed, true, "expired buckets free bounded capacity");

  assert.equal(constantTimeSecretEqual("same-secret", "same-secret"), true);
  assert.equal(constantTimeSecretEqual("short", "different-length-secret"), false);
  const productionAuth = { environment: "production", accessToken: "deployment-secret", allowPublicFunded: false };
  assert.equal(authorizeBillableRequest(request("203.0.113.4"), productionAuth).status, 401);
  assert.equal(authorizeBillableRequest(request("203.0.113.4", { authorization: "Bearer wrong" }), productionAuth).status, 401);
  assert.equal(
    authorizeBillableRequest(request("203.0.113.4", { authorization: "Bearer deployment-secret" }), productionAuth).allowed,
    true
  );
  assert.equal(authorizeBillableRequest(request("203.0.113.4"), {
    environment: "production",
    payload: { providerConfig: { provider: "openai", apiKey: "caller-key" } }
  }).funding, "byok");
  assert.equal(authorizeBillableRequest(request("203.0.113.4"), {
    environment: "production",
    accessToken: "",
    payload: { provider: "openai", providerConfig: { provider: "offline", apiKey: "unused-key" } }
  }).funding, "server", "an authoritative top-level provider fails closed on contradictory config");
  assert.equal(authorizeBillableRequest(request("203.0.113.4"), {
    environment: "production",
    payload: { provider: "offline" }
  }).funding, "offline");
  assert.equal(authorizeBillableRequest(request("203.0.113.4"), {
    environment: "production",
    allowPublicFunded: true
  }).allowed, true);
  assert.equal(authorizeBillableRequest(request("203.0.113.4"), {
    environment: "production",
    accessToken: "",
    allowPublicFunded: false
  }).status, 503);
  assert.equal(classifyProviderConfigFunding({ provider: "offline", apiKey: "ignored" }), "offline");
  assert.equal(classifyProviderConfigFunding({ provider: "openai", apiKey: "caller-key" }), "byok");
  assert.equal(classifyProviderConfigFunding({ provider: "openai" }), "server");
  assert.equal(authorizeBillableRequest(request("203.0.113.4"), {
    environment: "development",
    accessToken: ""
  }).allowed, true, "local development remains usable");

  const concurrency = createConcurrencyGate({ limit: 1 });
  const lease = concurrency.acquire();
  assert.equal(lease.allowed, true);
  assert.equal(concurrency.acquire().allowed, false);
  assert.equal(lease.release(), true);
  assert.equal(lease.release(), false, "release is idempotent");
  assert.equal(concurrency.inspect().active, 0);

  const daily = createDailyBudget({ now: () => now, callLimit: 2, tokenLimit: 100 });
  const firstReservation = daily.reserve({ calls: 1, tokens: 60 });
  assert.equal(firstReservation.allowed, true);
  assert.equal(firstReservation.settle({ tokens: 40 }).tokensUsed, 40);
  const secondReservation = daily.reserve({ calls: 1, tokens: 60 });
  assert.equal(secondReservation.allowed, true);
  assert.equal(secondReservation.settle({ tokens: 60 }).tokensUsed, 100);
  assert.equal(daily.reserve({ calls: 1, tokens: 1 }).allowed, false);
  now = Date.parse("2026-08-09T00:00:00.001Z");
  assert.equal(daily.reserve({ calls: 1, tokens: 100 }).allowed, true, "budgets reset at UTC midnight");

  const releasable = createDailyBudget({ callLimit: 1, tokenLimit: 10 });
  const rolledBack = releasable.reserve({ calls: 1, tokens: 10 });
  rolledBack.release();
  assert.equal(releasable.reserve({ calls: 1, tokens: 10 }).allowed, true, "unused reservations can be released");

  assert.equal(validateIdempotencyKey(undefined).ok, true);
  assert.equal(validateIdempotencyKey("short").ok, false);
  assert.equal(validateIdempotencyKey("request_12345678").ok, true);
  assert.equal(estimateBillableTokens({ prompt: "hello" }, "/api/generate") > 4_000, true);
  assert.equal(estimateBillableTokens({ input: "hello", provider: "offline" }, "/api/optimize-run"), 0);
  assert.equal(
    estimateBillableTokens({ input: "hello", options: { routePreference: "verified" } }, "/api/optimize-run") >
      estimateBillableTokens({ input: "hello", options: { routePreference: "fast" } }, "/api/optimize-run"),
    true
  );
  const secretFingerprint = idempotencyFingerprint("/api/run", { providerConfig: { apiKey: "secret-one" }, input: "hello" });
  assert.equal(secretFingerprint.includes("secret-one"), false);
  assert.notEqual(
    secretFingerprint,
    idempotencyFingerprint("/api/run", { providerConfig: { apiKey: "secret-two" }, input: "hello" })
  );
  assert.notEqual(secretFingerprint, idempotencyFingerprint("/api/other", { providerConfig: { apiKey: "secret-one" }, input: "hello" }));
  assert.equal(tokenUsageFromResult({ executionStatus: "provider_error", usage: { totalTokens: 0 } }), null);
  assert.equal(tokenUsageFromResult({ executionStatus: "cancelled", tokenReport: { actualTotalTokens: 0 } }), null);
  assert.equal(tokenUsageFromResult({ executionStatus: "completed", usage: { totalTokens: 12 } }), 12);
  assert.equal(tokenUsageFromResult({ result: { tokenReport: { actualTotalTokens: 17 } } }), 17);
  assert.equal(tokenUsageFromResult({ result: { executionStatus: "provider_error", tokenReport: { actualTotalTokens: 0 } } }), null);

  let idempotencyNow = 1_000;
  const store = createIdempotencyStore({ now: () => idempotencyNow, maxEntries: 2, ttlMs: 50 });
  let executions = 0;
  let finish;
  const held = new Promise((resolve) => { finish = resolve; });
  const identity = { key: "request_abcdefgh", scope: "client:/api/run", fingerprint: "fingerprint-a" };
  const first = store.execute(identity, async () => {
    executions += 1;
    await held;
    return { answer: 42 };
  });
  const joined = store.execute(identity, async () => {
    executions += 1;
    return { answer: 0 };
  });
  finish();
  const [firstResult, joinedResult] = await Promise.all([first, joined]);
  assert.equal(executions, 1);
  assert.equal(firstResult.status, "started");
  assert.equal(joinedResult.status, "joined");
  assert.equal((await store.execute(identity, async () => ({ answer: 0 }))).status, "replayed");
  await assert.rejects(
    store.execute({ ...identity, fingerprint: "fingerprint-b" }, async () => ({})),
    (error) => error.code === "idempotency_conflict" && error.status === 409
  );
  idempotencyNow += 51;
  assert.equal((await store.execute(identity, async () => ({ answer: 43 }))).status, "started", "completed entries expire");

  let uncertainMemoryNow = 2_000;
  const uncertainMemoryStore = createIdempotencyStore({ now: () => uncertainMemoryNow, maxEntries: 2, ttlMs: 50 });
  const uncertainMemoryIdentity = { key: "request_uncertain1", scope: "scope", fingerprint: "uncertain-1" };
  let uncertainMemoryExecutions = 0;
  await assert.rejects(
    uncertainMemoryStore.execute(uncertainMemoryIdentity, async (context) => {
      uncertainMemoryExecutions += 1;
      context.markExecutionStarted();
      throw new Error("provider outcome uncertain");
    }),
    /provider outcome uncertain/
  );
  assert.equal(uncertainMemoryStore.inspect().tombstones, 1);
  await assert.rejects(
    uncertainMemoryStore.execute(uncertainMemoryIdentity, async () => {
      uncertainMemoryExecutions += 1;
      return "duplicate";
    }),
    (error) => error.code === "idempotency_result_unavailable" && error.status === 409
  );
  assert.equal(uncertainMemoryExecutions, 1, "memory coordination fences an uncertain dispatched request");
  uncertainMemoryNow += 51;
  assert.equal(
    (await uncertainMemoryStore.execute(uncertainMemoryIdentity, async () => {
      uncertainMemoryExecutions += 1;
      return "confirmed retry";
    })).status,
    "started"
  );

  const preDispatchMemoryStore = createIdempotencyStore({ ttlMs: 1_000 });
  const preDispatchIdentity = { key: "request_predispatch1", scope: "scope", fingerprint: "pre-1" };
  await assert.rejects(
    preDispatchMemoryStore.execute(preDispatchIdentity, async () => { throw new Error("validation failed"); }),
    /validation failed/
  );
  assert.equal(
    (await preDispatchMemoryStore.execute(preDispatchIdentity, async () => "safe retry")).status,
    "started",
    "a proven pre-dispatch failure releases the memory claim"
  );

  const protectedReplayStore = createIdempotencyStore({ maxEntries: 1, ttlMs: 1_000 });
  const protectedIdentity = { key: "request_protected1", scope: "scope", fingerprint: "protected-1" };
  await protectedReplayStore.execute(protectedIdentity, async () => "protected result");
  await assert.rejects(
    protectedReplayStore.execute(
      { key: "request_protected2", scope: "scope", fingerprint: "protected-2" },
      async () => "unsafe admission"
    ),
    (error) => error.code === "idempotency_capacity" && error.status === 503
  );
  assert.equal(
    (await protectedReplayStore.execute(protectedIdentity, async () => "duplicate")).status,
    "replayed",
    "capacity pressure cannot evict a live replay fence"
  );

  const fullStore = createIdempotencyStore({ maxEntries: 1, ttlMs: 1_000 });
  let releasePending;
  const pending = fullStore.execute(
    { key: "request_pending1", scope: "scope", fingerprint: "fingerprint-1" },
    () => new Promise((resolve) => { releasePending = resolve; })
  );
  await Promise.resolve();
  await assert.rejects(
    fullStore.execute(
      { key: "request_pending2", scope: "scope", fingerprint: "fingerprint-2" },
      async () => "second"
    ),
    (error) => error.code === "idempotency_capacity"
  );
  assert.equal(fullStore.inspect().size, 1);
  releasePending("first");
  await pending;

  const guard = createBillableRequestGuard({
    rateLimit: {
      bucketCap: 20,
      profiles: {
        billable: { limit: 20, windowMs: 60_000 },
        preparation: { limit: 20, windowMs: 60_000 }
      }
    },
    concurrency: { limit: 1 },
    dailyBudgetOptions: { callLimit: 3, tokenLimit: 100 },
    idempotency: { maxEntries: 10, ttlMs: 60_000 },
    auth: productionAuth
  });
  let guardedExecutions = 0;
  const guardedReq = request("203.0.113.20", {
    authorization: "Bearer deployment-secret",
    "idempotency-key": "request_server01"
  });
  const serverResult = await guard.run({
    req: guardedReq,
    endpoint: "/api/run",
    payload: { input: "server request", provider: "openai" },
    estimatedTokens: 30,
    execute: async () => {
      guardedExecutions += 1;
      return { content: "ok", usage: { totalTokens: 12 } };
    }
  });
  assert.equal(serverResult.ok, true);
  assert.equal(serverResult.rate.allowed, true);
  assert.equal(serverResult.funding, "server");
  assert.equal(serverResult.budget.callsUsed, 1);
  assert.equal(serverResult.budget.tokensUsed, 12, "estimated tokens settle to reported usage");
  const replay = await guard.run({
    req: request("203.0.113.99", {
      authorization: "Bearer deployment-secret",
      "idempotency-key": "request_server01"
    }),
    endpoint: "/api/run",
    payload: { provider: "openai", input: "server request" },
    estimatedTokens: 30,
    execute: async () => { guardedExecutions += 1; }
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.authenticated, true, "authenticated idempotency survives an IP change");
  assert.equal(guardedExecutions, 1);
  const conflict = await guard.run({
    req: guardedReq,
    endpoint: "/api/run",
    payload: { input: "different request", provider: "openai" },
    execute: async () => ({})
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.rate.allowed, true);

  const budgetBeforeExemptions = guard.inspect().budget;
  const byok = await guard.run({
    req: request("203.0.113.21", { "idempotency-key": "request_byok0001" }),
    endpoint: "/api/run",
    payload: { input: "caller funded", providerConfig: { provider: "openai", apiKey: "caller-key" } },
    execute: async () => ({ usage: { totalTokens: 90 } })
  });
  assert.equal(byok.ok, true);
  assert.equal(byok.funding, "byok");
  assert.equal(byok.budget.applied, false);
  const offline = await guard.run({
    req: request("203.0.113.22", { "idempotency-key": "request_offline01" }),
    endpoint: "/api/run",
    payload: { input: "local route", provider: "offline" },
    execute: async () => ({ usage: { totalTokens: 90 } })
  });
  assert.equal(offline.ok, true);
  assert.equal(offline.funding, "offline");
  assert.equal(offline.budget.applied, false);
  assert.deepEqual(guard.inspect().budget, budgetBeforeExemptions, "BYOK/offline do not consume server-funded allowance");
  assert.equal(guard.inspect().concurrency.active, 0, "all execution paths release concurrency");

  const failed = await guard.run({
    req: request("203.0.113.23", {
      authorization: "Bearer deployment-secret",
      "idempotency-key": "request_failure01"
    }),
    endpoint: "/api/run",
    payload: { input: "fails", provider: "openai" },
    estimatedTokens: 5,
    execute: async () => { throw new Error("provider unavailable"); }
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.status, 500);
  assert.equal(failed.rate.allowed, true);
  assert.equal(guard.inspect().concurrency.active, 0, "errors release concurrency in finally");

  const unconfirmedGuard = createBillableRequestGuard({
    rateLimit: { profiles: { billable: { limit: 5, windowMs: 1_000 } } },
    idempotencyStore: {
      async execute(identity, operation) {
        return { value: await operation(), status: "started", persistenceConfirmed: false };
      },
      inspect: () => ({})
    }
  });
  const unconfirmed = await unconfirmedGuard.run({
    req: request("203.0.113.30", { "idempotency-key": "request_uncertain1" }),
    endpoint: "/api/run",
    payload: { input: "completion uncertainty", provider: "offline" },
    execute: async () => ({ content: "safe result" })
  });
  assert.equal(unconfirmed.ok, true);
  assert.equal(unconfirmed.idempotencyStatus, "started-unconfirmed");

  console.log("Request guard tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

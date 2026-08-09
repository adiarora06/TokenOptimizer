const assert = require("node:assert/strict");

const {
  MIN_SHARED_EXECUTION_FENCE_MS,
  createRedisConcurrencyGate,
  createRedisDailyBudget,
  createRedisIdempotencyStore,
  createRedisRateLimiter,
  createRedisRestClient,
  createSharedRequestGuardAdapters,
  decryptResult,
  encryptResult,
  minimumExecutionFenceMs
} = require("../shared-request-guard.cjs");
const { createBillableRequestGuard } = require("../request-guard.cjs");

const MARKERS = [
  "tokopt:rate:v1",
  "tokopt:concurrency-acquire:v1",
  "tokopt:concurrency-renew:v1",
  "tokopt:concurrency-release:v1",
  "tokopt:budget-time:v1",
  "tokopt:budget-reserve:v1",
  "tokopt:budget-settle:v1",
  "tokopt:budget-release:v1",
  "tokopt:idempotency-claim:v1",
  "tokopt:idempotency-renew:v1",
  "tokopt:idempotency-complete:v1",
  "tokopt:idempotency-release:v1"
];

function mapFor(container, key) {
  if (!container.has(key)) container.set(key, new Map());
  return container.get(key);
}

// This is deliberately an operation-level fake rather than a Redis command
// emulator. Each branch implements the atomic result of one versioned Lua
// script, and every adapter instance shares the same backing maps.
class FakeRedisRestClient {
  constructor(now) {
    this.now = now;
    this.rateBuckets = new Map();
    this.rateIndexes = new Map();
    this.concurrency = new Map();
    this.budgets = new Map();
    this.reservations = new Map();
    this.idempotency = new Map();
    this.idempotencyDecisions = [];
    this.failuresAfterCommit = new Map();
    this.advanceAfterBudgetTime = 0;
  }

  commitThenThrow(marker, count = 1) {
    this.failuresAfterCommit.set(marker, count);
  }

  operation(script) {
    const marker = MARKERS.find((candidate) => script.includes(candidate));
    if (!marker) throw new Error("Fake Redis received an unknown script marker");
    return marker;
  }

  async eval(script, keys, args) {
    const operation = this.operation(script);
    let result;
    switch (operation) {
      case "tokopt:rate:v1":
        result = this.takeRate(keys, args); break;
      case "tokopt:concurrency-acquire:v1":
        result = this.acquireConcurrency(keys, args); break;
      case "tokopt:concurrency-renew:v1":
        result = this.renewConcurrency(keys, args); break;
      case "tokopt:concurrency-release:v1":
        result = this.releaseConcurrency(keys, args); break;
      case "tokopt:budget-time:v1":
        result = this.budgetTime(); break;
      case "tokopt:budget-reserve:v1":
        result = this.reserveBudget(keys, args); break;
      case "tokopt:budget-settle:v1":
        result = this.settleBudget(keys, args); break;
      case "tokopt:budget-release:v1":
        result = this.releaseBudget(keys); break;
      case "tokopt:idempotency-claim:v1":
        result = this.claimIdempotency(keys, args); break;
      case "tokopt:idempotency-renew:v1":
        result = this.renewIdempotency(keys, args); break;
      case "tokopt:idempotency-complete:v1":
        result = this.completeIdempotency(keys, args); break;
      case "tokopt:idempotency-release:v1":
        result = this.releaseIdempotency(keys, args); break;
      default:
        throw new Error("Unreachable fake Redis operation");
    }
    const failures = this.failuresAfterCommit.get(operation) || 0;
    if (failures > 0) {
      this.failuresAfterCommit.set(operation, failures - 1);
      const error = new Error("simulated response loss after commit");
      error.status = 503;
      error.code = "coordination_unavailable";
      throw error;
    }
    return result;
  }

  takeRate([bucketKey, indexKey], args) {
    const windowMs = Number(args[0]);
    const limit = Number(args[1]);
    const capacity = Number(args[2]);
    const index = mapFor(this.rateIndexes, indexKey);
    for (const [key, resetAt] of index) {
      if (resetAt <= this.now) {
        index.delete(key);
        this.rateBuckets.delete(key);
      }
    }

    let bucket = this.rateBuckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= this.now) {
      this.rateBuckets.delete(bucketKey);
      index.delete(bucketKey);
      if (index.size >= capacity) {
        const retryAt = Math.min(...index.values());
        return [0, 1, 0, 0, retryAt, limit];
      }
      bucket = { count: 1, resetAt: this.now + windowMs };
      this.rateBuckets.set(bucketKey, bucket);
      index.set(bucketKey, bucket.resetAt);
    } else {
      bucket.count += 1;
    }
    return [bucket.count <= limit ? 1 : 0, 0, bucket.count, Math.max(0, limit - bucket.count), bucket.resetAt, limit];
  }

  liveLeases(key) {
    const leases = mapFor(this.concurrency, key);
    for (const [owner, expiresAt] of leases) {
      if (expiresAt <= this.now) leases.delete(owner);
    }
    return leases;
  }

  acquireConcurrency([key], args) {
    const limit = Number(args[0]);
    const leaseMs = Number(args[1]);
    const owner = String(args[2]);
    const leases = this.liveLeases(key);
    if (leases.has(owner)) return [2, leases.size, limit, Math.max(1, leases.get(owner) - this.now)];
    if (leases.size >= limit) {
      const retryMs = Math.max(1, Math.min(...leases.values()) - this.now);
      return [0, leases.size, limit, retryMs];
    }
    leases.set(owner, this.now + leaseMs);
    return [1, leases.size, limit, leaseMs];
  }

  renewConcurrency([key], args) {
    const leaseMs = Number(args[0]);
    const owner = String(args[1]);
    const leases = this.liveLeases(key);
    if (!leases.has(owner)) return 0;
    leases.set(owner, this.now + leaseMs);
    return 1;
  }

  releaseConcurrency([key], args) {
    return this.liveLeases(key).delete(String(args[0])) ? 1 : 0;
  }

  budgetFor(key) {
    if (!this.budgets.has(key)) this.budgets.set(key, { calls: 0, tokens: 0 });
    return this.budgets.get(key);
  }

  budgetTime() {
    const day = Math.floor(this.now / 86_400_000);
    const result = [day, (day + 1) * 86_400_000, this.now];
    this.now += this.advanceAfterBudgetTime;
    this.advanceAfterBudgetTime = 0;
    return result;
  }

  reserveBudget([budgetKey, reservationKey], args) {
    const day = Math.floor(this.now / 86_400_000);
    const resetAt = (day + 1) * 86_400_000;
    if (Number(args[5]) !== day) return [3, 0, 0, 0, 0, day, resetAt, this.now];
    const budget = this.budgetFor(budgetKey);
    const existing = this.reservations.get(reservationKey);
    if (existing) return [2, budget.calls, budget.tokens, existing.calls, existing.tokens, day, resetAt, this.now];
    const calls = Number(args[0]);
    const tokens = Number(args[1]);
    const callLimit = Number(args[2]);
    const tokenLimit = Number(args[3]);
    if (budget.calls + calls > callLimit) return [0, budget.calls, budget.tokens, 1, 0, day, resetAt, this.now];
    if (budget.tokens + tokens > tokenLimit) return [0, budget.calls, budget.tokens, 2, 0, day, resetAt, this.now];
    budget.calls += calls;
    budget.tokens += tokens;
    this.reservations.set(reservationKey, { status: "reserved", calls, tokens });
    return [1, budget.calls, budget.tokens, calls, tokens, day, resetAt, this.now];
  }

  settleBudget([budgetKey, reservationKey], args) {
    const budget = this.budgetFor(budgetKey);
    const reservation = this.reservations.get(reservationKey);
    if (!reservation) return [0, budget.calls, budget.tokens, 0];
    if (reservation.status === "reserved") {
      const actual = Number(args[0]);
      budget.tokens += actual - reservation.tokens;
      reservation.status = "settled";
      reservation.actual = actual;
      return [1, budget.calls, budget.tokens, actual];
    }
    return [2, budget.calls, budget.tokens, reservation.actual ?? reservation.tokens];
  }

  releaseBudget([budgetKey, reservationKey]) {
    const budget = this.budgetFor(budgetKey);
    const reservation = this.reservations.get(reservationKey);
    if (!reservation || reservation.status !== "reserved") return [0, budget.calls, budget.tokens];
    budget.calls -= reservation.calls;
    budget.tokens -= reservation.tokens;
    reservation.status = "released";
    return [1, budget.calls, budget.tokens];
  }

  currentIdempotency(key) {
    const entry = this.idempotency.get(key);
    if (entry && entry.expiresAt <= this.now) {
      this.idempotency.delete(key);
      return null;
    }
    return entry || null;
  }

  claimIdempotency([key], args) {
    const fingerprint = String(args[0]);
    const owner = String(args[1]);
    const ttlMs = Number(args[2]);
    const entry = this.currentIdempotency(key);
    if (!entry) {
      this.idempotency.set(key, { fingerprint, status: "pending", owner, expiresAt: this.now + ttlMs });
      this.idempotencyDecisions.push("started");
      return ["started"];
    }
    if (entry.fingerprint !== fingerprint) {
      this.idempotencyDecisions.push("conflict");
      return ["conflict"];
    }
    if (entry.status === "completed") {
      this.idempotencyDecisions.push("completed");
      return ["completed", entry.result];
    }
    if (entry.status === "tombstone") {
      this.idempotencyDecisions.push("tombstone");
      return ["tombstone", Math.max(1, entry.expiresAt - this.now)];
    }
    if (entry.owner === owner) {
      this.idempotencyDecisions.push("started");
      return ["started"];
    }
    this.idempotencyDecisions.push("pending");
    return ["pending", Math.max(1, entry.expiresAt - this.now)];
  }

  renewIdempotency([key], args) {
    const entry = this.currentIdempotency(key);
    if (!entry || entry.status !== "pending" || entry.owner !== String(args[0])) return 0;
    entry.expiresAt = this.now + Number(args[1]);
    return 1;
  }

  completeIdempotency([key], args) {
    const entry = this.currentIdempotency(key);
    const target = String(args[3] || "completed");
    if (entry?.status === target && entry.completion === String(args[0])) return 2;
    if (!entry || entry.status !== "pending" || entry.owner !== String(args[0])) return 0;
    entry.status = target;
    entry.completion = String(args[0]);
    if (target === "completed") entry.result = String(args[1]);
    else delete entry.result;
    delete entry.owner;
    entry.expiresAt = this.now + Number(args[2]);
    return 1;
  }

  releaseIdempotency([key], args) {
    const entry = this.currentIdempotency(key);
    if (!entry || entry.status !== "pending" || entry.owner !== String(args[0])) return 0;
    this.idempotency.delete(key);
    return 1;
  }
}

function request(client) {
  return { client };
}

function nextTurn() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await nextTurn();
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function run() {
  for (const exported of [
    createRedisConcurrencyGate,
    createRedisDailyBudget,
    createRedisIdempotencyStore,
    createRedisRateLimiter,
    createRedisRestClient,
    createSharedRequestGuardAdapters,
    decryptResult,
    encryptResult,
    minimumExecutionFenceMs
  ]) assert.equal(typeof exported, "function");

  let wireRequest;
  const restClient = createRedisRestClient({
    url: "https://redis.example.test",
    token: "rest-token",
    fetchImpl: async (url, options) => {
      wireRequest = { url, options };
      return { ok: true, text: async () => JSON.stringify({ result: ["wire-ok"] }) };
    }
  });
  assert.deepEqual(await restClient.eval("-- tokopt:test:v1", ["key"], ["arg"]), ["wire-ok"]);
  assert.equal(wireRequest.url, "https://redis.example.test");
  assert.equal(wireRequest.options.headers.authorization, "Bearer rest-token");
  assert.deepEqual(JSON.parse(wireRequest.options.body), ["EVAL", "-- tokopt:test:v1", 1, "key", "arg"]);
  assert.throws(() => createRedisRestClient({ url: "http://redis.example.test", token: "x", fetchImpl: async () => {} }), /HTTPS/);
  assert.throws(() => createRedisRestClient({ url: "https://redis.example.test", token: "", fetchImpl: async () => {} }), /token/i);

  const fake = new FakeRedisRestClient(Date.parse("2026-08-09T12:00:00.000Z"));
  const sharedOptions = {
    backend: "upstash",
    url: "https://redis.example.test",
    token: "test-token",
    secret: "shared-guard-test-secret-32-bytes-minimum",
    namespace: "shared-request-guard-test",
    client: fake,
    clientKey: (req) => req.client,
    profiles: {
      billable: { limit: 2, windowMs: 1_000 },
      preparation: { limit: 3, windowMs: 1_000 }
    },
    bucketCap: 5,
    concurrencyLimit: 1,
    concurrencyLeaseMs: MIN_SHARED_EXECUTION_FENCE_MS,
    dailyCallLimit: 10,
    dailyTokenLimit: 100,
    now: () => fake.now,
    idempotencyTtlMs: 300_000,
    pendingTtlMs: MIN_SHARED_EXECUTION_FENCE_MS,
    waitMs: 1_000,
    pollMs: 25
  };
  const firstAdapters = createSharedRequestGuardAdapters(sharedOptions);
  const secondAdapters = createSharedRequestGuardAdapters(sharedOptions);
  assert.equal(firstAdapters.ready, true);
  assert.equal(secondAdapters.ready, true);

  assert.equal((await firstAdapters.rateLimiter.take(request("same-client"))).allowed, true);
  assert.equal((await secondAdapters.rateLimiter.take(request("same-client"))).allowed, true);
  const distributedRateLimit = await firstAdapters.rateLimiter.take(request("same-client"));
  assert.equal(distributedRateLimit.allowed, false, "the shared limit spans adapter instances");
  assert.equal(distributedRateLimit.remaining, 0);
  fake.now += 1_001;
  assert.equal((await secondAdapters.rateLimiter.take(request("same-client"))).allowed, true, "the shared window expires once");

  const firstLease = await firstAdapters.concurrencyGate.acquire();
  assert.equal(firstLease.allowed, true);
  assert.equal((await secondAdapters.concurrencyGate.acquire()).allowed, false, "only one shared lease is admitted");
  assert.equal(await firstLease.release(), true);
  assert.equal(await firstLease.release(), false, "duplicate release is harmless");

  const staleLease = await firstAdapters.concurrencyGate.acquire();
  assert.equal(staleLease.allowed, true);
  fake.now += sharedOptions.concurrencyLeaseMs + 1;
  const replacementLease = await secondAdapters.concurrencyGate.acquire();
  assert.equal(replacementLease.allowed, true, "an expired lease can be replaced");
  assert.equal(await staleLease.release(), false, "a stale owner cannot remove its replacement");
  assert.equal((await firstAdapters.concurrencyGate.acquire()).allowed, false, "the replacement lease remains live");
  assert.equal(await replacementLease.release(), true);

  const duplicateUsage = { calls: 1, tokens: 60, reservationId: "shared-reservation" };
  const [originalReservation, duplicateReservation] = await Promise.all([
    firstAdapters.dailyBudget.reserve(duplicateUsage),
    secondAdapters.dailyBudget.reserve(duplicateUsage)
  ]);
  assert.equal(originalReservation.allowed, true);
  assert.equal(duplicateReservation.allowed, true, "retrying one reservation is idempotent");
  const firstSettlement = await originalReservation.settle({ tokens: 40 });
  const duplicateSettlement = await duplicateReservation.settle({ tokens: 40 });
  assert.equal(firstSettlement.tokensUsed, 40);
  assert.equal(duplicateSettlement.tokensUsed, 40, "settlement changes totals only once");

  const budgetRace = await Promise.all([
    firstAdapters.dailyBudget.reserve({ calls: 1, tokens: 60, reservationId: "race-one" }),
    secondAdapters.dailyBudget.reserve({ calls: 1, tokens: 60, reservationId: "race-two" })
  ]);
  assert.equal(budgetRace.filter((result) => result.allowed).length, 1);
  assert.equal(budgetRace.filter((result) => !result.allowed).length, 1, "atomic admission prevents overspending the shared token cap");
  assert.equal(budgetRace.find((result) => !result.allowed).reason, "daily_token_limit");

  const rolloverFake = new FakeRedisRestClient(Date.parse("2026-08-09T23:59:59.999Z"));
  rolloverFake.advanceAfterBudgetTime = 2;
  const rolloverAdapters = createSharedRequestGuardAdapters({
    ...sharedOptions,
    client: rolloverFake,
    now: () => Date.parse("2026-08-09T00:00:00.000Z")
  });
  const rolloverReservation = await rolloverAdapters.dailyBudget.reserve({
    calls: 1,
    tokens: 10,
    reservationId: "midnight-rollover"
  });
  assert.equal(rolloverReservation.allowed, true);
  assert.equal(rolloverReservation.snapshot().day, "2026-08-10", "Redis time owns the UTC budget rollover");

  const identity = { key: "shared-idempotency-key", scope: "principal:/api/run", fingerprint: "fingerprint-a" };
  let executions = 0;
  let finishExecution;
  const executionGate = new Promise((resolve) => { finishExecution = resolve; });
  const firstExecution = firstAdapters.idempotencyStore.execute(identity, async () => {
    executions += 1;
    await executionGate;
    return { answer: 42, source: "shared" };
  });
  await waitFor(() => executions === 1, "the first idempotent execution to start");
  const joinedExecution = secondAdapters.idempotencyStore.execute(identity, async () => {
    executions += 1;
    return { answer: 0 };
  });
  await waitFor(() => fake.idempotencyDecisions.includes("pending"), "the second adapter to join the pending request");
  finishExecution();
  const [started, joined] = await Promise.all([firstExecution, joinedExecution]);
  assert.equal(executions, 1);
  assert.equal(started.status, "started");
  assert.equal(started.persistenceConfirmed, true);
  assert.equal(joined.status, "joined");
  assert.deepEqual(joined.value, started.value);

  const replayed = await secondAdapters.idempotencyStore.execute(identity, async () => {
    executions += 1;
    return { answer: -1 };
  });
  assert.equal(replayed.status, "replayed");
  assert.equal(executions, 1);
  await assert.rejects(
    firstAdapters.idempotencyStore.execute({ ...identity, fingerprint: "fingerprint-b" }, async () => ({})),
    (error) => error?.status === 409 && error?.code === "idempotency_conflict"
  );

  const oversizedAdapters = createSharedRequestGuardAdapters({
    ...sharedOptions,
    idempotencyMaxResultBytes: 1_024
  });
  const oversizedIdentity = { key: "oversized-idempotency-key", scope: "principal:/api/run", fingerprint: "large-a" };
  let oversizedExecutions = 0;
  const oversizedStarted = await oversizedAdapters.idempotencyStore.execute(oversizedIdentity, async () => {
    oversizedExecutions += 1;
    return { content: "x".repeat(2_000) };
  });
  assert.equal(oversizedStarted.status, "started");
  await assert.rejects(
    oversizedAdapters.idempotencyStore.execute(oversizedIdentity, async () => {
      oversizedExecutions += 1;
      return {};
    }),
    (error) => error?.status === 409 && error?.code === "idempotency_result_unavailable"
  );
  assert.equal(oversizedExecutions, 1, "an oversized replay tombstone prevents duplicate provider execution");

  const uncertainFake = new FakeRedisRestClient(Date.parse("2026-08-09T13:00:00.000Z"));
  uncertainFake.commitThenThrow("tokopt:idempotency-complete:v1", 3);
  const uncertainAdapters = createSharedRequestGuardAdapters({ ...sharedOptions, client: uncertainFake });
  const uncertainIdentity = { key: "uncertain-completion-key", scope: "principal:/api/run", fingerprint: "uncertain-a" };
  let uncertainExecutions = 0;
  const uncertainResult = await uncertainAdapters.idempotencyStore.execute(uncertainIdentity, async () => {
    uncertainExecutions += 1;
    return { answer: "delivered" };
  });
  assert.equal(uncertainResult.persistenceConfirmed, false, "completion uncertainty is surfaced to the guard");
  const confirmedReplay = await uncertainAdapters.idempotencyStore.execute(uncertainIdentity, async () => {
    uncertainExecutions += 1;
    return { answer: "duplicate" };
  });
  assert.equal(confirmedReplay.status, "replayed");
  assert.equal(uncertainExecutions, 1, "a committed completion still replays after every response was lost");

  const cancellationFake = new FakeRedisRestClient(Date.parse("2026-08-09T14:00:00.000Z"));
  const cancellationAdapters = createSharedRequestGuardAdapters({ ...sharedOptions, client: cancellationFake });
  const cancellationIdentity = { key: "cancelled-join-key", scope: "principal:/api/run", fingerprint: "cancel-a" };
  let finishCancellationOwner;
  const cancellationOwnerGate = new Promise((resolve) => { finishCancellationOwner = resolve; });
  const cancellationOwner = cancellationAdapters.idempotencyStore.execute(cancellationIdentity, async () => {
    await cancellationOwnerGate;
    return { answer: "owner" };
  });
  await waitFor(() => cancellationFake.idempotencyDecisions.includes("started"), "the cancellation owner to start");
  const cancellationController = new AbortController();
  const cancelledJoin = cancellationAdapters.idempotencyStore.execute(
    { ...cancellationIdentity, signal: cancellationController.signal },
    async () => ({ answer: "duplicate" })
  );
  await waitFor(() => cancellationFake.idempotencyDecisions.includes("pending"), "the cancellable duplicate to wait");
  cancellationController.abort();
  await assert.rejects(cancelledJoin, (error) => error?.code === "request_cancelled");
  finishCancellationOwner();
  await cancellationOwner;

  const uncertainExecutionFake = new FakeRedisRestClient(Date.parse("2026-08-09T14:30:00.000Z"));
  const uncertainExecutionAdapters = createSharedRequestGuardAdapters({ ...sharedOptions, client: uncertainExecutionFake });
  const uncertainExecutionIdentity = {
    key: "execution-started-error-key",
    scope: "principal:/api/run",
    fingerprint: "execution-started-a"
  };
  await assert.rejects(
    uncertainExecutionAdapters.idempotencyStore.execute(uncertainExecutionIdentity, async (context) => {
      context.markExecutionStarted();
      const error = new Error("provider outcome is uncertain");
      error.code = "execution_failed";
      throw error;
    }),
    (error) => error?.code === "execution_failed"
  );
  assert.equal(
    Array.from(uncertainExecutionFake.idempotency.values()).some((entry) => entry.status === "tombstone"),
    true,
    "an execution-started error becomes a replay-window tombstone"
  );
  uncertainExecutionFake.now += sharedOptions.pendingTtlMs + 1;
  let uncertainDuplicateExecutions = 0;
  await assert.rejects(
    uncertainExecutionAdapters.idempotencyStore.execute(uncertainExecutionIdentity, async () => {
      uncertainDuplicateExecutions += 1;
      return { answer: "duplicate" };
    }),
    (error) => error?.status === 409 && error?.code === "idempotency_result_unavailable"
  );
  assert.equal(uncertainDuplicateExecutions, 0, "the fence outlives the pending TTL after dispatch uncertainty");

  const preExecutionFake = new FakeRedisRestClient(Date.parse("2026-08-09T14:45:00.000Z"));
  const preExecutionAdapters = createSharedRequestGuardAdapters({ ...sharedOptions, client: preExecutionFake });
  await assert.rejects(
    preExecutionAdapters.idempotencyStore.execute(
      { ...uncertainExecutionIdentity, key: "pre-execution-error-key" },
      async () => {
        const error = new Error("validation failed before provider execution");
        error.code = "validation_failed";
        throw error;
      }
    ),
    (error) => error?.code === "validation_failed"
  );
  assert.equal(preExecutionFake.idempotency.size, 0, "a proven pre-execution failure releases its claim");

  const encryptionSecret = "encryption-test-secret-at-least-32-bytes";
  const aad = "idempotency-key:fingerprint";
  const encrypted = encryptResult({ safe: true, nested: [1, 2, 3] }, encryptionSecret, aad);
  assert.deepEqual(decryptResult(encrypted, encryptionSecret, aad), { safe: true, nested: [1, 2, 3] });
  const parts = encrypted.split(".");
  parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
  assert.throws(
    () => decryptResult(parts.join("."), encryptionSecret, aad),
    (error) => error?.status === 503 && error?.code === "coordination_unavailable"
  );

  const unavailable = createSharedRequestGuardAdapters({ backend: "upstash", environment: {} });
  assert.equal(unavailable.backend, "upstash");
  assert.equal(unavailable.ready, false);
  const failsClosed = (error) => error?.status === 503 && error?.code === "coordination_unavailable";
  await assert.rejects(unavailable.rateLimiter.take(request("client")), failsClosed);
  await assert.rejects(unavailable.concurrencyGate.acquire(), failsClosed);
  await assert.rejects(unavailable.dailyBudget.reserve({ calls: 1, tokens: 1 }), failsClosed);

  const unsafeTimingAdapters = createSharedRequestGuardAdapters({
    ...sharedOptions,
    concurrencyLeaseMs: 5_000,
    pendingTtlMs: 10_000,
    idempotencyTtlMs: 30_000
  });
  assert.equal(unsafeTimingAdapters.ready, false, "unsafe lease overrides fail closed");
  assert.match(unsafeTimingAdapters.reason, new RegExp(`at least ${MIN_SHARED_EXECUTION_FENCE_MS} ms`));
  await assert.rejects(unsafeTimingAdapters.concurrencyGate.acquire(), failsClosed);

  const slowRedisMinimum = minimumExecutionFenceMs(30_000);
  assert.equal(slowRedisMinimum, 310_000);
  const slowRedisUnsafeAdapters = createSharedRequestGuardAdapters({
    ...sharedOptions,
    timeoutMs: 30_000
  });
  assert.equal(slowRedisUnsafeAdapters.ready, false, "long Redis timeouts require proportionally longer fences");
  assert.match(slowRedisUnsafeAdapters.reason, new RegExp(`at least ${slowRedisMinimum} ms`));

  let misconfiguredExecutionRan = false;
  await assert.rejects(unavailable.idempotencyStore.execute(identity, async () => {
    misconfiguredExecutionRan = true;
  }), failsClosed);
  assert.equal(misconfiguredExecutionRan, false, "explicit shared coordination never falls back silently");

  const integrationFake = new FakeRedisRestClient(Date.parse("2026-08-09T15:00:00.000Z"));
  integrationFake.commitThenThrow("tokopt:idempotency-claim:v1");
  integrationFake.commitThenThrow("tokopt:concurrency-acquire:v1");
  integrationFake.commitThenThrow("tokopt:budget-reserve:v1");
  integrationFake.commitThenThrow("tokopt:idempotency-complete:v1");
  const integrationOptions = {
    ...sharedOptions,
    client: integrationFake,
    now: () => integrationFake.now,
    profiles: {
      billable: { limit: 10, windowMs: 1_000 },
      preparation: { limit: 10, windowMs: 1_000 }
    },
    dailyTokenLimit: 1_000
  };
  const integrationAdapters = [
    createSharedRequestGuardAdapters(integrationOptions),
    createSharedRequestGuardAdapters(integrationOptions)
  ];
  const integrationGuards = integrationAdapters.map((adapters) => createBillableRequestGuard({
    rateLimiter: adapters.rateLimiter,
    concurrencyGate: adapters.concurrencyGate,
    dailyBudget: adapters.dailyBudget,
    idempotencyStore: adapters.idempotencyStore
  }));
  let integratedExecutions = 0;
  let releaseIntegrated;
  const integratedGate = new Promise((resolve) => { releaseIntegrated = resolve; });
  const guardedRequest = {
    headers: { "idempotency-key": "distributed_guard_123" },
    socket: { remoteAddress: "203.0.113.90" },
    client: "distributed-client"
  };
  const guardedArgs = {
    req: guardedRequest,
    endpoint: "/api/integration",
    payload: { input: "shared guard integration", provider: "openai" },
    estimatedTokens: 50,
    execute: async () => {
      integratedExecutions += 1;
      await integratedGate;
      return { content: "complete", usage: { totalTokens: 12 } };
    }
  };
  const integratedFirst = integrationGuards[0].run(guardedArgs);
  await waitFor(() => integratedExecutions === 1, "the integrated guarded execution to start");
  const integratedSecond = integrationGuards[1].run(guardedArgs);
  await waitFor(() => integrationFake.idempotencyDecisions.includes("pending"), "the integrated duplicate to join");
  releaseIntegrated();
  const integratedResults = await Promise.all([integratedFirst, integratedSecond]);
  assert.equal(integratedResults.every((result) => result.ok), true);
  assert.equal(integratedExecutions, 1, "independent guards execute one shared idempotent operation");
  assert.equal(integratedResults.some((result) => result.coalesced), true);
  assert.equal(Array.from(integrationFake.budgets.values())[0].calls, 1, "one distributed budget call is reserved");
  assert.equal(Array.from(integrationFake.budgets.values())[0].tokens, 12, "the shared reservation settles once");

  console.log("Shared request guard tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

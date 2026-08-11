const crypto = require("node:crypto");

const MAX_BILLABLE_EXECUTION_MS = 120_000;
const EXECUTION_FENCE_MARGIN_MS = 20_000;
const DEFAULT_REDIS_TIMEOUT_MS = 2_500;

// Heartbeats run after one third of a lease and make two timeout-bounded
// renewal attempts. Round up so that, even after renewal failure detection,
// the remaining lease covers the full provider deadline plus a safety margin.
function minimumExecutionFenceMs(redisTimeoutMs = DEFAULT_REDIS_TIMEOUT_MS) {
  const timeout = boundedInteger(redisTimeoutMs, DEFAULT_REDIS_TIMEOUT_MS, 250, 30_000);
  const detectionBudget = (timeout * 2) + 50;
  const required = Math.ceil((MAX_BILLABLE_EXECUTION_MS + EXECUTION_FENCE_MARGIN_MS + detectionBudget) * 1.5);
  return Math.ceil(required / 10_000) * 10_000;
}

const MIN_SHARED_EXECUTION_FENCE_MS = minimumExecutionFenceMs();

class SharedGuardError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "SharedGuardError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.budget = details.budget;
  }
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizedBackend(value) {
  const backend = String(value || "memory").trim().toLowerCase();
  if (["auto", "memory", "upstash"].includes(backend)) return backend;
  return "invalid";
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) || "";
}

function digest(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function keyedDigest(secret, value) {
  return crypto.createHmac("sha256", secret).update(String(value ?? ""), "utf8").digest("hex");
}

function randomId() {
  return crypto.randomBytes(18).toString("base64url");
}

function cancellationError() {
  return new SharedGuardError(499, "request_cancelled", "The request was cancelled.");
}

function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(cancellationError());
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timeout);
      reject(cancellationError());
    }
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

async function retryAmbiguous(operation, options = {}) {
  const attempts = boundedInteger(options.attempts, 3, 1, 5);
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.signal?.aborted) throw cancellationError();
    try {
      return await operation();
    } catch (error) {
      if (error?.code !== "coordination_unavailable") throw error;
      lastError = error;
      if (attempt + 1 < attempts) {
        await sleep(Math.min(400, 50 * (2 ** attempt)), options.signal);
      }
    }
  }
  throw lastError || unavailableError();
}

function numberAt(values, index, fallback = 0) {
  const parsed = Number(values?.[index]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function unavailableError(message = "Shared request coordination is temporarily unavailable.") {
  return new SharedGuardError(503, "coordination_unavailable", message, { retryAfterSeconds: 1 });
}

function normalizeRedisUrl(value) {
  const url = new URL(String(value || ""));
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new TypeError("The shared Redis REST URL must use HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError("The shared Redis REST URL must not contain credentials, query parameters, or fragments.");
  }
  return url.toString().replace(/\/$/, "");
}

function createRedisRestClient(options = {}) {
  const url = normalizeRedisUrl(options.url);
  const token = String(options.token || "");
  if (!token) throw new TypeError("A shared Redis REST token is required.");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("A Fetch-compatible runtime is required.");
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_REDIS_TIMEOUT_MS, 250, 30_000);
  const maxResponseBytes = boundedInteger(options.maxResponseBytes, 2_000_000, 1_024, 10_000_000);
  let lastSuccessAt = null;
  let lastFailureAt = null;

  async function command(parts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(parts),
        signal: controller.signal
      });
      const text = await response.text();
      if (Buffer.byteLength(text) > maxResponseBytes) {
        throw unavailableError();
      }
      let body;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        throw unavailableError();
      }
      if (!response.ok || body?.error || !("result" in body)) {
        throw unavailableError();
      }
      lastSuccessAt = new Date().toISOString();
      return body.result;
    } catch (error) {
      lastFailureAt = new Date().toISOString();
      if (error instanceof SharedGuardError) throw error;
      throw unavailableError();
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    command,
    inspect: () => ({ lastSuccessAt, lastFailureAt, verified: Boolean(lastSuccessAt) }),
    eval(script, keys = [], args = []) {
      return command(["EVAL", script, keys.length, ...keys, ...args]);
    }
  };
}

const RATE_SCRIPT = `-- tokopt:rate:v1
local clock = redis.call('TIME')
local now = (tonumber(clock[1]) * 1000) + math.floor(tonumber(clock[2]) / 1000)
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local capacity = tonumber(ARGV[3])
local reset = tonumber(redis.call('HGET', KEYS[1], 'reset') or '0')
local count = 0

if reset <= now then
  redis.call('DEL', KEYS[1])
  redis.call('ZREM', KEYS[2], KEYS[1])
  redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
  if tonumber(redis.call('ZCARD', KEYS[2])) >= capacity then
    local earliest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
    local retryAt = tonumber(earliest[2] or (now + window))
    return {0, 1, 0, 0, retryAt, limit, now}
  end
  reset = now + window
  count = 1
  redis.call('HSET', KEYS[1], 'count', count, 'reset', reset)
  redis.call('PEXPIRE', KEYS[1], window + 2000)
  redis.call('ZADD', KEYS[2], reset, KEYS[1])
  redis.call('PEXPIRE', KEYS[2], window + 2000)
else
  count = tonumber(redis.call('HINCRBY', KEYS[1], 'count', 1))
end

local allowed = 0
if count <= limit then allowed = 1 end
return {allowed, 0, count, math.max(0, limit - count), reset, limit, now}`;

const CONCURRENCY_ACQUIRE_SCRIPT = `-- tokopt:concurrency-acquire:v1
local clock = redis.call('TIME')
local now = (tonumber(clock[1]) * 1000) + math.floor(tonumber(clock[2]) / 1000)
local limit = tonumber(ARGV[1])
local lease = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local active = tonumber(redis.call('ZCARD', KEYS[1]))
local existing = redis.call('ZSCORE', KEYS[1], ARGV[3])
if existing then return {2, active, limit, math.max(1, tonumber(existing) - now)} end
if active >= limit then
  local earliest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local retryAt = tonumber(earliest[2] or (now + 1000))
  return {0, active, limit, math.max(1, retryAt - now)}
end
local expiresAt = now + lease
redis.call('ZADD', KEYS[1], expiresAt, ARGV[3])
redis.call('PEXPIRE', KEYS[1], lease + 2000)
return {1, active + 1, limit, lease}`;

const CONCURRENCY_RENEW_SCRIPT = `-- tokopt:concurrency-renew:v1
local clock = redis.call('TIME')
local now = (tonumber(clock[1]) * 1000) + math.floor(tonumber(clock[2]) / 1000)
if redis.call('ZSCORE', KEYS[1], ARGV[2]) == false then return 0 end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[1]), ARGV[2])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]) + 2000)
return 1`;

const CONCURRENCY_RELEASE_SCRIPT = `-- tokopt:concurrency-release:v1
return redis.call('ZREM', KEYS[1], ARGV[1])`;

const BUDGET_TIME_SCRIPT = `-- tokopt:budget-time:v1
local clock = redis.call('TIME')
local now = (tonumber(clock[1]) * 1000) + math.floor(tonumber(clock[2]) / 1000)
local day = math.floor(now / 86400000)
return {day, (day + 1) * 86400000, now}`;

const BUDGET_RESERVE_SCRIPT = `-- tokopt:budget-reserve:v1
local clock = redis.call('TIME')
local now = (tonumber(clock[1]) * 1000) + math.floor(tonumber(clock[2]) / 1000)
local day = math.floor(now / 86400000)
local resetAt = (day + 1) * 86400000
if day ~= tonumber(ARGV[6]) then return {3, 0, 0, 0, 0, day, resetAt, now} end
local existing = redis.call('HGET', KEYS[2], 'status')
local callsUsed = tonumber(redis.call('HGET', KEYS[1], 'calls') or '0')
local tokensUsed = tonumber(redis.call('HGET', KEYS[1], 'tokens') or '0')
if existing then
  return {2, callsUsed, tokensUsed, redis.call('HGET', KEYS[2], 'calls'), redis.call('HGET', KEYS[2], 'tokens'), day, resetAt, now}
end
local calls = tonumber(ARGV[1])
local tokens = tonumber(ARGV[2])
local callLimit = tonumber(ARGV[3])
local tokenLimit = tonumber(ARGV[4])
if callsUsed + calls > callLimit then return {0, callsUsed, tokensUsed, 1, 0, day, resetAt, now} end
if tokensUsed + tokens > tokenLimit then return {0, callsUsed, tokensUsed, 2, 0, day, resetAt, now} end
callsUsed = tonumber(redis.call('HINCRBY', KEYS[1], 'calls', calls))
tokensUsed = tonumber(redis.call('HINCRBY', KEYS[1], 'tokens', tokens))
redis.call('HSET', KEYS[2], 'status', 'reserved', 'calls', calls, 'tokens', tokens)
redis.call('PEXPIREAT', KEYS[1], ARGV[5])
redis.call('PEXPIREAT', KEYS[2], ARGV[5])
return {1, callsUsed, tokensUsed, calls, tokens, day, resetAt, now}`;

const BUDGET_SETTLE_SCRIPT = `-- tokopt:budget-settle:v1
local callsUsed = tonumber(redis.call('HGET', KEYS[1], 'calls') or '0')
local tokensUsed = tonumber(redis.call('HGET', KEYS[1], 'tokens') or '0')
local status = redis.call('HGET', KEYS[2], 'status')
if status == false then return {0, callsUsed, tokensUsed, 0} end
if status == 'reserved' then
  local reserved = tonumber(redis.call('HGET', KEYS[2], 'tokens') or '0')
  local actual = tonumber(ARGV[1])
  tokensUsed = tonumber(redis.call('HINCRBY', KEYS[1], 'tokens', actual - reserved))
  redis.call('HSET', KEYS[2], 'status', 'settled', 'actual', actual)
  return {1, callsUsed, tokensUsed, actual}
end
return {2, callsUsed, tokensUsed, tonumber(redis.call('HGET', KEYS[2], 'actual') or redis.call('HGET', KEYS[2], 'tokens') or '0')}`;

const BUDGET_RELEASE_SCRIPT = `-- tokopt:budget-release:v1
local callsUsed = tonumber(redis.call('HGET', KEYS[1], 'calls') or '0')
local tokensUsed = tonumber(redis.call('HGET', KEYS[1], 'tokens') or '0')
if redis.call('HGET', KEYS[2], 'status') ~= 'reserved' then return {0, callsUsed, tokensUsed} end
local calls = tonumber(redis.call('HGET', KEYS[2], 'calls') or '0')
local tokens = tonumber(redis.call('HGET', KEYS[2], 'tokens') or '0')
callsUsed = tonumber(redis.call('HINCRBY', KEYS[1], 'calls', -calls))
tokensUsed = tonumber(redis.call('HINCRBY', KEYS[1], 'tokens', -tokens))
redis.call('HSET', KEYS[2], 'status', 'released')
return {1, callsUsed, tokensUsed}`;

const IDEMPOTENCY_CLAIM_SCRIPT = `-- tokopt:idempotency-claim:v1
local clock = redis.call('TIME')
local now = (tonumber(clock[1]) * 1000) + math.floor(tonumber(clock[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
if redis.call('EXISTS', KEYS[1]) == 0 then
  if tonumber(redis.call('ZCARD', KEYS[2])) >= tonumber(ARGV[4]) then
    local earliest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
    return {'capacity', tonumber(earliest[2] or (now + 1000)) - now}
  end
  redis.call('HSET', KEYS[1], 'fingerprint', ARGV[1], 'status', 'pending', 'owner', ARGV[2])
  redis.call('PEXPIRE', KEYS[1], ARGV[3])
  redis.call('ZADD', KEYS[2], now + tonumber(ARGV[3]), KEYS[1])
  return {'started'}
end
if redis.call('HGET', KEYS[1], 'fingerprint') ~= ARGV[1] then return {'conflict'} end
local status = redis.call('HGET', KEYS[1], 'status')
if status == 'completed' then return {'completed', redis.call('HGET', KEYS[1], 'result')} end
if status == 'tombstone' then return {'tombstone', redis.call('PTTL', KEYS[1])} end
if status == 'pending' and redis.call('HGET', KEYS[1], 'owner') == ARGV[2] then return {'started'} end
return {'pending', redis.call('PTTL', KEYS[1])}`;

const IDEMPOTENCY_RENEW_SCRIPT = `-- tokopt:idempotency-renew:v1
if redis.call('HGET', KEYS[1], 'status') ~= 'pending' then return 0 end
if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[1] then return 0 end
redis.call('PEXPIRE', KEYS[1], ARGV[2])
local clock = redis.call('TIME')
local now = (tonumber(clock[1]) * 1000) + math.floor(tonumber(clock[2]) / 1000)
redis.call('ZADD', KEYS[2], now + tonumber(ARGV[2]), KEYS[1])
return 1`;

const IDEMPOTENCY_COMPLETE_SCRIPT = `-- tokopt:idempotency-complete:v1
local target = ARGV[4] or 'completed'
if redis.call('HGET', KEYS[1], 'status') == target and redis.call('HGET', KEYS[1], 'completion') == ARGV[1] then return 2 end
if redis.call('HGET', KEYS[1], 'status') ~= 'pending' then return 0 end
if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[1] then return 0 end
if target == 'tombstone' then
  redis.call('HSET', KEYS[1], 'status', 'tombstone', 'completion', ARGV[1])
  redis.call('HDEL', KEYS[1], 'result')
else
  redis.call('HSET', KEYS[1], 'status', 'completed', 'result', ARGV[2], 'completion', ARGV[1])
end
redis.call('HDEL', KEYS[1], 'owner')
redis.call('PEXPIRE', KEYS[1], ARGV[3])
local clock = redis.call('TIME')
local now = (tonumber(clock[1]) * 1000) + math.floor(tonumber(clock[2]) / 1000)
redis.call('ZADD', KEYS[2], now + tonumber(ARGV[3]), KEYS[1])
return 1`;

const IDEMPOTENCY_RELEASE_SCRIPT = `-- tokopt:idempotency-release:v1
if redis.call('HGET', KEYS[1], 'status') ~= 'pending' then return 0 end
if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[1] then return 0 end
redis.call('ZREM', KEYS[2], KEYS[1])
return redis.call('DEL', KEYS[1])`;

function createKeySpace(namespace, secret) {
  const namespaceHash = digest(String(namespace || "token-optimizer")).slice(0, 20);
  const tag = `{tokopt-${namespaceHash}}`;
  const prefix = `tokopt:${tag}:v1`;
  return {
    rateIndex: `${prefix}:rate:index`,
    rate(scope, client) {
      return `${prefix}:rate:${scope}:${keyedDigest(secret, client)}`;
    },
    concurrency: `${prefix}:concurrency`,
    idempotencyIndex: `${prefix}:idempotency:index`,
    budget(day) {
      return `${prefix}:budget:${day}`;
    },
    budgetReservation(day, id) {
      return `${prefix}:budget:${day}:reservation:${keyedDigest(secret, id)}`;
    },
    idempotency(scope, key) {
      return `${prefix}:idempotency:${keyedDigest(secret, `${scope}\0${key}`)}`;
    }
  };
}

function createRedisRateLimiter(options = {}) {
  const client = options.client;
  const keys = options.keys;
  const clientKey = typeof options.clientKey === "function" ? options.clientKey : () => "unknown";
  const bucketCap = boundedInteger(options.bucketCap, 1_000, 1, 100_000);
  const profiles = options.profiles || {
    billable: { limit: 20, windowMs: 60_000 },
    preparation: { limit: 60, windowMs: 60_000 }
  };

  return {
    async take(req, takeOptions = {}) {
      const scope = takeOptions.scope === "preparation" ? "preparation" : "billable";
      const profile = profiles[scope];
      const subject = clientKey(req);
      const result = await client.eval(
        RATE_SCRIPT,
        [keys.rate(scope, subject), keys.rateIndex],
        [profile.windowMs, profile.limit, bucketCap]
      );
      const resetAt = numberAt(result, 4, Date.now() + profile.windowMs);
      const serverNow = numberAt(result, 6, Date.now());
      return {
        allowed: numberAt(result, 0) === 1,
        capacityExceeded: numberAt(result, 1) === 1,
        scope,
        limit: numberAt(result, 5, profile.limit),
        remaining: numberAt(result, 3),
        resetAt,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - serverNow) / 1_000))
      };
    },
    clear() {},
    inspect: () => ({ backend: "upstash", bucketCap })
  };
}

function createRedisConcurrencyGate(options = {}) {
  const client = options.client;
  const key = options.keys.concurrency;
  const limit = boundedInteger(options.limit, 4, 1, 1_000);
  const leaseMs = boundedInteger(options.leaseMs, MIN_SHARED_EXECUTION_FENCE_MS, 5_000, 900_000);
  const heartbeatMs = Math.max(1_000, Math.floor(leaseMs / 3));

  return {
    async acquire() {
      const owner = randomId();
      const result = await retryAmbiguous(() => client.eval(
        CONCURRENCY_ACQUIRE_SCRIPT,
        [key],
        [limit, leaseMs, owner]
      ));
      if (![1, 2].includes(numberAt(result, 0))) {
        return {
          allowed: false,
          active: numberAt(result, 1),
          limit,
          retryAfterSeconds: Math.max(1, Math.ceil(numberAt(result, 3, 1_000) / 1_000))
        };
      }

      let released = false;
      let leaseHealthy = true;
      const ownership = new AbortController();
      const heartbeat = setInterval(() => {
        retryAmbiguous(
          () => client.eval(CONCURRENCY_RENEW_SCRIPT, [key], [leaseMs, owner]),
          { attempts: 2 }
        ).then((renewed) => {
          if (Number(renewed) !== 1) {
            leaseHealthy = false;
            ownership.abort();
          }
        }).catch(() => {
          leaseHealthy = false;
          ownership.abort();
        });
      }, heartbeatMs);
      heartbeat.unref?.();

      return {
        allowed: true,
        active: numberAt(result, 1),
        limit,
        signal: ownership.signal,
        leaseHealthy: () => leaseHealthy,
        async release() {
          if (released) return false;
          released = true;
          clearInterval(heartbeat);
          try {
            return Number(await retryAmbiguous(
              () => client.eval(CONCURRENCY_RELEASE_SCRIPT, [key], [owner]),
              { attempts: 2 }
            )) === 1;
          } catch {
            // The lease expires automatically. Do not discard a completed model
            // result solely because cleanup could not reach the shared store.
            return false;
          }
        }
      };
    },
    inspect: () => ({ backend: "upstash", limit, leaseMs })
  };
}

function sharedBudgetWindow(dayNumber, resetAt, serverNow) {
  if (!Number.isInteger(dayNumber) || dayNumber < 0 || !Number.isFinite(resetAt)) throw unavailableError();
  return {
    dayNumber,
    day: new Date(dayNumber * 86_400_000).toISOString().slice(0, 10),
    resetAt,
    serverNow: Number.isFinite(serverNow) ? serverNow : resetAt - 86_400_000,
    expiresAt: resetAt + 86_400_000
  };
}

function createRedisDailyBudget(options = {}) {
  const client = options.client;
  const keys = options.keys;
  const callLimit = boundedInteger(options.callLimit, 500, 1, 1_000_000);
  const tokenLimit = boundedInteger(options.tokenLimit, 2_000_000, 1, 1_000_000_000);

  async function currentWindow() {
    const result = await retryAmbiguous(() => client.eval(BUDGET_TIME_SCRIPT, [], []));
    return sharedBudgetWindow(numberAt(result, 0), numberAt(result, 1), numberAt(result, 2));
  }

  function snapshot(window, callsUsed, tokensUsed, additions = {}) {
    return {
      applied: true,
      backend: "upstash",
      day: window.day,
      resetAt: window.resetAt,
      callLimit,
      tokenLimit,
      callsUsed,
      tokensUsed,
      remainingCalls: Math.max(0, callLimit - callsUsed),
      remainingTokens: Math.max(0, tokenLimit - tokensUsed),
      ...additions
    };
  }

  return {
    async reserve(usage = {}) {
      const calls = boundedInteger(usage.calls, 1, 0, 1_000_000);
      const tokens = boundedInteger(usage.tokens, 0, 0, 1_000_000_000);
      const reservationId = usage.reservationId || randomId();
      let window = await currentWindow();
      let budgetKey;
      let reservationKey;
      let result;
      let decision;
      for (let rolloverAttempt = 0; rolloverAttempt < 2; rolloverAttempt += 1) {
        budgetKey = keys.budget(window.day);
        reservationKey = keys.budgetReservation(window.day, reservationId);
        result = await retryAmbiguous(() => client.eval(
          BUDGET_RESERVE_SCRIPT,
          [budgetKey, reservationKey],
          [calls, tokens, callLimit, tokenLimit, window.expiresAt, window.dayNumber]
        ));
        decision = numberAt(result, 0);
        if (decision !== 3) break;
        window = sharedBudgetWindow(numberAt(result, 5), numberAt(result, 6), numberAt(result, 7));
      }
      if (decision === 3) throw unavailableError();
      const callsUsed = numberAt(result, 1);
      const tokensUsed = numberAt(result, 2);
      if (decision === 0) {
        const reason = numberAt(result, 3) === 1 ? "daily_call_limit" : "daily_token_limit";
        return {
          allowed: false,
          ...snapshot(window, callsUsed, tokensUsed),
          reason,
          retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - window.serverNow) / 1_000))
        };
      }

      const reservedCalls = numberAt(result, 3, calls);
      const reservedTokens = numberAt(result, 4, tokens);
      let state = "reserved";
      let current = snapshot(window, callsUsed, tokensUsed, {
        reservedCalls,
        reservedTokens
      });
      return {
        allowed: true,
        reservedCalls,
        reservedTokens,
        async settle(actualUsage = {}) {
          if (state !== "reserved") return current;
          const actualTokens = boundedInteger(actualUsage.tokens, reservedTokens, 0, 1_000_000_000);
          const settled = await retryAmbiguous(() => client.eval(
            BUDGET_SETTLE_SCRIPT,
            [budgetKey, reservationKey],
            [actualTokens]
          ));
          state = "settled";
          current = snapshot(window, numberAt(settled, 1), numberAt(settled, 2), {
            reservedCalls,
            reservedTokens,
            settledTokens: numberAt(settled, 3, actualTokens)
          });
          return current;
        },
        async release() {
          if (state !== "reserved") return current;
          const released = await retryAmbiguous(
            () => client.eval(BUDGET_RELEASE_SCRIPT, [budgetKey, reservationKey], []),
            { attempts: 2 }
          );
          state = "released";
          current = snapshot(window, numberAt(released, 1), numberAt(released, 2));
          return current;
        },
        snapshot: () => current
      };
    },
    inspect: () => ({ backend: "upstash", callLimit, tokenLimit })
  };
}

function encryptionKey(secret) {
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

function encryptResult(value, secret, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptResult(value, secret, aad) {
  const [version, ivText, tagText, encryptedText] = String(value || "").split(".");
  if (version !== "v1" || !ivText || !tagText || !encryptedText) throw unavailableError();
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(ivText, "base64url"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const clear = Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]);
    return JSON.parse(clear.toString("utf8"));
  } catch {
    throw unavailableError();
  }
}

function createRedisIdempotencyStore(options = {}) {
  const client = options.client;
  const keys = options.keys;
  const secret = String(options.secret || "");
  if (Buffer.byteLength(secret) < 32) throw new TypeError("The shared guard secret must be at least 32 bytes.");
  const maxEntries = boundedInteger(options.maxEntries, 500, 1, 100_000);
  const maxResultBytes = boundedInteger(options.maxResultBytes, 1_500_000, 1_024, 1_750_000);
  const ttlMs = boundedInteger(options.ttlMs, 300_000, 1_000, 86_400_000);
  const pendingTtlMs = boundedInteger(options.pendingTtlMs, MIN_SHARED_EXECUTION_FENCE_MS, 10_000, 900_000);
  const waitMs = boundedInteger(options.waitMs, 5_000, 1_000, 900_000);
  const pollMs = boundedInteger(options.pollMs, 1_000, 25, 2_000);
  const heartbeatMs = Math.max(1_000, Math.floor(pendingTtlMs / 3));

  async function claim(storageKey, fingerprint, owner, signal) {
    return retryAmbiguous(() => client.eval(
      IDEMPOTENCY_CLAIM_SCRIPT,
      [storageKey, keys.idempotencyIndex],
      [fingerprint, owner, pendingTtlMs, maxEntries]
    ), { signal });
  }

  return {
    async execute(identity, operation) {
      if (!identity?.key) return { value: await operation({ signal: identity?.signal }), status: "none" };
      const scope = identity.scope || "global";
      const fingerprint = String(identity.fingerprint || "");
      const storedFingerprint = keyedDigest(secret, fingerprint);
      const storageKey = keys.idempotency(scope, identity.key);
      const aad = `${storageKey}:${storedFingerprint}`;
      const owner = randomId();
      const startedWaitingAt = Date.now();
      let joined = false;

      while (true) {
        const decision = await claim(storageKey, storedFingerprint, owner, identity.signal);
        const state = String(decision?.[0] || "");
        if (state === "conflict") {
          throw new SharedGuardError(409, "idempotency_conflict", "The Idempotency-Key was already used with a different request.");
        }
        if (state === "capacity") {
          throw new SharedGuardError(503, "idempotency_capacity", "The request deduplication service is busy. Try again shortly.", {
            retryAfterSeconds: Math.max(1, Math.ceil(numberAt(decision, 1, 1_000) / 1_000))
          });
        }
        if (state === "completed") {
          return {
            value: decryptResult(decision[1], secret, aad),
            status: joined ? "joined" : "replayed"
          };
        }
        if (state === "tombstone") {
          throw new SharedGuardError(409, "idempotency_result_unavailable", "The matching request has no safely replayable result. Confirm its outcome before using a new Idempotency-Key.", {
            retryAfterSeconds: Math.max(1, Math.ceil(Math.min(numberAt(decision, 1, ttlMs), ttlMs) / 1_000))
          });
        }
        if (state === "started") {
          let completed = false;
          let executionStarted = false;
          const ownership = new AbortController();
          const heartbeat = setInterval(() => {
            retryAmbiguous(() => client.eval(
              IDEMPOTENCY_RENEW_SCRIPT,
              [storageKey, keys.idempotencyIndex],
              [owner, pendingTtlMs]
            ), { attempts: 2 }).then((renewed) => {
              if (Number(renewed) !== 1) ownership.abort();
            }).catch(() => ownership.abort());
          }, heartbeatMs);
          heartbeat.unref?.();
          try {
            const value = await operation({
              signal: ownership.signal,
              ownerId: owner,
              markExecutionStarted() {
                executionStarted = true;
              }
            });
            const encrypted = encryptResult(value, secret, aad);
            const completionState = Buffer.byteLength(encrypted) <= maxResultBytes ? "completed" : "tombstone";
            try {
              completed = [1, 2].includes(Number(await retryAmbiguous(() => client.eval(
                IDEMPOTENCY_COMPLETE_SCRIPT,
                [storageKey, keys.idempotencyIndex],
                [owner, completionState === "completed" ? encrypted : "", ttlMs, completionState]
              ))));
            } catch {
              // Returning the successful result is safer than encouraging the
              // original client to repeat a provider call. The pending lease
              // continues blocking duplicates until it expires.
            }
            return { value, status: "started", persistenceConfirmed: completed };
          } catch (error) {
            if (executionStarted) {
              // Once provider work may have been dispatched, turn the owned
              // claim into a replay-window tombstone. A timeout, disconnect,
              // or lost lease cannot then become a second possibly billed call
              // as soon as the shorter pending lease expires.
              try {
                await retryAmbiguous(
                  () => client.eval(
                    IDEMPOTENCY_COMPLETE_SCRIPT,
                    [storageKey, keys.idempotencyIndex],
                    [owner, "", ttlMs, "tombstone"]
                  ),
                  { attempts: 3 }
                );
              } catch {
                // If Redis itself is unavailable, retain the pending claim as
                // the best available short-term fence until its TTL expires.
              }
            } else if (error?.code !== "coordination_unavailable") {
              try {
                await retryAmbiguous(
                  () => client.eval(IDEMPOTENCY_RELEASE_SCRIPT, [storageKey, keys.idempotencyIndex], [owner]),
                  { attempts: 2 }
                );
              } catch {}
            }
            throw error;
          } finally {
            clearInterval(heartbeat);
          }
        }
        if (state !== "pending") throw unavailableError();
        joined = true;
        if (identity.signal?.aborted) throw cancellationError();
        if (Date.now() - startedWaitingAt >= waitMs) {
          throw new SharedGuardError(409, "idempotency_in_progress", "A matching request is still in progress.", {
            retryAfterSeconds: Math.max(1, Math.ceil(Math.min(numberAt(decision, 1, pollMs), 5_000) / 1_000))
          });
        }
        const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(pollMs / 4)));
        await sleep(pollMs + jitter, identity.signal);
      }
    },
    clear() {},
    inspect: () => ({ backend: "upstash", maxEntries, maxResultBytes, ttlMs, pendingTtlMs, waitMs, encryptedResults: true })
  };
}

function unavailableAdapters(reason) {
  const fail = async () => { throw unavailableError(reason); };
  return {
    backend: "upstash",
    ready: false,
    reason,
    health: () => ({ verified: false, lastSuccessAt: null, lastFailureAt: null }),
    rateLimiter: { take: fail, clear() {}, inspect: () => ({ backend: "upstash", ready: false }) },
    concurrencyGate: { acquire: fail, inspect: () => ({ backend: "upstash", ready: false }) },
    dailyBudget: { reserve: fail, inspect: () => ({ backend: "upstash", ready: false }) },
    idempotencyStore: { execute: fail, clear() {}, inspect: () => ({ backend: "upstash", ready: false }) }
  };
}

function createSharedRequestGuardAdapters(options = {}) {
  const environment = options.environment || process.env;
  const backend = normalizedBackend(options.backend ?? environment.TOKEN_OPTIMIZER_SHARED_GUARD_BACKEND);
  const url = String(options.url ?? firstNonEmpty(
    environment.UPSTASH_REDIS_REST_URL,
    environment.KV_REST_API_URL
  ));
  const token = String(options.token ?? firstNonEmpty(
    environment.UPSTASH_REDIS_REST_TOKEN,
    environment.KV_REST_API_TOKEN
  ));
  const secret = String(options.secret ?? environment.TOKEN_OPTIMIZER_SHARED_GUARD_SECRET ?? "");
  const redisRequested = backend === "upstash" || (
    backend === "auto" && Boolean(url) && Boolean(token) && Buffer.byteLength(secret) >= 32
  );

  if (backend === "memory" || (backend === "auto" && !redisRequested)) {
    return { backend: "memory", ready: true };
  }
  if (backend === "invalid") {
    return unavailableAdapters("The shared guard backend configuration is invalid.");
  }
  if (!url || !token || Buffer.byteLength(secret) < 32) {
    return unavailableAdapters("Shared coordination is enabled but its Redis URL, token, or 32-byte encryption secret is missing.");
  }

  const redisTimeoutMs = boundedInteger(
    options.timeoutMs ?? environment.TOKEN_OPTIMIZER_SHARED_GUARD_TIMEOUT_MS,
    DEFAULT_REDIS_TIMEOUT_MS,
    250,
    30_000
  );
  const requiredExecutionFenceMs = minimumExecutionFenceMs(redisTimeoutMs);

  let client;
  try {
    client = options.client || createRedisRestClient({
      url,
      token,
      fetchImpl: options.fetchImpl,
      timeoutMs: redisTimeoutMs,
      maxResponseBytes: options.maxResponseBytes
    });
  } catch {
    return unavailableAdapters("Shared coordination is enabled but its Redis configuration is invalid.");
  }

  const defaultNamespace = `${firstNonEmpty(environment.VERCEL_PROJECT_ID, "token-optimizer")}:${firstNonEmpty(
    environment.VERCEL_ENV,
    environment.NODE_ENV,
    "local"
  )}`;
  const keys = createKeySpace(firstNonEmpty(
    typeof options.namespace === "string" ? options.namespace : "",
    environment.TOKEN_OPTIMIZER_SHARED_GUARD_NAMESPACE,
    defaultNamespace
  ), secret);
  const concurrencyLeaseMs = boundedInteger(
    options.concurrencyLeaseMs ?? environment.TOKEN_OPTIMIZER_SHARED_CONCURRENCY_LEASE_MS,
    requiredExecutionFenceMs,
    5_000,
    900_000
  );
  const pendingTtlMs = boundedInteger(
    options.pendingTtlMs ?? environment.TOKEN_OPTIMIZER_SHARED_PENDING_TTL_MS,
    requiredExecutionFenceMs,
    10_000,
    900_000
  );
  const idempotencyTtlMs = boundedInteger(options.idempotencyTtlMs, 360_000, 1_000, 86_400_000);
  if (
    concurrencyLeaseMs < requiredExecutionFenceMs ||
    pendingTtlMs < requiredExecutionFenceMs ||
    idempotencyTtlMs < pendingTtlMs
  ) {
    return unavailableAdapters(
      `Shared concurrency and pending leases must be at least ${requiredExecutionFenceMs} ms for the configured Redis timeout, and the idempotency replay TTL must be at least the pending lease.`
    );
  }
  const profiles = options.profiles;
  const rateLimiter = createRedisRateLimiter({
    client,
    keys,
    clientKey: options.clientKey,
    bucketCap: options.bucketCap,
    profiles
  });
  const concurrencyGate = createRedisConcurrencyGate({
    client,
    keys,
    limit: options.concurrencyLimit,
    leaseMs: concurrencyLeaseMs
  });
  const dailyBudget = createRedisDailyBudget({
    client,
    keys,
    now: options.now,
    callLimit: options.dailyCallLimit,
    tokenLimit: options.dailyTokenLimit
  });
  const idempotencyStore = createRedisIdempotencyStore({
    client,
    keys,
    secret,
    maxEntries: options.idempotencyMaxEntries,
    maxResultBytes: options.idempotencyMaxResultBytes ?? environment.TOKEN_OPTIMIZER_SHARED_REPLAY_MAX_BYTES,
    ttlMs: idempotencyTtlMs,
    pendingTtlMs,
    waitMs: options.waitMs ?? environment.TOKEN_OPTIMIZER_SHARED_WAIT_MS,
    pollMs: options.pollMs ?? environment.TOKEN_OPTIMIZER_SHARED_POLL_MS
  });

  return {
    backend: "upstash",
    ready: true,
    health: () => typeof client.inspect === "function"
      ? client.inspect()
      : { verified: null, lastSuccessAt: null, lastFailureAt: null },
    rateLimiter,
    concurrencyGate,
    dailyBudget,
    idempotencyStore
  };
}

module.exports = {
  REDIS_SCRIPTS: Object.freeze({
    rate: RATE_SCRIPT,
    concurrencyAcquire: CONCURRENCY_ACQUIRE_SCRIPT,
    concurrencyRenew: CONCURRENCY_RENEW_SCRIPT,
    concurrencyRelease: CONCURRENCY_RELEASE_SCRIPT,
    budgetTime: BUDGET_TIME_SCRIPT,
    budgetReserve: BUDGET_RESERVE_SCRIPT,
    budgetSettle: BUDGET_SETTLE_SCRIPT,
    budgetRelease: BUDGET_RELEASE_SCRIPT,
    idempotencyClaim: IDEMPOTENCY_CLAIM_SCRIPT,
    idempotencyRenew: IDEMPOTENCY_RENEW_SCRIPT,
    idempotencyComplete: IDEMPOTENCY_COMPLETE_SCRIPT,
    idempotencyRelease: IDEMPOTENCY_RELEASE_SCRIPT
  }),
  SharedGuardError,
  MIN_SHARED_EXECUTION_FENCE_MS,
  minimumExecutionFenceMs,
  createRedisConcurrencyGate,
  createRedisDailyBudget,
  createRedisIdempotencyStore,
  createRedisRateLimiter,
  createRedisRestClient,
  createSharedRequestGuardAdapters,
  decryptResult,
  encryptResult
};

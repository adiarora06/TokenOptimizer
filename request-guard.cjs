const { z } = require("zod");
const net = require("node:net");
const crypto = require("node:crypto");
const { safeErrorMessage } = require("./core/security.cjs");
const {
  MIN_SHARED_EXECUTION_FENCE_MS,
  createSharedRequestGuardAdapters
} = require("./shared-request-guard.cjs");

const MAX_BILLABLE_EXECUTION_MS = 120_000;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

const MAX_INPUT_CHARS = boundedInteger(process.env.TOKEN_OPTIMIZER_MAX_INPUT_CHARS, 80_000, 1_000, 1_000_000);
const RATE_PROFILES = {
  billable: {
    limit: boundedInteger(process.env.TOKEN_OPTIMIZER_RATE_MAX, 20, 1, 10_000),
    windowMs: boundedInteger(process.env.TOKEN_OPTIMIZER_RATE_WINDOW_MS, 60_000, 1_000, 3_600_000)
  },
  preparation: {
    limit: boundedInteger(process.env.TOKEN_OPTIMIZER_PREP_RATE_MAX, 60, 1, 10_000),
    windowMs: boundedInteger(process.env.TOKEN_OPTIMIZER_PREP_RATE_WINDOW_MS, 60_000, 1_000, 3_600_000)
  }
};
const RATE_BUCKET_CAP = boundedInteger(process.env.TOKEN_OPTIMIZER_RATE_BUCKET_CAP, 1_000, 1, 100_000);
const MAX_CONCURRENT_BILLABLE = boundedInteger(process.env.TOKEN_OPTIMIZER_MAX_CONCURRENCY, 4, 1, 1_000);
const DAILY_CALL_LIMIT = boundedInteger(process.env.TOKEN_OPTIMIZER_DAILY_CALL_LIMIT, 500, 1, 1_000_000);
const DAILY_TOKEN_LIMIT = boundedInteger(process.env.TOKEN_OPTIMIZER_DAILY_TOKEN_LIMIT, 2_000_000, 1, 1_000_000_000);
const IDEMPOTENCY_MAX_ENTRIES = boundedInteger(process.env.TOKEN_OPTIMIZER_IDEMPOTENCY_MAX_ENTRIES, 500, 1, 100_000);
const IDEMPOTENCY_TTL_MS = boundedInteger(
  process.env.TOKEN_OPTIMIZER_IDEMPOTENCY_TTL_MS,
  360_000,
  MIN_SHARED_EXECUTION_FENCE_MS,
  86_400_000
);

function requiredString(missingMessage) {
  return z.string({ error: (issue) => (issue.input === undefined ? missingMessage : undefined) });
}

const providerConfigSchema = z.object({
  provider: z.enum(["groq", "openai", "openrouter", "xai", "litellm", "custom", "offline"]).optional(),
  label: z.string().trim().max(80).optional(),
  baseUrl: z.string().trim().max(2_048).optional(),
  model: z.string().trim().max(200).optional(),
  apiKey: z.string().trim().max(4_000).optional()
}).passthrough();

const optimizerPayloadSchema = z.object({
  input: requiredString("Missing input").trim().min(1, "Missing input").max(MAX_INPUT_CHARS, `Input exceeds ${MAX_INPUT_CHARS.toLocaleString()} characters`),
  provider: z.enum(["groq-openai-fallback", "groq", "openai", "offline"]).optional(),
  source: z.string().trim().max(80).optional(),
  target: z.string().trim().max(80).optional(),
  sessionId: z.string().trim().max(120).nullable().optional(),
  runType: z.enum(["optimizer", "kit"]).optional(),
  options: z.object({
    routePreference: z.enum(["auto", "fast", "thorough", "verified"]).optional(),
    timeoutMs: z.number().int().min(5_000).max(MAX_BILLABLE_EXECUTION_MS).optional(),
    mode: z.string().max(80).optional()
  }).passthrough().optional(),
  providerConfig: providerConfigSchema.optional()
}).passthrough();

const a2aPayloadSchema = z.object({
  input: requiredString("Missing input").trim().min(1, "Missing input").max(MAX_INPUT_CHARS, `Input exceeds ${MAX_INPUT_CHARS.toLocaleString()} characters`),
  providerConfig: providerConfigSchema.optional(),
  options: z.object({
    mode: z.string().trim().max(80).optional(),
    timeoutMs: z.number().int().min(5_000).max(MAX_BILLABLE_EXECUTION_MS).optional()
  }).passthrough().optional()
}).passthrough();

const generatePayloadSchema = z.object({
  prompt: requiredString("Missing prompt").trim().min(1, "Missing prompt").max(MAX_INPUT_CHARS, `Prompt exceeds ${MAX_INPUT_CHARS.toLocaleString()} characters`),
  provider: z.enum(["groq-openai-fallback", "groq", "openai"]).optional()
}).passthrough();

function normalizedIp(value) {
  const candidate = String(value || "").split(",")[0].trim().replace(/^\[|\]$/g, "");
  const mappedIpv4 = candidate.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
  const normalized = mappedIpv4 || candidate;
  return net.isIP(normalized) ? normalized : "";
}

// Vercel overwrites x-forwarded-for before invoking a Function. A standalone
// Node server does not have that guarantee, so forwarding headers are ignored
// unless a trusted proxy is explicitly configured.
function clientKey(req) {
  const trustForwarded = process.env.VERCEL === "1" || process.env.TOKEN_OPTIMIZER_TRUST_PROXY === "1";
  const forwarded = trustForwarded ? normalizedIp(req.headers?.["x-forwarded-for"]) : "";
  return forwarded || normalizedIp(req.socket?.remoteAddress) || "unknown";
}

function createRateLimiter(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const bucketCap = boundedInteger(options.bucketCap, RATE_BUCKET_CAP, 1, 100_000);
  const suppliedProfiles = options.profiles || {};
  const profiles = Object.fromEntries(Object.entries(RATE_PROFILES).map(([scope, fallback]) => {
    const supplied = suppliedProfiles[scope] || {};
    return [scope, {
      limit: boundedInteger(supplied.limit, fallback.limit, 1, 1_000_000),
      windowMs: boundedInteger(supplied.windowMs, fallback.windowMs, 1, 86_400_000)
    }];
  }));
  const buckets = new Map();

  function purgeExpired(at) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= at) buckets.delete(key);
    }
  }

  function take(req, takeOptions = {}) {
    const at = now();
    const scope = takeOptions.scope === "preparation" ? "preparation" : "billable";
    const profile = profiles[scope];
    const key = `${scope}:${clientKey(req)}`;
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= at) {
      if (bucket) buckets.delete(key);
      purgeExpired(at);

      // Unknown clients fail closed when every bounded slot is active. Evicting
      // a live bucket would let an attacker rotate IPs to reset its own limit.
      if (buckets.size >= bucketCap) {
        const resetAt = Math.min(...Array.from(buckets.values(), (value) => value.resetAt));
        return {
          allowed: false,
          capacityExceeded: true,
          scope,
          limit: profile.limit,
          remaining: 0,
          resetAt,
          retryAfterSeconds: Math.max(1, Math.ceil((resetAt - at) / 1_000))
        };
      }

      bucket = { count: 0, resetAt: at + profile.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    return {
      allowed: bucket.count <= profile.limit,
      capacityExceeded: false,
      scope,
      limit: profile.limit,
      remaining: Math.max(0, profile.limit - bucket.count),
      resetAt: bucket.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - at) / 1_000))
    };
  }

  return {
    take,
    clear: () => buckets.clear(),
    inspect: () => ({ bucketCap, size: buckets.size })
  };
}

const sharedGuardAdapters = createSharedRequestGuardAdapters({
  clientKey,
  profiles: RATE_PROFILES,
  bucketCap: RATE_BUCKET_CAP,
  concurrencyLimit: MAX_CONCURRENT_BILLABLE,
  dailyCallLimit: DAILY_CALL_LIMIT,
  dailyTokenLimit: DAILY_TOKEN_LIMIT,
  idempotencyMaxEntries: IDEMPOTENCY_MAX_ENTRIES,
  idempotencyMaxResultBytes: boundedInteger(process.env.TOKEN_OPTIMIZER_SHARED_REPLAY_MAX_BYTES, 1_500_000, 1_024, 1_750_000),
  idempotencyTtlMs: IDEMPOTENCY_TTL_MS
});
const sharedCoordinationEnabled = sharedGuardAdapters.backend === "upstash";
const defaultRateLimiter = sharedCoordinationEnabled
  ? sharedGuardAdapters.rateLimiter
  : createRateLimiter();

function takeRateLimit(req, options = {}) {
  return defaultRateLimiter.take(req, options);
}

class RequestGuardError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "RequestGuardError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.budget = details.budget;
  }
}

function singleHeader(req, name) {
  const lowerName = String(name).toLowerCase();
  const headers = req?.headers;
  const raw = typeof headers?.get === "function"
    ? headers.get(lowerName)
    : headers?.[lowerName] ?? headers?.[name];
  if (raw === undefined || raw === null || raw === "") {
    return { present: false, valid: true, value: "" };
  }
  if (Array.isArray(raw) || typeof raw !== "string") {
    return { present: true, valid: false, value: "" };
  }
  return { present: true, valid: true, value: raw.trim() };
}

function secretDigest(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest();
}

function constantTimeSecretEqual(left, right) {
  const leftText = typeof left === "string" ? left : "";
  const rightText = typeof right === "string" ? right : "";
  const equal = crypto.timingSafeEqual(secretDigest(leftText), secretDigest(rightText));
  return leftText.length > 0 && rightText.length > 0 && equal;
}

function bearerCredential(req) {
  const header = singleHeader(req, "authorization");
  const match = header.valid && header.value.length <= 4_096
    ? header.value.match(/^Bearer[ \t]+([^\s]+)$/i)
    : null;
  return { valid: Boolean(match), token: match?.[1] || "" };
}

function idempotencyPrincipal(req, payload, funding, authorization) {
  if (authorization?.authenticated) {
    return `access:${secretDigest(bearerCredential(req).token).toString("hex")}`;
  }
  if (funding === "byok") {
    return `byok:${secretDigest(payload?.providerConfig?.apiKey).toString("hex")}`;
  }
  return `client:${clientKey(req)}`;
}

function enabled(value) {
  return value === true || String(value || "").toLowerCase() === "true" || String(value || "") === "1";
}

function combineAbortSignals(...signals) {
  const active = signals.filter((signal) => signal && typeof signal.addEventListener === "function");
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(active);
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

function classifyProviderConfigFunding(providerConfig = {}) {
  if (providerConfig?.provider === "offline") return "offline";
  if (typeof providerConfig?.apiKey === "string" && providerConfig.apiKey.trim()) return "byok";
  return "server";
}

function classifyRequestFunding(payload = {}, explicitFunding) {
  // `explicitFunding` is a trusted handler override, never a request-body field.
  if (["offline", "byok", "server"].includes(explicitFunding)) return explicitFunding;
  // A top-level provider is authoritative for endpoints that expose it. This
  // fail-closed precedence prevents a contradictory, unused providerConfig from
  // disguising a server-funded top-level provider as offline or BYOK.
  if (payload?.provider !== undefined) return payload.provider === "offline" ? "offline" : "server";
  return classifyProviderConfigFunding(payload?.providerConfig);
}

// Production is fail-closed only for server-funded calls. Local/test usage,
// explicit offline work, and caller-funded provider keys remain usable without
// a deployment access token. Public server funding requires an explicit opt-in.
function authorizeBillableRequest(req, options = {}) {
  const funding = classifyRequestFunding(options.payload, options.funding);
  if (funding === "offline" || funding === "byok") {
    return { allowed: true, authenticated: false, funding, reason: funding };
  }

  const environment = options.environment ?? process.env.NODE_ENV ?? "development";
  if (environment !== "production") {
    return { allowed: true, authenticated: false, funding, reason: "non_production" };
  }

  const configuredToken = String(options.accessToken ?? process.env.TOKEN_OPTIMIZER_ACCESS_TOKEN ?? "");
  const publicFunded = options.allowPublicFunded ?? enabled(process.env.TOKEN_OPTIMIZER_ALLOW_PUBLIC_FUNDED);
  const bearer = bearerCredential(req);
  // Hashing both values before timingSafeEqual keeps the comparison path fixed
  // even when attacker-controlled and configured token lengths differ.
  const tokenMatches = constantTimeSecretEqual(bearer.token, configuredToken);

  if (publicFunded) {
    return { allowed: true, authenticated: false, funding, reason: "public_funded_opt_in" };
  }
  if (bearer.valid && tokenMatches) {
    return { allowed: true, authenticated: true, funding, reason: "access_token" };
  }
  if (!configuredToken) {
    return {
      allowed: false,
      status: 503,
      code: "server_funding_disabled",
      error: "Server-funded requests are disabled until an access token or public-funded opt-in is configured.",
      funding
    };
  }
  return {
    allowed: false,
    status: 401,
    code: "unauthorized",
    error: "A valid bearer access token is required for server-funded requests.",
    funding
  };
}

function validateIdempotencyKey(value) {
  if (value === undefined || value === null || value === "") return { ok: true, key: null };
  if (Array.isArray(value) || typeof value !== "string") {
    return { ok: false, error: "Invalid Idempotency-Key header." };
  }
  const key = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._~:+/=\-]{7,127}$/.test(key)) {
    return { ok: false, error: "Idempotency-Key must be 8-128 URL-safe ASCII characters." };
  }
  return { ok: true, key };
}

function requestIdempotencyKey(req) {
  const header = singleHeader(req, "idempotency-key");
  if (!header.valid) return validateIdempotencyKey([]);
  return validateIdempotencyKey(header.present ? header.value : null);
}

const SENSITIVE_FINGERPRINT_FIELD = /(api.?key|token|authorization|secret|password|credential)/i;

function canonicalFingerprintValue(value, fieldName = "", seen = new WeakSet()) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    if (SENSITIVE_FINGERPRINT_FIELD.test(fieldName)) {
      return `[secret-sha256:${secretDigest(value).toString("hex")}]`;
    }
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map((item) => canonicalFingerprintValue(item, fieldName, seen));
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) throw new TypeError("Cannot fingerprint a circular payload");
  seen.add(value);
  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    normalized[key] = canonicalFingerprintValue(value[key], key, seen);
  }
  seen.delete(value);
  return normalized;
}

// Only a digest is retained. Sensitive field values are separately digested
// first, so changing a BYOK credential causes a conflict without storing it.
function idempotencyFingerprint(endpoint, payload) {
  const canonical = JSON.stringify({
    endpoint: String(endpoint || ""),
    payload: canonicalFingerprintValue(payload || {})
  });
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

function createConcurrencyGate(options = {}) {
  const limit = boundedInteger(options.limit, MAX_CONCURRENT_BILLABLE, 1, 1_000);
  let active = 0;

  function acquire() {
    if (active >= limit) {
      return { allowed: false, active, limit, retryAfterSeconds: 1 };
    }
    active += 1;
    let released = false;
    return {
      allowed: true,
      active,
      limit,
      release() {
        if (released) return false;
        released = true;
        active = Math.max(0, active - 1);
        return true;
      }
    };
  }

  return { acquire, inspect: () => ({ active, limit }) };
}

function utcDay(at) {
  const day = new Date(at).toISOString().slice(0, 10);
  return { day, resetAt: Date.parse(`${day}T00:00:00.000Z`) + 86_400_000 };
}

function createDailyBudget(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const callLimit = boundedInteger(options.callLimit, DAILY_CALL_LIMIT, 1, 1_000_000);
  const tokenLimit = boundedInteger(options.tokenLimit, DAILY_TOKEN_LIMIT, 1, 1_000_000_000);
  let state = null;

  function currentState() {
    const at = now();
    const date = utcDay(at);
    if (!state || state.day !== date.day) {
      state = { ...date, calls: 0, tokens: 0 };
    }
    return { at, state };
  }

  function snapshot(entry = currentState().state) {
    return {
      applied: true,
      day: entry.day,
      resetAt: entry.resetAt,
      callLimit,
      tokenLimit,
      callsUsed: entry.calls,
      tokensUsed: entry.tokens,
      remainingCalls: Math.max(0, callLimit - entry.calls),
      remainingTokens: Math.max(0, tokenLimit - entry.tokens)
    };
  }

  function reserve(usage = {}) {
    const calls = boundedInteger(usage.calls, 1, 0, 1_000_000);
    const tokens = boundedInteger(usage.tokens, 0, 0, 1_000_000_000);
    const { at, state: entry } = currentState();
    if (entry.calls + calls > callLimit || entry.tokens + tokens > tokenLimit) {
      return {
        allowed: false,
        ...snapshot(entry),
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - at) / 1_000)),
        reason: entry.calls + calls > callLimit ? "daily_call_limit" : "daily_token_limit"
      };
    }

    entry.calls += calls;
    entry.tokens += tokens;
    let status = "reserved";

    return {
      allowed: true,
      reservedCalls: calls,
      reservedTokens: tokens,
      settle(actualUsage = {}) {
        if (status !== "reserved") return snapshot(entry);
        const actualTokens = boundedInteger(actualUsage.tokens, tokens, 0, 1_000_000_000);
        entry.tokens = Math.max(0, entry.tokens + actualTokens - tokens);
        status = "settled";
        return { ...snapshot(entry), reservedCalls: calls, reservedTokens: tokens, settledTokens: actualTokens };
      },
      release() {
        if (status !== "reserved") return snapshot(entry);
        entry.calls = Math.max(0, entry.calls - calls);
        entry.tokens = Math.max(0, entry.tokens - tokens);
        status = "released";
        return snapshot(entry);
      },
      snapshot: () => snapshot(entry)
    };
  }

  return { reserve, inspect: () => snapshot() };
}

function createIdempotencyStore(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const maxEntries = boundedInteger(options.maxEntries, IDEMPOTENCY_MAX_ENTRIES, 1, 100_000);
  const ttlMs = boundedInteger(options.ttlMs, IDEMPOTENCY_TTL_MS, 1, 86_400_000);
  const entries = new Map();

  function purgeExpired(at) {
    for (const [key, entry] of entries) {
      if (["completed", "tombstone"].includes(entry.status) && entry.expiresAt <= at) entries.delete(key);
    }
  }

  function makeIdentity(scope, key) {
    return crypto.createHash("sha256").update(`${scope}\0${key}`, "utf8").digest("hex");
  }

  function makeRoom(at) {
    purgeExpired(at);
    // Replays and uncertain-outcome tombstones are safety fences, not a cache:
    // capacity pressure must fail closed instead of evicting them early and
    // allowing a duplicate provider call.
    return entries.size < maxEntries;
  }

  async function execute(identity, operation) {
    if (!identity?.key) return { value: await operation({ signal: identity?.signal }), status: "none" };
    const at = now();
    purgeExpired(at);
    const storageKey = makeIdentity(identity.scope || "global", identity.key);
    const fingerprint = String(identity.fingerprint || "");
    const existing = entries.get(storageKey);

    if (existing) {
      if (!constantTimeSecretEqual(existing.fingerprint, fingerprint)) {
        throw new RequestGuardError(409, "idempotency_conflict", "The Idempotency-Key was already used with a different request.");
      }
      if (existing.status === "pending") {
        return { value: await existing.promise, status: "joined" };
      }
      if (existing.status === "tombstone") {
        throw new RequestGuardError(
          409,
          "idempotency_result_unavailable",
          "The matching request has no safely replayable result. Confirm its outcome before using a new Idempotency-Key.",
          { retryAfterSeconds: Math.max(1, Math.ceil((existing.expiresAt - at) / 1_000)) }
        );
      }
      entries.delete(storageKey);
      entries.set(storageKey, existing);
      return { value: existing.value, status: "replayed" };
    }

    if (!makeRoom(at)) {
      throw new RequestGuardError(503, "idempotency_capacity", "The request deduplication service is busy. Try again shortly.", {
        retryAfterSeconds: 1
      });
    }

    let executionStarted = false;
    const entry = { status: "pending", fingerprint, promise: null };
    const promise = Promise.resolve().then(() => operation({
      signal: identity.signal,
      ownerId: crypto.randomUUID(),
      markExecutionStarted() {
        executionStarted = true;
      }
    }));
    entry.promise = promise;
    entries.set(storageKey, entry);
    promise.then((value) => {
      if (entries.get(storageKey) !== entry) return;
      entry.status = "completed";
      entry.value = value;
      entry.expiresAt = now() + ttlMs;
      delete entry.promise;
      entries.delete(storageKey);
      entries.set(storageKey, entry);
    }, () => {
      if (entries.get(storageKey) !== entry) return;
      if (!executionStarted) {
        entries.delete(storageKey);
        return;
      }
      entry.status = "tombstone";
      entry.expiresAt = now() + ttlMs;
      delete entry.promise;
      entries.delete(storageKey);
      entries.set(storageKey, entry);
    });
    return { value: await promise, status: "started" };
  }

  return {
    execute,
    clear: () => entries.clear(),
    inspect: () => ({
      maxEntries,
      ttlMs,
      size: entries.size,
      pending: Array.from(entries.values()).filter((entry) => entry.status === "pending").length,
      completed: Array.from(entries.values()).filter((entry) => entry.status === "completed").length,
      tombstones: Array.from(entries.values()).filter((entry) => entry.status === "tombstone").length
    })
  };
}

function tokenUsageFromResult(value) {
  // A workflow-level provider error can still represent a billed upstream
  // attempt even when no usage record made it back. Keep the reservation in
  // that case instead of treating a reported zero as proof of zero cost.
  const executionStatus = value?.executionStatus ?? value?.result?.executionStatus;
  if (["provider_error", "cancelled"].includes(executionStatus)) return null;
  const directCandidates = [
    value?.tokenReport?.actualTotalTokens,
    value?.result?.tokenReport?.actualTotalTokens,
    value?.usage?.totalTokens,
    value?.usage?.total_tokens,
    value?.totalTokens,
    value?.total_tokens
  ];
  for (const candidate of directCandidates) {
    const number = Number(candidate);
    if (Number.isFinite(number) && number >= 0) return Math.round(number);
  }

  const usage = value?.usage || {};
  const input = Number(usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens);
  const output = Number(usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens);
  if (Number.isFinite(input) || Number.isFinite(output)) {
    return Math.max(0, Math.round((Number.isFinite(input) ? input : 0) + (Number.isFinite(output) ? output : 0)));
  }
  return null;
}

function estimateBillableTokens(payload = {}, endpoint = "") {
  if (classifyRequestFunding(payload) === "offline") return 0;
  const inputText = payload.input ?? payload.prompt ?? "";
  const inputTokens = Math.ceil(String(inputText).length / 4);
  const outputReserve = boundedInteger(process.env.TOKEN_OPTIMIZER_MAX_OUTPUT_TOKENS, 4_096, 128, 32_768);
  const mode = payload.options?.mode;
  const preference = payload.options?.routePreference;
  const calls = endpoint === "/api/generate" || preference === "fast"
    ? 1
    : mode === "contract-only"
      ? 1
      : preference === "thorough"
        ? 2
        : 3;
  // Include a small per-call framing allowance for system messages and typed
  // contracts. Actual provider usage replaces this reservation on success.
  return Math.min(1_000_000_000, (inputTokens * calls) + (outputReserve * calls) + (512 * calls));
}

function estimatedTokenCount(payload, supplied, endpoint) {
  const number = Number(supplied);
  if (Number.isFinite(number) && number >= 0) return Math.min(1_000_000_000, Math.round(number));
  return estimateBillableTokens(payload, endpoint);
}

function guardFailure(error, context) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const result = {
    ok: false,
    status,
    error: error instanceof RequestGuardError ? error.message : publicError(error),
    code: error?.code || "request_failed",
    rate: context.rate,
    funding: context.funding,
    budget: error?.budget || null
  };
  if (Number.isFinite(error?.retryAfterSeconds)) result.retryAfterSeconds = error.retryAfterSeconds;
  return result;
}

function createBillableRequestGuard(options = {}) {
  const rateLimiter = options.rateLimiter || createRateLimiter(options.rateLimit);
  const concurrencyGate = options.concurrencyGate || createConcurrencyGate(options.concurrency);
  const dailyBudget = options.dailyBudget || createDailyBudget(options.dailyBudgetOptions);
  const idempotencyStore = options.idempotencyStore || createIdempotencyStore(options.idempotency);
  const authDefaults = options.auth || {};

  async function run(args = {}) {
    const req = args.req || {};
    const endpoint = String(args.endpoint || "unknown");
    const payload = args.payload || {};
    const funding = classifyRequestFunding(payload, args.funding);
    let rate = null;
    try {
      rate = await Promise.resolve(rateLimiter.take(req, { scope: args.rateScope }));
    } catch (error) {
      return guardFailure(error, { rate, funding });
    }

    if (!rate.allowed) {
      return {
        ok: false,
        status: 429,
        error: "Too many requests. Please wait a moment and try again.",
        code: rate.capacityExceeded ? "rate_bucket_capacity" : "rate_limited",
        retryAfterSeconds: rate.retryAfterSeconds,
        rate,
        funding,
        budget: null
      };
    }

    if (typeof args.execute !== "function") {
      return guardFailure(new RequestGuardError(500, "missing_executor", "The guarded request has no executor."), { rate, funding });
    }

    const authorization = authorizeBillableRequest(req, {
      ...authDefaults,
      ...(args.auth || {}),
      payload,
      funding
    });
    if (!authorization.allowed) {
      return {
        ok: false,
        status: authorization.status,
        error: authorization.error,
        code: authorization.code,
        rate,
        funding,
        budget: null
      };
    }

    const keyResult = requestIdempotencyKey(req);
    if (!keyResult.ok) {
      return {
        ok: false,
        status: 400,
        error: keyResult.error,
        code: "invalid_idempotency_key",
        rate,
        funding,
        budget: null
      };
    }

    let fingerprint;
    try {
      fingerprint = idempotencyFingerprint(endpoint, payload);
    } catch {
      return {
        ok: false,
        status: 400,
        error: "The request payload cannot be safely fingerprinted.",
        code: "invalid_idempotency_payload",
        rate,
        funding,
        budget: null
      };
    }

    const estimatedTokens = estimatedTokenCount(payload, args.estimatedTokens, endpoint);
    const scope = `${endpoint}:${idempotencyPrincipal(req, payload, funding, authorization)}`;

    try {
      const idempotent = await idempotencyStore.execute({
        key: keyResult.key,
        scope,
        fingerprint,
        signal: args.signal
      }, async (idempotencyContext = {}) => {
        const slot = await Promise.resolve(concurrencyGate.acquire());
        if (!slot.allowed) {
          throw new RequestGuardError(503, "concurrency_limit", "The service is at its concurrency limit.", {
            retryAfterSeconds: slot.retryAfterSeconds
          });
        }

        let reservation = null;
        let budget = { applied: false, funding, reason: `${funding}_requests_do_not_consume_server_budget` };
        const executionSignal = combineAbortSignals(args.signal, slot.signal, idempotencyContext.signal);
        try {
          if (funding === "server") {
            reservation = await Promise.resolve(dailyBudget.reserve({
              calls: 1,
              tokens: estimatedTokens,
              reservationId: idempotencyContext.ownerId
            }));
            if (!reservation.allowed) {
              throw new RequestGuardError(429, reservation.reason, "The server-funded daily budget has been reached.", {
                retryAfterSeconds: reservation.retryAfterSeconds,
                budget: reservation
              });
            }
          }

          try {
            idempotencyContext.markExecutionStarted?.();
            const value = await args.execute({ funding, rate, signal: executionSignal });
            if (reservation) {
              const actualTokens = tokenUsageFromResult(value);
              try {
                budget = await Promise.resolve(reservation.settle({ tokens: actualTokens ?? estimatedTokens }));
              } catch {
                // The conservative reservation already counts as spent. A
                // settlement outage must not discard a completed model result
                // and invite the client to pay for the same work again.
                budget = {
                  ...(typeof reservation.snapshot === "function" ? reservation.snapshot() : {}),
                  applied: true,
                  settlementStatus: "estimated"
                };
              }
            }
            return { value, budget };
          } catch (error) {
            // Once execution starts, keep the conservative reservation on error:
            // a failed/timed-out provider may still have billed the request.
            if (reservation) {
              try {
                budget = await Promise.resolve(reservation.settle({ tokens: estimatedTokens }));
              } catch {
                budget = {
                  ...(typeof reservation.snapshot === "function" ? reservation.snapshot() : {}),
                  applied: true,
                  settlementStatus: "estimated"
                };
              }
            }
            if (error instanceof RequestGuardError) {
              if (!error.budget) error.budget = budget;
              throw error;
            }
            throw new RequestGuardError(500, "execution_failed", publicError(error), { budget });
          }
        } finally {
          await Promise.resolve(slot.release());
        }
      });

      return {
        ok: true,
        value: idempotent.value.value,
        replayed: idempotent.status === "replayed",
        coalesced: idempotent.status === "joined",
        idempotencyStatus: idempotent.persistenceConfirmed === false
          ? `${idempotent.status}-unconfirmed`
          : idempotent.status,
        rate,
        funding,
        authenticated: authorization.authenticated,
        budget: idempotent.value.budget
      };
    } catch (error) {
      return guardFailure(error, { rate, funding });
    }
  }

  return {
    run,
    inspect: () => ({
      rate: rateLimiter.inspect(),
      concurrency: concurrencyGate.inspect(),
      budget: dailyBudget.inspect(),
      idempotency: idempotencyStore.inspect()
    })
  };
}

const defaultConcurrencyGate = sharedCoordinationEnabled
  ? sharedGuardAdapters.concurrencyGate
  : createConcurrencyGate();
const defaultDailyBudget = sharedCoordinationEnabled
  ? sharedGuardAdapters.dailyBudget
  : createDailyBudget();
const defaultIdempotencyStore = sharedCoordinationEnabled
  ? sharedGuardAdapters.idempotencyStore
  : createIdempotencyStore();
const defaultBillableRequestGuard = createBillableRequestGuard({
  rateLimiter: defaultRateLimiter,
  concurrencyGate: defaultConcurrencyGate,
  dailyBudget: defaultDailyBudget,
  idempotencyStore: defaultIdempotencyStore
});

function runBillableRequest(args) {
  return defaultBillableRequestGuard.run(args);
}

function acquireConcurrencySlot() {
  return defaultConcurrencyGate.acquire();
}

function reserveDailyBudget(usage) {
  return defaultDailyBudget.reserve(usage);
}

function requestGuardBackend() {
  const ready = sharedGuardAdapters.ready !== false;
  const health = typeof sharedGuardAdapters.health === "function"
    ? sharedGuardAdapters.health()
    : { verified: !sharedCoordinationEnabled, lastSuccessAt: null, lastFailureAt: null };
  return {
    backend: sharedCoordinationEnabled ? "upstash" : "memory",
    ready,
    configured: sharedCoordinationEnabled,
    distributed: sharedCoordinationEnabled && ready,
    verified: health.verified,
    lastSuccessAt: health.lastSuccessAt,
    lastFailureAt: health.lastFailureAt
  };
}

function validateOptimizerPayload(body) {
  const result = optimizerPayloadSchema.safeParse(body || {});
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    error: result.error.issues[0]?.message || "Invalid request"
  };
}

function validateWith(schema, body) {
  const result = schema.safeParse(body || {});
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.issues[0]?.message || "Invalid request" };
}

function validateA2APayload(body) {
  return validateWith(a2aPayloadSchema, body);
}

function validateGeneratePayload(body) {
  return validateWith(generatePayloadSchema, body);
}

function publicError(error) {
  if (!error) return "Unexpected error";
  if (error.name === "AbortError") return "The model request timed out or was cancelled";
  return safeErrorMessage(error);
}

// Returns an AbortSignal that fires when the client disconnects before the
// response finishes, so in-flight provider calls stop instead of running on.
function abortSignalOnClose(res) {
  const controller = new AbortController();
  res.on?.("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}

function commonHeaders(rate) {
  return {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...(rate ? {
      "x-ratelimit-limit": String(rate.limit),
      "x-ratelimit-remaining": String(rate.remaining),
      "x-ratelimit-reset": String(Math.ceil(rate.resetAt / 1_000)),
      "x-ratelimit-scope": rate.scope
    } : {})
  };
}

module.exports = {
  RequestGuardError,
  acquireConcurrencySlot,
  abortSignalOnClose,
  authorizeBillableRequest,
  clientKey,
  classifyProviderConfigFunding,
  commonHeaders,
  constantTimeSecretEqual,
  createBillableRequestGuard,
  createConcurrencyGate,
  createDailyBudget,
  createIdempotencyStore,
  createRateLimiter,
  estimateBillableTokens,
  idempotencyFingerprint,
  publicError,
  requestIdempotencyKey,
  reserveDailyBudget,
  requestGuardBackend,
  runBillableRequest,
  takeRateLimit,
  tokenUsageFromResult,
  validateA2APayload,
  validateGeneratePayload,
  validateIdempotencyKey,
  validateOptimizerPayload
};

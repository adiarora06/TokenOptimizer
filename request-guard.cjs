const { z } = require("zod");
const net = require("node:net");
const { safeErrorMessage } = require("./core/security.cjs");

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
const buckets = new Map();

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
    timeoutMs: z.number().int().min(5_000).max(120_000).optional(),
    mode: z.string().max(80).optional()
  }).passthrough().optional(),
  providerConfig: providerConfigSchema.optional()
}).passthrough();

const a2aPayloadSchema = z.object({
  input: requiredString("Missing input").trim().min(1, "Missing input").max(MAX_INPUT_CHARS, `Input exceeds ${MAX_INPUT_CHARS.toLocaleString()} characters`),
  providerConfig: providerConfigSchema.optional(),
  options: z.object({
    mode: z.string().trim().max(80).optional(),
    timeoutMs: z.number().int().min(5_000).max(120_000).optional()
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

function takeRateLimit(req, options = {}) {
  const now = Date.now();
  const scope = options.scope === "preparation" ? "preparation" : "billable";
  const profile = RATE_PROFILES[scope];
  const key = `${scope}:${clientKey(req)}`;
  const current = buckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + profile.windowMs }
    : current;
  bucket.count += 1;
  buckets.set(key, bucket);

  if (buckets.size > 1_000) {
    for (const [entryKey, value] of buckets) {
      if (value.resetAt <= now) buckets.delete(entryKey);
    }
  }

  return {
    allowed: bucket.count <= profile.limit,
    scope,
    limit: profile.limit,
    remaining: Math.max(0, profile.limit - bucket.count),
    resetAt: bucket.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000))
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
  abortSignalOnClose,
  clientKey,
  commonHeaders,
  publicError,
  takeRateLimit,
  validateA2APayload,
  validateGeneratePayload,
  validateOptimizerPayload
};

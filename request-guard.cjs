const { z } = require("zod");

const MAX_INPUT_CHARS = Number(process.env.TOKEN_OPTIMIZER_MAX_INPUT_CHARS || 80_000);
const WINDOW_MS = Number(process.env.TOKEN_OPTIMIZER_RATE_WINDOW_MS || 60_000);
const MAX_REQUESTS = Number(process.env.TOKEN_OPTIMIZER_RATE_MAX || 20);
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

// Keyed by IP only. Client-supplied identifiers (like the optional device
// header) must not shape the key, or a client could mint fresh buckets at will.
function clientKey(req) {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "unknown";
}

function takeRateLimit(req) {
  const now = Date.now();
  const key = clientKey(req);
  const current = buckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + WINDOW_MS }
    : current;
  bucket.count += 1;
  buckets.set(key, bucket);

  if (buckets.size > 1_000) {
    for (const [entryKey, value] of buckets) {
      if (value.resetAt <= now) buckets.delete(entryKey);
    }
  }

  return {
    allowed: bucket.count <= MAX_REQUESTS,
    limit: MAX_REQUESTS,
    remaining: Math.max(0, MAX_REQUESTS - bucket.count),
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
  return String(error.message || error).slice(0, 500);
}

function commonHeaders(rate) {
  return {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...(rate ? {
      "x-ratelimit-limit": String(rate.limit),
      "x-ratelimit-remaining": String(rate.remaining),
      "x-ratelimit-reset": String(Math.ceil(rate.resetAt / 1_000))
    } : {})
  };
}

module.exports = {
  commonHeaders,
  publicError,
  takeRateLimit,
  validateA2APayload,
  validateGeneratePayload,
  validateOptimizerPayload
};

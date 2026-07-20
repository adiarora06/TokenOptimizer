const SECRET_PATTERNS = [
  { label: "Private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { label: "OpenAI-style API key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { label: "Groq API key", pattern: /\bgsk_[A-Za-z0-9_-]{20,}\b/g },
  { label: "Google API key", pattern: /\bAIza[A-Za-z0-9_-]{24,}\b/g },
  { label: "AWS access key ID", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: "GitHub token", pattern: /\b(?:(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { label: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { label: "Stripe secret key", pattern: /\b[sr]k_live_[A-Za-z0-9]{16,}\b/g },
  { label: "JSON Web Token", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { label: "Bearer token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*\b/gi },
  { label: "Environment secret", pattern: /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))\s*=\s*([^\s"']{12,})/g }
];

function redactSensitiveText(value) {
  let text = String(value || "");
  const redactions = [];
  for (const item of SECRET_PATTERNS) {
    text = text.replace(item.pattern, (...matches) => {
      redactions.push(item.label);
      if (item.label === "Environment secret") return `${matches[1]}=[REDACTED_SECRET]`;
      return "[REDACTED_SECRET]";
    });
  }
  return {
    text,
    count: redactions.length,
    types: [...new Set(redactions)]
  };
}

// String-level guard only: a public hostname that resolves to a private IP
// (DNS rebinding) is not caught here. A full fix resolves DNS before checking.
function assertSafeProviderEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("Provider endpoint must be a valid URL");
  }
  if (!['http:', 'https:'].includes(endpoint.protocol)) {
    throw new Error("Provider endpoint must use HTTP or HTTPS");
  }
  if (endpoint.username || endpoint.password) {
    throw new Error("Provider endpoint must not contain URL credentials");
  }

  const host = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateHost = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
    host === "::1" || host === "0.0.0.0" || host === "169.254.169.254" ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host);
  const allowPrivate = process.env.NODE_ENV !== "production" || process.env.TOKEN_OPTIMIZER_ALLOW_PRIVATE_ENDPOINTS === "1";
  if (privateHost && !allowPrivate) {
    throw new Error("Private provider endpoints are disabled in production");
  }
  if (process.env.NODE_ENV === "production" && endpoint.protocol !== "https:" && !allowPrivate) {
    throw new Error("Provider endpoints must use HTTPS in production");
  }
  return endpoint.toString();
}

module.exports = {
  SECRET_PATTERNS,
  assertSafeProviderEndpoint,
  redactSensitiveText
};

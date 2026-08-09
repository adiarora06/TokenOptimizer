const dns = require("node:dns").promises;
const net = require("node:net");

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

function safeErrorMessage(error, fallback = "Unexpected error") {
  const raw = String(error?.message || error || fallback);
  const redacted = redactSensitiveText(raw).text.trim();
  return (redacted || fallback).slice(0, 500);
}

function privateEndpointsAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.TOKEN_OPTIMIZER_ALLOW_PRIVATE_ENDPOINTS === "1";
}

function parseIpv4(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.map(Number);
}

function isPublicIpv4(value) {
  const parts = parseIpv4(value);
  if (!parts) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function parseIpv6(value) {
  let address = String(value || "").toLowerCase().split("%")[0];
  if (address.includes(".")) {
    const lastColon = address.lastIndexOf(":");
    const ipv4 = parseIpv4(address.slice(lastColon + 1));
    if (!ipv4) return null;
    address = `${address.slice(0, lastColon)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }
  if ((address.match(/::/g) || []).length > 1) return null;
  const [leftText, rightText] = address.split("::");
  const left = leftText ? leftText.split(":") : [];
  const right = rightText ? rightText.split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((address.includes("::") && missing < 1) || (!address.includes("::") && missing !== 0)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((result, group) => (result << 16n) + BigInt(parseInt(group, 16)), 0n);
}

function matchesIpv6Prefix(value, prefix, bits) {
  const shift = 128n - BigInt(bits);
  return (value >> shift) === (prefix >> shift);
}

function isPublicIpv6(value) {
  const address = parseIpv6(value);
  if (address == null) return false;

  // Only globally routable unicast space is accepted. Explicit exclusions
  // cover documentation and transition ranges that can embed another address.
  const globalUnicast = (address >> 125n) === 1n; // 2000::/3
  if (!globalUnicast) return false;
  const blockedPrefixes = [
    [parseIpv6("2001:db8::"), 32],
    [parseIpv6("2001:2::"), 48],
    [parseIpv6("2001:10::"), 28],
    [parseIpv6("2001::"), 32],
    [parseIpv6("2002::"), 16]
  ];
  return !blockedPrefixes.some(([prefix, bits]) => matchesIpv6Prefix(address, prefix, bits));
}

function isPublicIpAddress(value) {
  const family = net.isIP(String(value || "").split("%")[0]);
  if (family === 4) return isPublicIpv4(value);
  if (family === 6) return isPublicIpv6(value);
  return false;
}

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
  const family = net.isIP(host);
  const privateHost = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
    host.endsWith(".internal") || host === "home.arpa" || host.endsWith(".home.arpa") ||
    (family > 0 && !isPublicIpAddress(host));
  const allowPrivate = privateEndpointsAllowed();
  if (privateHost && !allowPrivate) {
    throw new Error("Private provider endpoints are disabled in production");
  }
  if (process.env.NODE_ENV === "production" && endpoint.protocol !== "https:" && !allowPrivate) {
    throw new Error("Provider endpoints must use HTTPS in production");
  }
  return endpoint.toString();
}

async function resolveSafeProviderEndpoint(value, options = {}) {
  const safeUrl = assertSafeProviderEndpoint(value);
  const endpoint = new URL(safeUrl);
  const host = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const literalFamily = net.isIP(host);

  if (privateEndpointsAllowed()) {
    return {
      endpoint,
      addresses: literalFamily ? [{ address: host, family: literalFamily }] : []
    };
  }

  if (literalFamily) {
    return { endpoint, addresses: [{ address: host, family: literalFamily }] };
  }

  const lookup = options.lookup || dns.lookup.bind(dns);
  let addresses;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("Provider endpoint DNS lookup failed");
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error("Provider endpoint DNS lookup returned no addresses");
  }
  if (addresses.some((item) => !isPublicIpAddress(item.address))) {
    throw new Error("Private provider endpoints are disabled in production");
  }
  return {
    endpoint,
    addresses: addresses.map((item) => ({ address: item.address, family: Number(item.family) }))
  };
}

module.exports = {
  SECRET_PATTERNS,
  assertSafeProviderEndpoint,
  isPublicIpAddress,
  resolveSafeProviderEndpoint,
  redactSensitiveText,
  safeErrorMessage
};

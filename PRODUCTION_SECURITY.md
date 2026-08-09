# Production Security Runbook

Token Optimizer uses complementary request-control layers. The application guard provides authorization, rate, concurrency, budget, and duplicate-request protection. Its dependency-free memory backend is process-local; the optional Upstash Redis REST backend makes those decisions atomic across regions, cold starts, and horizontally scaled instances. Vercel Firewall and provider hard-spend limits remain defense in depth.

## Application controls

- Server-funded model routes fail closed in production. Configure `TOKEN_OPTIMIZER_ACCESS_TOKEN` and send it as a bearer token, or deliberately set `TOKEN_OPTIMIZER_ALLOW_PUBLIC_FUNDED=1` for a public funded demo.
- Offline and caller-funded BYOK requests remain available without the deployment bearer token. They still pass through rate, concurrency, and idempotency controls, but they do not consume the server-funded daily allowance.
- Billable model routes default to 20 requests per IP per 60 seconds.
- Zero-model-call prompt preparation has a separate 60 requests per IP per 60 seconds bucket, so preparation traffic cannot exhaust the model-call allowance.
- The per-IP bucket map is hard-capped at 1,000 entries by default. When every slot is active, unknown clients fail closed instead of evicting a live bucket and resetting an attacker's allowance.
- Provider work is capped at four concurrent runs. With shared coordination this is deployment-wide; with memory coordination it applies per warm process.
- Server-funded work is capped at 500 calls and 2,000,000 reserved/actual tokens per UTC day. With shared coordination this is deployment-wide; with memory coordination each warm process has its own allowance. Failed or cancelled provider attempts retain their conservative reservation because the upstream provider may still have billed them.
- Valid `Idempotency-Key` requests are single-flighted, replayed for five minutes, fingerprinted by endpoint and canonical payload, and bounded to 500 cached entries. The store retains only digests for request identity and secret-valued fields.
- Vercel's overwritten `x-forwarded-for` value is trusted only when `VERCEL=1`. Standalone deployments use the socket address unless `TOKEN_OPTIMIZER_TRUST_PROXY=1` is explicitly configured behind a proxy that overwrites the header.
- Input characters, output tokens, response bytes, workflow duration, provider redirects, and custom provider network destinations are bounded separately.
- Caller-selected models and LiteLLM base URLs are honored only when the caller supplies its own API credential. Requests that use server-managed credentials stay on the server-configured model and endpoint.
- Provider-controlled error text is redacted before it is returned to the browser or saved in workflow history.
- Failed fallback attempts expose only classified status messages, never raw provider-controlled error text.
- Public workflow responses use an allowlist and recursively redact configured secret values. Raw executor output, raw contract output, generation records, and unknown intermediate fields never cross the API boundary.
- Production telemetry is metadata-only: prompts, results, model names, provider error text, credentials, source labels, and session IDs are excluded by construction.
- The public system overview exposes aggregate counters only. Individual metadata events remain inside the bounded process-local buffer and structured deployment logs.

The defaults and supported overrides are documented in `.env.local.example`.

## Funding access policy

Generate a strong access token and configure it only on the server:

```bash
openssl rand -hex 32
```

```env
TOKEN_OPTIMIZER_ACCESS_TOKEN=<generated value>
TOKEN_OPTIMIZER_ALLOW_PUBLIC_FUNDED=0
```

API clients send `Authorization: Bearer <generated value>`. The public browser workspace intentionally does not embed this server secret. To operate a deliberately public funded demo, set `TOKEN_OPTIMIZER_ALLOW_PUBLIC_FUNDED=1` and retain the daily, concurrency, provider-spend, and firewall limits. The A2A/BYOK surface can instead use a caller-supplied provider credential; that value is not persisted in workflow results or idempotency state.

Choose the access mode deliberately:

| Mode | Configuration | Intended client |
|---|---|---|
| Private funded API | Access token set; public funding off | API clients that send the bearer token |
| Public funded workspace | `TOKEN_OPTIMIZER_ALLOW_PUBLIC_FUNDED=1` | Browser Workspace or unauthenticated demo clients |
| Caller funded | BYOK provider configuration | A2A clients supplying their own provider key |
| No provider spend | Offline provider | Local preparation and deterministic offline optimization |

The browser Workspace does not send the deployment bearer secret. Therefore private funded API mode intentionally returns `401` for funded Workspace runs; use BYOK/offline or explicitly operate a public funded demo instead.

## Deployment-wide shared coordination

The default `memory` backend remains suitable for local development and single-process deployments. It coordinates concurrent requests handled by one warm process, including Fluid Compute concurrency, but does not cross regions, cold starts, or horizontally scaled instances.

For deployment-wide enforcement, provision the Upstash Redis Free plan through the Vercel Marketplace, link it to the intended Vercel project environments, and configure these server-only values:

```env
TOKEN_OPTIMIZER_SHARED_GUARD_BACKEND=upstash
UPSTASH_REDIS_REST_URL=<injected REST URL>
UPSTASH_REDIS_REST_TOKEN=<injected standard REST token>
TOKEN_OPTIMIZER_SHARED_GUARD_SECRET=<separate random secret>
# Optional; otherwise project + production/preview/development are isolated automatically.
TOKEN_OPTIMIZER_SHARED_GUARD_NAMESPACE=<stable environment-specific namespace>
```

Generate the separate encryption/HMAC secret with `openssl rand -base64 32` and redeploy. `ready: true` in `/api/system-overview` means configuration is complete; `verified: true` appears after the process successfully reaches Redis. The app also recognizes the legacy `KV_REST_API_URL` and `KV_REST_API_TOKEN` aliases. A TCP-only `REDIS_URL` is not sufficient. No Redis package is required because the implementation uses the Node 18+ `fetch` API directly. Never expose any of these values to browser code.

Use one stable shared secret across every live instance in a namespace. Give production, preview, and development separate namespaces or databases. Rotate the secret only during a quiescent deployment window after short-lived idempotency entries have expired; mixed old/new secrets temporarily split rate and replay identities.

The shared backend uses atomic Redis scripts rather than non-atomic pipelines. It provides:

- Fixed-window rate decisions and a bounded active-client index.
- Expiring global concurrency leases with ownership-safe renewal and release.
- Atomic daily budget reservations with idempotent settlement for each reservation, keyed to the original UTC day. Ambiguous crashes may conservatively count an additional retry rather than risk undercounting spend.
- Cross-instance idempotency claims, pending-owner heartbeats, conflict detection, a bounded five-second join, and five-minute replay. Ownership operations retry with stable IDs so a committed-but-lost REST response does not create a second admission.
- HMAC-derived Redis identities. Completed public results are AES-256-GCM encrypted before their short replay window; raw provider stages and credentials are never stored.

CI starts a disposable Redis 7 service and runs every Lua script against the real interpreter on Node 20 and 22. Local `npm test` stays zero-setup and reports the smoke test as skipped when `TOKEN_OPTIMIZER_REDIS_SMOKE_URL` is unset; use `npm run test:redis-smoke` with a local disposable Redis 7 instance before changing any script.

Encrypted replay values are capped at 1.5 MB by default. Larger completed results leave an encrypted-free tombstone for the replay window: the original caller receives its result, while a duplicate receives `409 idempotency_result_unavailable` instead of repeating the provider call. A timeout, disconnect, or lease loss after provider execution begins also leaves an owner-fenced replay-window tombstone, because the upstream request may already have been accepted or billed. If Redis completion remains unconfirmed after bounded retries, the response header reports `x-idempotency-status: started-unconfirmed` and the pending lease continues blocking immediate duplicates until expiry.

Selecting `upstash` with missing, invalid, or unreachable shared configuration fails closed with `503 coordination_unavailable`. It never silently drops back to per-instance memory. Cleanup failures after a model result completes do not discard the result: conservative spend remains reserved and expiring leases self-heal.

Shared coordination reduces application-level overspend and duplication, but no application lock can guarantee exactly-once execution after an upstream provider call if the worker crashes before recording completion. Keep provider account/project hard-spend limits and Vercel Firewall enabled.

This backend shares guard decisions and short-lived encrypted replays only. It does not make browser history, telemetry buffers, or local `/api/system-runs` queue records durable.

For a zero-cost hobby deployment, keep the default 1,000 ms duplicate poll interval and five-second join wait, monitor command usage, and retain TTLs. Upstash's free allowance and availability terms can change and do not provide a production availability guarantee; confirm the current limits on the [official pricing page](https://upstash.com/pricing/redis) and [FAQ](https://upstash.com/docs/redis/help/faq). For higher-availability workloads, use an appropriate paid datastore tier while keeping the same adapter contract.

With the default 2.5-second Redis request timeout, the 220-second concurrency and pending leases are safety minimums for the 120-second workflow ceiling plus renewal/outage margin. The required minimum grows automatically with a longer Redis timeout (up to 310 seconds at the supported 30-second maximum). Shared coordination fails closed at startup when either lease is too short for that timeout, or when the replay TTL is shorter than the pending lease; do not reduce these values to save Redis commands.

## Telemetry operations

- `TOKEN_OPTIMIZER_TELEMETRY_LOG` defaults to enabled when `NODE_ENV=production`. Set it to `0` for no structured logs or `1` to enable logs in another environment.
- `TOKEN_OPTIMIZER_TELEMETRY_MAX_EVENTS` controls the process-local ring buffer and is clamped between 10 and 5,000 events.
- Structured records use `kind=token_optimizer.telemetry`, with `provider_attempt` and `workflow_run` event types.
- Fallback policy calls include their one-based attempt number; `fallbackRetry=true` only after the first provider was attempted.
- Failure messages are reduced to fixed codes such as `timeout`, `rate_limit`, `configuration`, `security_policy`, and `provider_unavailable` before storage.
- Serverless instances do not share the in-memory buffer. Use the structured log stream for deployment-wide dashboards and alerting.
- The deployment analyzer accepts only schema-versioned `token_optimizer.telemetry` events and discards unrelated log text. See `TELEMETRY_OPERATIONS.md` for commands and alert response.

## Vercel Firewall rollout

The linked `tok` project currently has one unpublished draft:

- Rule: `Observe billable AI API rate`
- Rule ID: `rule_observe_billable_ai_api_rate_6fYFGt`
- Match: `POST` to `/api/generate`, `/api/optimize-run`, `/api/optimize-stream`, `/api/workflow-run`, `/api/a2a-run`, or `/api/system-runs`
- Threshold: 60 requests per IP per 60 seconds
- Exceeded action: log only

The observation rule does not affect production until a project owner publishes it. Review the exact draft first:

```bash
npx --yes vercel@latest firewall rules inspect "Observe billable AI API rate" --json
npx --yes vercel@latest firewall diff --json
```

When ready to begin the observation period, a project owner can publish the log-only rule:

```bash
npx --yes vercel@latest firewall publish --yes
```

Review matching traffic at:

```text
https://vercel.com/adi-a/tok/firewall/traffic?filter=rule_observe_billable_ai_api_rate_6fYFGt
```

Keep the rule in log-only mode until normal production traffic has been reviewed. Then test enforcement on preview before changing production to a `rate_limit`, `challenge`, or `deny` action. Firewall counters are regional, so retain the application limiter as defense in depth.

To abandon the unpublished draft instead:

```bash
npx --yes vercel@latest firewall discard --yes
```

## Operational checks

1. Confirm the firewall diff contains only the intended rule.
2. Publish log-only observation.
3. Review at least one representative traffic window.
4. Set a limit above legitimate burst traffic and test it on preview.
5. Publish enforcement and monitor 429s, provider spend, and user reports.
6. Return the rule to log-only mode immediately if legitimate users are affected.

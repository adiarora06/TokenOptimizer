# Production Security Runbook

Token Optimizer uses two complementary request-control layers. The application limiter provides immediate feedback and local-development protection. Vercel Firewall provides the deployment-wide counter that serverless instances cannot share in memory.

## Application controls

- Billable model routes default to 20 requests per IP per 60 seconds.
- Zero-model-call prompt preparation has a separate 60 requests per IP per 60 seconds bucket, so preparation traffic cannot exhaust the model-call allowance.
- Vercel's overwritten `x-forwarded-for` value is trusted only when `VERCEL=1`. Standalone deployments use the socket address unless `TOKEN_OPTIMIZER_TRUST_PROXY=1` is explicitly configured behind a proxy that overwrites the header.
- Input characters, output tokens, response bytes, workflow duration, provider redirects, and custom provider network destinations are bounded separately.
- Caller-selected models and LiteLLM base URLs are honored only when the caller supplies its own API credential. Requests that use server-managed credentials stay on the server-configured model and endpoint.
- Provider-controlled error text is redacted before it is returned to the browser or saved in workflow history.
- Failed fallback attempts expose only classified status messages, never raw provider-controlled error text.

The defaults and supported overrides are documented in `.env.local.example`.

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

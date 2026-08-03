# Telemetry Operations

Token Optimizer emits metadata-only `provider_attempt` and `workflow_run` records under `kind=token_optimizer.telemetry`. The deployment report combines those records across function instances and evaluates one alert policy over the selected log window.

## Quick report

Export recent Vercel runtime logs and pipe them into the analyzer:

```bash
npx vercel logs --environment production --source serverless --since 1h --json \
  | npm run telemetry:report -- --input -
```

The analyzer accepts raw event JSON, newline-delimited JSON, JSON arrays, and Vercel log wrappers whose `message`, `text`, `payload`, or `data` field contains the structured event. Unrelated records are counted and discarded without being copied into the report.

Use JSON output for a dashboard, CI step, or scheduled monitor:

```bash
npm run telemetry:report -- --input runtime-logs.ndjson --json
```

By default the command exits with code `2` only when health is critical. Use `--fail-on warning` to return `1` for warnings, or `--fail-on never` for display-only reporting.

## Default alert policy

Rates and latency are evaluated only after the selected window contains at least 10 provider attempts or 10 workflow runs. Until then, health is `insufficient_data` unless an enabled spend threshold is crossed.

| Signal | Warning | Critical |
| --- | ---: | ---: |
| Provider failure rate | 10% | 25% |
| Workflow failure rate | 10% | 25% |
| Fallback-chain retry rate | 10% | 25% |
| Provider p95 latency | 10,000 ms | 30,000 ms |
| Estimated cost | Disabled | Disabled |

Thresholds can be overridden with the `TOKEN_OPTIMIZER_ALERT_*` environment variables documented in `.env.local.example`. When a warning value is accidentally higher than its critical value, the analyzer orders the pair from lower to higher rather than creating an inverted policy.

## Vercel operation

1. Deploy the telemetry-enabled source and leave `TOKEN_OPTIMIZER_TELEMETRY_LOG` unset or set it to `1` in production.
2. Run one request through a billable endpoint and query runtime logs for `token_optimizer.telemetry` within the plan's retention window.
3. Run the report over a representative window and adjust thresholds only after normal traffic is visible.
4. On Pro or Enterprise, configure a Vercel Drain for production function logs when a durable, deployment-wide history is required. Scope it to this project and verify Vercel's signature against the raw request body at the collector.
5. Feed drained NDJSON into the same analyzer or map its `health.metrics` fields into the monitoring vendor. Alert on `health.status=critical`; treat warnings as investigation signals until the baseline is stable.

Vercel runtime logs are sufficient for manual and scheduled checks within their retention window. A Drain or monitoring integration is required for durable history and external notifications. No provider keys, prompt text, result text, model names, raw errors, source labels, or session IDs are present in the emitted events.

## Alert response

- **Provider failures:** inspect `failures.providerAttempts` and the per-provider breakdown. Configuration failures should be fixed before sending more traffic.
- **Fallback retries:** check the primary provider for rate limits, timeout pressure, or an outage.
- **p95 latency:** compare provider averages and workflow stages, then review output limits and timeout budgets.
- **Workflow failures:** inspect workflow failure codes and affected API routes before promoting another release.
- **Estimated cost:** compare route mix, model-call count, and token totals with the selected window.

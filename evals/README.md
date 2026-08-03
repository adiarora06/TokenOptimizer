# Evaluation Harness

The evaluation harness measures whether Token Optimizer preserves intent while choosing the expected route and reducing avoidable prompt repetition. It has two deliberately separate modes.

## Deterministic evaluation

```bash
npm run eval
```

This mode is free, makes no network requests, and runs in CI through `npm run test:eval`. Every case checks:

- expected direct, contract, or full routing;
- retention of explicit task and constraint anchors;
- removal of known credentials and forbidden content;
- zero provider calls during portable preparation;
- stability when a prepared prompt is prepared again;
- raw and prepared token estimates, including honest zero-savings cases.

Thresholds live in `thresholds.json`. The suite fails when any correctness rate falls below its threshold, too few cases become smaller, aggregate savings regress, or any prepared prompt becomes larger.

Useful diagnostics:

```bash
npm run eval -- --case code_group_by
npm run eval:json
```

## Live baseline comparison

```bash
npm run eval:live -- --provider openai
```

Live mode is opt-in because it uses configured provider credentials and incurs model calls. Each enabled case runs:

1. one raw single-call baseline;
2. the normal adaptive Token Optimizer workflow;
3. the same objective output checks against both results.

It reports quality score, actual provider tokens, elapsed time, cost when configured, route, and model-call count. It does not use another model as a judge. Depending on the selected route, a case uses one baseline call plus one to three adaptive calls.

Options:

```bash
npm run eval:live -- --provider groq
npm run eval:live -- --provider openai --case structured_incident_json
npm run eval:live -- --provider openai --timeout-ms 60000 --json
```

## Adding a case

Add a stable, representative prompt to `cases.json` with:

- a unique `id` and product `category`;
- the expected route or allowed routes;
- literal `mustRetain` anchors that express important intent;
- `mustRemove` values and `expectedRedactions` when applicable;
- objective `outputChecks` for cases that can run live;
- `live: true` only when the checks are deterministic enough to compare providers.

Avoid subjective style-only checks. Prefer exact arithmetic, JSON keys, required API paths, named functions, and explicit safety constraints.

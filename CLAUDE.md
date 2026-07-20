# Token Optimizer Collaboration Guide

Token Optimizer is a browser-based adaptive LLM workflow that turns one rough request into a compact route, a completed result, measured usage, and an inspectable coordinator trace.

## Start With The Graph

Use the committed Graphify artifacts before scanning the repository broadly:

- `graphify-out/graph.json`: machine-readable code knowledge graph.
- `graphify-out/GRAPH_REPORT.md`: hubs, communities, connections, and architecture questions.
- `graphify-out/graph.html`: interactive local graph, also published at `/code-graph`.
- `.mcp.json`: project MCP declaration for Graphify tools in Claude Code.

Useful Graphify queries:

```bash
graphify query "show the adaptive optimization flow"
graphify explain "runSelfOptimizingWorkflow"
graphify path "outputs_workspace_run" "optimizer_core_runselfoptimizingworkflow"
```

If Graphify is not installed locally:

```bash
uv tool install "graphifyy[mcp]"
```

## Architecture Entry Points

- `optimizer-core.cjs`: adaptive routing, typed handoff contracts, provider calls, validation, traces, and usage normalization.
- `optimizer-system.cjs`: run lifecycle and stage snapshots.
- `outputs/workspace.js`: streaming workspace client, history, usage, and coordinator audit persistence.
- `api/optimize-stream.js`: production SSE workflow endpoint.
- `request-guard.cjs`: request validation, rate limiting, and public error shaping.
- `extensions/gemini-token-optimizer`: Manifest V3 Gemini wrapper and reusable site-adapter bridge.

## Product Constraints

- Keep the default experience one-shot and provider-agnostic.
- Do not expose provider keys or provider selection details in the browser UI.
- Simple prompts should avoid contract-building and verification calls unless they add value.
- The raw prompt belongs at intake; downstream agents should receive compact, typed state.
- Persist coordinator traces with trace ID, agent action, status, duration, route, and failure reason.
- Keep final results collapsed until the user opens them.

## Validation

Run the full suite before publishing:

```bash
npm test
```

Use `npm start` for local browser testing at `http://127.0.0.1:8787`.

After changing architecture, refresh the committed Graphify artifacts:

```bash
uvx --from graphifyy graphify extract . --code-only
uvx --from graphifyy graphify cluster-only .
```

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

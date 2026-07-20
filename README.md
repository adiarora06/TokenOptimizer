# Token Optimizer

Token Optimizer is a browser-based AI workspace built with Node.js and vanilla HTML/CSS/JavaScript that turns one rough request into a completed result through adaptive routing, compact handoff contracts, live execution events, and inspectable usage.

## Run Locally

```bash
npm start
```

Open:

```text
http://127.0.0.1:8787
```

## Product Shape

- **Workspace first**: one prompt box, one run action, live stage updates, measured usage, and a collapsed final result.
- **Adaptive execution**: simple prompts take one direct call, multi-part work uses a compact contract, and high-risk work can add verification.
- **Provider-agnostic UI**: model routing, fallback, timeouts, usage normalization, and optional cost estimates stay on the server.
- **Runs and Insights**: local prompt history, audit traces, session totals, all-time totals, route mix, status mix, and token charts.
- **Inspectable architecture**: agent responsibilities and the hub-and-spoke contract graph share one Architecture page.
- **Graphify code map**: the public app includes a searchable knowledge graph of real files, functions, calls, tests, adapters, and deployment routes.
- **Assistant wrappers**: a Manifest V3 side panel prepares and inserts prompts for Gemini and ChatGPT with zero duplicate provider calls.

## Source Map

- `outputs/workspace.html`: semantic structure for the primary one-shot workspace.
- `outputs/workspace.css`: responsive light/dark application UI and live run states.
- `outputs/workspace.js`: streaming client, local history, usage rendering, file context, result dialog, and continuation flow.
- `outputs/app-nav.css`: shared stable navigation for internal product pages.
- `outputs/open-source.html`: readable workings page for architecture and contribution context.
- `outputs/agent-structure.html`: agent roles plus hub-and-spoke information graph.
- `graphify-out/graph.html`: interactive Graphify repository map published at `/code-graph`.
- `graphify-out/graph.json`: machine-readable repository graph for assistants and MCP tools.
- `graphify-out/GRAPH_REPORT.md`: generated architecture report with hubs, communities, and high-impact connections.
- `outputs/prompt-history.html`: prompt history and side-panel audit log.
- `outputs/stats.html`: session and all-time usage insights.
- `extensions/gemini-token-optimizer`: local unpacked Chrome extension MVP for Gemini.
- `extensions/gemini-token-optimizer/ADAPTERS.md`: reusable site-adapter contract for future AI assistants.
- `extensions/gemini-token-optimizer/PUBLISHING.md`: Chrome Web Store readiness checklist.
- `optimizer-core.cjs`: public entry point for the optimizer core modules.
- `core/`: focused modules for provider adapters, adaptive routing, handoff preparation, the prompt library, secret removal, usage accounting, and the workflow runners.
- `request-guard.cjs`: payload validation, public error shaping, response hardening, and request throttling.
- `api/optimize-stream.js`: hosted server-sent event endpoint for live run progress.
- `api/prepare-handoff.js`: deterministic, zero-model-call prompt preparation for wrappers.
- `server.cjs`: local static server and streaming API implementation.
- `api/*.js`: Vercel function entrypoints, including workflow, compatibility, health, and streamed run routes.

## Optional Provider Keys

Copy the example env file and add rotated keys:

```bash
cp .env.local.example .env.local
```

```env
GROQ_API_KEY=
OPENAI_API_KEY=
```

The browser never stores provider keys. Server routes handle model calls and keep the UI provider-agnostic.

## Typed Contract Workflow

The core optimization pattern is:

1. Read the raw prompt once.
2. Choose the leanest valid route: direct, contract, or full verification.
3. Extract goal, facts, constraints, decisions, sources, open questions, and next action when a contract is useful.
4. Send downstream nodes compact state instead of the full transcript.
5. Save history and audit trail so the run can be inspected later.

## Execution Flow

The browser and orchestration layers are intentionally separate:

1. The browser performs a local token and route preflight while the user types.
2. The workspace posts one validated request to `/api/optimize-stream`.
3. The server emits understandable Understand, Route, Simplify, Execute, and Validate events.
4. The adaptive router selects a direct, contract, or verified workflow.
5. Provider-reported usage is normalized across every model call and returned with the final result.
6. The browser stores prompt history, audit traces, and usage summaries locally.

## Usage Semantics

- **Input/output tokens** use provider-reported totals when available and are labeled as estimates otherwise.
- **Context saved** compares the compact prompts against the planned repeated-input baseline; it is always labeled as an estimate.
- **Cost** appears only when a provider reports it or model pricing rates are configured on the server.
- **Secrets** matching supported key and credential patterns are removed before model transmission.

## Sidecar Wrapper Loop

The background mode is for working beside an active LLM or IDE:

1. Capture the active messy prompt.
2. Prepare it locally through the zero-call handoff endpoint.
3. Review the measured original and prepared token counts.
4. Insert the compact prompt into the target chat box or IDE agent.
5. Review the result and save an audit trail when needed.

## Graphify And Claude

The repository ships with a generated Graphify knowledge graph and project-level Claude guidance. After cloning the repository, Claude can use the graph to locate relevant files and relationships before loading source code.

Open the published graph:

```text
https://tok-pi-gilt.vercel.app/code-graph
```

Regenerate the graph after architecture changes:

```bash
uvx --from graphifyy graphify extract . --code-only
uvx --from graphifyy graphify cluster-only .
```

Optional MCP support for Claude Code is declared in `.mcp.json`. It uses `uvx` to provide Graphify's query, node, neighbor, path, community, and graph-stat tools against `graphify-out/graph.json`.

## Gemini Extension MVP

Load the extension locally:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `extensions/gemini-token-optimizer`.
5. Open `https://gemini.google.com` and click the extension icon.

The extension uses a Chrome side panel. It does not auto-send messages and it does not run a provider model while preparing the prompt. Gemini and ChatGPT ship as reference adapters; the internal adapter bridge can support additional assistants by adding one `adapters/<site>.js` file and a `content_scripts` entry, without changing the core workflow.

## Contributing Principle

Keep the default user path simple. Put complexity behind tabs, expandable panels, or the open-source workings page.

## License

Released under the [MIT License](LICENSE).

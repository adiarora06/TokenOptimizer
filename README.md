# Token Optimizer

Token Optimizer is a browser-based optimized LLM workspace built with Node.js and vanilla HTML/CSS/JavaScript that turns messy prompts into adaptive contract workflows, routes simple tasks directly, and keeps agent internals inspectable.

## Run Locally

```bash
npm start
```

Open:

```text
http://127.0.0.1:8787
```

## Product Shape

- **Workspace first**: one large prompt box, one optimized run action, live status, collapsed final result.
- **System runner**: background preflight, adaptive routing, queued local runs, stage snapshots, and hosted-compatible run objects keep orchestration out of the UI.
- **Sidecar wrappers**: browser, Google-style web LLM, and IDE flows generate copy-ready prompts and file placement kits.
- **Gemini extension MVP**: a Manifest V3 side panel can capture, optimize, and insert prompts on Gemini.
- **Open source second**: contracts, agents, routes, generated files, and audit behavior are documented in `/open-source`.
- **Power pages**: Agents, History, Stats, Settings, and Optimized IDE stay available without crowding the main workflow.

## Source Map

- `outputs/workspace.html`: main browser app and user-facing run flow.
- `outputs/system-worker.js`: background preflight worker for token estimates, constraints, contract preview, and route hints.
- `outputs/open-source.html`: readable workings page for architecture and contribution context.
- `outputs/agent-structure.html`: agent roles plus hub-and-spoke information graph.
- `extensions/gemini-token-optimizer`: local unpacked Chrome extension MVP for Gemini.
- `extensions/gemini-token-optimizer/PUBLISHING.md`: Chrome Web Store readiness checklist.
- `optimizer-system.cjs`: system runner for run IDs, stages, background local execution, and shared run snapshots.
- `optimizer-core.cjs`: adaptive route selection, contract shaping, provider-ready prompts, staged agents, token estimates, and fallback behavior.
- `server.cjs`: thin local server, static routes, API routes, system-run polling, and provider routing.
- `api/system-runs.js`: hosted system-run endpoint that returns the same run snapshot shape as local background jobs.
- `api/*.js`: Vercel function entrypoints, including `/api/workflow-run` and the older `/api/a2a-run` compatibility route.

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

## System Runner

The app now separates product UI from orchestration:

1. The browser worker performs local preflight while the user types.
2. The workspace starts `/api/system-runs` instead of calling the optimizer directly.
3. The local Node server queues a background job and exposes snapshots at `/api/system-runs/:id`.
4. Vercel completes the same run inline and returns the same `run` object shape.
5. The workspace writes final history, audit, and stats from the returned run result.

## Sidecar Wrapper Loop

The background mode is for working beside an active LLM or IDE:

1. Capture the active messy prompt.
2. Compress it in Token Optimizer.
3. Copy the sidecar prompt or wrapper kit.
4. Paste the compact handoff into the target chat box or IDE agent.
5. Review the result and save an audit trail when needed.

## Gemini Extension MVP

Load the extension locally:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `extensions/gemini-token-optimizer`.
5. Open `https://gemini.google.com` and click the extension icon.

The extension uses a Chrome side panel. It does not auto-send Gemini messages; it only inserts the optimized handoff when the user clicks **Insert into Gemini**.

## Contributing Principle

Keep the default user path simple. Put complexity behind tabs, expandable panels, or the open-source workings page.

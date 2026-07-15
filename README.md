# Token Optimizer

Token Optimizer is a browser-based optimized LLM workspace built with Node.js and vanilla HTML/CSS/JavaScript that converts messy prompts into compact A2A handoff contracts, runs staged agents, and keeps the workflow inspectable.

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
- **Open source second**: contracts, agents, routes, generated files, and audit behavior are documented in `/open-source`.
- **Power pages**: Agents, Agent Graph, History, Audit Log, Settings, and Optimized IDE stay available without crowding the main workflow.

## Source Map

- `outputs/workspace.html`: main browser app and user-facing run flow.
- `outputs/open-source.html`: readable workings page for architecture and contribution context.
- `outputs/agent-structure.html`: agent roles plus hub-and-spoke information graph.
- `optimizer-core.cjs`: blank A2A kit, handoff shaping, staged prompts, token estimates, and fallback behavior.
- `server.cjs`: local server, static routes, API routes, and provider routing.
- `api/*.js`: Vercel function entrypoints.

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

## Handoff Contract

The core optimization pattern is:

1. Read the raw prompt once.
2. Extract goal, facts, constraints, decisions, sources, open questions, and next action.
3. Send downstream agents the compact contract instead of the full transcript.
4. Save history and audit trail so the run can be inspected later.

## Contributing Principle

Keep the default user path simple. Put complexity behind tabs, expandable panels, or the open-source workings page.

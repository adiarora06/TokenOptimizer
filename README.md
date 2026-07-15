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
- **Sidecar wrappers**: browser, Google-style web LLM, and IDE flows generate copy-ready prompts and file placement kits.
- **Gemini extension MVP**: a Manifest V3 side panel can capture, optimize, and insert prompts on Gemini.
- **Open source second**: contracts, agents, routes, generated files, and audit behavior are documented in `/open-source`.
- **Power pages**: Agents, Agent Graph, History, Audit Log, Settings, and Optimized IDE stay available without crowding the main workflow.

## Source Map

- `outputs/workspace.html`: main browser app and user-facing run flow.
- `outputs/open-source.html`: readable workings page for architecture and contribution context.
- `outputs/agent-structure.html`: agent roles plus hub-and-spoke information graph.
- `extensions/gemini-token-optimizer`: local unpacked Chrome extension MVP for Gemini.
- `extensions/gemini-token-optimizer/PUBLISHING.md`: Chrome Web Store readiness checklist.
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

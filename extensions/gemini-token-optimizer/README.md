# Token Optimizer for Gemini and ChatGPT

This is a local unpacked Chrome extension for preparing prompts beside Gemini or ChatGPT without paying for a duplicate model call.

## What It Does

- Opens a Chrome side panel on Gemini and ChatGPT.
- Captures selected text or the focused assistant prompt box.
- Sends the prompt to the Token Optimizer preparation endpoint only after user action.
- Uses deterministic preparation with zero provider model calls.
- Removes repeated wrapper text and preserves a reusable portable handoff.
- Inserts the optimized prompt into the active assistant only when you click **Insert into assistant**.
- Supports a one-click **Prepare & insert** action that never auto-submits the message.
- Does not auto-send assistant messages.
- Records token counts and preparation strategy locally without storing provider keys.

## Load Locally

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder:

```text
extensions/gemini-token-optimizer
```

5. Open `https://gemini.google.com` or `https://chatgpt.com`.
6. Click the Token Optimizer extension icon to open the side panel.

## Backend

The extension calls the deployed preparation endpoint:

```text
https://tok-pi-gilt.vercel.app/api/prepare-handoff
```

## Package For Upload Later

From this folder:

```bash
zip -r ../../gemini-token-optimizer-mvp.zip \
  manifest.json service-worker.js content-bridge.js platforms.js adapters \
  sidepanel.html sidepanel.css sidepanel.js icons \
  README.md ADAPTERS.md PUBLISHING.md
```

See `PUBLISHING.md` for the Chrome Web Store readiness checklist.

## Privacy Shape

The extension does not store provider API keys. Prompt text is sent to the deterministic Token Optimizer preparation endpoint only after the user clicks **Prepare only** or **Prepare & insert**.

## Extend The Wrapper

See `ADAPTERS.md` for the site-adapter contract. Gemini and ChatGPT are enabled; future assistants can be added without changing the preparation or side-panel layers.

The same bridge can later support Claude, Copilot, and Perplexity through separate, narrowly scoped adapters and optional permissions.

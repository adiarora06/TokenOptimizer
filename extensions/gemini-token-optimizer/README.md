# Token Optimizer for Gemini

This is a local unpacked Chrome extension for preparing prompts beside Gemini without paying for a duplicate model call.

## What It Does

- Opens a Chrome side panel on `https://gemini.google.com/*`.
- Captures selected text or the focused Gemini prompt box.
- Sends the prompt to the Token Optimizer preparation endpoint only after user action.
- Uses deterministic preparation with zero provider model calls.
- Removes repeated wrapper text and preserves a reusable portable handoff.
- Inserts the optimized prompt into Gemini only when you click **Insert into Gemini**.
- Supports a one-click **Prepare & insert** action that never auto-submits Gemini.
- Does not auto-send the Gemini message.
- Records token counts and preparation strategy locally without storing provider keys.

## Load Locally

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder:

```text
extensions/gemini-token-optimizer
```

5. Open `https://gemini.google.com`.
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

See `ADAPTERS.md` for the site-adapter contract. Gemini remains the only enabled production permission; future assistants can be added without changing the preparation or side-panel layers.

The same bridge can later support ChatGPT, Claude, Copilot, and Perplexity through separate, narrowly scoped adapters and optional permissions.

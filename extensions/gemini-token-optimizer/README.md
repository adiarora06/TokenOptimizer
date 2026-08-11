# Token Optimizer for Gemini™ and ChatGPT

This is a local unpacked Chrome extension for preparing prompts beside Gemini™ or ChatGPT without paying for a duplicate model call.

## What It Does

- Opens a Chrome side panel on Gemini™ and ChatGPT.
- Captures selected text or the focused assistant prompt box.
- Sends the prompt to the Token Optimizer preparation endpoint only after user action.
- Requires explicit in-product consent before a prompt can be sent for preparation.
- Uses deterministic preparation with zero provider model calls.
- Removes repeated wrapper text and preserves a reusable portable handoff.
- Inserts the optimized prompt into the active assistant only when you click **Insert into assistant**.
- Supports a one-click **Prepare & insert** action that never auto-submits the message.
- Does not auto-send assistant messages.
- Shows token counts and preparation strategy for the current side-panel session without storing usage history or provider keys.

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

## Package For Chrome Web Store Upload

From the repository root:

```bash
npm run test:extension
npm run package:extension
```

This builds `token-optimizer-chrome-v0.2.0.zip` from a fixed runtime allowlist, verifies every manifest and side-panel reference, checks the archive, and prints its SHA-256 checksum. Documentation, tests, and store artwork are intentionally kept out of the executable package.

See `PUBLISHING.md` for the Chrome Web Store readiness checklist.

## Privacy Shape

The extension does not store provider API keys. Prompt text is sent over HTTPS to the deterministic Token Optimizer preparation endpoint only after the user checks the visible consent box and clicks **Prepare only** or **Prepare & insert**. Raw and prepared prompt text is not retained by Token Optimizer. Token metrics remain only in the current side-panel session; no usage history is stored.

## Extend The Wrapper

See `ADAPTERS.md` for the site-adapter contract. Gemini™ and ChatGPT are enabled; future assistants can be added without changing the preparation or side-panel layers.

The same bridge can later support Claude, Copilot, and Perplexity through separate, narrowly scoped adapters and optional permissions.

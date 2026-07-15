# Token Optimizer for Gemini MVP

This is a local unpacked Chrome extension MVP for using Token Optimizer beside Gemini.

## What It Does

- Opens a Chrome side panel on `https://gemini.google.com/*`.
- Captures selected text or the focused Gemini prompt box.
- Sends the prompt to the configured Token Optimizer backend only when you click **Optimize**.
- Builds a concise Gemini-ready prompt while keeping internal optimizer details out of the Gemini box.
- Inserts the optimized prompt into Gemini only when you click **Insert into Gemini**.
- Does not auto-send the Gemini message.

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

The extension calls the deployed optimizer endpoint:

```text
https://tok-pi-gilt.vercel.app/api/optimize-run
```

## Package For Upload Later

From this folder:

```bash
zip -r ../../gemini-token-optimizer-mvp.zip \
  manifest.json service-worker.js content-gemini.js \
  sidepanel.html sidepanel.css sidepanel.js icons \
  README.md PUBLISHING.md
```

See `PUBLISHING.md` for the Chrome Web Store readiness checklist.

## Privacy Shape

The extension does not store provider API keys. Prompt text is sent to Token Optimizer only after the user clicks **Optimize**.

# Token Optimizer for Gemini MVP

This is a local unpacked Chrome extension MVP for using Token Optimizer beside Gemini.

## What It Does

- Opens a Chrome side panel on `https://gemini.google.com/*`.
- Captures selected text or the focused Gemini prompt box.
- Sends the prompt to the configured Token Optimizer backend only when you click **Optimize**.
- Builds a Gemini-ready compact handoff prompt.
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

Default endpoint:

```text
https://tok-pi-gilt.vercel.app/api/optimize-run
```

For local testing, run the app from the repo root:

```bash
npm start
```

Then select **Local** in extension settings.

## Package For Upload Later

From this folder:

```bash
zip -r ../../gemini-token-optimizer-mvp.zip .
```

## Privacy Shape

The extension does not store provider API keys. Prompt text is sent to the configured optimizer endpoint only after the user clicks **Optimize**.

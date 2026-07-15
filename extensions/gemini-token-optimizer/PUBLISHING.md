# Publishing Token Optimizer for Gemini

This extension is not deployed by Vercel. Vercel hosts the Token Optimizer web app and API. The Gemini wrapper is a Chrome extension package in this folder that must be uploaded to the Chrome Web Store Developer Dashboard.

## Current MVP

- Manifest V3 side-panel extension.
- Runs on `https://gemini.google.com/*`.
- Uses the deployed Token Optimizer endpoint.
- Captures or accepts prompt text only after user action.
- Inserts an optimized prompt into Gemini only after user action.
- Does not auto-send Gemini messages.
- Does not store provider API keys in the extension.
- Does not expose local endpoint settings in the store package.

## Open Source Use

The extension is useful as an inspectable wrapper example:

- `manifest.json`: permissions, Gemini host access, side-panel setup, content script registration.
- `sidepanel.html`, `sidepanel.css`, `sidepanel.js`: the extension UI and optimize/insert workflow.
- `content-gemini.js`: the Gemini DOM adapter for capture and insert.
- `service-worker.js`: side-panel enablement for Gemini tabs.

## Store-Ready Checklist

1. Finalize extension name and avoid Google endorsement wording.
2. Keep the single purpose narrow: optimize prompts before inserting them into Gemini.
3. Keep permissions narrow: `sidePanel`, `storage`, `https://gemini.google.com/*`, and the optimizer API origin.
4. Add a public privacy policy page.
5. Include a Limited Use disclosure for prompt/user data.
6. Add screenshots and store listing assets.
7. Test local unpacked install on a fresh Chrome profile.
8. Package the extension zip from this folder.
9. Upload the zip in the Chrome Web Store Developer Dashboard.
10. Fill out Package, Store Listing, Privacy, and Distribution tabs.
11. Submit for review.

## Privacy Policy Notes

The privacy policy should plainly say:

- Prompt text is user data.
- Prompt text is sent to Token Optimizer only when the user clicks Optimize.
- The extension does not sell user data.
- The extension does not use prompt data for unrelated advertising or tracking.
- The extension does not store provider API keys.
- The extension stores the latest raw prompt locally only to prevent recursive wrapper output.

## Local Test Notes

Chrome 150 blocks `--load-extension` unless the command-line blocker is disabled. For automated local testing on this machine, launch a throwaway profile with:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir=/tmp/token-optimizer-chrome-profile \
  --remote-debugging-port=9337 \
  --disable-features=DisableLoadExtensionCommandLineSwitch,DisableDisableExtensionsExceptCommandLineSwitch \
  --load-extension=/absolute/path/to/extensions/gemini-token-optimizer \
  --disable-extensions-except=/absolute/path/to/extensions/gemini-token-optimizer \
  --no-first-run \
  --no-default-browser-check \
  --new-window https://gemini.google.com/app
```

Manual testing through `chrome://extensions` still uses the normal **Load unpacked** flow.

## Package Command

From this folder:

```bash
zip -r ../../gemini-token-optimizer-mvp.zip \
  manifest.json service-worker.js content-gemini.js \
  sidepanel.html sidepanel.css sidepanel.js icons \
  README.md PUBLISHING.md
```

Upload the generated zip through the Chrome Web Store Developer Dashboard.

## Publication Types

- Public: discoverable in the Chrome Web Store.
- Unlisted: installable by link, not searchable.
- Private/trusted tester: limited access for testing or organization-only use.

Start with unlisted or trusted testers if the Gemini selector needs more real-world testing.

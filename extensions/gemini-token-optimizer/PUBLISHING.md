# Publishing Token Optimizer for Gemini™ and ChatGPT

This extension is not deployed by Vercel. Vercel hosts the Token Optimizer web app and API. The assistant wrapper is a Chrome extension package in this folder that must be uploaded to the Chrome Web Store Developer Dashboard.

## Current Wrapper

- Manifest V3 side-panel extension.
- Runs on Gemini™ and ChatGPT.
- Uses the deployed preparation-only Token Optimizer endpoint.
- Makes zero provider model calls while preparing a prompt.
- Captures or accepts prompt text only after user action.
- Shows the data-use disclosure and requires explicit consent before preparation.
- Inserts an optimized prompt into the active assistant only after user action.
- Does not auto-send assistant messages.
- Does not store provider API keys in the extension.
- Does not expose local endpoint settings in the store package.

## Open Source Use

The extension is useful as an inspectable wrapper example:

- `manifest.json`: permissions, supported host access, side-panel setup, content script registration.
- `sidepanel.html`, `sidepanel.css`, `sidepanel.js`: the extension UI and prepare/insert workflow.
- `platforms.js`: supported-site metadata for the side panel.
- `content-bridge.js`: reusable capture/insert message contract.
- `adapters/gemini.js`: the Gemini™ DOM adapter.
- `ADAPTERS.md`: the contract for future AI assistant adapters.
- `service-worker.js`: side-panel enablement for supported assistant tabs.

## Store-Ready Checklist

1. Finalize extension name and avoid Google endorsement wording.
2. Keep the single purpose narrow: optimize prompts before inserting them into supported assistants.
3. Keep permissions narrow: `sidePanel`, the enabled assistant origins, and the optimizer API origin.
4. Add a public privacy policy page.
5. Include a Limited Use disclosure for prompt/user data.
6. Upload the screenshot and generated listing assets from `store-assets/`.
7. Test local unpacked install on a fresh Chrome profile.
8. Run the reproducible package command from the repository root.
9. Upload the zip in the Chrome Web Store Developer Dashboard.
10. Fill out Package, Store Listing, Privacy, and Distribution tabs.
11. Submit for review.

## Privacy Policy Notes

The privacy policy should plainly say:

- Prompt text is user data.
- Prompt text is sent to Token Optimizer only when the user clicks Prepare or Prepare & insert.
- Prompt preparation is deterministic and does not call a provider model.
- The extension does not sell user data.
- The extension does not use prompt data for unrelated advertising or tracking.
- The extension does not store provider API keys.
- Token counts and preparation strategy remain only in the current side-panel session; the extension stores no usage history or prompt text.

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

From the repository root:

```bash
npm run test:extension
npm run package:extension
```

Upload `token-optimizer-chrome-v0.2.0.zip` through the Chrome Web Store Developer Dashboard. The builder uses a sorted runtime allowlist, includes `prompt-compiler.js`, normalizes package metadata, checks all local references, validates the ZIP, and prints its SHA-256 checksum.

## Store Listing Assets

Ready-to-upload listing copy and promo graphics live in `store-assets/`:

- `store-listing.md`
- `store-icon-128.png`
- `screenshot-token-optimizer-1280x800.jpg`
- `small-promo-tile-440x280.jpg`
- `marquee-promo-tile-1400x560.jpg`

## Dashboard Values

- Primary category: **Workflow & Planning**
- Language: **English (United States)**
- Distribution: **Public**, all regions
- Remote code: **No**. All executable JavaScript is packaged with the extension; the preparation API returns data, not code.
- User data handled: **Website content** and **Personal communications** (only prompt text the user pastes or explicitly captures), **Personally identifiable information** (network address processed for service delivery/security), and **User activity** (request time, route, and status for security and rate limiting).
- Privacy policy: `https://tok-pi-gilt.vercel.app/privacy`
- Limited Use: certify every applicable statement only after confirming it matches the published privacy policy.

## Reviewer Test Instructions

1. Open Gemini™ or ChatGPT in Chrome. The extension itself requires no login.
2. Open the Token Optimizer side panel.
3. Review the prominent data-use disclosure and check the consent box.
4. Paste the repeated-line example from `store-assets/store-listing.md` under **Reviewer Test Instructions**.
5. Click **Prepare only**. Confirm that a shorter prepared prompt and token metrics appear.
6. Click **Insert into assistant**. Confirm that the text is inserted but not submitted.
7. Clear the consent box or reopen the side panel. Confirm the prompt fields clear and all prompt input, capture, and preparation controls stay disabled until consent is given again.

## Publication Types

- Public: discoverable in the Chrome Web Store.
- Unlisted: installable by link, not searchable.
- Private/trusted tester: limited access for testing or organization-only use.

Use Public for the initial submission. Chrome review controls when the listing becomes available; the extension can remain unpublished until review succeeds.

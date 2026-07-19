# Chrome Web Store Listing Copy

## Extension Name

Token Optimizer for Gemini

## Short Description

Clean up messy prompts before inserting them into Gemini.

## Detailed Description

Token Optimizer for Gemini is a focused side-panel extension that helps you turn rough, long, or repetitive prompts into cleaner Gemini-ready input before you send anything.

Instead of pasting a messy prompt directly into Gemini, open Token Optimizer beside Gemini, capture or paste your prompt, and choose Prepare only or Prepare & insert. Preparation does not call another AI model. The extension does not auto-send messages; you stay in control and review the final prompt first.

This is designed for people who use AI tools for coding, research, writing, planning, debugging, and multi-step work. It helps reduce prompt clutter, remove repeated instructions, preserve the actual task, and keep the final prompt easier for Gemini to follow.

Key features:

- Capture prompt text from Gemini or paste it manually.
- Optimize long, repetitive, or messy prompts into concise Gemini-ready input.
- Prepare prompts without making a duplicate provider model call.
- Insert the optimized prompt into Gemini only after you choose to do so.
- Keep the workflow visible with simple stages: Capture, Prepare, Ready, Insert, Review.
- Avoid auto-sending messages so you can inspect the final prompt before submitting.
- Keep the extension narrow and focused on prompt cleanup for Gemini.

How it works:

1. Open Gemini in Chrome.
2. Open the Token Optimizer side panel.
3. Paste your rough prompt or capture text from the Gemini prompt box.
4. Click Prepare only, or use Prepare & insert for the one-click path.
5. Review the cleaned Gemini-ready prompt.
6. Copy it or insert it into Gemini.
7. Send in Gemini only when you are ready.

Privacy and data use:

- Prompt text is sent to Token Optimizer only when you click a Prepare action.
- The preparation endpoint uses deterministic processing and does not call a provider model.
- Nothing is sent when you capture text or insert text into Gemini.
- The extension does not auto-send Gemini messages.
- The extension does not store provider API keys.
- The extension does not sell user data.
- The extension stores the latest raw prompt and preparation metrics locally to avoid recursive prompt cleanup and show token counts.

Token Optimizer for Gemini is not affiliated with, endorsed by, or sponsored by Google.

## Single Purpose Statement

Token Optimizer for Gemini optimizes user-provided prompt text and inserts the reviewed result into Gemini only after explicit user action.

## Permission Justification

- `sidePanel`: Opens the Token Optimizer workspace beside Gemini.
- `storage`: Stores the latest raw prompt and preparation metrics locally to avoid recursive wrapping and show usage.
- `https://gemini.google.com/*`: Captures and inserts prompt text on Gemini only.
- `https://tok-pi-gilt.vercel.app/*`: Sends prompts to the preparation endpoint only after the user clicks a Prepare action.

## Store Assets

- Store icon: `store-icon-128.png` at 128x128, RGB, no alpha.
- Small promo tile: `small-promo-tile-440x280.png` at 440x280, RGB, no alpha.
- Marquee promo tile: `marquee-promo-tile-1400x560.png` at 1400x560, RGB, no alpha.

## Privacy Policy URL

https://tok-pi-gilt.vercel.app/privacy

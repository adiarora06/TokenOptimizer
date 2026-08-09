# Chrome Web Store Listing Copy

## Extension Name

Token Optimizer

## Short Description

Clean up messy prompts before inserting them into Gemini or ChatGPT.

## Detailed Description

Token Optimizer is a focused side-panel extension that helps you turn rough, long, or repetitive prompts into cleaner input for Gemini or ChatGPT before you send anything.

Instead of pasting a messy prompt directly into an assistant, open Token Optimizer beside Gemini or ChatGPT, capture or paste your prompt, and choose Prepare only or Prepare & insert. Preparation does not call another AI model. The extension does not auto-send messages; you stay in control and review the final prompt first.

This is designed for people who use AI tools for coding, research, writing, planning, debugging, and multi-step work. It helps reduce prompt clutter, remove repeated instructions, preserve the actual task, and keep the final prompt easier for the assistant to follow.

Key features:

- Capture prompt text from Gemini or ChatGPT, or paste it manually.
- Optimize long, repetitive, or messy prompts into concise assistant-ready input.
- Prepare prompts without making a duplicate provider model call.
- Insert the optimized prompt into the active assistant only after you choose to do so.
- Keep the workflow visible with simple stages: Capture, Prepare, Ready, Insert, Review.
- Avoid auto-sending messages so you can inspect the final prompt before submitting.
- Keep the extension narrow and focused on prompt cleanup for supported assistants.

How it works:

1. Open Gemini or ChatGPT in Chrome.
2. Open the Token Optimizer side panel.
3. Paste your rough prompt or capture text from the assistant prompt box.
4. Click Prepare only, or use Prepare & insert for the one-click path.
5. Review the cleaned assistant-ready prompt.
6. Copy it or insert it into the active assistant.
7. Send only when you are ready.

Privacy and data use:

- Prompt text is sent to Token Optimizer only when you click a Prepare action.
- The preparation endpoint uses deterministic processing and does not call a provider model.
- Nothing is sent when you capture text or insert text into an assistant.
- The extension does not auto-send assistant messages.
- The extension does not store provider API keys.
- The extension does not sell user data.
- The extension stores preparation metrics locally to show token counts; it does not persist raw prompts.

Token Optimizer is not affiliated with, endorsed by, or sponsored by Google or OpenAI.

## Single Purpose Statement

Token Optimizer prepares user-provided prompt text and inserts the reviewed result into a supported assistant only after explicit user action.

## Permission Justification

- `sidePanel`: Opens the Token Optimizer workspace beside a supported assistant.
- `storage`: Stores preparation metrics locally to show usage history.
- `https://gemini.google.com/*`: Captures and inserts prompt text on Gemini only after user action.
- `https://chatgpt.com/*` and `https://chat.openai.com/*`: Capture and insert prompt text on ChatGPT only after user action.
- `https://tok-pi-gilt.vercel.app/*`: Sends prompts to the preparation endpoint only after the user clicks a Prepare action.

## Store Assets

- Store icon: `store-icon-128.png` at 128x128, RGB, no alpha.
- Small promo tile: `small-promo-tile-440x280.png` at 440x280, RGB, no alpha.
- Marquee promo tile: `marquee-promo-tile-1400x560.png` at 1400x560, RGB, no alpha.

## Privacy Policy URL

https://tok-pi-gilt.vercel.app/privacy

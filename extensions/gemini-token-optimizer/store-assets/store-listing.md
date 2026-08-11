# Chrome Web Store Listing Copy

## Extension Name

Token Optimizer

## Short Description

Clean up messy prompts before inserting them into Gemini™ or ChatGPT.

## Detailed Description

Token Optimizer is a focused side-panel extension that helps you turn rough, long, or repetitive prompts into cleaner input for Gemini™ or ChatGPT before you send anything.

Instead of pasting a messy prompt directly into an assistant, open Token Optimizer beside Gemini™ or ChatGPT, capture or paste your prompt, and choose Prepare only or Prepare & insert. Preparation does not call another AI model. The extension does not auto-send messages; you stay in control and review the final prompt first.

This is designed for people who use AI tools for coding, research, writing, planning, debugging, and multi-step work. It helps reduce prompt clutter, remove repeated instructions, preserve the actual task, and keep the final prompt easier for the assistant to follow.

Key features:

- Capture prompt text from Gemini™ or ChatGPT, or paste it manually.
- Optimize long, repetitive, or messy prompts into concise assistant-ready input.
- Prepare prompts without making a duplicate provider model call.
- Insert the optimized prompt into the active assistant only after you choose to do so.
- Keep the workflow visible with simple stages: Capture, Prepare, Ready, Insert, Review.
- Avoid auto-sending messages so you can inspect the final prompt before submitting.
- Keep the extension narrow and focused on prompt cleanup for supported assistants.

How it works:

1. Open Gemini™ or ChatGPT in Chrome.
2. Open the Token Optimizer side panel.
3. Paste your rough prompt or capture text from the assistant prompt box.
4. Click Prepare only, or use Prepare & insert for the one-click path.
5. Review the cleaned assistant-ready prompt.
6. Copy it or insert it into the active assistant.
7. Send only when you are ready.

Privacy and data use:

- A prominent in-product notice explains prompt, local-metric, and operational request-data handling before any prompt is typed, pasted, captured, or prepared.
- Prompt input and capture stay disabled until you check the consent box. Prompt text is sent over HTTPS to Token Optimizer only after that consent and a Prepare action.
- The preparation endpoint uses deterministic processing and does not call a provider model.
- Raw and prepared prompt text is processed for the response and is not stored by Token Optimizer.
- Nothing is sent when you capture text or insert text into an assistant.
- The extension does not auto-send assistant messages.
- The extension does not store provider API keys.
- The extension does not sell user data.
- Token counts and strategy are shown only in the current side-panel session; no prompt text or usage history is stored.

Token Optimizer is not affiliated with, endorsed by, or sponsored by Google or OpenAI.

## Single Purpose Statement

Token Optimizer prepares user-provided prompt text and inserts the reviewed result into a supported assistant only after explicit user action.

## Permission Justification

- `sidePanel`: Opens the Token Optimizer workspace beside a supported assistant.
- `https://gemini.google.com/*`: Captures and inserts prompt text on Gemini™ only after user action.
- `https://chatgpt.com/*` and `https://chat.openai.com/*`: Capture and insert prompt text on ChatGPT only after user action.
- `https://tok-pi-gilt.vercel.app/*`: Sends prompts to the preparation endpoint only after the user clicks a Prepare action.

## Dashboard Metadata

- Primary category: Workflow & Planning
- Language: English (United States)
- Distribution: Public, all regions
- Remote code declaration: No. Every executable script is included in the uploaded package. The HTTPS endpoint returns JSON data and never supplies executable code.

## Data Use Disclosure Selections

- Website content: Yes. The extension handles prompt text that the user pastes or explicitly captures from a supported assistant.
- User activity: Yes. Hosting infrastructure processes request time, route, and status for service delivery, security, and rate limiting. The extension stores no usage history.
- Personally identifiable information: Yes. Hosting infrastructure processes network addresses and request metadata for delivery, security, and rate limiting; Token Optimizer may keep a short-lived keyed, pseudonymous rate-limit identifier.
- Authentication information: No.
- Financial and payment information: No.
- Health information: No intentional collection; users are told not to submit sensitive information.
- Personal communications: Yes. Only prompt text the user pastes or explicitly captures from a supported assistant composer is handled; conversations are never read automatically.
- Location: No.
- Web history: No. The supported assistant identity stays in the browser and is not sent to the preparation service.

## Data Use Certifications

- User data is used only to provide or improve the extension's narrow prompt-preparation purpose and security.
- User data is not sold or transferred for advertising, creditworthiness, lending, or unrelated purposes.
- Humans do not read prompt text except with the user's specific consent or when required for security or legal compliance.
- Token Optimizer complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Remote Code Declaration

Select **No, I am not using remote code**. All JavaScript runs from files in the uploaded ZIP. The remote preparation service returns JSON prompt output and metrics, not code.

## Reviewer Test Instructions

1. Open Gemini™ or ChatGPT in Chrome and open the Token Optimizer side panel.
2. Read the visible data-use notice and check its consent box.
3. Paste this prompt into the extension:

   ```text
   Build an extendable browser wrapper for AI applications.
   Keep provider keys out of the extension.
   Keep provider keys out of the extension.
   Insert prompts only after a user action.
   Insert prompts only after a user action.
   ```

4. Click **Prepare only**.
5. Confirm the duplicates are removed and the metrics report 55 original tokens, 35 prepared tokens, 20 saved tokens, and zero preparation model calls.
6. Click **Insert into assistant** and confirm that the extension inserts but does not submit the prompt.
7. Uncheck consent and confirm the prompt fields clear and prompt input/capture become disabled.
8. No extension-specific account or test credentials are required.

## Store Assets

- Store icon: `store-icon-128.png` at 128x128.
- Product screenshot: `screenshot-token-optimizer-1280x800.jpg` at 1280x800.
- Small promo tile: `small-promo-tile-440x280.jpg` at 440x280.
- Marquee promo tile: `marquee-promo-tile-1400x560.jpg` at 1400x560.

## Privacy Policy URL

https://tok-pi-gilt.vercel.app/privacy

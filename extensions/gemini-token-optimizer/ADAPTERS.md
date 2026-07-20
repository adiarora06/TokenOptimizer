# Site Adapter Architecture

The extension keeps prompt preparation, side-panel UI, and site-specific DOM access separate.

## Layers

- `sidepanel.js`: provider-neutral prepare, copy, insert, metrics, and local history flow.
- `platforms.js`: side-panel metadata used to recognize supported assistant URLs.
- `content-bridge.js`: stable Chrome message contract shared by every site.
- `adapters/gemini.js`: Gemini prompt discovery, capture, and insertion.
- `adapters/chatgpt.js`: ChatGPT prompt discovery, capture, and insertion (second reference adapter).
- `/api/prepare-handoff`: deterministic prompt preparation with zero model calls.

## Adapter Contract

Each content adapter assigns `globalThis.TokenOptimizerSiteAdapter` before `content-bridge.js` loads:

```js
globalThis.TokenOptimizerSiteAdapter = Object.freeze({
  id: "assistant-id",
  label: "Assistant Name",
  capabilities: Object.freeze({
    capture: true,
    insert: true,
    autoSubmit: false
  }),
  findPromptBox,
  capturePrompt,
  insertPrompt
});
```

`insertPrompt` must place text in the target prompt box without submitting it.

## Add Another Assistant

1. Add `adapters/<assistant>.js` with the adapter contract above.
2. Register its URL metadata in `platforms.js`.
3. Add a narrowly scoped `content_scripts` entry for its origin in `manifest.json`.
4. Add the matching host permission only when that assistant is released.
5. Add DOM selection, capture, insertion, and no-auto-submit tests.
6. Update the privacy policy and Chrome Web Store disclosures before publishing the expanded package.

Keep unreleased assistant permissions out of the production manifest. This preserves the Gemini extension's narrow single purpose and avoids unnecessary Chrome Web Store review scope.

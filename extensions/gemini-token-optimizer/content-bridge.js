(() => {
  const adapter = globalThis.TokenOptimizerSiteAdapter;
  if (!adapter) {
    console.warn("Token Optimizer did not find a site adapter for this page.");
    return;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;

    if (message.type === "TOKEN_OPTIMIZER_PING") {
      sendResponse({
        ok: true,
        target: adapter.id,
        label: adapter.label,
        capabilities: adapter.capabilities,
        hasInput: Boolean(adapter.findPromptBox())
      });
      return false;
    }

    if (message.type === "TOKEN_OPTIMIZER_CAPTURE") {
      const prompt = adapter.capturePrompt();
      sendResponse({
        ok: Boolean(prompt),
        target: adapter.id,
        prompt,
        message: prompt ? `Captured the ${adapter.label} prompt.` : `Could not find text in the ${adapter.label} prompt box.`
      });
      return false;
    }

    if (message.type === "TOKEN_OPTIMIZER_INSERT") {
      sendResponse({ target: adapter.id, ...adapter.insertPrompt(message.prompt) });
      return false;
    }

    return false;
  });
})();

(() => {
  const platforms = Object.freeze([
    Object.freeze({
      id: "gemini",
      label: "Gemini",
      origins: Object.freeze(["https://gemini.google.com/"]),
      statusLabel: "Gemini ready"
    }),
    Object.freeze({
      id: "chatgpt",
      label: "ChatGPT",
      origins: Object.freeze(["https://chatgpt.com/", "https://chat.openai.com/"]),
      statusLabel: "ChatGPT ready"
    })
  ]);

  function forUrl(value) {
    const url = String(value || "");
    return platforms.find((platform) => platform.origins.some((origin) => url.startsWith(origin))) || null;
  }

  globalThis.TokenOptimizerPlatformRegistry = Object.freeze({ platforms, forUrl });
})();

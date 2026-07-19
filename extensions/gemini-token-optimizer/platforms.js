(() => {
  const platforms = Object.freeze([
    Object.freeze({
      id: "gemini",
      label: "Gemini",
      origins: Object.freeze(["https://gemini.google.com/"]),
      statusLabel: "Gemini ready"
    })
  ]);

  function forUrl(value) {
    const url = String(value || "");
    return platforms.find((platform) => platform.origins.some((origin) => url.startsWith(origin))) || null;
  }

  globalThis.TokenOptimizerPlatformRegistry = Object.freeze({ platforms, forUrl });
})();

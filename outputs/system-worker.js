importScripts("/prompt-compiler.js");

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type !== "preflight") return;

  const analysis = self.TokenOptimizerCompiler.compilePrompt(String(message.prompt || ""), {
    mode: message.mode || "primary",
    wrapperTarget: message.wrapperTarget || "browser",
    routePreference: message.routePreference || "auto"
  });

  self.postMessage({
    type: "preflight-result",
    requestId: message.requestId,
    analysis
  });
};

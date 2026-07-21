(() => {
  const { build, isVisible } = globalThis.TokenOptimizerAdapterBase;

  // ChatGPT composer has shipped as both a <textarea> and a ProseMirror
  // contenteditable div over time, so the adapter covers both shapes.
  const selectors = [
    "#prompt-textarea",
    "div#prompt-textarea[contenteditable='true']",
    "textarea#prompt-textarea",
    "form textarea[data-virtualkeyboard]",
    "form div[contenteditable='true']",
    "textarea[placeholder]",
    "[role='textbox'][contenteditable='true']"
  ];

  function hasPromptLabel(node) {
    const label = [
      node.getAttribute("aria-label"),
      node.getAttribute("placeholder"),
      node.getAttribute("data-placeholder"),
      node.id
    ].filter(Boolean).join(" ").toLowerCase();
    return /prompt|message|ask|send a message|type|chatgpt/i.test(label);
  }

  function isNearPromptArea(node) {
    return node.getBoundingClientRect().bottom > window.innerHeight * 0.4;
  }

  function isHugeEditable(node) {
    const rect = node.getBoundingClientRect();
    if (node.id === "prompt-textarea" || node.closest?.("form")) return false;
    return rect.height > Math.min(360, window.innerHeight * 0.5) ||
      rect.width > window.innerWidth * 0.96;
  }

  function isCandidate(node, allowFocused) {
    if (!node || !(node instanceof HTMLElement) || !isVisible(node) || isHugeEditable(node)) return false;
    if (node.id === "prompt-textarea") return true;
    if (node.tagName === "TEXTAREA" && node.closest?.("form")) return true;
    if (node.getAttribute("role") === "textbox" && hasPromptLabel(node)) return true;
    return Boolean(allowFocused && node.isContentEditable && isNearPromptArea(node));
  }

  function score(node) {
    const rect = node.getBoundingClientRect();
    let value = 0;
    if (node.id === "prompt-textarea") value += 100;
    if (node.tagName === "TEXTAREA") value += 40;
    if (node.closest?.("form")) value += 30;
    if (hasPromptLabel(node)) value += 25;
    if (isNearPromptArea(node)) value += 10;
    value += Math.max(0, Math.min(20, rect.bottom / Math.max(1, window.innerHeight) * 20));
    return value;
  }

  globalThis.TokenOptimizerSiteAdapter = build({
    id: "chatgpt",
    label: "ChatGPT",
    selectors,
    isCandidate,
    score,
    notFoundMessage: "Open ChatGPT and click inside the message box first.",
    insertedMessage: "Inserted the prepared prompt into ChatGPT."
  });
})();

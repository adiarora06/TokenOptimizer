(() => {
  const { build, isVisible } = globalThis.TokenOptimizerAdapterBase;

  const selectors = [
    "rich-textarea .ql-editor[contenteditable='true']",
    "rich-textarea div[contenteditable='true']",
    "div.ql-editor[contenteditable='true']",
    "textarea[aria-label]",
    "textarea[placeholder]",
    "[role='textbox'][contenteditable='true']",
    "[role='textbox'] textarea"
  ];

  function hasPromptLabel(node) {
    const label = [
      node.getAttribute("aria-label"),
      node.getAttribute("placeholder"),
      node.getAttribute("data-placeholder")
    ].filter(Boolean).join(" ").toLowerCase();
    return /prompt|message|ask|enter|type|gemini/i.test(label);
  }

  function isNearPromptArea(node) {
    return node.getBoundingClientRect().bottom > window.innerHeight * 0.45;
  }

  function isHugeEditable(node) {
    const rect = node.getBoundingClientRect();
    if (node.closest("rich-textarea")) return false;
    return rect.height > Math.min(360, window.innerHeight * 0.45) ||
      rect.width > window.innerWidth * 0.96;
  }

  function isCandidate(node, allowFocused) {
    if (!node || !(node instanceof HTMLElement) || !isVisible(node) || isHugeEditable(node)) return false;
    if (node.closest("rich-textarea")) return true;
    if (node.tagName === "TEXTAREA" || node.classList.contains("ql-editor")) return true;
    if (node.getAttribute("role") === "textbox" && hasPromptLabel(node)) return true;
    return Boolean(allowFocused && node.isContentEditable && isNearPromptArea(node));
  }

  function score(node) {
    const rect = node.getBoundingClientRect();
    let value = 0;
    if (node.closest("rich-textarea")) value += 100;
    if (node.classList.contains("ql-editor")) value += 50;
    if (node.tagName === "TEXTAREA") value += 40;
    if (hasPromptLabel(node)) value += 25;
    if (isNearPromptArea(node)) value += 10;
    value += Math.max(0, Math.min(20, rect.bottom / Math.max(1, window.innerHeight) * 20));
    return value;
  }

  globalThis.TokenOptimizerSiteAdapter = build({
    id: "gemini",
    label: "Gemini",
    selectors,
    isCandidate,
    score,
    notFoundMessage: "Open Gemini and click inside the prompt box first.",
    insertedMessage: "Inserted the prepared prompt into Gemini."
  });
})();

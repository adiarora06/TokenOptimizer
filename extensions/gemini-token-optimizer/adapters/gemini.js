(() => {
  const selectors = [
    "rich-textarea .ql-editor[contenteditable='true']",
    "rich-textarea div[contenteditable='true']",
    "div.ql-editor[contenteditable='true']",
    "textarea[aria-label]",
    "textarea[placeholder]",
    "[role='textbox'][contenteditable='true']",
    "[role='textbox'] textarea"
  ];

  function normalizePromptNode(node) {
    if (!node || !(node instanceof HTMLElement)) return null;
    if (node.tagName === "TEXTAREA") return node;
    return node.querySelector?.("textarea") || node;
  }

  function isVisible(node) {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none";
  }

  function hasPromptLabel(node) {
    const label = [
      node.getAttribute("aria-label"),
      node.getAttribute("placeholder"),
      node.getAttribute("data-placeholder")
    ].filter(Boolean).join(" ").toLowerCase();
    return /prompt|message|ask|enter|type|gemini/i.test(label);
  }

  function isNearPromptArea(node) {
    const rect = node.getBoundingClientRect();
    return rect.bottom > window.innerHeight * 0.45;
  }

  function isHugeEditable(node) {
    const rect = node.getBoundingClientRect();
    if (node.closest("rich-textarea")) return false;
    return rect.height > Math.min(360, window.innerHeight * 0.45) ||
      rect.width > window.innerWidth * 0.96;
  }

  function isPromptCandidate(node, allowFocused) {
    if (!node || !(node instanceof HTMLElement) || !isVisible(node) || isHugeEditable(node)) return false;
    if (node.closest("rich-textarea")) return true;
    if (node.tagName === "TEXTAREA" || node.classList.contains("ql-editor")) return true;
    if (node.getAttribute("role") === "textbox" && hasPromptLabel(node)) return true;
    return Boolean(allowFocused && node.isContentEditable && isNearPromptArea(node));
  }

  function promptScore(node) {
    const rect = node.getBoundingClientRect();
    let score = 0;
    if (node.closest("rich-textarea")) score += 100;
    if (node.classList.contains("ql-editor")) score += 50;
    if (node.tagName === "TEXTAREA") score += 40;
    if (hasPromptLabel(node)) score += 25;
    if (isNearPromptArea(node)) score += 10;
    score += Math.max(0, Math.min(20, rect.bottom / Math.max(1, window.innerHeight) * 20));
    return score;
  }

  function findPromptBox() {
    const active = document.activeElement;
    if (isPromptCandidate(active, true)) return normalizePromptNode(active);

    const candidates = selectors
      .flatMap((selector) => [...document.querySelectorAll(selector)])
      .map(normalizePromptNode)
      .filter(Boolean)
      .filter((node, index, nodes) => nodes.indexOf(node) === index)
      .filter((node) => isPromptCandidate(node, false))
      .map((node) => ({ node, score: promptScore(node) }))
      .sort((a, b) => b.score - a.score);
    return candidates[0]?.node || null;
  }

  function capturePrompt() {
    const selected = String(window.getSelection()?.toString() || "").trim();
    if (selected) return selected;
    const box = findPromptBox();
    if (!box) return "";
    return box.tagName === "TEXTAREA"
      ? String(box.value || "").trim()
      : String(box.innerText || box.textContent || "").trim();
  }

  function insertPrompt(prompt) {
    const value = String(prompt || "").trim();
    if (!value) return { ok: false, message: "No prepared prompt to insert." };
    const box = findPromptBox();
    if (!box) return { ok: false, message: "Open Gemini and click inside the prompt box first." };

    box.scrollIntoView({ block: "center", inline: "nearest" });
    box.focus();
    if (box.tagName === "TEXTAREA") {
      box.value = value;
      box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      return { ok: true, message: "Inserted the prepared prompt into Gemini." };
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(box);
    selection.removeAllRanges();
    selection.addRange(range);
    const inserted = document.execCommand("insertText", false, value);
    if (!inserted) {
      box.replaceChildren();
      value.split(/\r?\n/).forEach((line, index) => {
        if (index) box.append(document.createElement("br"));
        box.append(document.createTextNode(line));
      });
      box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    }
    return { ok: true, message: "Inserted the prepared prompt into Gemini." };
  }

  globalThis.TokenOptimizerSiteAdapter = Object.freeze({
    id: "gemini",
    label: "Gemini",
    capabilities: Object.freeze({ capture: true, insert: true, autoSubmit: false }),
    findPromptBox,
    capturePrompt,
    insertPrompt
  });
})();

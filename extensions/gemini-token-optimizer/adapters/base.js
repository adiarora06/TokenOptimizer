(() => {
  // Shared scaffolding for site adapters. Each site supplies its selectors, a
  // candidate predicate, and a score function; prompt-box discovery, capture,
  // and insertion live here so that logic exists once across every assistant.
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

  function build({ id, label, selectors, isCandidate, score, notFoundMessage, insertedMessage }) {
    function findPromptBox() {
      const active = document.activeElement;
      if (isCandidate(active, true)) return normalizePromptNode(active);

      const candidates = selectors
        .flatMap((selector) => [...document.querySelectorAll(selector)])
        .map(normalizePromptNode)
        .filter(Boolean)
        .filter((node, index, nodes) => nodes.indexOf(node) === index)
        .filter((node) => isCandidate(node, false))
        .map((node) => ({ node, weight: score(node) }))
        .sort((a, b) => b.weight - a.weight);
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
      if (!box) return { ok: false, message: notFoundMessage };

      box.scrollIntoView({ block: "center", inline: "nearest" });
      box.focus();
      if (box.tagName === "TEXTAREA") {
        box.value = value;
        box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
        return { ok: true, message: insertedMessage };
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
      return { ok: true, message: insertedMessage };
    }

    return Object.freeze({
      id,
      label,
      capabilities: Object.freeze({ capture: true, insert: true, autoSubmit: false }),
      findPromptBox,
      capturePrompt,
      insertPrompt
    });
  }

  globalThis.TokenOptimizerAdapterBase = Object.freeze({ build, isVisible });
})();

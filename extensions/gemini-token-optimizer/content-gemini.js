const selectors = [
  "rich-textarea div[contenteditable='true']",
  "div[contenteditable='true'][role='textbox']",
  "div[contenteditable='true']",
  "textarea",
  "[role='textbox']"
];

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "TO_GEMINI_PING") {
    sendResponse({
      ok: true,
      page: "gemini",
      hasInput: Boolean(findPromptBox())
    });
    return false;
  }

  if (message.type === "TO_CAPTURE_PROMPT") {
    const prompt = capturePrompt();
    sendResponse({
      ok: Boolean(prompt),
      prompt,
      message: prompt ? "Captured Gemini prompt." : "Could not find text in the Gemini prompt box."
    });
    return false;
  }

  if (message.type === "TO_INSERT_PROMPT") {
    const result = insertPrompt(String(message.prompt || ""));
    sendResponse(result);
    return false;
  }

  return false;
});

function findPromptBox() {
  const active = document.activeElement;
  if (isPromptLike(active)) return active;

  for (const selector of selectors) {
    const candidates = [...document.querySelectorAll(selector)];
    const visible = candidates.find((node) => isVisible(node) && isPromptLike(node));
    if (visible) return visible;
  }

  return null;
}

function isPromptLike(node) {
  if (!node || !(node instanceof HTMLElement)) return false;
  const label = [
    node.getAttribute("aria-label"),
    node.getAttribute("placeholder"),
    node.textContent
  ].filter(Boolean).join(" ").toLowerCase();
  return node.isContentEditable ||
    node.tagName === "TEXTAREA" ||
    node.getAttribute("role") === "textbox" ||
    /prompt|message|ask|enter|type/i.test(label);
}

function isVisible(node) {
  const rect = node.getBoundingClientRect();
  const style = getComputedStyle(node);
  return rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== "hidden" &&
    style.display !== "none";
}

function capturePrompt() {
  const selected = String(window.getSelection()?.toString() || "").trim();
  if (selected) return selected;

  const box = findPromptBox();
  if (!box) return "";

  if (box.tagName === "TEXTAREA") return String(box.value || "").trim();
  return String(box.innerText || box.textContent || "").trim();
}

function insertPrompt(prompt) {
  const value = prompt.trim();
  if (!value) {
    return { ok: false, message: "No optimized prompt to insert." };
  }

  const box = findPromptBox();
  if (!box) {
    return { ok: false, message: "Open Gemini and click inside the prompt box first." };
  }

  box.focus();

  if (box.tagName === "TEXTAREA") {
    box.value = value;
    box.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: value
    }));
    return { ok: true, message: "Inserted optimized prompt into Gemini." };
  }

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(box);
  selection.removeAllRanges();
  selection.addRange(range);

  const inserted = document.execCommand("insertText", false, value);
  if (!inserted) {
    box.textContent = value;
    box.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: value
    }));
  }

  return { ok: true, message: "Inserted optimized prompt into Gemini." };
}

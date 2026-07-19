const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeElement {
  constructor(tagName, options = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map(Object.entries(options.attributes || {}));
    this.classList = {
      contains: (name) => (options.classes || []).includes(name)
    };
    this.children = options.children || [];
    this.parent = options.parent || null;
    this.textContent = options.textContent || "";
    this.innerText = options.innerText || this.textContent;
    this.value = options.value || "";
    this.isContentEditable = Boolean(options.contentEditable);
    this.rect = options.rect || { width: 420, height: 80, bottom: 700 };
    this.focused = false;
    this.events = [];
    this.replaced = false;
    for (const child of this.children) child.parent = this;
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  closest(selector) {
    if (selector === "rich-textarea") {
      let node = this;
      while (node) {
        if (node.tagName === "RICH-TEXTAREA") return node;
        node = node.parent;
      }
    }
    return null;
  }

  querySelector(selector) {
    if (selector === "textarea") {
      return this.children.find((child) => child.tagName === "TEXTAREA") || null;
    }
    return null;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  focus() {
    this.focused = true;
  }

  scrollIntoView() {}

  dispatchEvent(event) {
    this.events.push(event.type);
  }

  replaceChildren() {
    this.replaced = true;
    this.textContent = "";
    this.innerText = "";
  }

  append(node) {
    const value = node.textContent || "";
    this.textContent += value;
    this.innerText += value;
  }
}

const promptBox = new FakeElement("div", {
  classes: ["ql-editor"],
  contentEditable: true,
  attributes: { "data-placeholder": "Enter a prompt here" },
  textContent: "Original prompt",
  rect: { width: 500, height: 90, bottom: 720 }
});
const richTextarea = new FakeElement("rich-textarea", {
  children: [promptBox],
  rect: { width: 520, height: 110, bottom: 730 }
});
promptBox.parent = richTextarea;

const hugeEditor = new FakeElement("div", {
  contentEditable: true,
  attributes: { role: "textbox" },
  textContent: "Do not select this huge page editor",
  rect: { width: 1400, height: 900, bottom: 900 }
});

const nodes = [hugeEditor, richTextarea, promptBox];

const context = {
  console,
  HTMLElement: FakeElement,
  chrome: {
    runtime: {
      onMessage: {
        addListener(listener) {
          context.__listener = listener;
        }
      }
    }
  },
  window: {
    innerHeight: 800,
    innerWidth: 1440,
    getSelection: () => ({ toString: () => "" })
  },
  document: {
    activeElement: null,
    querySelectorAll(selector) {
      if (selector === "rich-textarea .ql-editor[contenteditable='true']") return [promptBox];
      if (selector === "rich-textarea div[contenteditable='true']") return [promptBox];
      if (selector === "div.ql-editor[contenteditable='true']") return [promptBox];
      if (selector === "[role='textbox'][contenteditable='true']") return [hugeEditor];
      return [];
    },
    createRange: () => ({ selectNodeContents() {} }),
    createElement: (tagName) => new FakeElement(tagName),
    createTextNode: (textContent) => ({ textContent })
  },
  getComputedStyle: () => ({ visibility: "visible", display: "block" }),
  InputEvent: class InputEvent {
    constructor(type) {
      this.type = type;
    }
  }
};
context.window.getSelection = () => ({
  toString: () => "",
  removeAllRanges() {},
  addRange() {}
});
context.document.execCommand = () => false;

const adapterCode = fs.readFileSync(path.resolve(__dirname, "../adapters/gemini.js"), "utf8");
const bridgeCode = fs.readFileSync(path.resolve(__dirname, "../content-bridge.js"), "utf8");
vm.runInNewContext(`${adapterCode}\n${bridgeCode}`, context);

context.__findPromptBox = context.TokenOptimizerSiteAdapter.findPromptBox;
context.__capturePrompt = context.TokenOptimizerSiteAdapter.capturePrompt;
context.__insertPrompt = context.TokenOptimizerSiteAdapter.insertPrompt;

assert.equal(context.__findPromptBox(), promptBox);
assert.equal(context.__capturePrompt(), "Original prompt");
const inserted = context.__insertPrompt("Optimized Gemini prompt");
assert.equal(inserted.ok, true);
assert.equal(promptBox.focused, true);
assert.equal(promptBox.replaced, true);
assert.match(promptBox.textContent, /Optimized Gemini prompt/);
assert.notEqual(context.__findPromptBox(), hugeEditor);

context.window.getSelection = () => ({ toString: () => "Selected prompt" });
assert.equal(context.__capturePrompt(), "Selected prompt");

let pingResponse = null;
context.__listener({ type: "TOKEN_OPTIMIZER_PING" }, null, (response) => { pingResponse = response; });
assert.equal(pingResponse.target, "gemini");
assert.equal(pingResponse.capabilities.autoSubmit, false);

console.log("content gemini tests passed", nodes.length);

const PRODUCTION_ENDPOINT = "https://tok-pi-gilt.vercel.app/api/optimize-run";
const LOCAL_ENDPOINT = "http://127.0.0.1:8787/api/optimize-run";
const storageKey = "tokenOptimizerGeminiSettings";

const state = {
  lastResult: null,
  activeStage: "capture"
};

const el = (id) => document.getElementById(id);

function setStatus(phase, title, detail, running = false, stage = null) {
  el("statusPhase").textContent = phase;
  el("statusTitle").textContent = title;
  el("statusDetail").textContent = detail;
  el("statusDot").classList.toggle("running", running);
  syncRail(stage || phase.toLowerCase());
}

function syncRail(stage) {
  const normalized = {
    ready: "capture",
    capture: "capture",
    captured: "capture",
    compress: "compress",
    optimizing: "compress",
    handoff: "handoff",
    optimized: "handoff",
    paste: "paste",
    inserted: "paste",
    review: "review",
    done: "review",
    error: "review"
  }[String(stage || "").toLowerCase()] || "capture";

  state.activeStage = normalized;
  document.querySelectorAll("[data-stage]").forEach((button) => {
    if (button.dataset.stage === normalized) {
      button.setAttribute("aria-current", "step");
    } else {
      button.removeAttribute("aria-current");
    }
  });
}

function toast(message) {
  const node = el("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 2200);
}

function estimateTokens(text) {
  return Math.max(0, Math.ceil(String(text || "").length / 4));
}

function updateTokenPill() {
  const raw = estimateTokens(el("rawPrompt").value);
  const optimized = estimateTokens(el("optimizedPrompt").value);
  el("tokenPill").textContent = optimized ? `${optimized} optimized` : `${raw} raw`;
}

async function getSettings() {
  const data = await chrome.storage.sync.get(storageKey);
  return data[storageKey] || { endpoint: PRODUCTION_ENDPOINT };
}

async function saveSettings(settings) {
  await chrome.storage.sync.set({ [storageKey]: settings });
}

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function messageGemini(message) {
  const tab = await currentTab();
  if (!tab?.id || !tab.url?.startsWith("https://gemini.google.com/")) {
    throw new Error("Open a Gemini tab first.");
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    throw new Error("Gemini page is not ready yet. Refresh Gemini, focus the prompt box, and try again.");
  }
}

async function checkConnection() {
  try {
    const response = await messageGemini({ type: "TO_GEMINI_PING" });
    el("connectionPill").textContent = response?.hasInput ? "Gemini ready" : "Open prompt";
    setStatus("Ready", "Gemini sidecar connected", "Capture, optimize, then insert when you choose.", false, "capture");
  } catch (error) {
    el("connectionPill").textContent = "No Gemini";
    setStatus("Ready", "Open Gemini to connect", error.message, false, "capture");
  }
}

function buildSidecarPrompt(result, rawPrompt) {
  const contract = result?.handoffContract || {};
  const contractText = JSON.stringify(contract, null, 2);
  const finalAnswer = result?.finalAnswer || "";
  return [
    "# Token Optimizer Gemini Handoff",
    "",
    "Use this compact handoff instead of the original long prompt. Do not ask for the full transcript unless the contract is impossible to execute.",
    "",
    "## Handoff Contract",
    contractText,
    "",
    "## Optimized Result",
    finalAnswer,
    "",
    "## Execution Rules",
    "- Preserve the user's goal and constraints.",
    "- Avoid repeating setup text back to the user.",
    "- Ask at most one clarifying question only if blocked.",
    "- Return a useful final answer.",
    "",
    "## Original Prompt Summary",
    rawPrompt.slice(0, 900)
  ].join("\n");
}

async function capturePrompt() {
  setStatus("Capture", "Capturing Gemini prompt", "Reading the active prompt box or selected text.", true, "capture");
  try {
    const response = await messageGemini({ type: "TO_CAPTURE_PROMPT" });
    if (!response?.ok) throw new Error(response?.message || "No prompt text found.");
    el("rawPrompt").value = response.prompt;
    updateTokenPill();
    setStatus("Captured", "Prompt captured", "Now click Optimize to compress it into a Gemini-ready handoff.", false, "capture");
    toast("Prompt captured");
  } catch (error) {
    setStatus("Error", "Capture failed", error.message, false, "capture");
  }
}

async function optimizePrompt() {
  const rawPrompt = el("rawPrompt").value.trim();
  if (!rawPrompt) {
    setStatus("Capture", "Paste or capture a prompt first", "The optimizer needs a rough prompt before it can compress anything.", false, "capture");
    el("rawPrompt").focus();
    return;
  }

  const endpoint = el("backendUrl").value.trim() || PRODUCTION_ENDPOINT;
  await saveSettings({ endpoint });
  setStatus("Optimizing", "Compressing prompt", "Calling Token Optimizer and building the Gemini handoff.", true, "compress");
  el("optimizePrompt").disabled = true;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: rawPrompt, provider: "groq-openai-fallback" })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Optimizer request failed.");
    state.lastResult = data;
    el("optimizedPrompt").value = buildSidecarPrompt(data, rawPrompt);
    updateTokenPill();
    setStatus("Handoff", "Optimized handoff ready", "Copy it or insert it into Gemini. Nothing is auto-sent.", false, "handoff");
    toast("Optimized prompt ready");
  } catch (error) {
    setStatus("Error", "Optimization failed", error.message, false, "review");
  } finally {
    el("optimizePrompt").disabled = false;
  }
}

async function insertIntoGemini() {
  const prompt = el("optimizedPrompt").value.trim();
  if (!prompt) {
    setStatus("Handoff", "Optimize first", "There is no optimized prompt to insert yet.", false, "handoff");
    return;
  }

  setStatus("Paste", "Inserting into Gemini", "The prompt will be placed in the box, but not submitted.", true, "paste");
  try {
    const response = await messageGemini({ type: "TO_INSERT_PROMPT", prompt });
    if (!response?.ok) throw new Error(response?.message || "Insert failed.");
    setStatus("Review", "Inserted into Gemini", "Review the prompt in Gemini, then send it when ready.", false, "review");
    toast("Inserted into Gemini");
  } catch (error) {
    setStatus("Error", "Insert failed", error.message, false, "paste");
  }
}

async function copyOptimized() {
  const prompt = el("optimizedPrompt").value.trim();
  if (!prompt) {
    setStatus("Handoff", "Nothing to copy yet", "Optimize a prompt first.", false, "handoff");
    return;
  }
  await navigator.clipboard.writeText(prompt);
  setStatus("Paste", "Copied optimized handoff", "Paste it into Gemini or another active LLM prompt box.", false, "paste");
  toast("Copied");
}

function bindEvents() {
  el("capturePrompt").addEventListener("click", capturePrompt);
  el("optimizePrompt").addEventListener("click", optimizePrompt);
  el("insertGemini").addEventListener("click", insertIntoGemini);
  el("copyOptimized").addEventListener("click", copyOptimized);
  el("rawPrompt").addEventListener("input", updateTokenPill);
  el("optimizedPrompt").addEventListener("input", updateTokenPill);
  el("useProduction").addEventListener("click", async () => {
    el("backendUrl").value = PRODUCTION_ENDPOINT;
    await saveSettings({ endpoint: PRODUCTION_ENDPOINT });
    toast("Production endpoint selected");
  });
  el("useLocal").addEventListener("click", async () => {
    el("backendUrl").value = LOCAL_ENDPOINT;
    await saveSettings({ endpoint: LOCAL_ENDPOINT });
    toast("Local endpoint selected");
  });
  document.querySelectorAll("[data-stage]").forEach((button) => {
    button.addEventListener("click", () => {
      syncRail(button.dataset.stage);
      const messages = {
        capture: ["Capture", "Capture or paste prompt", "Get the rough prompt into Token Optimizer."],
        compress: ["Compress", "Compress once", "Run Optimize to build the compact handoff."],
        handoff: ["Handoff", "Review handoff", "Copy or insert the optimized prompt."],
        paste: ["Paste", "Paste into Gemini", "Insert the optimized prompt into Gemini when ready."],
        review: ["Review", "Review before sending", "Gemini will not send until you choose to submit."]
      };
      const [phase, title, detail] = messages[button.dataset.stage];
      setStatus(phase, title, detail, false, button.dataset.stage);
    });
  });
}

async function init() {
  bindEvents();
  const settings = await getSettings();
  el("backendUrl").value = settings.endpoint || PRODUCTION_ENDPOINT;
  updateTokenPill();
  checkConnection();
}

init();

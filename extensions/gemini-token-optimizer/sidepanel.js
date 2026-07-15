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

function asLines(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (!value) return [];
  return String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function cleanPromptText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

function firstUsefulLine(text) {
  const lines = asLines(text);
  return lines[0] || "Complete the user's task.";
}

function withoutEllipsis(text) {
  return String(text || "").replace(/\.\.\.$/, "").trim();
}

function isTruncated(text) {
  return /\.\.\.$/.test(String(text || "").trim());
}

function uniqueShortLines(lines, max = 5, reference = "") {
  const referenceText = cleanPromptText(withoutEllipsis(reference)).toLowerCase();
  const seen = new Set();
  return lines
    .map((line) => cleanPromptText(withoutEllipsis(line)))
    .filter(Boolean)
    .filter((line) => !/^(user_input|source|sources)$/i.test(line))
    .filter((line) => {
      const key = line.toLowerCase();
      if (!referenceText) return true;
      return key !== referenceText &&
        !referenceText.includes(key) &&
        !key.includes(referenceText);
    })
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max)
    .map((line) => line.length > 260 ? `${line.slice(0, 257).replace(/\s+\S*$/, "")}.` : line);
}

function bulletSection(title, lines, reference = "") {
  const cleaned = uniqueShortLines(lines, 5, reference);
  if (!cleaned.length) return "";
  return [`${title}:`, ...cleaned.map((line) => `- ${line}`)].join("\n");
}

function cleanDirectRequest(rawPrompt) {
  const prompt = cleanPromptText(rawPrompt);
  return prompt
    .replace(/^i want you to\s+/i, "Please ")
    .replace(/^i need you to\s+/i, "Please ")
    .replace(/^i want\s+/i, "Please ");
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
  const rawClean = cleanPromptText(rawPrompt);

  if (estimateTokens(rawClean) <= 180) {
    return [
      cleanDirectRequest(rawClean),
      "",
      "Return the answer directly. Include every deliverable the request asks for, and do not mention token optimization or internal workflow."
    ].join("\n");
  }

  const contractGoal = cleanPromptText(contract.goal || "");
  const goal = isTruncated(contractGoal) || !contractGoal
    ? cleanPromptText(firstUsefulLine(rawPrompt))
    : contractGoal;
  const facts = uniqueShortLines([
    ...asLines(contract.facts),
    ...asLines(contract.sources)
  ], 4, goal);
  const constraints = uniqueShortLines(asLines(contract.constraints), 4, goal);
  const outputStyle = String(contract.output_style || "").trim();
  const sections = [
    "Complete this task directly and concisely.",
    "",
    "Task:",
    goal,
    "",
    bulletSection("Important context", facts, goal),
    bulletSection("Requirements", constraints, goal),
    [
      "Output:",
      "- Give the final answer directly.",
      "- Include code, steps, diagrams, or tables only when the task asks for them.",
      "- Do not mention token optimization, handoff contracts, or internal agent workflow.",
      outputStyle ? `- Style: ${outputStyle}` : ""
    ].filter(Boolean).join("\n")
  ].filter(Boolean);

  return [
    ...sections,
    "",
    "If one small assumption is needed, make it and continue."
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
  setStatus("Optimizing", "Compressing prompt", "Calling Token Optimizer and building a clean Gemini-ready prompt.", true, "compress");
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
    setStatus("Handoff", "Gemini prompt ready", "Copy it or insert it into Gemini. Nothing is auto-sent.", false, "handoff");
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
  setStatus("Paste", "Copied Gemini-ready prompt", "Paste it into Gemini or another active LLM prompt box.", false, "paste");
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
        handoff: ["Handoff", "Review Gemini prompt", "Copy or insert the optimized prompt."],
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

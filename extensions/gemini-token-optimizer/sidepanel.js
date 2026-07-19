const PREPARE_ENDPOINT = "https://tok-pi-gilt.vercel.app/api/prepare-handoff";
const recentPromptKey = "tokenOptimizerLastRawPrompt";
const preparationHistoryKey = "tokenOptimizerPreparationHistory";

const state = {
  activeStage: "capture",
  lastResult: null,
  target: null
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
    analyze: "prepare",
    prepare: "prepare",
    preparing: "prepare",
    handoff: "handoff",
    prepared: "handoff",
    insert: "insert",
    inserted: "insert",
    review: "review",
    done: "review",
    error: "review"
  }[String(stage || "").toLowerCase()] || "capture";

  state.activeStage = normalized;
  document.querySelectorAll("[data-stage]").forEach((button) => {
    if (button.dataset.stage === normalized) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
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

function looksPrepared(text) {
  const value = String(text || "").trim();
  return /^Complete this task directly/i.test(value) ||
    /\n(?:Task|Important context|Requirements|Output):/i.test(value) ||
    /token optimization|handoff contracts|internal agent workflow/i.test(value);
}

function platformForUrl(url) {
  return globalThis.TokenOptimizerPlatformRegistry?.forUrl(url) || null;
}

async function currentContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const target = platformForUrl(tab?.url);
  if (!tab?.id || !target) throw new Error("Open a supported AI assistant tab first.");
  state.target = target;
  return { tab, target };
}

async function messageTarget(message) {
  const { tab, target } = await currentContext();
  try {
    const response = await chrome.tabs.sendMessage(tab.id, message);
    return { response, target };
  } catch {
    throw new Error(`${target.label} is not ready yet. Refresh the page, focus its prompt box, and try again.`);
  }
}

async function getRecentRawPrompt() {
  const data = await chrome.storage.local.get(recentPromptKey);
  return String(data[recentPromptKey] || "").trim();
}

async function rememberRawPrompt(prompt) {
  if (!prompt || looksPrepared(prompt)) return;
  await chrome.storage.local.set({ [recentPromptKey]: prompt });
}

async function recordPreparation(result, target) {
  const data = await chrome.storage.local.get(preparationHistoryKey);
  const history = Array.isArray(data[preparationHistoryKey]) ? data[preparationHistoryKey] : [];
  const report = result.tokenReport || {};
  history.unshift({
    at: new Date().toISOString(),
    target: target.id,
    strategy: result.strategy || "pass-through",
    rawTokens: Number(report.rawInputTokens || 0),
    preparedTokens: Number(report.optimizedPromptTokens || 0),
    savedTokens: Number(report.estimatedSavingsTokens || 0),
    modelCalls: Number(report.modelCalls || 0)
  });
  await chrome.storage.local.set({ [preparationHistoryKey]: history.slice(0, 50) });
}

function renderMetrics(result) {
  const report = result?.tokenReport || {};
  const raw = Number(report.rawInputTokens || 0);
  const prepared = Number(report.optimizedPromptTokens || 0);
  const saved = Number(report.estimatedSavingsTokens || 0);
  const percent = Number(report.estimatedSavingsPercent || 0);
  const calls = Number(report.modelCalls || 0);

  el("tokenPill").textContent = `${prepared} ready`;
  el("rawTokenMetric").textContent = raw;
  el("readyTokenMetric").textContent = prepared;
  el("savedTokenMetric").textContent = saved ? `${saved} (${percent}%)` : "No increase";
  el("modelCallMetric").textContent = calls;
  el("metrics").hidden = false;
  el("routeNote").textContent = calls === 0
    ? "Prepared without calling a model."
    : `${calls} preparation model call${calls === 1 ? "" : "s"}.`;
  el("routeNote").hidden = false;
}

function updateDraftTokenPill() {
  if (state.lastResult) return;
  const raw = estimateTokens(el("rawPrompt").value);
  el("tokenPill").textContent = raw ? `${raw} raw` : "0 tokens";
}

async function checkConnection() {
  try {
    const { response, target } = await messageTarget({ type: "TOKEN_OPTIMIZER_PING" });
    el("connectionPill").textContent = response?.hasInput ? target.statusLabel : `Open ${target.label} prompt`;
    setStatus("Ready", `${target.label} wrapper connected`, "Capture a rough prompt or prepare and insert it in one click.", false, "capture");
  } catch (error) {
    el("connectionPill").textContent = "No assistant";
    setStatus("Ready", "Open Gemini to connect", error.message, false, "capture");
  }
}

async function capturePrompt({ quiet = false } = {}) {
  if (!quiet) setStatus("Capture", "Capturing the active prompt", "Reading the selected text or prompt box.", true, "capture");
  const { response, target } = await messageTarget({ type: "TOKEN_OPTIMIZER_CAPTURE" });
  if (!response?.ok) throw new Error(response?.message || `No ${target.label} prompt text found.`);
  el("rawPrompt").value = response.prompt;
  state.lastResult = null;
  updateDraftTokenPill();
  await rememberRawPrompt(response.prompt);
  if (!quiet) {
    setStatus("Captured", "Prompt captured", "Prepare it, or prepare and insert it in one click.", false, "capture");
    toast("Prompt captured");
  }
  return response.prompt;
}

async function rawPromptForPreparation() {
  let prompt = el("rawPrompt").value.trim();
  if (!prompt) prompt = await capturePrompt({ quiet: true });
  if (looksPrepared(prompt)) prompt = await getRecentRawPrompt() || prompt;
  if (!prompt) throw new Error("Paste a prompt or focus a prompt box first.");
  el("rawPrompt").value = prompt;
  await rememberRawPrompt(prompt);
  return prompt;
}

async function requestPreparation(rawPrompt, target) {
  const response = await fetch(PREPARE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: rawPrompt,
      source: "browser-extension",
      target: target.id,
      options: { routePreference: "auto" }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Prompt preparation failed.");
  if (Number(data?.tokenReport?.modelCalls || 0) !== 0) {
    throw new Error("Preparation stopped because it attempted an unnecessary model call.");
  }
  if (!data.optimizedPrompt) throw new Error("The preparation service returned an empty prompt.");
  return data;
}

async function insertPreparedPrompt(prompt) {
  setStatus("Insert", "Inserting the prepared prompt", "Placing it in the active prompt box without sending it.", true, "insert");
  const { response, target } = await messageTarget({ type: "TOKEN_OPTIMIZER_INSERT", prompt });
  if (!response?.ok) throw new Error(response?.message || "Insert failed.");
  setStatus("Review", `Inserted into ${target.label}`, "Review it, then send when ready.", false, "review");
  toast(`Inserted into ${target.label}`);
}

async function preparePrompt({ insert = false } = {}) {
  const buttons = [el("optimizePrompt"), el("optimizeInsert")];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const rawPrompt = await rawPromptForPreparation();
    const { target } = await currentContext();
    setStatus("Prepare", "Preparing a clean handoff", "Removing repeated wrapper text without running another model.", true, "prepare");
    const result = await requestPreparation(rawPrompt, target);
    state.lastResult = result;
    el("optimizedPrompt").value = result.optimizedPrompt;
    renderMetrics(result);
    await recordPreparation(result, target);
    setStatus("Prepared", "Prompt ready", "No preparation model call was used.", false, "handoff");
    toast("Prompt ready");
    if (insert) await insertPreparedPrompt(result.optimizedPrompt);
  } catch (error) {
    setStatus("Error", "Could not prepare the prompt", error.message, false, "review");
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function copyPrepared() {
  const prompt = el("optimizedPrompt").value.trim();
  if (!prompt) {
    setStatus("Ready", "Nothing to copy yet", "Prepare a prompt first.", false, "handoff");
    return;
  }
  await navigator.clipboard.writeText(prompt);
  setStatus("Ready", "Prepared prompt copied", "Paste it into any supported assistant.", false, "handoff");
  toast("Copied");
}

function bindEvents() {
  el("capturePrompt").addEventListener("click", () => capturePrompt().catch((error) => {
    setStatus("Error", "Capture failed", error.message, false, "capture");
  }));
  el("optimizePrompt").addEventListener("click", () => preparePrompt({ insert: false }));
  el("optimizeInsert").addEventListener("click", () => preparePrompt({ insert: true }));
  el("insertTarget").addEventListener("click", () => {
    const prompt = el("optimizedPrompt").value.trim();
    if (!prompt) {
      setStatus("Ready", "Prepare first", "There is no prepared prompt to insert yet.", false, "handoff");
      return;
    }
    insertPreparedPrompt(prompt).catch((error) => setStatus("Error", "Insert failed", error.message, false, "insert"));
  });
  el("copyPrepared").addEventListener("click", copyPrepared);
  el("rawPrompt").addEventListener("input", () => {
    state.lastResult = null;
    updateDraftTokenPill();
  });
  document.querySelectorAll("[data-stage]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = state.target?.label || "the assistant";
      const messages = {
        capture: ["Capture", "Capture or paste", "Bring the rough prompt into the wrapper."],
        prepare: ["Prepare", "Prepare locally", "Remove repetition without calling another model."],
        handoff: ["Ready", "Review the prepared prompt", "Copy it or insert it into the active assistant."],
        insert: ["Insert", `Insert into ${target}`, "Place the prompt without submitting it."],
        review: ["Review", "Review before sending", "The wrapper never submits the assistant message for you."]
      };
      const [phase, title, detail] = messages[button.dataset.stage];
      setStatus(phase, title, detail, false, button.dataset.stage);
    });
  });
}

async function init() {
  bindEvents();
  updateDraftTokenPill();
  await checkConnection();
}

init();

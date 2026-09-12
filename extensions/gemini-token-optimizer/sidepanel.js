const PREPARE_ENDPOINT = "https://tok-pi-gilt.vercel.app/api/prepare-handoff";
const compiler = globalThis.TokenOptimizerCompiler;

if (!compiler) throw new Error("Prompt compiler failed to load.");

const state = {
  activeStage: "capture",
  connectionCheckId: 0,
  connectionRefreshTimer: null,
  lastResult: null,
  preparing: false,
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
    handoff: "review",
    prepared: "review",
    review: "review",
    done: "review",
    error: "review",
    insert: "insert",
    inserted: "insert"
  }[String(stage || "").toLowerCase()] || "capture";

  state.activeStage = normalized;
  document.querySelectorAll("[data-stage]").forEach((step) => {
    if (step.dataset.stage === normalized) step.setAttribute("aria-current", "step");
    else step.removeAttribute("aria-current");
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
  return compiler.estimateTokens(text);
}

function platformForUrl(url) {
  return globalThis.TokenOptimizerPlatformRegistry?.forUrl(url) || null;
}

function tokenizeForDiff(text) {
  return String(text || "").match(/\s+|[^\s]+/g) || [];
}

function mergeDiffParts(parts) {
  return parts.reduce((merged, part) => {
    const previous = merged.at(-1);
    if (previous?.type === part.type) previous.text += part.text;
    else merged.push({ ...part });
    return merged;
  }, []);
}

function diffPromptTokens(before, after) {
  const original = tokenizeForDiff(before);
  const prepared = tokenizeForDiff(after);
  let prefix = 0;
  while (prefix < original.length && prefix < prepared.length && original[prefix] === prepared[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < original.length - prefix
    && suffix < prepared.length - prefix
    && original[original.length - 1 - suffix] === prepared[prepared.length - 1 - suffix]
  ) suffix += 1;

  const beforeMiddle = original.slice(prefix, original.length - suffix);
  const afterMiddle = prepared.slice(prefix, prepared.length - suffix);
  const parts = [];
  if (prefix) parts.push({ type: "same", text: original.slice(0, prefix).join("") });

  if (beforeMiddle.length + afterMiddle.length > 2000 || beforeMiddle.length * afterMiddle.length > 60000) {
    if (beforeMiddle.length) parts.push({ type: "removed", text: beforeMiddle.join("") });
    if (afterMiddle.length) parts.push({ type: "added", text: afterMiddle.join("") });
  } else {
    const table = Array.from(
      { length: beforeMiddle.length + 1 },
      () => new Uint16Array(afterMiddle.length + 1)
    );
    for (let i = beforeMiddle.length - 1; i >= 0; i -= 1) {
      for (let j = afterMiddle.length - 1; j >= 0; j -= 1) {
        table[i][j] = beforeMiddle[i] === afterMiddle[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }

    let i = 0;
    let j = 0;
    while (i < beforeMiddle.length && j < afterMiddle.length) {
      if (beforeMiddle[i] === afterMiddle[j]) {
        parts.push({ type: "same", text: beforeMiddle[i] });
        i += 1;
        j += 1;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        parts.push({ type: "removed", text: beforeMiddle[i] });
        i += 1;
      } else {
        parts.push({ type: "added", text: afterMiddle[j] });
        j += 1;
      }
    }
    while (i < beforeMiddle.length) parts.push({ type: "removed", text: beforeMiddle[i++] });
    while (j < afterMiddle.length) parts.push({ type: "added", text: afterMiddle[j++] });
  }

  if (suffix) parts.push({ type: "same", text: original.slice(original.length - suffix).join("") });
  return mergeDiffParts(parts);
}

function renderPromptDiff(before, after) {
  const parts = diffPromptTokens(before, after);
  const fragment = document.createDocumentFragment();
  for (const part of parts) {
    const node = document.createElement(part.type === "added" ? "ins" : part.type === "removed" ? "del" : "span");
    node.textContent = part.text;
    fragment.appendChild(node);
  }
  el("promptDiff").replaceChildren(fragment);

  const added = estimateTokens(parts.filter((part) => part.type === "added").map((part) => part.text).join(""));
  const removed = estimateTokens(parts.filter((part) => part.type === "removed").map((part) => part.text).join(""));
  el("diffSummary").textContent = added || removed
    ? `${removed} token${removed === 1 ? "" : "s"} removed · ${added} added`
    : "No wording changes were needed.";
  el("diffView").hidden = false;
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

function renderMetrics(result) {
  const report = result?.tokenReport || {};
  const raw = Number(report.rawInputTokens || 0);
  const prepared = Number(report.optimizedPromptTokens || 0);
  const saved = Number(report.estimatedSavingsTokens || 0);
  const percent = Number(report.estimatedSavingsPercent || 0);
  const calls = Number(report.modelCalls || 0);
  const route = result?.workflowShape?.route;

  el("tokenPill").textContent = `${prepared} ready`;
  el("rawTokenMetric").textContent = raw;
  el("readyTokenMetric").textContent = prepared;
  el("savedTokenMetric").textContent = saved ? `${saved} (${percent}%)` : "No increase";
  el("modelCallMetric").textContent = calls;
  el("metrics").hidden = false;
  el("routeNote").textContent = calls === 0
    ? `${route ? `${route[0].toUpperCase()}${route.slice(1)} route · ` : ""}Prepared without calling a model.`
    : `${calls} preparation model call${calls === 1 ? "" : "s"}.`;
  el("routeNote").hidden = false;
}

function updateDraftTokenPill() {
  if (state.lastResult) return;
  const raw = estimateTokens(el("rawPrompt").value);
  el("tokenPill").textContent = raw ? `${raw} raw` : "0 tokens";
}

function hasPreparationConsent() {
  return Boolean(el("dataConsent")?.checked);
}

function syncActionControls() {
  const consented = hasPreparationConsent();
  const busyOrBlocked = state.preparing || !consented;
  el("dataDisclosure").classList.toggle("accepted", consented);
  el("dataDisclosureTitle").textContent = consented ? "Data notice accepted" : "Before you capture, type, or prepare";
  el("rawPrompt").disabled = busyOrBlocked;
  el("capturePrompt").disabled = busyOrBlocked || !state.target;
  el("preparePrompt").disabled = busyOrBlocked;
  el("copyPrepared").disabled = state.preparing || !state.lastResult;
  el("insertTarget").disabled = state.preparing || !state.lastResult || !state.target;
  el("capturePrompt").textContent = state.target ? `Capture from ${state.target.label}` : "Capture from assistant";
  el("insertTarget").textContent = state.target ? `Insert into ${state.target.label}` : "Insert into assistant";
  el("rawPrompt").placeholder = consented
    ? "Paste the rough prompt here, or capture it after focusing the assistant's prompt box."
    : "Agree to the data notice, then paste or capture a rough prompt.";
}

function clearPreparedResult() {
  state.lastResult = null;
  el("optimizedPrompt").value = "";
  el("metrics").hidden = true;
  el("routeNote").hidden = true;
  el("diffView").hidden = true;
  el("promptDiff").replaceChildren();
}

function handleConsentChange() {
  if (!hasPreparationConsent()) {
    el("rawPrompt").value = "";
    clearPreparedResult();
    el("tokenPill").textContent = "0 tokens";
    setStatus("Ready", "Consent required before prompt handling", "Review the data notice and check the agreement box to continue.", false, "capture");
  } else {
    setStatus("Capture", "Paste a prompt or capture from the assistant", "Connection status refreshes automatically when you switch tabs.", false, "capture");
    scheduleConnectionRefresh();
  }
  syncActionControls();
}

async function checkConnection() {
  const checkId = ++state.connectionCheckId;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const target = platformForUrl(tab?.url);
    if (!tab?.id || !target) throw new Error("Open a supported AI assistant tab first.");

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: "TOKEN_OPTIMIZER_PING" });
    } catch {
      throw new Error(`${target.label} is not ready yet. Refresh the page, focus its prompt box, and try again.`);
    }
    if (checkId !== state.connectionCheckId) return;

    state.target = target;
    el("connectionPill").textContent = response?.hasInput ? target.statusLabel : `Open ${target.label} prompt`;
    if (!state.preparing && !state.lastResult) {
      setStatus(
        hasPreparationConsent() ? "Capture" : "Ready",
        hasPreparationConsent() ? `${target.label} connected` : `${target.label} connected · consent needed`,
        hasPreparationConsent()
          ? "Capture the active prompt or paste one below."
          : "Review the data notice and agree before handling prompt text.",
        false,
        "capture"
      );
    }
  } catch (error) {
    if (checkId !== state.connectionCheckId) return;
    state.target = null;
    el("connectionPill").textContent = "No assistant";
    if (!state.preparing && !state.lastResult) {
      setStatus("Ready", "Open Gemini™ or ChatGPT to connect", error.message, false, "capture");
    }
  } finally {
    if (checkId === state.connectionCheckId) syncActionControls();
  }
}

function scheduleConnectionRefresh() {
  clearTimeout(state.connectionRefreshTimer);
  state.connectionRefreshTimer = setTimeout(() => checkConnection(), 120);
}

async function capturePrompt({ quiet = false } = {}) {
  if (!hasPreparationConsent()) throw new Error("Consent is required before prompt capture.");
  if (!quiet) setStatus("Capture", "Capturing the active prompt", "Reading the selected text or prompt box.", true, "capture");
  const { response, target } = await messageTarget({ type: "TOKEN_OPTIMIZER_CAPTURE" });
  if (!response?.ok) throw new Error(response?.message || `No ${target.label} prompt text found.`);
  clearPreparedResult();
  el("rawPrompt").value = response.prompt;
  updateDraftTokenPill();
  syncActionControls();
  if (!quiet) {
    setStatus("Prepare", "Prompt captured", "Review the draft, then prepare it.", false, "prepare");
    toast("Prompt captured");
  }
  return response.prompt;
}

async function rawPromptForPreparation() {
  let prompt = el("rawPrompt").value.trim();
  if (!prompt) prompt = await capturePrompt({ quiet: true });
  if (!prompt) throw new Error("Paste a prompt or focus a prompt box first.");
  el("rawPrompt").value = prompt;
  return prompt;
}

async function requestPreparation(rawPrompt) {
  const response = await fetch(PREPARE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: rawPrompt,
      source: "browser-extension",
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
  setStatus("Inserted", `Inserted into ${target.label}`, "Review it in the assistant, then send when ready.", false, "insert");
  toast(`Inserted into ${target.label}`);
}

async function preparePrompt() {
  if (!hasPreparationConsent()) {
    setStatus("Ready", "Consent required before preparation", "Review the data notice and check the agreement box first.", false, "prepare");
    return;
  }
  state.preparing = true;
  syncActionControls();
  try {
    const rawPrompt = await rawPromptForPreparation();
    setStatus("Prepare", "Preparing securely", "Using Token Optimizer's deterministic service without running an AI model.", true, "prepare");
    const result = await requestPreparation(rawPrompt);
    state.lastResult = result;
    el("optimizedPrompt").value = result.optimizedPrompt;
    renderPromptDiff(rawPrompt, result.optimizedPrompt);
    renderMetrics(result);
    setStatus("Review", "Review what changed", "Copy the prepared prompt or insert it into the connected assistant.", false, "review");
    toast("Prompt ready to review");
  } catch (error) {
    setStatus("Error", "Could not prepare the prompt", error.message, false, "review");
  } finally {
    state.preparing = false;
    syncActionControls();
  }
}

async function copyPrepared() {
  const prompt = el("optimizedPrompt").value.trim();
  if (!prompt) {
    setStatus("Ready", "Nothing to copy yet", "Prepare a prompt first.", false, "review");
    return;
  }
  await navigator.clipboard.writeText(prompt);
  setStatus("Review", "Prepared prompt copied", "Paste it anywhere, or insert it into the connected assistant.", false, "review");
  toast("Copied");
}

function bindEvents() {
  el("capturePrompt").addEventListener("click", () => capturePrompt().catch((error) => {
    setStatus("Error", "Capture failed", error.message, false, "capture");
  }));
  el("preparePrompt").addEventListener("click", preparePrompt);
  el("insertTarget").addEventListener("click", () => {
    const prompt = el("optimizedPrompt").value.trim();
    if (!prompt) {
      setStatus("Ready", "Prepare first", "There is no prepared prompt to insert yet.", false, "review");
      return;
    }
    insertPreparedPrompt(prompt).catch((error) => setStatus("Error", "Insert failed", error.message, false, "insert"));
  });
  el("copyPrepared").addEventListener("click", copyPrepared);
  el("dataConsent").addEventListener("change", handleConsentChange);
  el("rawPrompt").addEventListener("input", () => {
    clearPreparedResult();
    updateDraftTokenPill();
    syncActionControls();
    const hasDraft = Boolean(el("rawPrompt").value.trim());
    setStatus(
      hasDraft ? "Prepare" : "Capture",
      hasDraft ? "Prompt ready to prepare" : "Paste a prompt or capture from the assistant",
      hasDraft ? "One action prepares it; review follows before copy or insert." : "Connection status refreshes automatically when you switch tabs.",
      false,
      hasDraft ? "prepare" : "capture"
    );
  });

  globalThis.chrome?.tabs?.onActivated?.addListener(scheduleConnectionRefresh);
  globalThis.chrome?.tabs?.onUpdated?.addListener((_tabId, changeInfo) => {
    if (changeInfo.status === "complete" || changeInfo.url) scheduleConnectionRefresh();
  });
  globalThis.window?.addEventListener("focus", scheduleConnectionRefresh);
  document.addEventListener?.("visibilitychange", () => {
    if (!document.hidden) scheduleConnectionRefresh();
  });
}

async function init() {
  bindEvents();
  syncActionControls();
  updateDraftTokenPill();
  await checkConnection();
}

init();

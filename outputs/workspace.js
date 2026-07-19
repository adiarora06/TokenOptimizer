(() => {
  "use strict";

  const historyKey = "tokenOptimizerPromptHistory";
  const auditKey = "tokenOptimizerAuditLog";
  const sessionIdKey = "tokenOptimizerSessionId";
  const sessionStartKey = "tokenOptimizerSessionStart";
  const deviceIdKey = "tokenOptimizerDeviceId";
  const stageOrder = ["understand", "simplify", "execute", "validate"];
  const el = (id) => document.getElementById(id);

  const state = {
    attachedFile: null,
    continuationContext: null,
    events: [],
    lastResult: null,
    lastPrompt: "",
    controller: null,
    startedAt: null,
    finishedElapsedMs: 0,
    stageStartedAt: {},
    running: false,
    toastTimer: null
  };

  function makeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function ensureSession() {
    let id = sessionStorage.getItem(sessionIdKey);
    let startedAt = sessionStorage.getItem(sessionStartKey);
    if (!id || !startedAt) {
      id = makeId("session");
      startedAt = new Date().toISOString();
      sessionStorage.setItem(sessionIdKey, id);
      sessionStorage.setItem(sessionStartKey, startedAt);
    }
    return { id, startedAt };
  }

  function ensureDeviceId() {
    let id = localStorage.getItem(deviceIdKey);
    if (!id) {
      id = makeId("device");
      localStorage.setItem(deviceIdKey, id);
    }
    return id;
  }

  const session = ensureSession();
  const deviceId = ensureDeviceId();

  function estimateTokens(text) {
    return Math.max(0, Math.ceil(String(text || "").length / 4));
  }

  function compactNumber(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return "--";
    if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
    if (number >= 10_000) return `${Math.round(number / 1_000)}k`;
    if (number >= 1_000) return `${(number / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
    return Math.round(number).toLocaleString();
  }

  function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function formatCost(value) {
    if (value == null || value === "") return "N/A";
    const cost = Number(value);
    if (!Number.isFinite(cost) || cost < 0) return "N/A";
    if (cost === 0) return "$0.00";
    if (cost < 0.01) return `$${cost.toFixed(5)}`;
    return `$${cost.toFixed(3)}`;
  }

  function toast(message) {
    const node = el("toast");
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => node.classList.remove("show"), 1800);
  }

  function setServiceState(label, type = "ready") {
    const node = el("serviceState");
    node.dataset.state = type;
    node.querySelector("span:last-child").textContent = label;
  }

  function setLiveStatus(label, detail, type = "ready", stage = null) {
    el("liveLabel").textContent = label;
    el("liveDetail").textContent = detail;
    el("liveDot").dataset.state = type;
    document.querySelectorAll("[data-live-step]").forEach((node) => {
      const step = node.dataset.liveStep;
      const activeIndex = stage ? stageOrder.indexOf(stage) : -1;
      const nodeIndex = stageOrder.indexOf(step);
      if (type === "error" && step === stage) node.dataset.status = "error";
      else if (activeIndex >= 0 && nodeIndex < activeIndex) node.dataset.status = "done";
      else if (step === stage && type === "running") node.dataset.status = "active";
      else if (step === stage && type === "ready") node.dataset.status = "done";
      else delete node.dataset.status;
    });
  }

  function routeAnalysis(text, preference = "auto") {
    const lower = String(text || "").toLowerCase();
    const tokens = estimateTokens(text);
    const structured = /\b(json|yaml|schema|table|csv|xml|exact format)\b/.test(lower);
    const highImpact = /\b(delete|publish|deploy|migrate|production|security|legal|medical|financial|payment|credential)\b/.test(lower);
    const explicitCheck = /\b(verify|validate|double-check|test thoroughly|review for errors|fact-check)\b/.test(lower);
    const deliverables = (text.match(/\b(and|also|plus|then)\b/gi) || []).length;
    let complexity = Number(tokens > 140) + Number(tokens > 360) + Number(structured) + Number(deliverables >= 3) + Number(highImpact || explicitCheck);
    let route = complexity <= 1 ? "direct" : complexity <= 4 && !(highImpact && explicitCheck) ? "contract" : "full";
    if (preference === "fast") route = "direct";
    if (preference === "thorough" && route === "direct") route = "contract";
    if (preference === "verified") route = "full";
    const reason = route === "direct"
      ? "A single call can cover this request without adding workflow overhead."
      : route === "contract"
        ? "The request has several requirements, so compact structured context helps prevent drift."
        : "The request is complex or high-impact enough to justify a separate validation pass.";
    return { tokens, route, reason, routeReason: reason, complexity };
  }

  function contextInput() {
    const parts = [el("prompt").value.trim()];
    if (state.continuationContext) {
      parts.push(`\nPrevious result context:\n${state.continuationContext}`);
    }
    if (state.attachedFile) {
      parts.push(`\nAttached file: ${state.attachedFile.name}\n---\n${state.attachedFile.text}\n---`);
    }
    return parts.filter(Boolean).join("\n").trim();
  }

  function refreshContextChip() {
    const items = [];
    if (state.attachedFile) items.push(state.attachedFile.name);
    if (state.continuationContext) items.push("Previous result context");
    el("attachmentRow").classList.toggle("hidden", !items.length);
    el("attachmentName").textContent = items.length > 1 ? `${items.length} context items` : items[0] || "";
  }

  function refreshPreflight() {
    const input = contextInput();
    const analysis = routeAnalysis(input, el("routePreference").value);
    el("tokenEstimate").textContent = `About ${compactNumber(analysis.tokens)} input tokens`;
    if (!state.lastResult && !state.running) {
      el("routeReason").textContent = input
        ? analysis.reason
        : "Automatic mode chooses the least expensive route that can still cover the request.";
      el("routeFacts").innerHTML = `
        <div><dt>Likely route</dt><dd>${routeLabel(analysis.route)}</dd></div>
        <div><dt>Usage</dt><dd>Measured after run</dd></div>
      `;
    }
  }

  function routeLabel(route) {
    return route === "direct" ? "Direct" : route === "contract" ? "Compact" : route === "full" ? "Verified" : "Automatic";
  }

  function timelineStepFor(stage) {
    if (["understand", "intake", "preflight"].includes(stage)) return "understand";
    if (["route", "simplify", "contract", "optimize"].includes(stage)) return "simplify";
    if (["execute", "adapter"].includes(stage)) return "execute";
    if (["verify", "validate", "complete", "save"].includes(stage)) return "validate";
    return "execute";
  }

  function resetTimeline() {
    state.events = [];
    state.stageStartedAt = {};
    document.querySelectorAll(".timeline-step").forEach((node) => {
      node.dataset.status = "ready";
      node.querySelector("time").textContent = "--:--";
    });
    document.querySelectorAll("[data-live-step]").forEach((node) => delete node.dataset.status);
    el("timelineSummary").dataset.state = "running";
    el("timelineSummary").querySelector(".summary-state").innerHTML = '<i class="ti ti-point-filled" aria-hidden="true"></i> Running';
    el("timelineSummary").querySelector("strong").textContent = "Starting run";
  }

  function updateTimeline(event) {
    const step = timelineStepFor(event.stage || event.phase || "execute");
    const node = document.querySelector(`[data-step="${step}"]`);
    if (!node) return;
    const status = event.status === "error" ? "error" : event.status === "skipped" ? "skipped" : event.status === "done" || event.status === "completed" ? "done" : "active";
    const now = Date.now();
    if (!state.stageStartedAt[step]) state.stageStartedAt[step] = now;
    node.dataset.status = status;
    if (status !== "active") node.querySelector("time").textContent = formatDuration(now - state.stageStartedAt[step]);
    const detail = String(event.detail || "").trim();
    if (detail) node.querySelector("p").textContent = detail;

    const activeIndex = stageOrder.indexOf(step);
    document.querySelectorAll(".timeline-step").forEach((candidate) => {
      const candidateIndex = stageOrder.indexOf(candidate.dataset.step);
      if (candidateIndex < activeIndex && candidate.dataset.status !== "error") candidate.dataset.status = "done";
    });

    el("runningMessage").textContent = detail || "Working on the request...";
    el("timelineSummary").querySelector("strong").textContent = detail || "Run in progress";
    const liveType = status === "error" ? "error" : status === "done" ? "ready" : "running";
    setLiveStatus(status === "error" ? "Needs attention" : "Running", detail || "Working on the request.", liveType, step);
  }

  function setRunView(view) {
    el("emptyResult").classList.toggle("hidden", view !== "empty");
    el("runningResult").classList.toggle("hidden", view !== "running");
    el("completedResult").classList.toggle("hidden", view !== "completed");
    el("errorResult").classList.toggle("hidden", view !== "error");
  }

  function setRunning(running) {
    state.running = running;
    el("runButton").classList.toggle("hidden", running);
    el("cancelButton").classList.toggle("hidden", !running);
    el("prompt").disabled = running;
    el("routePreference").disabled = running;
    el("fileInput").disabled = running;
    if (running) {
      document.activeElement?.blur();
      state.startedAt = Date.now();
      state.finishedElapsedMs = 0;
      setServiceState("Running", "running");
    } else {
      checkService();
    }
  }

  function resetMetrics() {
    el("inputTokens").textContent = "--";
    el("outputTokens").textContent = "--";
    el("estimatedCost").textContent = "--";
    el("elapsedTime").textContent = "00:00";
    el("runStatus").dataset.state = "running";
    el("runStatus").innerHTML = '<i class="ti ti-point-filled" aria-hidden="true"></i> Running';
    el("modelCallCount").textContent = "Waiting for usage";
  }

  function renderMarkdown(target, markdown) {
    const source = String(markdown || "");
    if (window.marked?.parse && window.DOMPurify?.sanitize) {
      const rendered = window.marked.parse(source, { gfm: true, breaks: true });
      target.innerHTML = window.DOMPurify.sanitize(rendered, { USE_PROFILES: { html: true } });
      target.querySelectorAll("a").forEach((link) => {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      });
      return;
    }
    target.textContent = source;
  }

  function resultTitle(result, prompt) {
    const answer = String(result.finalAnswer || "");
    const heading = answer.split(/\r?\n/).find((line) => /^#{1,3}\s+/.test(line));
    const raw = heading ? heading.replace(/^#{1,3}\s+/, "") : prompt.replace(/\s+/g, " ").trim();
    return raw.length > 72 ? `${raw.slice(0, 69)}...` : raw || "Completed result";
  }

  function renderMetrics(result) {
    const report = result.tokenReport || {};
    const actual = report.actualUsageSource === "provider";
    el("inputTokens").textContent = actual ? compactNumber(report.actualInputTokens) : compactNumber(report.optimizedPromptTokens || report.rawInputTokens);
    el("outputTokens").textContent = actual ? compactNumber(report.actualOutputTokens) : "N/A";
    el("estimatedCost").textContent = formatCost(report.estimatedCostUsd);
    el("elapsedTime").textContent = formatDuration(result.elapsedMs);
    el("inputTokenSource").textContent = actual ? "Provider measured" : "Prompt estimate";
    el("costSource").textContent = report.estimatedCostUsd == null ? "Pricing unavailable" : "Based on configured rates";
    const isComplete = result.executionStatus === "completed";
    el("runStatus").dataset.state = isComplete ? "ready" : "error";
    el("runStatus").innerHTML = `<i class="ti ti-point-filled" aria-hidden="true"></i> ${isComplete ? "Completed" : "Needs attention"}`;
    el("modelCallCount").textContent = `${report.modelCalls || 0} model call${report.modelCalls === 1 ? "" : "s"}`;
  }

  function renderRouteDetails(result) {
    const report = result.tokenReport || {};
    const comparison = report.comparison || {};
    el("routeReason").textContent = result.workflowShape?.routeReason || report.routeReason || "Automatic route selected.";
    el("routeFacts").innerHTML = `
      <div><dt>Route</dt><dd>${routeLabel(result.workflowShape?.route || report.adaptiveRoute)}</dd></div>
      <div><dt>Model calls</dt><dd>${report.modelCalls || 0}</dd></div>
      <div><dt>Usage source</dt><dd>${report.actualUsageSource === "provider" ? "Measured" : "Estimated"}</dd></div>
      <div><dt>Context comparison</dt><dd>${comparison.estimatedContextSavingsPercent || 0}% estimated</dd></div>
    `;
  }

  function renderCompleted(result, prompt) {
    state.lastResult = result;
    const title = resultTitle(result, prompt);
    el("resultTitle").textContent = title;
    el("dialogTitle").textContent = title;
    renderMarkdown(el("resultPreview"), result.finalAnswer);
    renderMarkdown(el("dialogResult"), result.finalAnswer);
    el("resultPreview").classList.add("is-collapsed");
    el("expandResult").classList.remove("hidden");
    el("expandResult").innerHTML = '<span>Open full result</span><i class="ti ti-chevron-down" aria-hidden="true"></i>';
    const report = result.tokenReport || {};
    const comparison = report.comparison || {};
    const notes = [
      `${routeLabel(result.workflowShape?.route || report.adaptiveRoute)} route`,
      report.actualUsageSource === "provider" ? `${compactNumber(report.actualTotalTokens)} measured total tokens` : "Usage estimated",
      comparison.estimatedContextSavingsPercent > 0 ? `${comparison.estimatedContextSavingsPercent}% estimated context reduction` : "No context reduction claimed"
    ];
    if (result.securityReport?.redactions) notes.push(`${result.securityReport.redactions} sensitive value${result.securityReport.redactions === 1 ? "" : "s"} removed`);
    el("resultFootnote").innerHTML = notes.map((note) => `<span>${escapeHtml(note)}</span>`).join("");
    renderMetrics(result);
    renderRouteDetails(result);
    setRunView("completed");
  }

  function renderError(result) {
    state.lastResult = result;
    el("errorMessage").textContent = result.providerError || "The model route was unavailable. Your prepared prompt is still available to copy.";
    renderMetrics(result);
    renderRouteDetails(result);
    setRunView("error");
    el("timelineSummary").dataset.state = "error";
    el("timelineSummary").querySelector(".summary-state").innerHTML = '<i class="ti ti-point-filled" aria-hidden="true"></i> Needs attention';
    el("timelineSummary").querySelector("strong").textContent = result.providerError || "Execution stopped";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function loadArray(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function saveRun(prompt, result) {
    const now = new Date().toISOString();
    const title = prompt.replace(/\s+/g, " ").trim().slice(0, 90) || "Untitled run";
    const report = result.tokenReport || {};
    const comparison = report.comparison || {};
    const id = makeId("run");
    const history = loadArray(historyKey);
    history.unshift({
      id,
      prompt,
      title,
      route: result.workflowShape?.route || report.adaptiveRoute || "automatic",
      mode: "workspace",
      status: result.executionStatus || "completed",
      createdAt: now,
      sessionId: session.id
    });
    localStorage.setItem(historyKey, JSON.stringify(history.slice(0, 50)));

    const audit = loadArray(auditKey);
    audit.unshift({
      id,
      title,
      mode: "workspace",
      provider: result.workflowShape?.route || report.adaptiveRoute || "automatic",
      route: result.workflowShape?.route || report.adaptiveRoute || "automatic",
      status: result.executionStatus || "completed",
      createdAt: now,
      sessionId: session.id,
      rawTokens: report.rawInputTokens || estimateTokens(prompt),
      optimizedTokens: report.actualInputTokens || report.optimizedPromptTokens || 0,
      naiveTokens: comparison.estimatedBaselineInputTokens || report.estimatedNaiveThreeStepTokens || 0,
      savedTokens: comparison.estimatedContextSavingsTokens || report.estimatedSavingsTokens || 0,
      savingsPercent: comparison.estimatedContextSavingsPercent || report.estimatedSavingsPercent || 0,
      actualInputTokens: report.actualInputTokens || 0,
      actualOutputTokens: report.actualOutputTokens || 0,
      actualTotalTokens: report.actualTotalTokens || 0,
      estimatedCostUsd: report.estimatedCostUsd ?? null,
      usageSource: report.actualUsageSource || "estimated",
      elapsedMs: result.elapsedMs || 0,
      modelCalls: report.modelCalls || 0,
      routeReason: result.workflowShape?.routeReason || report.routeReason || "",
      phases: state.events.slice(-12)
    });
    localStorage.setItem(auditKey, JSON.stringify(audit.slice(0, 100)));
  }

  async function parseEventStream(response, onEvent) {
    if (!response.body?.getReader) throw new Error("Live response streaming is not available in this browser.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult = null;

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let eventName = "message";
        const dataLines = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length) {
          const payload = JSON.parse(dataLines.join("\n"));
          if (eventName === "result") finalResult = payload.result;
          else if (eventName === "error") throw new Error(payload.error || "Run failed");
          else onEvent(payload);
        }
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
    return finalResult;
  }

  async function run() {
    if (state.running) return;
    const visiblePrompt = el("prompt").value.trim();
    const input = contextInput();
    if (!visiblePrompt) {
      toast("Describe what you want done first.");
      el("prompt").focus();
      return;
    }

    state.lastPrompt = visiblePrompt;
    state.lastResult = null;
    state.controller = new AbortController();
    setRunning(true);
    resetTimeline();
    resetMetrics();
    setRunView("running");
    setLiveStatus("Running", "Understanding the request.", "running", "understand");

    try {
      const response = await fetch("/api/optimize-stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          "x-token-optimizer-device": deviceId
        },
        body: JSON.stringify({
          input,
          provider: "groq-openai-fallback",
          source: "workspace",
          sessionId: session.id,
          options: { routePreference: el("routePreference").value }
        }),
        signal: state.controller.signal
      });

      if (!response.ok) {
        let message = `Run failed with HTTP ${response.status}`;
        try {
          const data = await response.json();
          message = data.error || message;
        } catch {}
        throw new Error(message);
      }

      const result = await parseEventStream(response, (event) => {
        state.events.push({
          agent: timelineStepFor(event.stage || event.phase || "execute"),
          phase: event.stage || event.phase || "execute",
          detail: String(event.detail || "").trim(),
          status: event.status || "active",
          at: new Date().toISOString()
        });
        updateTimeline(event);
      });
      if (!result) throw new Error("The run ended without a result.");
      state.finishedElapsedMs = result.elapsedMs || Date.now() - state.startedAt;
      saveRun(visiblePrompt, result);
      if (result.executionStatus === "completed" && result.finalAnswer) {
        renderCompleted(result, visiblePrompt);
        updateTimeline({ stage: "validate", status: "done", detail: "Result checked and ready." });
        el("timelineSummary").dataset.state = "ready";
        el("timelineSummary").querySelector(".summary-state").innerHTML = '<i class="ti ti-circle-check-filled" aria-hidden="true"></i> Completed';
        el("timelineSummary").querySelector("strong").textContent = `Finished in ${formatDuration(state.finishedElapsedMs)}`;
        setLiveStatus("Completed", "Result ready to open, copy, or continue.", "ready", "validate");
      } else {
        renderError(result);
        setLiveStatus("Needs attention", result.providerError || "Execution could not finish.", "error", "execute");
      }
    } catch (error) {
      if (error.name === "AbortError") {
        const cancelled = {
          executionStatus: "cancelled",
          providerError: "Run cancelled",
          optimizedPrompt: state.lastResult?.optimizedPrompt || input,
          tokenReport: { rawInputTokens: estimateTokens(input), actualUsageSource: "unavailable", modelCalls: 0 },
          workflowShape: routeAnalysis(input, el("routePreference").value),
          elapsedMs: Date.now() - state.startedAt
        };
        renderError(cancelled);
        setLiveStatus("Cancelled", "The run was stopped before completion.", "error", "execute");
      } else {
        const failed = {
          executionStatus: "provider_error",
          providerError: error.message,
          optimizedPrompt: input,
          tokenReport: { rawInputTokens: estimateTokens(input), actualUsageSource: "unavailable", modelCalls: 0 },
          workflowShape: routeAnalysis(input, el("routePreference").value),
          elapsedMs: Date.now() - state.startedAt
        };
        renderError(failed);
        setLiveStatus("Needs attention", error.message, "error", "execute");
      }
    } finally {
      setRunning(false);
      state.controller = null;
    }
  }

  async function copyText(text, message) {
    await navigator.clipboard.writeText(String(text || ""));
    toast(message);
  }

  function suggestedFilename(prompt, result) {
    const match = String(prompt || "").match(/\b([A-Za-z0-9_-]+\.(?:md|txt|json|ya?ml|csv|xml|js|ts|jsx|tsx|py|html|css|sql|java|go|rs|c|cpp))\b/i);
    if (match) return match[1];
    const style = result?.handoffContract?.output_style || "";
    if (/structured/i.test(style)) return "optimized-result.json";
    if (/code/i.test(style)) return "optimized-result.md";
    return "optimized-result.md";
  }

  function downloadResult() {
    if (!state.lastResult?.finalAnswer) return;
    const blob = new Blob([state.lastResult.finalAnswer], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = suggestedFilename(state.lastPrompt, state.lastResult);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    toast("Result downloaded.");
  }

  function continueFromResult() {
    if (!state.lastResult?.finalAnswer) return;
    const contract = state.lastResult.handoffContract || {};
    state.continuationContext = [
      `Goal: ${contract.goal || state.lastPrompt}`,
      `Previous result:\n${state.lastResult.finalAnswer}`
    ].join("\n\n");
    el("prompt").value = "";
    el("prompt").placeholder = "What should happen next?";
    refreshContextChip();
    refreshPreflight();
    el("prompt").focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast("Previous result attached as context.");
  }

  function toggleInlineResult() {
    const preview = el("resultPreview");
    const collapsed = preview.classList.toggle("is-collapsed");
    el("expandResult").innerHTML = collapsed
      ? '<span>Open full result</span><i class="ti ti-chevron-down" aria-hidden="true"></i>'
      : '<span>Collapse result</span><i class="ti ti-chevron-up" aria-hidden="true"></i>';
  }

  async function handleAttachment(file) {
    if (!file) return;
    if (file.size > 1_000_000) {
      toast("Please attach a text file smaller than 1 MB.");
      el("fileInput").value = "";
      return;
    }
    try {
      const text = await file.text();
      if (text.length + el("prompt").value.length > 80_000) {
        toast("The prompt and attachment together must stay under 80,000 characters.");
        el("fileInput").value = "";
        return;
      }
      state.attachedFile = { name: file.name, text };
      refreshContextChip();
      refreshPreflight();
      toast(`${file.name} attached.`);
    } catch {
      toast("That file could not be read as text.");
    }
  }

  function removeContext() {
    state.attachedFile = null;
    state.continuationContext = null;
    el("fileInput").value = "";
    refreshContextChip();
    refreshPreflight();
  }

  async function checkService() {
    try {
      const response = await fetch("/api/provider-status", { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("Unavailable");
      const data = await response.json();
      setServiceState(data.groqConfigured || data.openaiConfigured ? "Ready" : "Setup needed", data.groqConfigured || data.openaiConfigured ? "ready" : "error");
    } catch {
      setServiceState("Checking connection", "error");
    }
  }

  function restoreInput() {
    const keys = ["tokenOptimizerLandingInput", "tokenOptimizerA2AInput"];
    for (const key of keys) {
      try {
        const value = JSON.parse(localStorage.getItem(key) || "null");
        const prompt = value?.prompt || value?.rawInput || value?.input;
        if (prompt) {
          el("prompt").value = prompt;
          localStorage.removeItem(key);
          break;
        }
      } catch {}
    }
  }

  function bindEvents() {
    el("prompt").addEventListener("input", refreshPreflight);
    el("routePreference").addEventListener("change", refreshPreflight);
    el("runButton").addEventListener("click", run);
    el("retryButton").addEventListener("click", run);
    el("cancelButton").addEventListener("click", () => state.controller?.abort());
    el("fileInput").addEventListener("change", (event) => handleAttachment(event.target.files?.[0]));
    el("removeAttachment").addEventListener("click", removeContext);
    el("exampleButton").addEventListener("click", () => {
      el("prompt").value = "Create a Python program that runs binary search over numbers 0 through 69 to find 7. Report the number of comparisons and include a compact text diagram of each search step.";
      refreshPreflight();
      el("prompt").focus();
    });
    el("copyResult").addEventListener("click", () => copyText(state.lastResult?.finalAnswer, "Result copied."));
    el("dialogCopy").addEventListener("click", () => copyText(state.lastResult?.finalAnswer, "Result copied."));
    el("copyOptimizedPrompt").addEventListener("click", () => copyText(state.lastResult?.optimizedPrompt || contextInput(), "Prepared prompt copied."));
    el("downloadResult").addEventListener("click", downloadResult);
    el("continueButton").addEventListener("click", continueFromResult);
    el("dialogContinue").addEventListener("click", () => {
      el("resultDialog").close();
      continueFromResult();
    });
    el("expandResult").addEventListener("click", toggleInlineResult);
    el("openResult").addEventListener("click", () => el("resultDialog").showModal());
    el("closeDialog").addEventListener("click", () => el("resultDialog").close());
    el("resultDialog").addEventListener("click", (event) => {
      if (event.target === el("resultDialog")) el("resultDialog").close();
    });
    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        run();
      }
      if (event.key === "Escape" && state.running) state.controller?.abort();
    });
  }

  function startClock() {
    const tick = () => {
      if (state.running && state.startedAt) {
        const elapsed = Date.now() - state.startedAt;
        el("elapsedTime").textContent = formatDuration(elapsed);
        el("liveClock").textContent = formatDuration(elapsed);
      } else if (state.finishedElapsedMs) {
        el("liveClock").textContent = formatDuration(state.finishedElapsedMs);
      } else {
        el("liveClock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      }
    };
    tick();
    setInterval(tick, 1000);
  }

  restoreInput();
  bindEvents();
  refreshContextChip();
  refreshPreflight();
  checkService();
  startClock();
})();

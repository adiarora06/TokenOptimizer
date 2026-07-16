const {
  runBlankA2AKit,
  runSelfOptimizingWorkflow
} = require("./optimizer-core.cjs");

const MAX_RUNS = 60;

const SYSTEM_ARCHITECTURE = {
  layers: [
    {
      id: "workspace",
      name: "Workspace UI",
      responsibility: "Collect the messy prompt once, show live status, and keep advanced details collapsed until requested."
    },
    {
      id: "preflight-worker",
      name: "Background Preflight Worker",
      responsibility: "Estimate tokens, detect constraints, build a local contract preview, and recommend direct, contract, or full verification routes while the user types."
    },
    {
      id: "system-runner",
      name: "System Runner",
      responsibility: "Create run IDs, track stages, queue local work, and return stable snapshots to the UI."
    },
    {
      id: "optimizer-core",
      name: "Optimizer Core",
      responsibility: "Run the adaptive workflow graph, typed contracts, provider adapters, verifier, fallback, and token report logic."
    },
    {
      id: "provider-adapters",
      name: "Provider Adapters",
      responsibility: "Hide provider-specific model details behind one contract-ready execution interface."
    },
    {
      id: "local-storage",
      name: "Local Usage Store",
      responsibility: "Save history, audit records, session metadata, and usage stats in the user's browser."
    }
  ],
  flow: [
    ["workspace", "preflight-worker"],
    ["workspace", "system-runner"],
    ["system-runner", "optimizer-core"],
    ["optimizer-core", "provider-adapters"],
    ["provider-adapters", "optimizer-core"],
    ["optimizer-core", "system-runner"],
    ["system-runner", "workspace"],
    ["workspace", "local-storage"]
  ]
};

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || "").length / 4));
}

function compactTitle(text) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (!compact) return "Untitled run";
  return compact.length > 86 ? `${compact.slice(0, 83)}...` : compact;
}

function createId(prefix = "run") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function baseStages(runType) {
  const contractLabel = runType === "kit" ? "Kit Contract" : "Contract";
  return [
    { id: "queued", label: "Queued", status: "done", detail: "System runner accepted the job." },
    { id: "preflight", label: "Preflight", status: "pending", detail: "Estimate tokens and choose the leanest route." },
    { id: "intake", label: "Intake", status: "pending", detail: "Read the raw prompt once." },
    { id: "route", label: "Route", status: "pending", detail: "Pick direct, contract, or full verification." },
    { id: "contract", label: contractLabel, status: "pending", detail: "Build compact typed state." },
    { id: "execute", label: "Execute", status: "pending", detail: "Run from the leanest valid payload." },
    { id: "verify", label: "Verify", status: "pending", detail: "Check constraints without extra model calls unless needed." },
    { id: "save", label: "Save", status: "pending", detail: "Return result for browser history and stats." }
  ];
}

function updateStage(run, stageId, status, detail) {
  run.stages = run.stages.map((stage) => {
    if (stage.id !== stageId) return stage;
    return {
      ...stage,
      status,
      detail: detail || stage.detail,
      at: nowIso()
    };
  });
  run.phase = stageId;
  run.currentStage = run.stages.find((stage) => stage.id === stageId) || run.currentStage;
  run.updatedAt = nowIso();
}

function stageFromTrace(traceItem = {}) {
  const raw = String(traceItem.phase || "").toLowerCase();
  if (raw.includes("contract")) return "contract";
  if (raw.includes("route")) return "route";
  if (raw.includes("preflight")) return "preflight";
  if (raw.includes("execute")) return "execute";
  if (raw.includes("verify")) return "verify";
  if (raw.includes("intake")) return "intake";
  if (raw.includes("fallback")) return "verify";
  if (raw.includes("offline")) return "execute";
  return raw || "execute";
}

function applyResultTrace(run, result) {
  for (const item of result?.trace || []) {
    const stageId = stageFromTrace(item);
    if (run.stages.some((stage) => stage.id === stageId)) {
      updateStage(run, stageId, item.status || "done", item.detail || item.phase);
    }
  }
  for (const stage of run.stages) {
    if (stage.status === "pending") updateStage(run, stage.id, "done");
  }
}

function publicRun(run) {
  return {
    id: run.id,
    runType: run.runType,
    status: run.status,
    phase: run.phase,
    title: run.title,
    progress: run.progress,
    currentStage: run.currentStage,
    stages: run.stages,
    tokenEstimate: run.tokenEstimate,
    route: run.route,
    source: run.source,
    sessionId: run.sessionId,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt,
    elapsedMs: run.elapsedMs,
    error: run.error,
    result: run.result || null
  };
}

async function executeSystemRun(run, payload = {}) {
  const started = Date.now();
  run.status = "running";
  run.progress = 10;
  updateStage(run, "preflight", "running", "Estimating token pressure and route shape.");
  updateStage(run, "preflight", "done", "Preflight snapshot is ready.");
  run.progress = 20;
  updateStage(run, "intake", "running", "Reading raw prompt once and building a run snapshot.");
  updateStage(run, "intake", "done", `${run.tokenEstimate} estimated input tokens captured.`);
  run.progress = 32;
  updateStage(run, "route", "running", "Selecting the leanest valid workflow route.");
  updateStage(run, "route", "done", "Adaptive route selected.");
  run.progress = 42;
  updateStage(run, "contract", "running", "Creating contract-shaped state before downstream work.");

  try {
    const result = run.runType === "kit"
      ? await runBlankA2AKit({
        rawInput: payload.rawInput,
        providerConfig: payload.providerConfig || {},
        options: payload.options || {}
      })
      : await runSelfOptimizingWorkflow({
        rawInput: payload.rawInput,
        provider: payload.provider || "groq-openai-fallback"
      });

    run.result = result;
    run.status = "completed";
    run.progress = 100;
    applyResultTrace(run, result);
    updateStage(run, "save", "done", "Result ready for browser history, audit log, and stats.");
    run.finishedAt = nowIso();
    run.elapsedMs = Date.now() - started;
  } catch (error) {
    run.status = "failed";
    run.error = error.message;
    run.progress = Math.max(run.progress, 72);
    updateStage(run, "verify", "error", error.message);
    run.finishedAt = nowIso();
    run.elapsedMs = Date.now() - started;
  }

  run.updatedAt = nowIso();
  return run;
}

function createRun(payload = {}) {
  const rawInput = String(payload.rawInput || "");
  const runType = payload.runType === "kit" ? "kit" : "optimizer";
  const route = runType === "kit"
    ? payload.providerConfig?.provider || "kit-auto"
    : payload.provider || "groq-openai-fallback";

  return {
    id: createId(runType),
    runType,
    status: "queued",
    phase: "queued",
    title: compactTitle(rawInput),
    progress: 4,
    currentStage: { id: "queued", label: "Queued", status: "done", detail: "System runner accepted the job." },
    stages: baseStages(runType),
    tokenEstimate: estimateTokens(rawInput),
    route,
    source: payload.source || "workspace",
    sessionId: payload.sessionId || null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    finishedAt: null,
    elapsedMs: null,
    error: null,
    result: null
  };
}

function createOptimizerSystem() {
  const runs = new Map();

  function remember(run) {
    runs.set(run.id, run);
    const sorted = [...runs.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    for (const stale of sorted.slice(MAX_RUNS)) runs.delete(stale.id);
  }

  function start(payload) {
    const run = createRun(payload);
    remember(run);
    setTimeout(() => {
      executeSystemRun(run, payload).catch((error) => {
        run.status = "failed";
        run.error = error.message;
        run.updatedAt = nowIso();
      });
    }, 0);
    return publicRun(run);
  }

  function get(id) {
    const run = runs.get(id);
    return run ? publicRun(run) : null;
  }

  function list() {
    return [...runs.values()]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(publicRun);
  }

  return {
    architecture: SYSTEM_ARCHITECTURE,
    start,
    get,
    list
  };
}

async function runSystemRunInline(payload = {}) {
  const run = createRun(payload);
  await executeSystemRun(run, payload);
  return publicRun(run);
}

module.exports = {
  SYSTEM_ARCHITECTURE,
  createOptimizerSystem,
  runSystemRunInline
};

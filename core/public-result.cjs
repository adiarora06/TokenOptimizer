const { redactSensitiveText } = require("./security.cjs");

const REDACTED_SECRET = "[REDACTED_SECRET]";

const PUBLIC_RESULT_FIELDS = Object.freeze([
  "traceId",
  "mode",
  "provider",
  "providerLabel",
  "model",
  "providerError",
  "executionStatus",
  "qualityStatus",
  "acceptanceReport",
  "repairReport",
  "workflowShape",
  "securityReport",
  "finalAnswer",
  "providerUsage",
  "trace",
  "tokenReport",
  "elapsedMs"
]);

const PREPARED_ARTIFACT_FIELDS = Object.freeze([
  "optimizedPrompt",
  "optimizedPrompts"
]);

const SECRET_CONFIG_KEY = /(?:API_?KEY|ACCESS_?KEY|AUTH_?TOKEN|TOKEN|SECRET|PASSWORD|PASSCODE|CREDENTIALS?|PRIVATE_?KEY|CLIENT_?SECRET|DATABASE_URL|REDIS_URL|MONGODB_URI|POSTGRES_URL)$/i;

function appendSecretValues(target, value, seen = new WeakSet()) {
  if (typeof value === "string") {
    // Very short configured values (for example "0" or "on") are common
    // flags and would corrupt unrelated public text if replaced literally.
    if (value.trim().length >= 8) target.push(value);
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value) || value instanceof Set) {
    for (const item of value) appendSecretValues(target, item, seen);
    return;
  }
  for (const item of Object.values(value)) appendSecretValues(target, item, seen);
}

function collectConfiguredSecretValues(options = {}) {
  const values = [];
  const env = options.env === undefined ? process.env : options.env;
  if (env && typeof env === "object") {
    for (const [name, value] of Object.entries(env)) {
      if (SECRET_CONFIG_KEY.test(name)) appendSecretValues(values, value);
    }
  }
  appendSecretValues(values, options.secretValues);
  return [...new Set(values)].sort((left, right) => right.length - left.length);
}

function redactString(value, secretValues) {
  let redacted = redactSensitiveText(value).text;
  for (const secret of secretValues) {
    if (redacted.includes(secret)) redacted = redacted.split(secret).join(REDACTED_SECRET);
  }
  return redacted;
}

function redactPublicValue(value, secretValues = [], ancestors = new WeakSet()) {
  if (typeof value === "string") return redactString(value, secretValues);
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value !== "object") return undefined;
  if (ancestors.has(value)) return "[Circular]";

  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((item) => redactPublicValue(item, secretValues, ancestors));
  } else if (value instanceof Date) {
    result = redactString(value.toISOString(), secretValues);
  } else {
    result = {};
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) continue;
      const safeKey = redactString(key, secretValues);
      const safeValue = redactPublicValue(descriptor.value, secretValues, ancestors);
      if (safeValue === undefined) continue;
      Object.defineProperty(result, safeKey, {
        configurable: true,
        enumerable: true,
        value: safeValue,
        writable: true
      });
    }
  }
  ancestors.delete(value);
  return result;
}

function contractMetadata(contract) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) return undefined;
  const metadata = {};
  if (Object.prototype.hasOwnProperty.call(contract, "contract_id")) {
    metadata.contract_id = contract.contract_id;
  }
  if (contract.token_budget && typeof contract.token_budget === "object" && !Array.isArray(contract.token_budget)) {
    metadata.token_budget = {};
    for (const field of ["raw_input_estimate", "handoff_target", "executor_target", "executor_max"]) {
      if (Object.prototype.hasOwnProperty.call(contract.token_budget, field)) {
        metadata.token_budget[field] = contract.token_budget[field];
      }
    }
  }
  for (const field of ["required_payload", "forbidden_payload"]) {
    if (Array.isArray(contract[field])) metadata[field] = contract[field].filter((item) => typeof item === "string");
  }
  const contentCounts = {};
  for (const field of ["facts", "constraints", "decisions", "required_output", "sources", "open_questions"]) {
    if (Array.isArray(contract[field])) contentCounts[field] = contract[field].length;
  }
  if (Object.keys(contentCounts).length) metadata.content_counts = contentCounts;
  return metadata;
}

function kitMetadata(kit) {
  if (!kit || typeof kit !== "object" || Array.isArray(kit)) return undefined;
  const metadata = {};
  for (const field of ["kit_id", "mode", "architecture"]) {
    if (Object.prototype.hasOwnProperty.call(kit, field)) metadata[field] = kit[field];
  }
  if (Array.isArray(kit.agents)) {
    metadata.agents = kit.agents.map((agent) => {
      if (!agent || typeof agent !== "object" || Array.isArray(agent)) return {};
      const publicAgent = {};
      for (const field of ["id", "name", "responsibility", "receives", "sends"]) {
        if (Object.prototype.hasOwnProperty.call(agent, field)) publicAgent[field] = agent[field];
      }
      return publicAgent;
    });
  }
  if (Array.isArray(kit.handoff_rules)) {
    metadata.handoff_rules = kit.handoff_rules.filter((item) => typeof item === "string");
  }
  if (kit.a2a_compatibility && typeof kit.a2a_compatibility === "object" && !Array.isArray(kit.a2a_compatibility)) {
    metadata.a2a_compatibility = {};
    for (const field of ["role", "note"]) {
      if (Object.prototype.hasOwnProperty.call(kit.a2a_compatibility, field)) {
        metadata.a2a_compatibility[field] = kit.a2a_compatibility[field];
      }
    }
  }
  if (kit.handoff_contract) metadata.handoff_contract = contractMetadata(kit.handoff_contract);
  return metadata;
}

function validationMetadata(validation) {
  if (!validation || typeof validation !== "object" || Array.isArray(validation)) return undefined;
  const metadata = {};
  for (const field of ["source", "issues", "status", "valid", "usedFallback", "finishReason"]) {
    if (Object.prototype.hasOwnProperty.call(validation, field)) metadata[field] = validation[field];
  }
  return metadata;
}

function projectPublicResult(result, options = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return {};

  const projected = {};
  for (const field of PUBLIC_RESULT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(result, field)) projected[field] = result[field];
  }

  const includePreparedArtifacts = options.includePreparedArtifacts === true;
  if (Object.prototype.hasOwnProperty.call(result, "kit")) {
    projected.kit = includePreparedArtifacts ? result.kit : kitMetadata(result.kit);
  }
  if (Object.prototype.hasOwnProperty.call(result, "handoffContract")) {
    projected.handoffContract = includePreparedArtifacts
      ? result.handoffContract
      : contractMetadata(result.handoffContract);
  }
  if (Object.prototype.hasOwnProperty.call(result, "contractValidation")) {
    projected.contractValidation = validationMetadata(result.contractValidation);
  }
  if (includePreparedArtifacts) {
    for (const field of PREPARED_ARTIFACT_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(result, field)) projected[field] = result[field];
    }
  }

  return redactPublicValue(projected, collectConfiguredSecretValues(options));
}

module.exports = {
  PREPARED_ARTIFACT_FIELDS,
  PUBLIC_RESULT_FIELDS,
  REDACTED_SECRET,
  collectConfiguredSecretValues,
  projectPublicResult,
  redactPublicValue
};

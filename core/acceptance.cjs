const { redactSensitiveText } = require("./security.cjs");

const ACCEPTANCE_VERSION = "1.0.0";
const REPAIR_VERSION = "1.0.0";
const NUMBER_WORDS = Object.freeze({
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10
});

function compactSource(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 180);
}

function wordCount(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).length;
}

function parseCount(value) {
  const normalized = String(value || "").toLowerCase();
  return NUMBER_WORDS[normalized] || Number(normalized) || 0;
}

function listItems(value) {
  return String(value || "")
    .replace(/\band\b/gi, ",")
    .split(",")
    .map((item) => item
      .replace(/^[\s`"']+|[\s`"']+$/g, "")
      .replace(/^(?:the|a|an)\s+/i, "")
      .trim())
    .filter((item) => /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(item));
}

function jsonCandidate(value) {
  const source = String(value || "").trim();
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : source;
}

function parseJson(value) {
  return JSON.parse(jsonCandidate(value));
}

function extractJsonValue(value) {
  const source = String(value || "");
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== "{" && source[start] !== "[") continue;
    const stack = [];
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === "{" || character === "[") stack.push(character);
      else if (character === "}" || character === "]") {
        const opening = stack.pop();
        if ((opening === "{" && character !== "}") || (opening === "[" && character !== "]")) break;
        if (stack.length === 0) {
          const candidate = source.slice(start, index + 1);
          try {
            return { value: JSON.parse(candidate), source: candidate };
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

function literalJsonValue(value) {
  const source = String(value || "");
  if (/^true$/i.test(source)) return true;
  if (/^false$/i.test(source)) return false;
  if (/^null$/i.test(source)) return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(source)) return Number(source);
  return source;
}

function stripMarkdown(value) {
  return String(value || "")
    .replace(/^\s*```(?:[A-Za-z0-9_-]+)?\s*$/gm, "")
    .replace(/^\s*```\s*$/gm, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}(?:[-*+]\s+|\d+\.\s+)/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^\s+|\s+$/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

function removeLiteral(value, literal) {
  const escaped = String(literal || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped ? String(value || "").replace(new RegExp(escaped, "gi"), "") : String(value || "");
}

function repairAction(type, label) {
  return { type, label, applied: true };
}

function containsMarkdown(value) {
  return /(^|\n)\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+\.\s|```|>\s)|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|__[^_]+__/m.test(String(value || ""));
}

function containsImplementationCode(value) {
  const source = String(value || "");
  // Keep no-code checks conservative: implementation syntax must begin a line
  // and have the punctuation expected for a real declaration or statement.
  const structuralPatterns = [
    /^[ \t]*(?:export[ \t]+(?:default[ \t]+)?)?(?:async[ \t]+)?function(?:[ \t]*\*)?[ \t]+[A-Za-z_$][\w$]*[ \t]*\([^\n)]*\)[ \t]*(?::[^\n{]+)?[ \t]*\{/m,
    /^[ \t]*(?:export[ \t]+)?(?:declare[ \t]+)?(?:const|let|var)[ \t]+[A-Za-z_$][\w$]*(?:[ \t]*:[^=\n;]+)?[ \t]*=[ \t]*(?![=])/m,
    /^[ \t]*(?:export[ \t]+(?:default[ \t]+)?)?(?:abstract[ \t]+)?class[ \t]+[A-Za-z_$][\w$]*(?:[ \t]+(?:extends|implements)[^\n{]+)?[ \t]*\{/m,
    /^[ \t]*(?:export[ \t]+)?(?:declare[ \t]+)?(?:interface|enum|namespace)[ \t]+[A-Za-z_$][\w$]*(?:[^\n{]*)?\{/m,
    /^[ \t]*(?:export[ \t]+)?type[ \t]+[A-Za-z_$][\w$]*(?:[ \t]*<[^\n>]+>)?[ \t]*=[ \t]*\S/m,
    /^[ \t]*import[ \t]+(?:type[ \t]+)?(?:[\w$*{}, \t]+)[ \t]+from[ \t]+["'][^"'\n]+["']/m,
    /^[ \t]*(?:async[ \t]+)?def[ \t]+[A-Za-z_]\w*[ \t]*\([^\n)]*\)[ \t]*(?:->[^\n:]+)?[ \t]*:/m,
    /^[ \t]*class[ \t]+[A-Za-z_]\w*(?:[ \t]*\([^\n)]*\))?[ \t]*:/m,
    /^[ \t]*SELECT[ \t]+(?:\*|[A-Za-z_][\w.]*(?:[ \t]*,[ \t]*[A-Za-z_][\w.]*)*)[ \t]+FROM[ \t]+[A-Za-z_][\w.]*(?:[ \t]+(?:WHERE|JOIN|GROUP[ \t]+BY|ORDER[ \t]+BY|LIMIT)\b|[ \t]*;?[ \t]*$)/im,
    /^[ \t]*(?:INSERT[ \t]+INTO[ \t]+[A-Za-z_][\w.]*[ \t]*(?:\([^\n)]*\)[ \t]*)?(?:VALUES|SELECT)\b|UPDATE[ \t]+[A-Za-z_][\w.]*[ \t]+SET[ \t]+[A-Za-z_][\w.]*[ \t]*=|DELETE[ \t]+FROM[ \t]+[A-Za-z_][\w.]*[ \t]+WHERE\b)/im,
    /^[ \t]*(?:CREATE[ \t]+(?:OR[ \t]+REPLACE[ \t]+)?TABLE[ \t]+(?:IF[ \t]+NOT[ \t]+EXISTS[ \t]+)?[A-Za-z_][\w.]*[ \t]*\(|CREATE[ \t]+(?:OR[ \t]+REPLACE[ \t]+)?VIEW[ \t]+[A-Za-z_][\w.]*[ \t]+AS[ \t]+SELECT\b|CREATE[ \t]+INDEX[ \t]+[A-Za-z_]\w*[ \t]+ON\b|CREATE[ \t]+(?:OR[ \t]+REPLACE[ \t]+)?(?:FUNCTION|PROCEDURE)[ \t]+[A-Za-z_][\w.]*[ \t]*\(|ALTER[ \t]+TABLE[ \t]+[A-Za-z_][\w.]*[ \t]+(?:ADD|ALTER|DROP|RENAME)\b|DROP[ \t]+(?:TABLE|VIEW|INDEX)[ \t]+[A-Za-z_][\w.]*[ \t]*;?[ \t]*$|WITH[ \t]+[A-Za-z_]\w*[ \t]+AS[ \t]*\()/im
  ];
  const codeFenceLanguages = new Set([
    "bash", "c", "c#", "c++", "cpp", "cs", "css", "go", "html", "java", "javascript", "js", "jsx",
    "kotlin", "php", "py", "python", "rb", "ruby", "rust", "sh", "shell", "sql", "swift", "ts", "tsx", "typescript"
  ]);
  const fencedCodeBlock = /(?:^|\n)[ \t]*```([^\n`]*)\n([\s\S]*?)\n[ \t]*```(?:[ \t]*(?:\n|$))/g;
  for (const match of source.matchAll(fencedCodeBlock)) {
    const language = String(match[1] || "").trim().split(/\s+/)[0].toLowerCase();
    if (codeFenceLanguages.has(language)) return true;
    if (!language && structuralPatterns.some((pattern) => pattern.test(match[2]))) return true;
  }
  return structuralPatterns.some((pattern) => pattern.test(source));
}

function countExecutableTests(value) {
  const source = String(value || "");
  const testPattern = /^[ \t]*(?:(?:test|it)(?:\.(?:only|concurrent))?[ \t]*\(|assert(?:\.[A-Za-z_$][\w$]*)*[ \t]*\(|(?:async[ \t]+)?def[ \t]+test_[A-Za-z0-9_]*[ \t]*\(|assert[ \t]+(?=(?:not[ \t]+)?(?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*[ \t]*(?:\(|==|!=|<=|>=|<|>|is\b|in\b)|[\[(])))/gm;
  return (source.match(testPattern) || []).length;
}

function addGate(gates, signatures, gate) {
  const signature = JSON.stringify([gate.type, gate.expected]);
  if (signatures.has(signature)) return;
  signatures.add(signature);
  gates.push({
    id: `gate_${gates.length + 1}`,
    severity: "error",
    ...gate,
    source: compactSource(gate.source)
  });
}

function compileAcceptanceGates(rawInput) {
  const safeInput = redactSensitiveText(rawInput).text;
  const gates = [];
  const signatures = new Set();
  const add = (gate) => addGate(gates, signatures, gate);

  add({
    type: "non_empty",
    label: "Output is not empty",
    source: "Baseline output requirement",
    expected: true
  });
  add({
    type: "secret_absent",
    label: "No supported secret pattern is present",
    source: "Baseline security requirement",
    expected: true
  });

  const asksForJson = /\b(?:return|respond with|output|provide|produce)\b[^.\n]{0,80}\bjson\b|\bjson\s+(?:object|array|only)\b/i.test(safeInput);
  const asksForJsonOnly = asksForJson && /\b(?:json only|only (?:a |one )?json|exact json|json without (?:markdown|prose|explanation)|do not add markdown)\b/i.test(safeInput);
  if (asksForJson) {
    add({
      type: "valid_json",
      label: "Output contains valid JSON",
      source: "Explicit JSON output request",
      expected: true
    });
  }
  if (asksForJsonOnly) {
    add({
      type: "json_only",
      label: "Output is JSON without wrappers or prose",
      source: "Explicit JSON-only output request",
      expected: true
    });
  }

  const exactKeys = safeInput.match(/\buse exactly the keys?\s+([^\n.]+)/i);
  const namedKeys = exactKeys || safeInput.match(/\bjson\s+with\s+([^\n.]+?)\s+keys?\b/i) || safeInput.match(/\b(?:json\s+)?keys?\s*(?:named|are|:)\s*([^\n.]+)/i);
  if (namedKeys) {
    const keys = listItems(namedKeys[1]);
    if (keys.length) {
      add({
        type: "json_keys",
        label: `${exactKeys ? "Exact" : "Required"} JSON keys: ${keys.join(", ")}`,
        source: namedKeys[0],
        expected: { keys, exact: Boolean(exactKeys) }
      });
    }
  }

  if (asksForJson) {
    for (const match of safeInput.matchAll(/\bset\s+([A-Za-z_][A-Za-z0-9_-]*)\s+to\s+([A-Za-z0-9_-]+)\b/gi)) {
      add({
        type: "json_value",
        label: `JSON ${match[1]} equals ${match[2]}`,
        source: match[0],
        expected: { key: match[1], value: match[2] }
      });
    }
  }

  const maxWords = safeInput.match(/\b(?:under|at most|no more than|maximum(?: of)?|max(?:imum)?(?: of)?)\s+(\d+)\s+words?\b/i) ||
    safeInput.match(/\b(\d+)\s+words?\s+or\s+fewer\b/i);
  if (maxWords) {
    add({
      type: "max_words",
      label: `At most ${Number(maxWords[1])} words`,
      source: maxWords[0],
      expected: Number(maxWords[1])
    });
  }

  if (/\breturn only (?:the )?integer(?: result)?\b/i.test(safeInput)) {
    add({
      type: "integer_only",
      label: "Output contains only one integer",
      source: "Return only the integer result",
      expected: true
    });
  }
  if (/\b(?:do not add|do not include|without|no)\s+markdown\b/i.test(safeInput)) {
    add({
      type: "no_markdown",
      label: "Output contains no Markdown formatting",
      source: "Explicit no-Markdown requirement",
      expected: true
    });
  }
  if (/\b(?:do not include|without|no)\s+(?:implementation\s+)?code\b/i.test(safeInput)) {
    add({
      type: "no_code",
      label: "Output contains no implementation code",
      source: "Explicit no-code requirement",
      expected: true
    });
  }

  const namedFunction = safeInput.match(/\bfunction\s+named\s+([A-Za-z_$][\w$]*)\b/i);
  if (namedFunction) {
    add({
      type: "named_function",
      label: `Defines function ${namedFunction[1]}`,
      source: namedFunction[0],
      expected: namedFunction[1]
    });
  }

  const minimumTests = safeInput.match(/\binclude\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:[A-Za-z.]+\s+)?(?:assert\s+)?tests?\b/i);
  if (minimumTests) {
    const count = parseCount(minimumTests[1]);
    if (count) {
      add({
        type: "minimum_tests",
        label: `Includes at least ${count} executable tests`,
        source: minimumTests[0],
        expected: count
      });
    }
  }

  const columns = safeInput.match(/\b(?:table|csv)\s+with\s+([^\n.]+?)\s+columns?\b/i);
  if (columns) {
    const terms = listItems(columns[1]);
    if (terms.length) {
      add({
        type: "required_terms",
        label: `Includes columns: ${terms.join(", ")}`,
        source: columns[0],
        expected: terms
      });
    }
  }

  for (const endpoint of safeInput.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9_{}\-./:]*)/g)) {
    const literal = `${endpoint[1]} ${endpoint[2].replace(/[.,;:]+$/, "")}`;
    add({
      type: "required_literal",
      label: `Includes ${literal}`,
      source: literal,
      expected: literal
    });
  }

  for (const match of safeInput.matchAll(/\b(?:must|should)\s+(?:include|contain|mention|use)\s+(?:the\s+(?:word|phrase)\s+)?["'`]([^"'`\n]+)["'`]/gi)) {
    add({
      type: "required_literal",
      label: `Includes “${match[1]}”`,
      source: match[0],
      expected: match[1]
    });
  }
  for (const match of safeInput.matchAll(/\b(?:must not|do not|don't)\s+(?:include|contain|mention|use)\s+(?:the\s+(?:word|phrase)\s+)?["'`]([^"'`\n]+)["'`]/gi)) {
    add({
      type: "forbidden_literal",
      label: `Excludes “${match[1]}”`,
      source: match[0],
      expected: match[1]
    });
  }

  return {
    version: ACCEPTANCE_VERSION,
    gates
  };
}

function evaluateGate(gate, output) {
  const text = String(output || "");
  const lower = text.toLowerCase();
  try {
    if (gate.type === "non_empty") {
      const passed = Boolean(text.trim());
      return { passed, evidence: passed ? "Generated output is present." : "Generated output is empty." };
    }
    if (gate.type === "secret_absent") {
      const scan = redactSensitiveText(text);
      const passed = scan.count === 0;
      return {
        passed,
        evidence: passed
          ? "No supported secret pattern detected."
          : `${scan.count} supported secret pattern${scan.count === 1 ? "" : "s"} detected.`,
        observed: { redactions: scan.count, types: scan.types }
      };
    }
    if (gate.type === "valid_json") {
      parseJson(text);
      return { passed: true, evidence: "JSON parsed successfully." };
    }
    if (gate.type === "json_only") {
      parseJson(text);
      const passed = text.trim() === jsonCandidate(text);
      return { passed, evidence: passed ? "No wrapper or prose surrounds the JSON." : "JSON is wrapped in Markdown or prose." };
    }
    if (gate.type === "json_keys") {
      const parsed = parseJson(text);
      const keys = parsed && !Array.isArray(parsed) && typeof parsed === "object" ? Object.keys(parsed) : [];
      const expected = gate.expected.keys;
      const passed = expected.every((key) => keys.includes(key)) && (!gate.expected.exact || keys.length === expected.length);
      return { passed, evidence: `Observed keys: ${keys.join(", ") || "none"}.`, observed: { keys } };
    }
    if (gate.type === "json_value") {
      const parsed = parseJson(text);
      const actual = parsed?.[gate.expected.key];
      const passed = String(actual).toLowerCase() === String(gate.expected.value).toLowerCase();
      return { passed, evidence: `${gate.expected.key} is ${actual === undefined ? "missing" : String(actual)}.` };
    }
    if (gate.type === "max_words") {
      const count = wordCount(text);
      return { passed: count <= gate.expected, evidence: `${count} words observed; limit is ${gate.expected}.`, observed: { words: count } };
    }
    if (gate.type === "integer_only") {
      const passed = /^\s*-?\d+\s*$/.test(text);
      return { passed, evidence: passed ? "Output is one integer." : "Output contains content beyond one integer." };
    }
    if (gate.type === "no_markdown") {
      const passed = !containsMarkdown(text);
      return { passed, evidence: passed ? "No Markdown syntax detected." : "Markdown syntax detected." };
    }
    if (gate.type === "no_code") {
      const passed = !containsImplementationCode(text);
      return { passed, evidence: passed ? "No implementation-code pattern detected." : "Implementation-code pattern detected." };
    }
    if (gate.type === "named_function") {
      const escaped = String(gate.expected).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const passed = new RegExp(`\\b(?:function\\s+${escaped}|(?:const|let|var)\\s+${escaped}\\s*=|${escaped}\\s*[:=]\\s*(?:function|\\())`, "i").test(text);
      return { passed, evidence: passed ? `Function ${gate.expected} is defined.` : `Function ${gate.expected} was not detected.` };
    }
    if (gate.type === "minimum_tests") {
      const count = countExecutableTests(text);
      return { passed: count >= gate.expected, evidence: `${count} executable test signal${count === 1 ? "" : "s"} detected; minimum is ${gate.expected}.`, observed: { tests: count } };
    }
    if (gate.type === "required_terms") {
      const missing = gate.expected.filter((term) => !lower.includes(String(term).toLowerCase()));
      return { passed: missing.length === 0, evidence: missing.length ? `Missing: ${missing.join(", ")}.` : "Every required term is present.", observed: { missing } };
    }
    if (gate.type === "required_literal") {
      const passed = lower.includes(String(gate.expected).toLowerCase());
      return { passed, evidence: passed ? "Required literal is present." : "Required literal is missing." };
    }
    if (gate.type === "forbidden_literal") {
      const passed = !lower.includes(String(gate.expected).toLowerCase());
      return { passed, evidence: passed ? "Forbidden literal is absent." : "Forbidden literal is present." };
    }
    return { passed: false, evidence: "Unsupported acceptance gate." };
  } catch {
    return { passed: false, evidence: gate.type.startsWith("json_") || gate.type === "valid_json" ? "Output could not be parsed as JSON." : "Gate evaluation failed." };
  }
}

function evaluateAcceptanceGates({ rawInput, output, compiled } = {}) {
  const definition = compiled || compileAcceptanceGates(rawInput);
  const gates = definition.gates.map((gate) => ({ ...gate, ...evaluateGate(gate, output) }));
  const passedCount = gates.filter((gate) => gate.passed).length;
  const failed = gates.filter((gate) => !gate.passed);
  const passed = failed.length === 0;
  return {
    version: definition.version || ACCEPTANCE_VERSION,
    status: passed ? "passed" : "failed",
    passed,
    gateCount: gates.length,
    passedCount,
    failedCount: failed.length,
    failedGateIds: failed.map((gate) => gate.id),
    summary: passed
      ? `${passedCount}/${gates.length} deterministic acceptance gates passed.`
      : `${failed.length} of ${gates.length} deterministic acceptance gates need review.`,
    gates
  };
}

function skippedAcceptanceReport(reason = "No generated output was available to evaluate.") {
  return {
    version: ACCEPTANCE_VERSION,
    status: "not_run",
    passed: null,
    gateCount: 0,
    passedCount: 0,
    failedCount: 0,
    failedGateIds: [],
    summary: reason,
    gates: []
  };
}

function skippedRepairReport(reason = "No generated output was available to repair.") {
  return {
    version: REPAIR_VERSION,
    status: "not_run",
    attempted: false,
    changed: false,
    improved: false,
    modelCalls: 0,
    actionCount: 0,
    actions: [],
    initialFailedCount: 0,
    remainingFailedCount: 0,
    repairedGateIds: [],
    summary: reason
  };
}

function repairAcceptanceFailures({ rawInput, output, compiled, acceptanceReport } = {}) {
  const originalOutput = String(output || "");
  const definition = compiled || compileAcceptanceGates(rawInput);
  const initialReport = acceptanceReport || evaluateAcceptanceGates({
    rawInput,
    output: originalOutput,
    compiled: definition
  });
  if (initialReport.passed) {
    return {
      output: originalOutput,
      acceptanceReport: initialReport,
      repairReport: {
        ...skippedRepairReport("All deterministic acceptance gates already passed."),
        status: "not_needed",
        initialFailedCount: 0,
        remainingFailedCount: 0
      }
    };
  }

  const failedTypes = new Set(initialReport.gates.filter((gate) => !gate.passed).map((gate) => gate.type));
  const failedGateIds = new Set(initialReport.failedGateIds);
  const actions = [];
  let candidate = originalOutput;

  if (failedTypes.has("secret_absent")) {
    const redacted = redactSensitiveText(candidate);
    if (redacted.text !== candidate) {
      candidate = redacted.text;
      actions.push(repairAction("redact_secrets", "Redacted supported secret patterns"));
    }
  }

  const failedJson = initialReport.gates.filter((gate) => !gate.passed && [
    "valid_json",
    "json_only",
    "json_keys",
    "json_value"
  ].includes(gate.type));
  if (failedJson.length) {
    let parsed = null;
    let extracted = false;
    try {
      parsed = parseJson(candidate);
    } catch {
      const found = extractJsonValue(candidate);
      if (found) {
        parsed = found.value;
        extracted = true;
      }
    }
    if (parsed !== null) {
      let jsonChanged = false;
      if (extracted || failedTypes.has("json_only")) {
        jsonChanged = true;
        actions.push(repairAction("normalize_json", "Removed JSON wrappers and normalized output"));
      }
      if (parsed && !Array.isArray(parsed) && typeof parsed === "object") {
        const exactKeysGate = failedJson.find((gate) => gate.type === "json_keys" && gate.expected.exact);
        if (exactKeysGate) {
          const allowed = {};
          for (const key of exactKeysGate.expected.keys) {
            if (Object.prototype.hasOwnProperty.call(parsed, key)) allowed[key] = parsed[key];
          }
          if (Object.keys(parsed).some((key) => !exactKeysGate.expected.keys.includes(key))) {
            parsed = allowed;
            jsonChanged = true;
            actions.push(repairAction("remove_extra_json_keys", "Removed JSON keys outside the exact contract"));
          }
        }
        const valueGates = failedJson.filter((gate) => gate.type === "json_value");
        for (const gate of valueGates) {
          const expected = literalJsonValue(gate.expected.value);
          if (parsed[gate.expected.key] !== expected) {
            parsed[gate.expected.key] = expected;
            jsonChanged = true;
            actions.push(repairAction("set_explicit_json_value", "Applied an explicitly requested JSON value"));
          }
        }
      }
      if (jsonChanged) candidate = JSON.stringify(parsed);
    }
  }

  for (const gate of initialReport.gates.filter((item) => !item.passed && item.type === "forbidden_literal")) {
    const withoutLiteral = removeLiteral(candidate, gate.expected);
    if (withoutLiteral !== candidate) {
      candidate = withoutLiteral;
      actions.push(repairAction("remove_forbidden_literal", "Removed an explicitly forbidden literal"));
    }
  }

  if (failedTypes.has("integer_only")) {
    const integers = candidate.match(/-?\d+/g) || [];
    if (integers.length === 1 && candidate.trim() !== integers[0]) {
      candidate = integers[0];
      actions.push(repairAction("extract_integer", "Kept the single unambiguous integer"));
    }
  }

  if (failedTypes.has("no_markdown")) {
    const plain = stripMarkdown(candidate);
    if (plain !== candidate) {
      candidate = plain;
      actions.push(repairAction("remove_markdown", "Removed mechanical Markdown formatting"));
    }
  }

  const candidateReport = evaluateAcceptanceGates({ rawInput, output: candidate, compiled: definition });
  const candidateFailed = new Set(candidateReport.failedGateIds);
  const introducedFailure = [...candidateFailed].some((id) => !failedGateIds.has(id));
  const improved = candidateReport.failedCount < initialReport.failedCount && !introducedFailure;
  const adoptedActions = improved ? actions : [];
  const finalReport = improved ? candidateReport : initialReport;
  const repairedGateIds = improved
    ? initialReport.failedGateIds.filter((id) => !candidateFailed.has(id))
    : [];
  const status = improved ? finalReport.passed ? "repaired" : "partial" : "unavailable";
  const summary = status === "repaired"
    ? `Repaired locally with ${adoptedActions.length} mechanical change${adoptedActions.length === 1 ? "" : "s"}; all acceptance gates now pass.`
    : status === "partial"
      ? `Repaired locally with ${adoptedActions.length} mechanical change${adoptedActions.length === 1 ? "" : "s"}; ${finalReport.failedCount} gate${finalReport.failedCount === 1 ? "" : "s"} still need review.`
      : "No safe deterministic repair could improve the result; the original output was preserved.";

  return {
    output: improved ? candidate : originalOutput,
    acceptanceReport: finalReport,
    repairReport: {
      version: REPAIR_VERSION,
      status,
      attempted: true,
      changed: improved,
      improved,
      modelCalls: 0,
      actionCount: adoptedActions.length,
      actions: adoptedActions,
      initialFailedCount: initialReport.failedCount,
      remainingFailedCount: finalReport.failedCount,
      repairedGateIds,
      summary
    }
  };
}

module.exports = {
  ACCEPTANCE_VERSION,
  REPAIR_VERSION,
  compileAcceptanceGates,
  evaluateAcceptanceGates,
  repairAcceptanceFailures,
  skippedRepairReport,
  skippedAcceptanceReport
};

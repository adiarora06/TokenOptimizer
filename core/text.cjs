function compactLines(text, maxLines = 8) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines);
}

function cleanPromptText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

function stripListPrefix(line) {
  return String(line || "").replace(/^(\s*[-*]\s*)+/, "").trim();
}

function withoutTrailingEllipsis(value) {
  return String(value || "").replace(/\.\.\.$/, "").trim();
}

function promptSection(value, label, nextLabels) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const next = nextLabels
    .map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const match = String(value || "").match(
    new RegExp(`${escaped}:\\s*([\\s\\S]*?)(?=\\n(?:${next}):|$)`, "i")
  );
  return match ? match[1].trim() : "";
}

function dedupeNaturalLanguageLines(value) {
  const seen = new Set();
  let inFence = false;
  return String(value || "")
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("```")) {
        inFence = !inFence;
        return true;
      }
      if (!trimmed || inFence || /^\s/.test(line) || trimmed.length < 32) return true;
      const key = cleanPromptText(stripListPrefix(trimmed)).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = {
  cleanPromptText,
  compactLines,
  dedupeNaturalLanguageLines,
  promptSection,
  stripListPrefix,
  withoutTrailingEllipsis
};

// Prints a canonical form of a Graphify graph.json so two generation runs can
// be compared byte-for-byte. Graphify serializes nodes, links, and object keys
// in an unstable order, community detection is unseeded, and the file embeds
// the source commit — so ordering, community fields, and build metadata are
// normalized away. Node and link structure is deterministic and is compared.
// Usage: node scripts/canonical-graph.cjs <path-to-graph.json>

const fs = require("node:fs");

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortDeep(value[key]);
    return sorted;
  }
  return value;
}

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/canonical-graph.cjs <path-to-graph.json>");
  process.exit(2);
}

const graph = JSON.parse(fs.readFileSync(file, "utf8"));
delete graph.built_at_commit;
if (Array.isArray(graph.nodes)) {
  for (const node of graph.nodes) {
    delete node.community;
    delete node.community_name;
  }
  graph.nodes.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
if (Array.isArray(graph.links)) {
  graph.links.sort((a, b) =>
    String(a.source).localeCompare(String(b.source)) ||
    String(a.target).localeCompare(String(b.target)) ||
    String(a.type || "").localeCompare(String(b.type || "")));
}
process.stdout.write(JSON.stringify(sortDeep(graph), null, 2));

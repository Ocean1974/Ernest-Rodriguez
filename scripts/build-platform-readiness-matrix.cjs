const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pathToFileURL } = require("url");

const root = path.join(__dirname, "..");
const outputJson = path.join(root, "output", "platform-readiness-matrix.json");
const outputMd = path.join(root, "output", "platform-readiness-matrix.md");

function sha256(buffer) { return crypto.createHash("sha256").update(buffer).digest("hex"); }
function readJson(relativePath) { return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8")); }
function parseFeatureGates() {
  const source = fs.readFileSync(path.join(root, "src", "data", "platformFeatureGates.ts"), "utf8");
  return Object.fromEntries([...source.matchAll(/^\s+([A-Za-z][A-Za-z0-9]*):\s*(true|false),$/gm)].map((match) => [match[1], match[2] === "true"]));
}
function evidenceInventory(registry) {
  const references = [...new Set(registry.capabilities.flatMap((capability) => capability.foundationEvidence))];
  return Object.fromEntries(references.map((reference) => {
    const absolute = path.join(root, reference);
    if (!fs.existsSync(absolute)) return [reference, { exists: false }];
    const bytes = fs.readFileSync(absolute);
    let schemaVersion = "";
    let generatedAt = "";
    if (reference.endsWith(".json")) { try { const parsed = JSON.parse(bytes.toString("utf8")); schemaVersion = String(parsed.schemaVersion || ""); generatedAt = String(parsed.generatedAt || ""); } catch {} }
    return [reference, { exists: true, bytes: bytes.length, sha256: sha256(bytes), schemaVersion, generatedAt }];
  }));
}
function renderMarkdown(matrix) {
  return [
    "# White Rabbit Platform Readiness Matrix",
    "",
    `Generated: ${matrix.generatedAt}`,
    "",
    matrix.activationPolicy,
    "",
    `- Capabilities: ${matrix.summary.capabilityCount}`,
    `- Activation authorized: ${matrix.summary.activationAuthorizedCount}`,
    `- Enabled feature gates: ${matrix.summary.enabledFeatureGateCount}`,
    `- Priority counties blocked: ${matrix.observedFacts.priorityCountiesBlocked}`,
    `- PMTiles artifact present: ${matrix.observedFacts.pmtilesArtifactPresent ? "yes" : "no"}`,
    "",
    "| Stage | Capability | Status | Gates enabled | Primary blockers |",
    "| --- | --- | --- | ---: | --- |",
    ...matrix.capabilities.map((item) => `| ${item.stage} | ${item.name} | ${item.status} | ${item.enabledFeatureGates.length} | ${[...item.externalBlockers, ...item.missingFoundationEvidence.map((value) => `missing ${value}`)].join(" ") || "Signed release evidence required."} |`),
    "",
    "No capability in this matrix changes the locked White Rabbit UI. Activation requires a separately verified signed release manifest.",
    "",
  ].join("\n");
}

(async () => {
  const { createPlatformReadinessMatrix } = await import(pathToFileURL(path.join(root, "src", "operations", "platformReadiness.mjs")).href);
  const registry = readJson("data/platform-capability-registry.json");
  const pmtiles = readJson("output/pmtiles-readiness.json");
  const county = readJson("output/county-activation-manifest.json");
  const matrix = createPlatformReadinessMatrix({
    registry,
    featureGateStates: parseFeatureGates(),
    evidenceInventory: evidenceInventory(registry),
    generatedAt: new Date().toISOString(),
    releaseDecisionVerifications: [],
    observedFacts: {
      pmtilesStatus: pmtiles.status,
      pmtilesArtifactPresent: pmtiles.checks?.pmtilesArtifactPresent === true,
      pmtilesBlockers: pmtiles.blockers || [],
      priorityCountyCandidates: Number(county.summary?.candidateCount || 0),
      priorityCountiesBlocked: Number(county.summary?.blockedCount || 0),
      priorityCountyVisibleActivations: Number(county.summary?.visibleActivationCount || 0),
      priorityCountiesUnknownFreshness: Number(county.summary?.unknownParcelFreshnessCount || 0)
    }
  });
  fs.writeFileSync(outputJson, `${JSON.stringify(matrix, null, 2)}\n`);
  fs.writeFileSync(outputMd, renderMarkdown(matrix));
  console.log(`Built ${path.relative(root, outputJson)} and ${path.relative(root, outputMd)}.`);
})().catch((error) => { console.error(error); process.exit(1); });

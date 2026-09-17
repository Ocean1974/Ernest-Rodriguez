const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const universePath = path.join(root, "data", "national-county-intelligence", "us-county-universe.json");
const qcIndexPath = path.join(root, "output", "county-qc", "index.json");
const outputDir = path.join(root, "output", "tx-ky-completion-gate");
const outputJson = path.join(outputDir, "tx-ky-completion-gate.json");
const outputMd = path.join(outputDir, "tx-ky-completion-gate.md");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function canonicalAdapterInfo(county) {
  if (county.state === "TX" && county.countyName === "Dallas County") {
    return { adapterId: "dallas-county-dcad", adapterPath: "data/county-adapters/dallas/adapter.json" };
  }
  if (county.state === "TX" && county.countyName === "Tarrant County") {
    return { adapterId: "tarrant-county-tad", adapterPath: "data/county-adapters/tarrant/adapter.json" };
  }
  if (county.state === "KY" && county.countyName === "Jefferson County") {
    return { adapterId: "jefferson-ky", adapterPath: "data/county-adapters/louisville/adapter.json" };
  }
  return { adapterId: county.countyId, adapterPath: `data/county-adapters/${county.countyId}/adapter.json` };
}

function parcelManifestPath(adapter) {
  const rootPath = adapter.publicDataRoots?.parcels;
  if (!rootPath) return "";
  return `public${rootPath}manifest.json`.replace(/\/+/g, "/").replace(/^public\/data/, "public/data");
}

function countyRecord(county, qcById) {
  const canonical = canonicalAdapterInfo(county);
  const adapter = exists(canonical.adapterPath) ? readJson(path.join(root, canonical.adapterPath)) : null;
  const qc = qcById.get(canonical.adapterId) || null;
  const manifestPath = adapter ? parcelManifestPath(adapter) : "";
  const parcelManifestPresent = manifestPath ? exists(manifestPath) : false;
  const verified = adapter?.verifiedCounts || {};
  const hasVerifiedParcelCount = Number(verified.parcelGeometryFeatures || 0) > 0;
  const hasViewportChunks = Number(verified.appParcelChunks || 0) > 0 || parcelManifestPresent;
  const hasSearchShards = Number(verified.parcelSearchShards || 0) > 0;
  const ownerReady = (adapter?.ownerEnrichment?.officialJoinKey && !String(adapter.ownerEnrichment.officialJoinKey).includes("source-needed") && adapter?.ownerEnrichment?.fields?.ownerName && !String(adapter.ownerEnrichment.fields.ownerName).includes("source-needed")) ||
    adapter?.layerReadiness?.ownerAppraisal === "joined-to-public-parcel-service" ||
    (adapter?.optionalLayers || []).some((layer) => layer.id?.includes("owner") && ["ready", "joined-to-public-parcel-service"].includes(layer.status));
  const sourceNeededValues = JSON.stringify({
    sourceFiles: adapter?.sourceFiles || {},
    joinKeys: adapter?.joinKeys || {},
  }).includes("source-needed");

  const completeCore =
    Boolean(adapter) &&
    adapter.status === "active" &&
    qc?.status === "pass" &&
    hasVerifiedParcelCount &&
    hasViewportChunks &&
    hasSearchShards &&
    ownerReady &&
    !sourceNeededValues;

  const mapSearchReady =
    Boolean(adapter) &&
    hasVerifiedParcelCount &&
    hasViewportChunks &&
    hasSearchShards &&
    (qc?.status === "pass" || qc?.status === "warning");

  const status = completeCore ? "core-complete" : mapSearchReady ? "partial-map-search-ready" : "source-needed";
  const missing = [];
  if (!adapter) missing.push("adapter");
  if (!hasVerifiedParcelCount) missing.push("verified-parcel-count");
  if (!hasViewportChunks) missing.push("viewport-chunks");
  if (!hasSearchShards) missing.push("search-shards");
  if (!ownerReady) missing.push("owner-appraisal-ready");
  if (sourceNeededValues) missing.push("source-needed-fields-or-join-keys");
  if (!qc || qc.status === "fail") missing.push("passing-or-warning-qc");

  return {
    censusCountyId: county.countyId,
    adapterId: canonical.adapterId,
    countyName: county.countyName,
    state: county.state,
    fips: county.fips,
    status,
    canActivate: completeCore,
    mapSearchReady,
    adapterPath: canonical.adapterPath,
    qcStatus: qc?.status || "missing",
    parcelManifestPath: manifestPath,
    verifiedCounts: verified,
    missing,
  };
}

function main() {
  const universe = readJson(universePath);
  const qcIndex = exists("output/county-qc/index.json") ? readJson(qcIndexPath) : { counties: [] };
  const qcById = new Map((qcIndex.counties || []).map((item) => [item.adapterId, item]));
  const targets = universe.counties.filter((county) => county.state === "TX" || county.state === "KY");
  const counties = targets.map((county) => countyRecord(county, qcById));
  const byState = {
    TX: counties.filter((county) => county.state === "TX"),
    KY: counties.filter((county) => county.state === "KY"),
  };
  const summaryFor = (items) => ({
    total: items.length,
    coreComplete: items.filter((county) => county.status === "core-complete").length,
    partialMapSearchReady: items.filter((county) => county.status === "partial-map-search-ready").length,
    sourceNeeded: items.filter((county) => county.status === "source-needed").length,
  });
  const report = {
    version: "wr-tx-ky-completion-gate-v1",
    generatedAt: new Date().toISOString(),
    source: "data/national-county-intelligence/us-county-universe.json",
    uiConstraint: "Do not redesign White Rabbit pages while completing TX/KY county pipelines.",
    completionRule: "A county is core-complete only when official sources, exact join keys, verified counts, viewport chunks, search shards, owner/appraisal readiness, and QC are all verified. Source-needed shells are not complete.",
    stateGate: {
      activeStates: ["TX", "KY"],
      executionMode: "concurrent-state-pipelines",
      texasComplete: byState.TX.every((county) => county.status === "core-complete"),
      kentuckyComplete: byState.KY.every((county) => county.status === "core-complete"),
      texasCanAdvance: true,
      kentuckyCanAdvance: true,
    },
    summary: {
      TX: summaryFor(byState.TX),
      KY: summaryFor(byState.KY),
      total: summaryFor(counties),
    },
    nextTexasCounties: byState.TX.filter((county) => county.status !== "core-complete").slice(0, 25),
    kentuckyPreview: byState.KY.filter((county) => county.status !== "core-complete").slice(0, 10),
    counties,
  };
  ensureDir(outputDir);
  fs.writeFileSync(outputJson, JSON.stringify(report, null, 2));
  const lines = [
    "# TX/KY Completion Gate",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `- Texas: ${report.summary.TX.coreComplete}/${report.summary.TX.total} core-complete`,
    `- Kentucky: ${report.summary.KY.coreComplete}/${report.summary.KY.total} core-complete`,
    `- Active state pipelines: ${report.stateGate.activeStates.join(", ")}`,
    `- Execution mode: ${report.stateGate.executionMode}`,
    "",
    "## Completion Rule",
    "",
    report.completionRule,
    "",
    "## Next Texas Counties",
    "",
    "| County | Status | Missing |",
    "| --- | --- | --- |",
    ...report.nextTexasCounties.map((county) => `| ${county.countyName} | ${county.status} | ${county.missing.join(", ")} |`),
    "",
    "## Kentucky Preview",
    "",
    "| County | Status | Missing |",
    "| --- | --- | --- |",
    ...report.kentuckyPreview.map((county) => `| ${county.countyName} | ${county.status} | ${county.missing.join(", ")} |`),
    "",
    "## UI Constraint",
    "",
    report.uiConstraint,
    "",
  ];
  fs.writeFileSync(outputMd, lines.join("\n"));
  console.log(`Wrote ${path.relative(root, outputJson)}`);
  console.log(`Wrote ${path.relative(root, outputMd)}`);
  console.log(JSON.stringify(report.summary, null, 2));
}

main();

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const adaptersDir = path.join(root, "data", "county-adapters");
const outputJson = path.join(root, "output", "county-expansion-readiness-report.json");
const outputMd = path.join(root, "output", "county-expansion-readiness-report.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8").replace(/^\uFEFF/, ""));
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function isExternalSource(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function sourceIsMissing(value) {
  const source = String(value || "").trim();
  if (!source || source === "optional") return false;
  if (/source-needed/i.test(source)) return true;
  if (isExternalSource(source)) return false;
  return !exists(source);
}

function publicRootToRelativeManifest(publicRoot) {
  if (!publicRoot || !String(publicRoot).startsWith("/data/")) return "";
  return path.posix.join("public", String(publicRoot).replace(/^\//, ""), "manifest.json");
}

function readParcelService(adapter) {
  const manifestPath = publicRootToRelativeManifest(adapter.publicDataRoots?.parcels || adapter.dataRoots?.parcels || "");
  if (!manifestPath || !exists(manifestPath)) return null;
  return readJson(manifestPath);
}

function countSearchShards(manifest) {
  return Object.keys(manifest?.searchIndexShards?.files || {}).length;
}

function parcelServiceReady(adapter) {
  const manifest = readParcelService(adapter);
  if (!manifest || /sample/i.test(String(manifest.mode || manifest.activationStatus || ""))) return false;
  return Boolean(manifest.featureCount && manifest.chunkCount && manifest.searchIndexCount && countSearchShards(manifest));
}

function nextActionsForPilot(adapter, missingSources, missingOutputs, placeholderJoinKeys) {
  if (parcelServiceReady(adapter)) {
    const actions = [
      "Keep the built viewport chunks and search shards QC-gated; do not activate visible app behavior yet.",
      "Finish source verification and parcel joins for missing permits/CO, zoning detail, floodplain, development, migration/demand, and owner/appraisal gaps.",
      "Build PMTiles/vector tiles or document the tile production handoff before any production promotion.",
      "Keep the county disabled in the app until QC has zero failures and explicit activation review passes.",
    ];
    if (String(adapter.id) === "king-county-wa") actions.splice(1, 0, "Resolve or keep documented the duplicate PIN and current-owner source gaps before DCAD-like parcel windows.");
    return actions;
  }

  const actions = [];
  if (missingSources.length) actions.push("Load or verify the listed source-needed parcel, appraisal, permit, zoning, floodplain, and demand sources.");
  if (placeholderJoinKeys.length) actions.push("Run schema inspection and replace every pilot/template join key with exact source fields or documented spatial behavior.");
  if (missingOutputs.length) actions.push("Build universal parcel GeoJSON, viewport chunks, search shards, permit joins, development index, and county QC.");
  actions.push("Keep the county disabled in the app until QC has zero failures and production counts are verified.");
  return actions;
}

function discoverAdapters() {
  return fs
    .readdirSync(adaptersDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const adapterPath = path.join("data", "county-adapters", entry.name, "adapter.json");
      const pipelinePath = path.join("data", "county-adapters", entry.name, "pipeline.json");
      if (!exists(adapterPath)) return null;
      return {
        slug: entry.name,
        adapterPath,
        pipelinePath,
        adapter: readJson(adapterPath),
        hasPipeline: exists(pipelinePath),
      };
    })
    .filter(Boolean);
}

function statusFromChecks(items) {
  return items.every((item) => item.pass) ? "ready" : "blocked";
}

function main() {
  const adapters = discoverAdapters();
  const activeAdapters = adapters.filter((item) => item.adapter.status === "active");
  const pilotAdapters = adapters.filter((item) => item.adapter.status === "pilot");
  const dallas = adapters.find((item) => item.adapter.id === "dallas-county-dcad");
  const qcIndex = exists("output/county-qc/index.json") ? readJson("output/county-qc/index.json") : null;
  const dallasQc = exists("output/county-qc/dallas-county-dcad.json") ? readJson("output/county-qc/dallas-county-dcad.json") : null;
  const parcelManifest = exists("public/data/parcels/manifest.json") ? readJson("public/data/parcels/manifest.json") : null;
  const permitManifest = exists("public/data/permits/manifest.json") ? readJson("public/data/permits/manifest.json") : null;
  const developmentIndex = exists("public/data/developments/parcel-development-index.json")
    ? readJson("public/data/developments/parcel-development-index.json")
    : null;

  const dallasCounts = dallas?.adapter.verifiedCounts || {};
  const gateChecks = [
    { id: "single-active-county", label: "Exactly one production county is active", pass: activeAdapters.length === 1 },
    { id: "dallas-active", label: "Dallas/DCAD remains the active production adapter", pass: activeAdapters[0]?.adapter.id === "dallas-county-dcad" },
    { id: "dallas-qc-pass", label: "Dallas county QC passes with zero warnings and failures", pass: dallasQc?.status === "pass" && dallasQc.warningCount === 0 && dallasQc.failCount === 0 },
    { id: "county-qc-no-failures", label: "County QC index has zero failures", pass: qcIndex?.failCount === 0 },
    { id: "parcel-count-locked", label: "Live parcel manifest matches the verified DCAD parcel count", pass: parcelManifest?.featureCount === dallasCounts.parcelGeometryFeatures },
    { id: "parcel-chunks-locked", label: "Live parcel chunks match the verified DCAD chunk count", pass: parcelManifest?.chunkCount === dallasCounts.appParcelChunks },
    {
      id: "parcel-search-shards-locked",
      label: "Live parcel search shards match the verified DCAD shard count",
      pass: Object.keys(parcelManifest?.searchIndexShards?.files || {}).length === dallasCounts.parcelSearchShards,
    },
    {
      id: "permit-counts-locked",
      label: "Live permit manifest matches verified joined/unmatched counts",
      pass: permitManifest?.joinedPermitCount === dallasCounts.permitRowsJoined && permitManifest?.unmatchedPermitCount === dallasCounts.permitRowsUnmatched,
    },
    { id: "development-count-locked", label: "Live development index matches verified parcel count", pass: developmentIndex?.parcelCount === dallasCounts.parcelsWithDevelopmentSignals },
    { id: "primary-join-documented", label: "Dallas primary parcel/account join key is locked", pass: String(dallas?.adapter.joinKeys?.primaryParcelAccount || "").includes("PARCEL_GEOM.Acct") },
    {
      id: "uncertain-joins-documented",
      label: "BLKID and ParcelDimension uncertainty stays documented",
      pass: String(dallas?.adapter.joinKeys?.blockLabels || "").includes("spatial") && String(dallas?.adapter.joinKeys?.dimensions || "").includes("spatial"),
    },
    { id: "pmtiles-gap-documented", label: "PMTiles/vector tile production gap is documented", pass: String(dallas?.adapter.productionGap || "").includes("PMTiles") },
  ];

  const pilots = pilotAdapters.map((item) => {
    const required = item.adapter.requiredOutputs || [];
    const missingOutputs = required.filter((entry) => {
      if (entry.includes(" or ")) return !entry.split(/\s+or\s+/).some(exists);
      return !exists(entry);
    });
    const missingSources = Object.entries(item.adapter.sourceFiles || {})
      .filter(([, value]) => sourceIsMissing(value))
      .map(([key, value]) => ({ key, path: value }));
    const placeholderJoinKeys = Object.entries(item.adapter.joinKeys || {})
      .filter(([, value]) => /pilot|document exact|unavailable/i.test(String(value)))
      .map(([key, value]) => ({ key, value }));

    return {
      adapterId: item.adapter.id,
      countyName: item.adapter.countyName,
      status: item.adapter.status,
      enabledForProduction: false,
      hasPipeline: item.hasPipeline,
      missingSources,
      missingOutputs,
      placeholderJoinKeys,
      parcelServiceReady: parcelServiceReady(item.adapter),
      nextActions: nextActionsForPilot(item.adapter, missingSources, missingOutputs, placeholderJoinKeys),
    };
  });

  const report = {
    generatedAt: new Date().toISOString(),
    status: statusFromChecks(gateChecks),
    activeAdapterId: activeAdapters[0]?.adapter.id || "",
    activeCountyCount: activeAdapters.length,
    pilotCountyCount: pilotAdapters.length,
    gateChecks,
    lockedDallasCounts: {
      parcelGeometryFeatures: dallasCounts.parcelGeometryFeatures,
      appParcelChunks: dallasCounts.appParcelChunks,
      parcelSearchShards: dallasCounts.parcelSearchShards,
      dcadAccountRows: dallasCounts.dcadAccountRows,
      dcadAppraisalRows: dallasCounts.dcadAppraisalRows,
      permitRowsJoined: dallasCounts.permitRowsJoined,
      permitRowsUnmatched: dallasCounts.permitRowsUnmatched,
      parcelsWithDevelopmentSignals: dallasCounts.parcelsWithDevelopmentSignals,
    },
    lockedDallasJoinKeys: dallas?.adapter.joinKeys || {},
    pilots,
    uiConstraint: "Do not redesign or restyle White Rabbit pages while expanding county data plumbing.",
  };

  fs.mkdirSync(path.dirname(outputJson), { recursive: true });
  fs.writeFileSync(outputJson, JSON.stringify(report, null, 2));

  const lines = [
    "# County Expansion Readiness Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `- Status: ${report.status}`,
    `- Active adapter: \`${report.activeAdapterId}\``,
    `- Active production county count: ${report.activeCountyCount}`,
    `- Pilot county count: ${report.pilotCountyCount}`,
    "",
    "## Dallas/DCAD Gate",
    "",
    "| Status | Check |",
    "| --- | --- |",
    ...gateChecks.map((item) => `| ${item.pass ? "pass" : "blocked"} | ${item.label} |`),
    "",
    "## Locked DCAD Counts",
    "",
    ...Object.entries(report.lockedDallasCounts).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Locked DCAD Join Keys",
    "",
    ...Object.entries(report.lockedDallasJoinKeys).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Pilot Counties",
    "",
    ...pilots.flatMap((pilot) => [
      `### ${pilot.countyName}`,
      "",
      `- Adapter: \`${pilot.adapterId}\``,
      `- Production enabled: ${pilot.enabledForProduction}`,
      `- Pipeline present: ${pilot.hasPipeline}`,
      `- Missing source files: ${pilot.missingSources.length}`,
      `- Missing required outputs: ${pilot.missingOutputs.length}`,
      `- Placeholder/uncertain join keys: ${pilot.placeholderJoinKeys.length}`,
      "",
      "Next actions:",
      "",
      ...pilot.nextActions.map((action) => `- ${action}`),
      "",
    ]),
    "## UI Constraint",
    "",
    report.uiConstraint,
    "",
  ];
  fs.writeFileSync(outputMd, lines.join("\n"));

  console.log(`Wrote ${path.relative(root, outputJson)}`);
  console.log(`Wrote ${path.relative(root, outputMd)}`);
  console.log(JSON.stringify({ status: report.status, activeAdapterId: report.activeAdapterId, pilotCountyCount: report.pilotCountyCount }, null, 2));
}

main();

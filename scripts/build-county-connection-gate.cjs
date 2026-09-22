const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const outputJson = path.join(root, "output", "county-connection-gate.json");
const outputMd = path.join(root, "output", "county-connection-gate.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8").replace(/^\uFEFF/, ""));
}

function tryReadJson(relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function publicRootToRelativeManifest(publicRoot) {
  if (!publicRoot || !String(publicRoot).startsWith("/data/")) return "";
  return path.posix.join("public", String(publicRoot).replace(/^\//, ""), "manifest.json");
}

function compactNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function layerByNeed(adapter, pattern) {
  const matches = (adapter.optionalLayers || []).filter((layer) => pattern.test(`${layer.id || ""} ${layer.label || ""}`));
  return matches.find((layer) => layerReady(layer)) || matches.find((layer) => !layerSourceNeeded(layer)) || matches[0];
}

function layerReady(layer) {
  return /available|ready|loaded|metadata-ready|parcel-index-ready/i.test(String(layer?.status || ""));
}

function layerSourceNeeded(layer) {
  return !layer || /source-needed|pending|build-needed|inspection-needed|not-confirmed/i.test(String(layer.status || ""));
}

let nationalDemandCoverage;
function nationalDemandFor(adapter, fallbackFips = "") {
  if (nationalDemandCoverage === undefined) nationalDemandCoverage = tryReadJson("public/data/national/migration-demand/coverage-index.json") || null;
  const fips = String(adapter?.fips || fallbackFips || "");
  return /^\d{5}$/.test(fips) ? nationalDemandCoverage?.counties?.[fips] || null : null;
}

function countyPublicParcelRoot(adapter) {
  return adapter.publicDataRoots?.parcels || adapter.dataRoots?.parcels || "";
}

function adapterRecordFromQueue(queue) {
  const records = new Map();
  for (const county of [...(queue.activeExamples || []), ...(queue.priorityCountyQueue || [])]) {
    const adapterPath = county.adapterPath || `data/county-adapters/${county.countyId}/adapter.json`;
    if (!records.has(county.countyId)) records.set(county.countyId, { ...county, adapterPath });
  }
  return [...records.values()];
}

function countyOutputPrefix(countyId) {
  if (countyId === "dallas-county-dcad") return "";
  if (countyId === "tarrant-county-tad") return "tarrant/";
  return `${countyId}/`;
}

function qaReportPaths(countyId) {
  if (countyId === "dallas-county-dcad") {
    return ["output/county-qc/dallas-county-dcad.json", "output/schema-report.json", "output/join-key-report.md"];
  }
  return [
    `output/${countyOutputPrefix(countyId)}qa-report.json`,
    `output/${countyOutputPrefix(countyId)}schema-report.json`,
    `output/${countyOutputPrefix(countyId)}join-key-report.json`,
    `output/${countyOutputPrefix(countyId)}join-key-report.md`,
  ];
}

function nextBuildStepsFor(record) {
  const countyId = record.countyId;
  if (countyId === "dallas-county-dcad") return [
    "Keep Dallas locked as the model county and do not redesign the pages.",
    "Complete independent reuse-rights review for the captured IRS 2022-2023 county migration files.",
    "Maintain the captured ACS demographic/housing, BLS labor, Dallas County-issued permit, and selected DallasNow Building-record lineage; expand City issuance/type coverage and connect other municipal feeds at their true jurisdictions before claiming countywide supply coverage.",
    "Approve and backtest point-in-time demand features; do not attribute county observations to parcels without parcel-specific evidence.",
  ];
  if (countyId === "jefferson-ky") {
    return [
      "Load the official Jefferson County PVA owner/appraisal export into data/raw/jefferson-ky/Jefferson_County_KY_PVA_Owner_Appraisal.csv.",
      "Run npm run jefferson:build after the PVA file is present so owner, value, land, and building fields join into the existing parcel chunks.",
      "Keep the 22,717 spatially joined active permits and 16,320 parcel development summaries production-disabled until county QC and promotion pass; CO remains source-needed.",
    ];
  }
  if (countyId === "harris-county-tx") {
    return [
      "Keep the active Harris map/search pilot limited to certified parcel, owner/appraisal, dimension, block/legal, Houston development-control, floodplain, current plat activity, and explicitly historical 2024 Houston permit fields.",
      "Refresh the permit source before production promotion; the 2024 City of Houston permit workbooks are not current, not countywide, and do not include certificates of occupancy.",
      "Retain blank-safe coverage outside Houston jurisdiction and preserve unmatched or ambiguous permit addresses as QA records rather than parcel facts.",
    ];
  }
  if (countyId === "travis-county-tx") {
    return [
      "Promote the reconciled Austin/Travis parcel, search, dimension, block/subdivision, zoning, floodplain, permit/CO, and development-signal layers as a map/search pilot after visibility authorization.",
      "Keep migration-demand fields disabled until an approved aggregate source and geography-to-parcel join are certified.",
      "Preserve blank-safe coverage outside City of Austin service extents, preserve unmatched permits, and keep federal SFHA distinct from Austin's local fully-developed floodplain.",
    ];
  }
  if (countyId === "maricopa-county-az") {
    return [
      "Keep the full Maricopa viewport chunks and search shards QC-gated; do not activate visible app behavior yet.",
      "Verify permit, floodplain, municipal zoning detail, development, and migration-demand sources before activation.",
      "Build PMTiles/vector tiles or document the tile production handoff before any production promotion.",
    ];
  }
  if (countyId === "king-county-wa") {
    return [
      "Keep the full King County viewport chunks and search shards QC-gated; do not activate visible app behavior yet.",
      "Find an official current owner source or keep owner-contact source-needed; duplicate PIN handling must stay documented.",
      "Build PMTiles/vector tiles or document the tile production handoff before any production promotion.",
    ];
  }
  if (countyId === "tarrant-county-tad") {
    return [
      "Keep the full Tarrant viewport chunks, search shards, and owner/appraisal joins QC-gated; do not activate visible app behavior yet.",
      "Maintain the verified permit/CO, zoning, floodplain, development, block, dimension, and national aggregate migration-demand context while preserving jurisdiction disclosures.",
      "Build PMTiles/vector tiles or document the tile production handoff before production promotion.",
    ];
  }
  return ["Verify official parcel geometry, owner/appraisal, permits, zoning, floodplain, and demand sources before building chunks."];
}

function buildCountyGate(queueRecord) {
  const adapter = tryReadJson(queueRecord.adapterPath);
  if (!adapter) {
    return {
      countyId: queueRecord.countyId,
      countyName: queueRecord.countyName,
      state: queueRecord.state,
      market: queueRecord.market,
      adapterPath: queueRecord.adapterPath,
      adapterPresent: false,
      activationStage: "adapter-missing",
      mapSearchReady: false,
      dcadLikeWindowReady: false,
      missingDcadLikeGroups: ["adapter", "parcel-geometry", "parcel-ids", "owner-appraisal", "viewport-search", "qa"],
      nextBuildSteps: nextBuildStepsFor(queueRecord),
    };
  }

  const parcelManifestPath = publicRootToRelativeManifest(countyPublicParcelRoot(adapter));
  const parcelManifest = parcelManifestPath ? tryReadJson(parcelManifestPath) : null;
  const verifiedParcelCount = compactNumber(adapter.verifiedCounts?.parcelGeometryFeatures);
  const manifestFeatureCount = compactNumber(parcelManifest?.featureCount);
  const manifestSourceCount = compactNumber(parcelManifest?.sourceVerifiedFeatureCount || verifiedParcelCount);
  const sampleMode = /sample/i.test(String(parcelManifest?.mode || parcelManifest?.activationStatus || ""));
  const fullParcelServiceReady =
    Boolean(parcelManifest) &&
    !sampleMode &&
    manifestFeatureCount > 0 &&
    (manifestSourceCount === 0 || manifestFeatureCount >= Math.floor(manifestSourceCount * 0.99));
  const viewportReady = Boolean(parcelManifest?.chunkCount && parcelManifest?.chunks?.length);
  const searchShardCount = Object.keys(parcelManifest?.searchIndexShards?.files || {}).length;
  const searchReady = Boolean(parcelManifest?.searchIndexCount && searchShardCount);
  const mapSearchReady = fullParcelServiceReady && viewportReady && searchReady;
  const qaPaths = qaReportPaths(adapter.id || queueRecord.countyId);
  const qaReady = qaPaths.some(exists);

  const ownerLayer = layerByNeed(adapter, /owner|appraisal|pva|hcad/i);
  const addressLayer = (adapter.optionalLayers || []).find((layer) => layer.id === "lojic-address-intelligence") || layerByNeed(adapter, /^address/i);
  const zoningLayer = layerByNeed(adapter, /zoning/i);
  const floodLayer = layerByNeed(adapter, /flood/i);
  const permitLayer = layerByNeed(adapter, /permit|certificate|occupancy/i);
  const dimensionsLayer = layerByNeed(adapter, /dimension/i);
  const blockLayer = layerByNeed(adapter, /block|grid|legal/i);
  const developmentLayer = layerByNeed(adapter, /development/i);
  const demandLayer = layerByNeed(adapter, /migration|demand/i);
  const nationalDemand = nationalDemandFor(adapter, queueRecord.fips);

  const ownerJoinedToPublicService =
    adapter.status === "active" ||
    (mapSearchReady && Boolean(parcelManifest?.joinedAppraisalCount) && !layerSourceNeeded(ownerLayer));
  const addressReady = ownerJoinedToPublicService || (
    layerReady(addressLayer) &&
    !layerSourceNeeded(addressLayer) &&
    (!addressLayer?.publicManifestPath || exists(addressLayer.publicManifestPath))
  );
  const zoningReady = layerReady(zoningLayer) && (!zoningLayer.publicManifestPath || exists(zoningLayer.publicManifestPath));
  const floodplainReady = layerReady(floodLayer) && (!floodLayer.publicManifestPath || exists(floodLayer.publicManifestPath));
  const permitsReady =
    layerReady(permitLayer) &&
    !layerSourceNeeded(permitLayer) &&
    compactNumber(adapter.verifiedCounts?.permitRowsJoined || parcelManifest?.joinedPermitCount) > 0;
  const dimensionsReady =
    layerReady(dimensionsLayer) &&
    !layerSourceNeeded(dimensionsLayer) &&
    (adapter.status === "active" || compactNumber(parcelManifest?.joinedParcelDimensionCount) > 0);
  const blockGridReady = layerReady(blockLayer) && !layerSourceNeeded(blockLayer);
  const developmentReady = layerReady(developmentLayer) && !layerSourceNeeded(developmentLayer);
  const migrationDemandReady = (layerReady(demandLayer) && !layerSourceNeeded(demandLayer)) || /^ready/i.test(String(nationalDemand?.status || ""));

  const readyDcadLikeGroups = [
    mapSearchReady ? "identity" : "",
    mapSearchReady ? "geometry" : "",
    addressReady ? "address" : "",
    ownerJoinedToPublicService ? "owner-contact" : "",
    ownerJoinedToPublicService ? "appraisal-values" : "",
    ownerJoinedToPublicService ? "land-building" : "",
    dimensionsReady ? "parcel-dimensions" : "",
    blockGridReady ? "block-grid" : "",
    zoningReady ? "zoning" : "",
    floodplainReady ? "floodplain" : "",
    permitsReady ? "permits-certificates" : "",
    developmentReady ? "development-signals" : "",
    migrationDemandReady ? "migration-demand" : "",
    qaReady ? "source-lineage" : "",
  ].filter(Boolean);
  const allDcadLikeGroups = [
    "identity",
    "address",
    "owner-contact",
    "appraisal-values",
    "land-building",
    "geometry",
    "parcel-dimensions",
    "block-grid",
    "zoning",
    "floodplain",
    "permits-certificates",
    "development-signals",
    "migration-demand",
    "source-lineage",
  ];
  const coreDcadLikeGroups = allDcadLikeGroups.filter((group) => group !== "migration-demand");
  const missingDcadLikeGroups = allDcadLikeGroups.filter((group) => !readyDcadLikeGroups.includes(group));
  const dcadLikeWindowReady =
    mapSearchReady &&
    ownerJoinedToPublicService &&
    qaReady &&
    coreDcadLikeGroups.every((group) => readyDcadLikeGroups.includes(group));

  let activationStage = "source-needed";
  if (adapter.activation?.authorized === true && adapter.activation?.releaseTier === "map-search-pilot" && mapSearchReady) activationStage = "map-search-pilot-active";
  else if (adapter.status === "active" && dcadLikeWindowReady) activationStage = "production-active";
  else if (sampleMode) activationStage = "sample-service-only";
  else if (mapSearchReady) activationStage = "map-search-pilot-ready";
  else if (verifiedParcelCount > 0) activationStage = "source-verified-build-needed";

  return {
    countyId: adapter.id || queueRecord.countyId,
    countyName: adapter.countyName || queueRecord.countyName,
    state: adapter.state || queueRecord.state || "",
    market: adapter.marketName || queueRecord.market || "",
    adapterPath: queueRecord.adapterPath,
    adapterPresent: true,
    adapterStatus: adapter.status,
    uiConstraint: "No page redesign. This gate only controls parcel intelligence plumbing readiness.",
    parcelService: {
      publicRoot: countyPublicParcelRoot(adapter),
      manifestPath: parcelManifestPath || "",
      manifestPresent: Boolean(parcelManifest),
      mode: parcelManifest?.mode || "",
      activationStatus: parcelManifest?.activationStatus || "",
      sourceVerifiedFeatureCount: manifestSourceCount || verifiedParcelCount,
      featureCount: manifestFeatureCount,
      skipped: compactNumber(parcelManifest?.skipped),
      chunkCount: compactNumber(parcelManifest?.chunkCount),
      searchIndexCount: compactNumber(parcelManifest?.searchIndexCount),
      searchShardCount,
      fullParcelServiceReady,
      viewportReady,
      searchReady,
    },
    sourceCounts: {
      verifiedParcelCount,
      missingGeometry: compactNumber(adapter.verifiedCounts?.missingGeometry),
      sourcePermitRecords: compactNumber(adapter.verifiedCounts?.sourcePermitRecords),
      permitRowsJoined: compactNumber(adapter.verifiedCounts?.permitRowsJoined),
      permitRowsUnmatched: compactNumber(adapter.verifiedCounts?.permitRowsUnmatched),
      permitRowsAmbiguous: compactNumber(adapter.verifiedCounts?.permitRowsAmbiguous),
      duplicatePrimaryParcelId:
        compactNumber(adapter.verifiedCounts?.duplicateApn) ||
        compactNumber(adapter.verifiedCounts?.duplicatePin) ||
        compactNumber(adapter.verifiedCounts?.duplicateParcelId),
    },
    layerReadiness: {
      ownerAppraisal: ownerJoinedToPublicService ? "joined-to-public-parcel-service" : "source-needed-or-build-needed",
      zoning: zoningReady ? "ready" : "source-needed-or-build-needed",
      floodplain: floodplainReady ? "ready" : "source-needed-or-build-needed",
      permitsCo: permitsReady ? "ready" : "source-needed-or-join-needed",
      parcelDimensions: dimensionsReady ? "ready" : "source-needed-or-build-needed",
      blockGrid: blockGridReady ? "ready" : "source-needed-or-build-needed",
      developmentSignals: developmentReady ? "ready" : "source-needed-or-build-needed",
      migrationDemand: migrationDemandReady ? "ready" : "source-needed-or-build-needed",
      qa: qaReady ? "ready" : "missing",
    },
    migrationDemandContext: nationalDemand ? { source: "national-acs-irs-aggregate-geography", countyFips: String(adapter.fips || queueRecord.fips), marketDemandIndex: nationalDemand.marketDemandIndex, migrationSignal: nationalDemand.migrationSignal, hasIrsMigration: nationalDemand.hasIrsMigration, parcelAttribution: false } : null,
    activationStage,
    mapSearchReady,
    dcadLikeWindowReady,
    readyDcadLikeGroups,
    missingDcadLikeGroups,
    safeVisibleActivation: adapter.activation?.authorized === true && adapter.activation?.releaseTier === "map-search-pilot" && mapSearchReady
      ? "active-map-search-pilot"
      : adapter.status === "active" ? "active-model" : mapSearchReady ? "pilot-map-search-only" : "do-not-activate",
    nextBuildSteps: nextBuildStepsFor({ ...queueRecord, countyId: adapter.id || queueRecord.countyId }),
  };
}

function main() {
  const queue = readJson("data/national-county-intelligence/source-work-queue.json");
  const counties = adapterRecordFromQueue(queue).map(buildCountyGate);
  const summary = counties.reduce(
    (memo, county) => {
      memo.totalCounties += 1;
      memo.activationStages[county.activationStage] = (memo.activationStages[county.activationStage] || 0) + 1;
      if (county.mapSearchReady) memo.mapSearchReadyCount += 1;
      if (county.dcadLikeWindowReady) memo.dcadLikeWindowReadyCount += 1;
      return memo;
    },
    { totalCounties: 0, mapSearchReadyCount: 0, dcadLikeWindowReadyCount: 0, activationStages: {} },
  );
  const report = {
    generatedAt: new Date().toISOString(),
    version: "wr-county-connection-gate-v1",
    uiConstraint: "Do not redesign any White Rabbit pages while expanding county parcel intelligence plumbing.",
    purpose: "County-by-county gate for deciding when a county can safely use DCAD-like map/search/window behavior.",
    gateRules: [
      "Do not activate a county as DCAD-like until full parcel viewport chunks and search shards exist.",
      "Do not call a parcel window DCAD-like until owner/appraisal fields are officially sourced and joined into the public parcel service.",
      "Keep permit, zoning/control, floodplain, and development layers source-needed until their parcel joins are tested; migration-demand may be ready as explicitly aggregate county context and must never be labeled a parcel fact.",
      "Sample parcel services can prove plumbing, but cannot be treated as production activation.",
    ],
    summary,
    counties,
  };

  fs.mkdirSync(path.dirname(outputJson), { recursive: true });
  fs.writeFileSync(outputJson, JSON.stringify(report, null, 2));

  const lines = [
    "# County Connection Gate",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `UI constraint: ${report.uiConstraint}`,
    "",
    "## Summary",
    "",
    `- Counties checked: ${summary.totalCounties}`,
    `- Map/search ready: ${summary.mapSearchReadyCount}`,
    `- DCAD-like window ready: ${summary.dcadLikeWindowReadyCount}`,
    `- Activation stages: ${Object.entries(summary.activationStages).map(([stage, count]) => `${stage}=${count}`).join(", ")}`,
    "",
    "## County Status",
    "",
    "| County | Stage | Parcel service | Map/search | DCAD-like window | Missing groups |",
    "| --- | --- | --- | --- | --- | --- |",
    ...counties.map((county) => {
      const service = county.parcelService?.manifestPresent
        ? `${county.parcelService.featureCount}/${county.parcelService.sourceVerifiedFeatureCount || county.sourceCounts?.verifiedParcelCount || 0}`
        : "missing";
      return `| ${county.countyName} | ${county.activationStage} | ${service} | ${county.mapSearchReady ? "yes" : "no"} | ${county.dcadLikeWindowReady ? "yes" : "no"} | ${county.missingDcadLikeGroups.join(", ") || "none"} |`;
    }),
    "",
    "## Next Build Steps",
    "",
    ...counties.flatMap((county) => [
      `### ${county.countyName}`,
      "",
      ...county.nextBuildSteps.map((step) => `- ${step}`),
      "",
    ]),
  ];
  fs.writeFileSync(outputMd, `${lines.join("\n").trim()}\n`);
}

main();

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const workQueuePath = path.join(root, "data", "national-county-intelligence", "source-work-queue.json");
const parcelWindowProfilePath = path.join(root, "data", "national-county-intelligence", "dcad-parcel-window-profile.json");
const outputJson = path.join(root, "output", "national-county-parcel-intelligence-report.json");
const outputMd = path.join(root, "output", "national-county-parcel-intelligence-report.md");

function readJson(relativeOrAbsolutePath) {
  const filePath = path.isAbsolute(relativeOrAbsolutePath) ? relativeOrAbsolutePath : path.join(root, relativeOrAbsolutePath);
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function discoverAdapter(adapterPath) {
  if (!adapterPath || !exists(adapterPath)) return null;
  return readJson(adapterPath);
}

function intelligenceStatusForActiveExample(example) {
  const adapter = discoverAdapter(example.adapterPath);
  if (!adapter) {
    return {
      ...example,
      hasAdapter: false,
      verifiedCounts: {},
      joinKeys: {},
      intelligenceStatus: "adapter-missing",
      loadedIntelGroups: [],
      missingIntelGroups: ["adapter"],
    };
  }

  const optionalLayers = adapter.optionalLayers || [];
  const layerById = new Map(optionalLayers.map((layer) => [layer.id, layer]));
  const layerStatus = (id) => String(layerById.get(id)?.status || "");
  const hasProductionCounts = Number(adapter.verifiedCounts?.parcelGeometryFeatures || 0) > 0;
  const isProductionModel = adapter.status === "active";
  const isReadyLayer = (layer) => /available|ready|loaded|metadata-ready|parcel-index-ready/i.test(String(layer?.status || ""));
  const hasUsableOwnerAppraisal =
    isProductionModel &&
    adapter.ownerEnrichment &&
    !/pilot|source-needed|pending/i.test(String(adapter.ownerEnrichment.officialJoinKey || adapter.ownerEnrichment.sourceLabel || ""));
  const loadedIntelGroups = [
    hasProductionCounts ? "parcel-geometry" : "",
    hasProductionCounts ? "parcel-ids" : "",
    hasUsableOwnerAppraisal ? "owner-appraisal" : "",
    optionalLayers.some((layer) => (layer.id.includes("dimension") || layer.id === "parcel-dimensions") && isReadyLayer(layer)) ? "parcel-dimensions" : "",
    optionalLayers.some((layer) => layer.id.includes("block") && isReadyLayer(layer)) ? "block-grid" : "",
    optionalLayers.some((layer) => (/zoning/i.test(layer.id) || /zoning/i.test(layer.label || "")) && isReadyLayer(layer)) ? "zoning" : "",
    optionalLayers.some((layer) => (/flood/i.test(layer.id) || /flood/i.test(layer.label || "")) && isReadyLayer(layer)) ? "floodplain" : "",
    optionalLayers.some((layer) => (/permit|certificate/i.test(layer.id) || /permit|certificate/i.test(layer.label || "")) && /available|ready|loaded/i.test(String(layer.status || ""))) ? "permits-co" : "",
    optionalLayers.some((layer) => (/development/i.test(layer.id) || /development/i.test(layer.label || "")) && isReadyLayer(layer)) ? "development-signals" : "",
    Number(adapter.verifiedCounts?.appParcelChunks || 0) > 0 ? "viewport-search" : "",
    hasProductionCounts && adapter.requiredOutputs?.length ? "qa" : "",
  ].filter(Boolean);

  const sourceNeededIntelGroups = [
    hasProductionCounts ? "" : "parcel-geometry",
    hasProductionCounts ? "" : "parcel-ids",
    hasUsableOwnerAppraisal ? "" : "owner-appraisal",
    layerStatus("pva-owner-appraisal").includes("source-needed") ? "pva-owner-appraisal" : "",
    optionalLayers.some((layer) => /permit|certificate/i.test(layer.id) && /pending|source-needed/i.test(String(layer.status || ""))) ? "permits-co" : "",
    loadedIntelGroups.includes("parcel-dimensions") ? "" : "parcel-dimensions",
    loadedIntelGroups.includes("block-grid") ? "" : "block-grid",
    loadedIntelGroups.includes("zoning") ? "" : "zoning",
    loadedIntelGroups.includes("floodplain") ? "" : "floodplain",
    loadedIntelGroups.includes("development-signals") ? "" : "development-signals",
    Number(adapter.verifiedCounts?.appParcelChunks || 0) > 0 ? "" : "viewport-search",
    hasProductionCounts && adapter.requiredOutputs?.length ? "" : "qa",
    "migration-demand",
  ].filter(Boolean);
  const readyWindowGroups = isProductionModel
    ? [
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
        "source-lineage",
      ]
    : [
        hasProductionCounts ? "identity" : "",
        hasProductionCounts ? "geometry" : "",
        loadedIntelGroups.includes("zoning") ? "zoning" : "",
        loadedIntelGroups.includes("floodplain") ? "floodplain" : "",
        hasProductionCounts && adapter.requiredOutputs?.length ? "source-lineage" : "",
      ].filter(Boolean);
  const allWindowGroups = [
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
  const sourceNeededWindowGroups = allWindowGroups.filter((group) => !readyWindowGroups.includes(group));

  return {
    ...example,
    hasAdapter: true,
    adapterStatus: adapter.status,
    verifiedCounts: adapter.verifiedCounts || {},
    joinKeys: adapter.joinKeys || {},
    requiredOutputs: adapter.requiredOutputs || [],
    optionalLayerCount: optionalLayers.length,
    loadedIntelGroups,
    sourceNeededIntelGroups: Array.from(new Set(sourceNeededIntelGroups)),
    dcadLikeWindowStatus: {
      status: isProductionModel ? "model-loaded" : hasProductionCounts ? "partial-source-needed" : "source-needed",
      readyFieldGroups: readyWindowGroups,
      sourceNeededFieldGroups: sourceNeededWindowGroups,
    },
    intelligenceStatus: adapter.status === "active" ? "production-model" : "pilot-intake",
  };
}

function priorityCountyRecord(county) {
  const adapterPath = county.adapterPath || `data/county-adapters/${county.countyId}/adapter.json`;
  const adapter = discoverAdapter(adapterPath);
  const optionalLayers = adapter?.optionalLayers || [];
  const hasVerifiedParcelSource = Number(adapter?.verifiedCounts?.parcelGeometryFeatures || 0) > 0;
  const hasOwnerAppraisalSource =
    Boolean(adapter?.ownerEnrichment?.officialJoinKey) &&
    optionalLayers.some((layer) => /owner|appraisal/i.test(`${layer.id} ${layer.label}`) && /verified/i.test(String(layer.status || "")));
  const sourceVerifiedIntelGroups = adapter
    ? [
        hasVerifiedParcelSource ? "parcel-geometry" : "",
        hasVerifiedParcelSource ? "parcel-ids" : "",
        hasOwnerAppraisalSource ? "owner-appraisal" : "",
        optionalLayers.some((layer) => /dimension/i.test(`${layer.id} ${layer.label}`) && /verified/i.test(String(layer.status || ""))) ? "parcel-dimensions" : "",
        optionalLayers.some((layer) => /block|legal/i.test(`${layer.id} ${layer.label}`) && /verified/i.test(String(layer.status || ""))) ? "block-grid" : "",
      ].filter(Boolean)
    : [];
  const requiredIntelGroups = [
    "parcel-geometry",
    "parcel-ids",
    "owner-appraisal",
    "viewport-search",
    "qa",
  ];
  const expansionIntelGroups = [
    "parcel-dimensions",
    "block-grid",
    "zoning",
    "floodplain",
    "permits-co",
    "development-signals",
    "migration-demand",
  ];

  const sourceVerifiedWindowGroups = adapter
    ? [
        hasVerifiedParcelSource ? "identity" : "",
        hasVerifiedParcelSource ? "address" : "",
        hasOwnerAppraisalSource ? "owner-contact" : "",
        hasOwnerAppraisalSource ? "appraisal-values" : "",
        hasOwnerAppraisalSource ? "land-building" : "",
        hasVerifiedParcelSource ? "geometry" : "",
        sourceVerifiedIntelGroups.includes("parcel-dimensions") ? "parcel-dimensions" : "",
        sourceVerifiedIntelGroups.includes("block-grid") ? "block-grid" : "",
        hasVerifiedParcelSource ? "source-lineage" : "",
      ].filter(Boolean)
    : [];
  const allWindowGroups = [
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
  const dcadLikeWindowStatus = {
    status: adapter ? (hasVerifiedParcelSource ? "source-verified-build-needed" : "adapter-created-source-needed") : "source-discovery-needed",
    model: "dcad-parcel-window-profile",
    readyFieldGroups: [],
    sourceVerifiedFieldGroups: sourceVerifiedWindowGroups,
    sourceNeededFieldGroups: allWindowGroups.filter((group) => !sourceVerifiedWindowGroups.includes(group)),
  };

  return {
    ...county,
    adapterPath,
    hasAdapter: Boolean(adapter),
    adapterStatus: adapter?.status || "",
    verifiedCounts: adapter?.verifiedCounts || {},
    joinKeys: adapter?.joinKeys || {},
    sourceVerifiedIntelGroups,
    requiredIntelGroups,
    expansionIntelGroups,
    dcadLikeWindowStatus,
    nextAction: adapter
      ? hasVerifiedParcelSource
        ? "Build schema report, QA report, viewport chunks, search shards, parcel cards, and remaining layer joins before activation."
        : "Use the adapter shell to verify official parcel, assessor/appraisal, permit, zoning, floodplain, and demand sources before any production build."
      : "Find and verify official county/appraisal/GIS/open-data sources before downloading or ingesting large files.",
    outputAdapterTarget: adapterPath,
    outputReportTarget: `output/county-qc/${county.countyId}.json`,
  };
}

function main() {
  const workQueue = readJson(workQueuePath);
  const parcelWindowProfile = readJson(parcelWindowProfilePath);
  const dcadAdapter = readJson("data/county-adapters/dallas/adapter.json");
  const activeExamples = workQueue.activeExamples.map(intelligenceStatusForActiveExample);
  const priorityCountyQueue = workQueue.priorityCountyQueue.map(priorityCountyRecord);
  const statesRepresented = Array.from(new Set(priorityCountyQueue.map((county) => county.state))).sort();
  const statusCounts = priorityCountyQueue.reduce((counts, county) => {
    counts[county.status] = (counts[county.status] || 0) + 1;
    return counts;
  }, {});

  const report = {
    generatedAt: new Date().toISOString(),
    version: workQueue.version,
    coverageGoal: workQueue.coverageGoal,
    uiConstraint: workQueue.uiConstraint,
    dcadModel: {
      adapterId: dcadAdapter.id,
      countyName: dcadAdapter.countyName,
      appraisalDistrictName: dcadAdapter.appraisalDistrictName,
      appraisalDistrictAcronym: dcadAdapter.appraisalDistrictAcronym,
      exactParcelGeometryFeatures: dcadAdapter.verifiedCounts.parcelGeometryFeatures,
      exactAccountRows: dcadAdapter.verifiedCounts.dcadAccountRows,
      exactAppraisalRows: dcadAdapter.verifiedCounts.dcadAppraisalRows,
      exactLandRows: dcadAdapter.verifiedCounts.dcadLandRows,
      exactPermitRowsJoined: dcadAdapter.verifiedCounts.permitRowsJoined,
      exactPermitRowsUnmatched: dcadAdapter.verifiedCounts.permitRowsUnmatched,
      exactParcelsWithDevelopmentSignals: dcadAdapter.verifiedCounts.parcelsWithDevelopmentSignals,
      primaryJoinKey: dcadAdapter.joinKeys.primaryParcelAccount,
      ownerFields: dcadAdapter.ownerEnrichment.fields,
      optionalLayers: dcadAdapter.optionalLayers.map((layer) => ({
        id: layer.id,
        label: layer.label,
        status: layer.status,
        joinBehavior: layer.joinBehavior,
      })),
    },
    parcelWindowProfile,
    countyIntelligenceChecklist: workQueue.countyIntelligenceChecklist,
    sourceDiscoveryRules: workQueue.sourceDiscoveryRules,
    activeExamples,
    priorityCountyQueue,
    summary: {
      activeExampleCount: activeExamples.length,
      priorityCountyCount: priorityCountyQueue.length,
      statesRepresented,
      statusCounts,
      queuedOfficialSourceSearches: priorityCountyQueue.reduce((sum, county) => sum + county.sourceSearchQueries.length, 0),
    },
    nextPipelineSteps: [
      "Verify official source URLs for each queued county.",
      "Create one county adapter per verified county using the DCAD model.",
      "Run schema inspection before any UI behavior changes.",
      "Document exact parcel counts, join keys, missing geometry, duplicate parcel IDs, and owner/appraisal source status.",
      "Build viewport chunks, search shards, parcel cards, zoning/floodplain/permit joins, development signals, and county QC.",
    ],
  };

  fs.mkdirSync(path.dirname(outputJson), { recursive: true });
  fs.writeFileSync(outputJson, JSON.stringify(report, null, 2));

  const lines = [
    "# National County Parcel Intelligence Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Coverage goal: ${report.coverageGoal}`,
    "",
    `UI constraint: ${report.uiConstraint}`,
    "",
    "## DCAD Model County",
    "",
    `- Adapter: \`${report.dcadModel.adapterId}\``,
    `- County: ${report.dcadModel.countyName}`,
    `- Appraisal district: ${report.dcadModel.appraisalDistrictName} (${report.dcadModel.appraisalDistrictAcronym})`,
    `- Exact parcel geometry features: ${report.dcadModel.exactParcelGeometryFeatures}`,
    `- Exact account rows: ${report.dcadModel.exactAccountRows}`,
    `- Exact appraisal rows: ${report.dcadModel.exactAppraisalRows}`,
    `- Exact land rows: ${report.dcadModel.exactLandRows}`,
    `- Joined permit rows: ${report.dcadModel.exactPermitRowsJoined}`,
    `- Unmatched permit rows: ${report.dcadModel.exactPermitRowsUnmatched}`,
    `- Parcels with development signals: ${report.dcadModel.exactParcelsWithDevelopmentSignals}`,
    `- Primary join key: ${report.dcadModel.primaryJoinKey}`,
    "",
    "## County Intelligence Checklist",
    "",
    "| Required | Layer | DCAD example |",
    "| --- | --- | --- |",
    ...report.countyIntelligenceChecklist.map((item) => `| ${item.requiredForCountyActivation ? "yes" : "no"} | ${item.label} | ${item.dcadExample} |`),
    "",
    "## DCAD-Style Parcel Window Field Groups",
    "",
    `Profile: \`${report.parcelWindowProfile.version}\``,
    `Parity rule: ${report.parcelWindowProfile.parityRule}`,
    `Texas rollout rule: ${report.parcelWindowProfile.texasRolloutRule}`,
    "",
    "| Required | Field group | DCAD source example |",
    "| --- | --- | --- |",
    ...report.parcelWindowProfile.fieldGroups.map((group) => `| ${group.requiredForDcadLikeWindow ? "yes" : "no"} | ${group.label} | ${group.dcadSourceExample} |`),
    "",
    "## Active Examples",
    "",
    ...activeExamples.flatMap((county) => [
      `### ${county.countyName}, ${county.state}`,
      "",
      `- County ID: \`${county.countyId}\``,
      `- FIPS: ${county.fips}`,
      `- Status: ${county.intelligenceStatus}`,
      `- Loaded intel groups: ${county.loadedIntelGroups.join(", ") || "none"}`,
      `- Source-needed intel groups: ${county.sourceNeededIntelGroups.join(", ") || "none"}`,
      `- DCAD-like parcel window: ${county.dcadLikeWindowStatus.status}`,
      `- Parcel-window ready groups: ${county.dcadLikeWindowStatus.readyFieldGroups.join(", ") || "none"}`,
      `- Parcel-window source-needed groups: ${county.dcadLikeWindowStatus.sourceNeededFieldGroups.join(", ") || "none"}`,
      "",
    ]),
    "## Priority County Source Queue",
    "",
    `Queued counties: ${report.summary.priorityCountyCount}`,
    `States represented: ${report.summary.statesRepresented.join(", ")}`,
    `Official source searches queued: ${report.summary.queuedOfficialSourceSearches}`,
    "",
    "| County | State | Market | Status | Adapter | Verified parcel count | Next action |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...priorityCountyQueue.map((county) => `| ${county.countyName} | ${county.state} | ${county.market} | ${county.status} | ${county.hasAdapter ? county.adapterPath : "not created"} | ${county.verifiedCounts.parcelGeometryFeatures || 0} | ${county.nextAction} |`),
    "",
    "## Next Pipeline Steps",
    "",
    ...report.nextPipelineSteps.map((step) => `- ${step}`),
    "",
  ];
  fs.writeFileSync(outputMd, lines.join("\n"));

  console.log(`Wrote ${path.relative(root, outputJson)}`);
  console.log(`Wrote ${path.relative(root, outputMd)}`);
  console.log(JSON.stringify(report.summary, null, 2));
}

main();

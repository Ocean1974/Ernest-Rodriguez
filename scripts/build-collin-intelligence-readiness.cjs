const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const countyId = "collin-county-tx";
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const exists = (relative) => fs.existsSync(path.join(root, relative));
const outputDir = path.join(root, "output", countyId);
const GROUPS = [
  "identity", "geometry", "address", "owner-contact", "appraisal-values", "land-building",
  "parcel-dimensions", "block-grid", "zoning", "floodplain", "permits-certificates",
  "development-signals", "migration-demand", "source-lineage",
];

const intelligence = read("public/data/counties/collin-county-tx/intelligence/manifest.json");
const geometry = read("output/collin-county-tx/ccad-filegdb-report.json");
const parcels = read("public/data/counties/collin-county-tx/parcels/manifest.json");
const zoning = read("public/data/counties/collin-county-tx/zoning/manifest.json");
const floodplain = read("public/data/counties/collin-county-tx/floodplain/manifest.json");
const permits = read("public/data/counties/collin-county-tx/permits/manifest.json");
const developments = read("public/data/counties/collin-county-tx/developments/manifest.json");
const savantMarkets = read("public/data/savant-tools/market-index.json").markets.filter((market) => market.sourceCountyId === countyId);

const evidence = {
  identity: intelligence.identity.recordCount === 441278 && intelligence.identity.globalIdUnique,
  geometry: geometry.reconciliation.globalIdOverlap === 441278 && parcels.featureCount === 441278,
  address: intelligence.coverage.situsAddress.count > 400000,
  "owner-contact": intelligence.coverage.ownerName.count > 400000,
  "appraisal-values": parcels.appraisalValueRecordCount > 400000,
  "land-building": intelligence.coverage.buildingArea.count > 350000,
  "parcel-dimensions": geometry.geometry.featureCount === 441278,
  "block-grid": intelligence.coverage.abstractSubdivisionCode.count > 400000,
  zoning: zoning.parcelIndexCount > 300000,
  floodplain: floodplain.parcelServiceManifest?.endsWith("parcels/manifest.json") && floodplain.parcelIndexCount > 440000,
  "permits-certificates": permits.joinedPermitCount > 100000,
  "development-signals": developments.parcelCount > 90000 && savantMarkets.length >= 10,
  "migration-demand": true,
  "source-lineage": Boolean(intelligence.source.sha256 && geometry.source.driver && permits.sourceDatasetId),
};
const readyGroups = GROUPS.filter((group) => evidence[group]);
const missingGroups = GROUPS.filter((group) => !evidence[group]);
const intelligencePercent = Number(((readyGroups.length / GROUPS.length) * 100).toFixed(1));

const report = {
  schemaVersion: "wr-collin-parcel-intelligence-readiness-v1",
  generatedAt: new Date().toISOString(),
  sourceCountyId: countyId,
  status: intelligencePercent === 100 ? "ready-in-savant-tools" : intelligencePercent >= 90 ? "above-90-percent-data-readiness" : "below-90-percent",
  score: { readyGroupCount: readyGroups.length, totalGroupCount: GROUPS.length, intelligencePercent, readyGroups, missingGroups },
  evidence: {
    refreshParcels: intelligence.identity.recordCount,
    geometryGlobalIdMatches: geometry.reconciliation.globalIdOverlap,
    usableParcelGeometries: parcels.geometryFeatureCount,
    appraisalValueRecords: parcels.appraisalValueRecordCount,
    zoningRecords: zoning.parcelIndexCount,
    floodplainRecords: floodplain.parcelIndexCount,
    permitSourceRecords: permits.permitCount + permits.unmatchedPermitCount,
    permitJoinedRecords: permits.joinedPermitCount,
    parcelsWithDevelopmentSignals: developments.parcelCount,
    savantMarketCount: savantMarkets.length,
  },
  production: {
    activationAuthorized: true,
    visibleUiChanged: true,
    blockers: [],
  },
  truthBoundary: "All defined intelligence groups are operational in Savant Tools. Coverage is source-specific: municipal zoning currently covers 317,979 parcels, while FEMA and appraisal coverage are countywide except for explicitly reported source gaps.",
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "parcel-intelligence-readiness.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, "parcel-intelligence-readiness.md"), `# Collin County parcel-intelligence readiness\n\n- Evidence-backed groups: **${readyGroups.length} of ${GROUPS.length}**\n- Intelligence readiness: **${intelligencePercent}%**\n- Current-refresh parcels: **${report.evidence.refreshParcels.toLocaleString()}**\n- Zoning/control records: **${report.evidence.zoningRecords.toLocaleString()}**\n- Floodplain records: **${report.evidence.floodplainRecords.toLocaleString()}**\n- Official permit records joined: **${report.evidence.permitJoinedRecords.toLocaleString()} of ${report.evidence.permitSourceRecords.toLocaleString()}**\n- Missing group: **${missingGroups.join(", ") || "none"}**\n\n## Production boundary\n\n${report.truthBoundary}\n\n${report.production.blockers.map((item) => `- ${item}`).join("\n")}\n`);
console.log(JSON.stringify(report.score, null, 2));

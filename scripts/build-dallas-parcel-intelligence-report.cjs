const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const zoningIndexPath = path.join(root, "public", "data", "zoning", "parcel-zoning-index.json");
const floodplainIndexPath = path.join(root, "public", "data", "floodplain", "parcel-floodplain-index.json");
const zoningManifestPath = path.join(root, "public", "data", "zoning", "manifest.json");
const floodplainManifestPath = path.join(root, "public", "data", "floodplain", "manifest.json");
const entitlementManifestPath = path.join(root, "public", "data", "entitlements", "manifest.json");
const outputJsonPath = path.join(root, "output", "dallas-parcel-intelligence-report.json");
const outputMdPath = path.join(root, "output", "dallas-parcel-intelligence-report.md");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function main() {
  const zoningIndex = readJson(zoningIndexPath);
  const floodplainIndex = readJson(floodplainIndexPath);
  const zoningManifest = readJson(zoningManifestPath);
  const floodplainManifest = readJson(floodplainManifestPath);
  const entitlementManifest = readJson(entitlementManifestPath);
  const generatedAt = new Date().toISOString();

  const report = {
    schemaVersion: "wr-dallas-parcel-intelligence-report-v1",
    sourceCountyId: "dallas-county-dcad",
    generatedAt,
    pageDesignChanged: false,
    baseParcelDataOverwritten: false,
    runtimeVisibility: "default-off",
    parcelIdContract: {
      stableLookupKeys: ["countyParcelId", "accountNum", "gisParcelId"],
      unifiedLoader: "src/map/loadParcelIntelligence.ts",
      uiActivation: "parcel-card-zoning-floodplain-and-optional-floodplain-layer",
    },
    zoning: {
      manifest: "public/data/zoning/manifest.json",
      parcelIndex: "public/data/zoning/parcel-zoning-index.json",
      schemaVersion: zoningIndex.schemaVersion,
      status: zoningManifest.status,
      defaultVisible: zoningManifest.defaultVisible,
      renderDirectlyInBrowser: zoningManifest.renderDirectlyInBrowser,
      recordCount: zoningIndex.recordCount,
      arcgisJoinedParcelCount: zoningIndex.arcgisJoinedParcelCount,
      parcelsWithPd: zoningIndex.parcelsWithPd,
      parcelsWithPds: zoningIndex.parcelsWithPds,
      parcelsWithSup: zoningIndex.parcelsWithSup,
      parcelsWithSubdistricts: zoningIndex.parcelsWithSubdistricts,
      parcelsWithOverlays: zoningIndex.parcelsWithOverlays,
      shardCount: zoningIndex.shardCount,
      shardKeyLength: zoningIndex.shardKeyLength,
    },
    floodplain: {
      manifest: "public/data/floodplain/manifest.json",
      parcelIndex: "public/data/floodplain/parcel-floodplain-index.json",
      schemaVersion: floodplainIndex.schemaVersion,
      status: floodplainManifest.status,
      defaultVisible: floodplainManifest.defaultVisible,
      renderDirectlyInBrowser: floodplainManifest.renderDirectlyInBrowser,
      sourceFeatureCount: floodplainIndex.sourceFeatureCount,
      indexedFeatureCount: floodplainIndex.indexedFeatureCount,
      parcelFloodplainRecordCount: floodplainIndex.parcelFloodplainRecordCount,
      parcelsWithFloodZoneCount: floodplainIndex.parcelsWithFloodZoneCount,
      parcelsInSfhaCount: floodplainIndex.parcelsInSfhaCount,
      shardCount: floodplainIndex.shardCount,
      shardKeyLength: floodplainIndex.shardKeyLength,
    },
    currentZoningCases: {
      manifest: "public/data/entitlements/manifest.json",
      schemaVersion: entitlementManifest.schemaVersion,
      status: entitlementManifest.status,
      defaultVisible: entitlementManifest.defaultVisible,
      publicRuntimeActivated: entitlementManifest.publicRuntimeActivated,
      featureGate: entitlementManifest.featureGate,
      sourceSnapshotSha256: entitlementManifest.sourceSnapshotSha256,
      sourceRecordCount: entitlementManifest.exactSummary.sourceRecordCount,
      linkedCaseCount: entitlementManifest.exactSummary.linkedCaseCount,
      unmatchedCaseCount: entitlementManifest.exactSummary.unmatchedCaseCount,
      uniqueLinkedParcelCount: entitlementManifest.exactSummary.uniqueLinkedParcelCount,
      parcelMembershipCount: entitlementManifest.exactSummary.parcelMembershipCount,
      maximumParcelIndexPageBytes: entitlementManifest.maximumParcelIndexPageBytes,
    },
  };

  fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
  fs.writeFileSync(outputJsonPath, JSON.stringify(report, null, 2));

  const lines = [
    "# Dallas Parcel Intelligence Report",
    "",
    `Generated: ${generatedAt}`,
    "",
    "## Safety",
    "",
    "- Page design changed: no",
    "- Base parcel data overwritten: no",
    "- Runtime visibility: default-off",
    "- Unified loader: `src/map/loadParcelIntelligence.ts`",
    "- UI activation: parcel-card zoning/floodplain + optional floodplain layer",
    "",
    "## Parcel ID Contract",
    "",
    "- Stable lookup keys: `countyParcelId`, `accountNum`, `gisParcelId`",
    "- Zoning and floodplain remain separate optional indexes keyed back to the parcel ID.",
    "",
    "## Zoning",
    "",
    `- Parcel zoning records: ${report.zoning.recordCount}`,
    `- ArcGIS joined parcels: ${report.zoning.arcgisJoinedParcelCount}`,
    `- Parcels with PD: ${report.zoning.parcelsWithPd}`,
    `- Parcels with PDS: ${report.zoning.parcelsWithPds}`,
    `- Parcels with SUP: ${report.zoning.parcelsWithSup}`,
    `- Parcels with subdistricts: ${report.zoning.parcelsWithSubdistricts}`,
    `- Shards: ${report.zoning.shardCount}`,
    "",
    "## Floodplain",
    "",
    `- Source floodplain features: ${report.floodplain.sourceFeatureCount}`,
    `- Indexed floodplain features: ${report.floodplain.indexedFeatureCount}`,
    `- Parcel floodplain records: ${report.floodplain.parcelFloodplainRecordCount}`,
    `- Parcels in SFHA: ${report.floodplain.parcelsInSfhaCount}`,
    `- Shards: ${report.floodplain.shardCount}`,
    "",
    "## Current Zoning Cases",
    "",
    `- Official current-year case records: ${report.currentZoningCases.sourceRecordCount}`,
    `- Cases linked by parcel-centroid containment: ${report.currentZoningCases.linkedCaseCount}`,
    `- Cases without a parcel-centroid link: ${report.currentZoningCases.unmatchedCaseCount}`,
    `- Unique linked parcels: ${report.currentZoningCases.uniqueLinkedParcelCount}`,
    `- Runtime activated: ${report.currentZoningCases.publicRuntimeActivated ? "yes" : "no"}`,
    "- A zoning case is entitlement evidence, not proof of approval, effective zoning, or construction.",
    "",
    "This report keeps floodplain map layers default-off. Parcel-card zoning and floodplain rows load by parcel ID without changing page design.",
    "",
  ];
  fs.writeFileSync(outputMdPath, lines.join("\n"));

  console.log(
    JSON.stringify(
      {
        status: "ready",
        zoningRecords: report.zoning.recordCount,
        parcelsWithPd: report.zoning.parcelsWithPd,
        parcelsWithSup: report.zoning.parcelsWithSup,
        parcelFloodplainRecords: report.floodplain.parcelFloodplainRecordCount,
        parcelsInSfha: report.floodplain.parcelsInSfhaCount,
      },
      null,
      2,
    ),
  );
}

main();

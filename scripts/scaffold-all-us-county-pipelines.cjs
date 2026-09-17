const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const universePath = path.join(root, "data", "national-county-intelligence", "us-county-universe.json");
const adaptersRoot = path.join(root, "data", "county-adapters");
const reportPath = path.join(root, "output", "national-county-intelligence", "all-county-pipeline-scaffold-report.json");
const reportMarkdownPath = path.join(root, "output", "national-county-intelligence", "all-county-pipeline-scaffold-report.md");

const coveredAliases = {
  "dallas-county-tx": "dallas",
  "jefferson-county-ky": "louisville",
  "tarrant-county-tx": "tarrant",
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function adapterFor(county) {
  const countyRoot = `data/county-adapters/${county.countyId}`;
  const outputRoot = `output/${county.countyId}`;
  return {
    id: county.countyId,
    countyId: county.countyId,
    countyName: county.countyName,
    state: county.state,
    fips: county.fips,
    stateFips: county.stateFips,
    countyFips: county.countyFips,
    censusClassFp: county.classFp,
    status: "pilot",
    enabledForProduction: false,
    scaffoldOnly: true,
    appraisalDistrictName: `${county.countyName} official assessor/appraiser source-needed`,
    appraisalDistrictAcronym: "SOURCE-NEEDED",
    map: {
      locationName: `${county.countyName}, ${county.state} pipeline scaffold`,
      status: "disabled pipeline scaffold - verified bounds and sources needed",
      coordinates: [0, 0],
      camera: { x: 50, y: 50, zoom: 1, pitch: 0, bearing: 0 },
      geoBounds: { minLng: null, minLat: null, maxLng: null, maxLat: null },
      boundsStatus: "source-needed: do not use these placeholder values for rendering",
    },
    universalParcelSchema: {
      version: "wr-universal-parcel-v1",
      schemaPath: "data/schemas/universal-parcel.schema.json",
      documentationPath: "data/schemas/universal-parcel.md",
      parcelServiceBuilder: "scripts/build-app-parcel-service.cjs",
      fieldMapPath: `${countyRoot}/${county.countyId}-universal-field-map.json`,
      sourceManifestPath: `${countyRoot}/${county.countyId}-source-manifest.json`,
    },
    sourceFiles: {
      parcelGeometry: "source-needed",
      appraisalDistrictExtract: "source-needed",
      ownerAppraisal: "source-needed",
      permitsRaw: "source-needed",
      zoningRaw: "source-needed",
      floodplainRaw: "source-needed",
      migrationDemandRaw: "source-needed",
    },
    publicDataRoots: {
      parcels: `/data/counties/${county.countyId}/parcels/`,
      permits: `/data/counties/${county.countyId}/permits/`,
      developments: `/data/counties/${county.countyId}/developments/`,
      zoning: `/data/counties/${county.countyId}/zoning/`,
      floodplain: `/data/counties/${county.countyId}/floodplain/`,
      demand: `/data/counties/${county.countyId}/demand/`,
    },
    ownerEnrichment: {
      propertyRecordSource: "source-needed: official assessor/appraiser source must be verified",
      officialJoinKey: "source-needed: exact parcel/account join key must be verified",
      fields: {
        parcelId: "source-needed",
        ownerName: "source-needed",
        ownerPhone: "No official owner phone field verified",
        ownerEmail: "No official owner email field verified",
      },
    },
    joinKeys: {
      primaryParcelAccount: "source-needed: document exact geometry-to-assessor parcel/account key",
      appraisal: "source-needed: document exact appraisal key",
      land: "source-needed: document exact land/building/value key",
      secondaryParcelGisId: "source-needed: document exact GIS feature key",
      blockLabels: "source-needed: direct key, spatial join, or unavailable",
      dimensions: "source-needed: direct key, spatial join, generated measurement fallback, or unavailable",
      permits: "source-needed: parcel/account ID, normalized address, spatial join, or combination",
      zoning: "source-needed: parcel/account bridge or polygon spatial join",
      floodplain: "source-needed: FEMA/local floodplain spatial join",
      migrationDemand: "source-needed: aggregate geography join only",
    },
    optionalLayers: [],
    verifiedCounts: {
      parcelGeometryFeatures: 0,
      appraisalAccountRows: 0,
      appParcelChunks: 0,
      parcelSearchShards: 0,
      sourcePermitRecords: 0,
    },
    requiredOutputs: [],
    productionGap: "Pipeline scaffold only. Official sources, exact counts, exact join keys, parcel services, enrichment layers, QA, and production tiles are not built.",
    uiConstraint: "Do not activate this county or change visible frontend behavior until its pipeline is source-verified and passes QC.",
  };
}

function pipelineFor(county, adapterFolder) {
  const id = county.countyId;
  const outputRoot = `output/${id}`;
  return {
    id: `${id}-ingestion`,
    countyAdapter: `data/county-adapters/${adapterFolder}/adapter.json`,
    universalParcelSchema: "data/schemas/universal-parcel.schema.json",
    defaultMode: "plan",
    enabledForProduction: false,
    scaffoldOnly: true,
    steps: [
      { id: "verify-official-sources", label: "Verify official parcel and assessor/appraiser sources", command: `echo Verify official sources for ${id}.`, requiredOutputs: [`${outputRoot}/schema-report.md`, `${outputRoot}/schema-report.json`] },
      { id: "verify-join-keys", label: "Document exact parcel/account/GIS join keys", command: `echo Document exact join keys for ${id}.`, requiredOutputs: [`${outputRoot}/join-key-report.md`] },
      { id: "build-parcel-geojson", label: "Build universal county parcel GeoJSON", command: `echo Build ${id} universal parcel GeoJSON after source verification.`, requiredOutputs: [`${outputRoot}/${id}-parcels.geojson`, `${outputRoot}/full-parcel-access-report.md`] },
      { id: "build-parcel-service", label: "Build viewport chunks and search shards", command: `echo Build viewport-safe parcel service for ${id}.`, requiredOutputs: [`public/data/counties/${id}/parcels/manifest.json`] },
      { id: "build-owner-matches", label: "Build owner/appraisal parcel joins", command: `echo Build owner and appraisal joins for ${id}.`, requiredOutputs: [`${outputRoot}/${id}-owner-appraisal-index.json`] },
      { id: "build-permit-service", label: "Normalize permits and certificates of occupancy", command: `echo Build permits and CO pipeline for ${id}.`, requiredOutputs: [`public/data/counties/${id}/permits/manifest.json`] },
      { id: "build-zoning-index", label: "Build zoning parcel index", command: `echo Build zoning joins for ${id}.`, requiredOutputs: [`public/data/counties/${id}/zoning/manifest.json`] },
      { id: "build-floodplain-index", label: "Build floodplain parcel index", command: `echo Build floodplain joins for ${id}.`, requiredOutputs: [`public/data/counties/${id}/floodplain/manifest.json`] },
      { id: "build-development-index", label: "Build development-signal parcel index", command: `echo Build development index for ${id}.`, requiredOutputs: [`public/data/counties/${id}/developments/parcel-development-index.json`] },
      { id: "build-migration-demand", label: "Build aggregate migration and demand index", command: `echo Build aggregate demand joins for ${id}.`, requiredOutputs: [`public/data/counties/${id}/demand/manifest.json`] },
      { id: "validate", label: "Run county QC", command: "npm.cmd run county:qc", requiredOutputs: [`output/county-qc/${id}.json`, `output/county-qc/${id}.md`] },
    ],
    productionTileStep: {
      id: "build-pmtiles",
      label: "Build PMTiles/vector tiles after verified parcel GeoJSON exists",
      expectedOutput: `${outputRoot}/${id}-parcels.pmtiles`,
    },
    uiConstraint: "Do not redesign or activate White Rabbit pages while this county remains a pipeline scaffold.",
  };
}

function main() {
  const universe = readJson(universePath);
  const created = [];
  const existing = [];

  for (const county of universe.counties) {
    const adapterFolder = coveredAliases[county.countyId] || county.countyId;
    const folder = path.join(adaptersRoot, adapterFolder);
    const adapterPath = path.join(folder, "adapter.json");
    const pipelinePath = path.join(folder, "pipeline.json");

    if (fs.existsSync(adapterPath)) {
      if (!fs.existsSync(pipelinePath)) writeJson(pipelinePath, pipelineFor(county, adapterFolder));
      existing.push(county.countyId);
      continue;
    }

    fs.mkdirSync(folder, { recursive: true });
    writeJson(adapterPath, adapterFor(county));
    writeJson(pipelinePath, pipelineFor(county, adapterFolder));
    writeText(path.join(folder, "README.md"), `# ${county.countyName}, ${county.state}\n\nDisabled county pipeline scaffold. Official sources, exact counts, and exact join keys remain source-needed. Do not activate it in the frontend.\n`);
    created.push(county.countyId);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    censusCountyEquivalentCount: universe.countyEquivalentCount,
    existingCountyCount: existing.length,
    createdCountyCount: created.length,
    coveredCountyCount: existing.length + created.length,
    created,
    policy: "Pipeline scaffolding only. No source-needed county was activated and no parcel counts or join keys were invented.",
    uiConstraint: "No frontend files or visible behavior were changed.",
  };
  writeJson(reportPath, report);
  writeText(reportMarkdownPath, [
    "# All U.S. County Pipeline Scaffold Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `- Census counties/county-equivalents: ${report.censusCountyEquivalentCount}`,
    `- Existing county pipelines retained: ${report.existingCountyCount}`,
    `- New county pipelines scaffolded: ${report.createdCountyCount}`,
    `- Total county coverage: ${report.coveredCountyCount}`,
    "",
    report.policy,
    "",
    report.uiConstraint,
    "",
  ].join("\n"));
  console.log(JSON.stringify({ existingCountyCount: report.existingCountyCount, createdCountyCount: report.createdCountyCount, coveredCountyCount: report.coveredCountyCount }, null, 2));
}

main();

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const adaptersDir = path.join(root, "data", "county-adapters");
const outputDir = path.join(root, "output", "tx-ky-county-start");
const outputJson = path.join(outputDir, "tx-ky-county-start-report.json");
const outputMd = path.join(outputDir, "tx-ky-county-start-report.md");

const counties = [
  {
    countyId: "el-paso-county-tx",
    countyName: "El Paso County",
    state: "TX",
    fips: "48141",
    marketName: "El Paso",
    appraisalDistrictName: "El Paso Central Appraisal District",
    appraisalDistrictAcronym: "EPCAD",
    coordinates: [-106.485, 31.7619],
    geoBounds: { minLng: -106.75, minLat: 31.45, maxLng: -105.95, maxLat: 32.1 },
    locationId: 1101,
    sourceSearchQueries: [
      "El Paso Central Appraisal District parcel data official",
      "El Paso County Texas GIS parcel boundaries official",
      "City of El Paso permits open data parcel address",
    ],
  },
  {
    countyId: "montgomery-county-tx",
    countyName: "Montgomery County",
    state: "TX",
    fips: "48339",
    marketName: "Houston exurban",
    appraisalDistrictName: "Montgomery Central Appraisal District",
    appraisalDistrictAcronym: "MCAD",
    coordinates: [-95.6963, 30.3213],
    geoBounds: { minLng: -96.05, minLat: 30.0, maxLng: -95.0, maxLat: 30.65 },
    locationId: 1102,
    sourceSearchQueries: [
      "Montgomery Central Appraisal District parcel data official",
      "Montgomery County Texas GIS parcel boundaries official",
      "Montgomery County Texas permits open data parcel address",
    ],
  },
  {
    countyId: "williamson-county-tx",
    countyName: "Williamson County",
    state: "TX",
    fips: "48491",
    marketName: "Austin North",
    appraisalDistrictName: "Williamson Central Appraisal District",
    appraisalDistrictAcronym: "WCAD",
    coordinates: [-97.6982, 30.6327],
    geoBounds: { minLng: -98.05, minLat: 30.32, maxLng: -97.25, maxLat: 30.9 },
    locationId: 1103,
    sourceSearchQueries: [
      "Williamson Central Appraisal District parcel data official",
      "Williamson County Texas GIS parcel boundaries official",
      "Williamson County Texas permits open data parcel address",
    ],
  },
  {
    countyId: "fayette-county-ky",
    countyName: "Fayette County",
    state: "KY",
    fips: "21067",
    marketName: "Lexington",
    appraisalDistrictName: "Fayette County Property Valuation Administrator",
    appraisalDistrictAcronym: "Fayette PVA",
    coordinates: [-84.5037, 38.0406],
    geoBounds: { minLng: -84.72, minLat: 37.82, maxLng: -84.25, maxLat: 38.22 },
    locationId: 1104,
    sourceSearchQueries: [
      "Fayette County Kentucky PVA parcel data official",
      "Lexington Fayette County GIS parcel boundaries official",
      "Lexington Kentucky permits open data parcel address",
    ],
  },
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function countyFolder(county) {
  return path.join(adaptersDir, county.countyId);
}

function countyPublicRoot(county) {
  return `/data/counties/${county.countyId}`;
}

function sourceNeededAdapter(county) {
  const publicRoot = countyPublicRoot(county);
  const outputRoot = `output/${county.countyId}`;
  return {
    id: county.countyId,
    countyId: county.countyId,
    countyName: county.countyName,
    state: county.state,
    fips: county.fips,
    marketName: county.marketName,
    appraisalDistrictName: county.appraisalDistrictName,
    appraisalDistrictAcronym: county.appraisalDistrictAcronym,
    gisSource: "source-needed: official county parcel/GIS source not verified yet",
    uniqueGisKey: "source-needed",
    parcelIdField: "source-needed",
    accountIdField: "source-needed",
    geometryType: "polygon",
    sourceSpatialReference: "source-needed",
    status: "pilot",
    map: {
      locationId: county.locationId,
      locationName: `${county.countyName} ${county.state} / ${county.marketName} Pilot`,
      locationType: county.appraisalDistrictName,
      status: "pilot adapter shell - source discovery needed",
      coordinates: county.coordinates,
      camera: { x: 50, y: 50, zoom: 1.2, pitch: 48, bearing: 0 },
      geoBounds: county.geoBounds,
      boundsStatus: "pilot approximate market/county bounds; replace with verified parcel extent during source inspection",
    },
    universalParcelSchema: {
      version: "wr-universal-parcel-v1",
      schemaPath: "data/schemas/universal-parcel.schema.json",
      documentationPath: "data/schemas/universal-parcel.md",
      parcelServiceBuilder: "scripts/build-app-parcel-service.cjs",
      fieldMapPath: `data/county-adapters/${county.countyId}/${county.countyId}-universal-field-map.json`,
      sourceManifestPath: `data/county-adapters/${county.countyId}/${county.countyId}-source-manifest.json`,
    },
    sourceFiles: {
      parcelGeometry: "source-needed",
      appraisalDistrictExtract: "source-needed",
      ownerAppraisal: "source-needed",
      permitsRaw: "source-needed",
      permitsProcessed: `data/permits/processed/${county.countyId}`,
      zoningRaw: "source-needed",
      floodplainRaw: "source-needed",
      migrationDemandRaw: "source-needed",
    },
    publicDataRoots: {
      parcels: `${publicRoot}/parcels/`,
      permits: `${publicRoot}/permits/`,
      developments: `${publicRoot}/developments/`,
      zoning: `${publicRoot}/zoning/`,
      floodplain: `${publicRoot}/floodplain/`,
      demand: `${publicRoot}/demand/`,
    },
    productionOutputs: {
      parcelGeojson: `${outputRoot}/${county.countyId}-parcels.geojson`,
      parcelPmtiles: `${outputRoot}/${county.countyId}-parcels.pmtiles`,
      vectorTilesDirectory: `${outputRoot}/vector-tiles/`,
    },
    optionalLayers: [
      {
        id: "county-parcels",
        label: "County parcels",
        source: "source-needed",
        status: "source-needed",
        joinBehavior: "source-needed: official parcel/account and GIS keys must be verified before activation",
        defaultVisible: false,
        renderStrategy: "build-time official source fetch, offline universal mapping, viewport chunks, capped runtime loader",
        maxFeaturesPerViewport: 750,
      },
      {
        id: "owner-appraisal",
        label: "Owner/appraisal",
        source: "source-needed",
        status: "source-needed",
        joinBehavior: "source-needed: official assessor/appraisal bulk source must provide owner, mailing, situs, value, land/building, and legal fields",
        defaultVisible: false,
        renderStrategy: "build-time official source fetch, offline owner/appraisal normalization, viewport chunks, capped runtime loader",
        maxFeaturesPerViewport: 750,
      },
      {
        id: "permits",
        label: "Permits and certificates of occupancy",
        source: "source-needed",
        status: "source-needed",
        joinBehavior: "source-needed: parcel/account, normalized address, or spatial point-in-parcel join",
        defaultVisible: false,
        publicDataRoot: `${publicRoot}/permits/`,
        manifestPath: `public/data/counties/${county.countyId}/permits/manifest.json`,
        renderStrategy: "build-time official source verification, offline permit normalization, viewport-safe chunks",
        maxFeaturesPerViewport: 750,
      },
      {
        id: "zoning-intelligence",
        label: "Zoning intelligence",
        source: "source-needed",
        status: "source-needed",
        joinBehavior: "source-needed: parcel/account ID bridge first; spatial join for zoning polygons and case areas",
        defaultVisible: false,
        publicDataRoot: `${publicRoot}/zoning/`,
        manifestPath: `public/data/counties/${county.countyId}/zoning/manifest.json`,
        schemaPath: "data/schemas/dallas-zoning-layer.schema.json",
        reportPath: `${outputRoot}/zoning-source-report.md`,
        renderStrategy: "build-time official source verification, offline joins, viewport chunks, capped runtime loader",
        maxFeaturesPerViewport: 750,
      },
      {
        id: "floodplain-intelligence",
        label: "Floodplain intelligence",
        source: "source-needed",
        status: "source-needed",
        joinBehavior: "source-needed: FEMA/local floodplain spatial join keyed back to parcel/account IDs",
        defaultVisible: false,
        publicDataRoot: `${publicRoot}/floodplain/`,
        manifestPath: `public/data/counties/${county.countyId}/floodplain/manifest.json`,
        parcelIndexPath: `public/data/counties/${county.countyId}/floodplain/parcel-floodplain-index.json`,
        schemaPath: "data/schemas/parcel-floodplain-index.schema.json",
        parcelIndexSchemaPath: "data/schemas/parcel-floodplain-index.schema.json",
        reportPath: `${outputRoot}/floodplain-source-report.md`,
        renderStrategy: "build-time official source verification, offline parcel centroid spatial join, viewport-safe sharded parcel ID lookup",
        maxFeaturesPerViewport: 750,
      },
      {
        id: "migration-demand",
        label: "Migration and demand",
        source: "source-needed",
        status: "source-needed",
        joinBehavior: "source-needed: aggregate Census/ACS/IRS or approved demand geography joined by tract/block group/market, not individual people",
        defaultVisible: false,
        publicDataRoot: `${publicRoot}/demand/`,
        manifestPath: `public/data/counties/${county.countyId}/demand/manifest.json`,
        renderStrategy: "build-time aggregate demand scoring, offline geography-to-parcel join, viewport-safe parcel index lookup",
        maxFeaturesPerViewport: 750,
      },
    ],
    publicSourceDiscovery: {
      status: "queued",
      priorityReason: `${county.state} continuation county in the current TX/KY work focus.`,
      sourceSearchQueries: county.sourceSearchQueries,
      sourceRules: [
        "Use official county, assessor/appraiser, GIS, municipal, state, or federal sources first.",
        "Do not activate this county until exact parcel counts and join keys are verified.",
        "Do not infer owner phone/email from permits, contractors, applicants, or scraped pages.",
      ],
    },
    ownerEnrichment: {
      sourceLabel: "source-needed",
      propertyRecordSource: "source-needed: official assessor/appraisal parcel/property source must be verified",
      officialJoinKey: "source-needed: official parcel/account join key must be verified",
      noOfficialEmailFieldNote: "No official owner phone/email source is verified. Do not infer owner contact fields.",
      fields: {
        parcelId: "source-needed",
        gisParcelId: "source-needed",
        ownerName: "source-needed",
        ownerName2: "source-needed",
        businessName: "source-needed",
        ownerMailingAddress: "source-needed",
        ownerMailingAddress2: "source-needed",
        ownerCity: "source-needed",
        ownerState: "source-needed",
        ownerZip: "source-needed",
        ownerPhone: "No official owner phone field verified",
        ownerEmail: "No official owner email field verified",
      },
    },
    joinKeys: {
      primaryParcelAccount: "source-needed: document exact parcel geometry key -> assessor/appraisal account key",
      appraisal: "source-needed: document exact appraisal/property key",
      land: "source-needed: document exact land/building/value key",
      secondaryParcelGisId: "source-needed: document exact GIS feature key",
      blockLabels: "source-needed: direct key, spatial join, or unavailable",
      dimensions: "source-needed: direct key, spatial join, generated measurement fallback, or unavailable",
      permits: "source-needed: parcel/account ID, address match, spatial join, or combination",
      zoning: "source-needed: parcel/account ID bridge first; spatial join for zoning polygons and case areas",
      floodplain: "source-needed: FEMA/local floodplain parcel centroid spatial join keyed to parcel/account IDs",
      migrationDemand: "source-needed: aggregate geography join, not individual people",
    },
    verifiedCounts: {
      parcelGeometryFeatures: 0,
      missingGeometry: 0,
      appraisalAccountRows: 0,
      appraisalRows: 0,
      landRows: 0,
      appParcelChunks: 0,
      parcelSearchShards: 0,
      sourcePermitRecords: 0,
      permitRowsJoined: 0,
      permitRowsUnmatched: 0,
      parcelsWithDevelopmentSignals: 0,
      migrationDemandGeographies: 0,
    },
    requiredOutputs: [
      `${outputRoot}/schema-report.md`,
      `${outputRoot}/schema-report.json`,
      `${outputRoot}/join-key-report.md`,
      `${outputRoot}/full-parcel-access-report.md`,
      `${outputRoot}/qa-report.md`,
      `${outputRoot}/qa-report.json`,
      `${outputRoot}/${county.countyId}-parcels.geojson`,
      `${outputRoot}/${county.countyId}-parcels.pmtiles or ${outputRoot}/vector-tiles/`,
      `public/data/counties/${county.countyId}/parcels/manifest.json`,
      `public/data/counties/${county.countyId}/permits/manifest.json`,
      `public/data/counties/${county.countyId}/developments/parcel-development-index.json`,
      `public/data/counties/${county.countyId}/zoning/manifest.json`,
      `public/data/counties/${county.countyId}/floodplain/manifest.json`,
      `public/data/counties/${county.countyId}/demand/manifest.json`,
    ],
    productionGap: "Pilot adapter shell only. Official parcel geometry, assessor/appraisal owner/value source, exact join keys, viewport chunks, search shards, permits/CO, zoning, floodplain, development signals, migration/demand, QA reports, and PMTiles are not built yet.",
    pilotNotes: "Do not activate this county in the app. Do not redesign any pages. Fill official sources and exact join keys before any visible behavior changes.",
  };
}

function sourceNeededPipeline(county) {
  const outputRoot = `output/${county.countyId}`;
  return {
    id: `${county.countyId}-ingestion`,
    countyAdapter: `data/county-adapters/${county.countyId}/adapter.json`,
    universalParcelSchema: "data/schemas/universal-parcel.schema.json",
    defaultMode: "plan",
    steps: [
      {
        id: "verify-official-sources",
        label: "Verify official parcel, assessor/appraisal, permit, zoning, floodplain, and demand sources",
        command: `echo Verify official sources for ${county.countyId} before ingesting large files.`,
        requiredOutputs: [`${outputRoot}/schema-report.md`, `${outputRoot}/schema-report.json`],
      },
      {
        id: "verify-join-keys",
        label: "Document exact parcel/account/GIS join keys",
        command: `echo Replace source-needed join keys for ${county.countyId}.`,
        requiredOutputs: [`${outputRoot}/join-key-report.md`],
      },
      {
        id: "build-parcel-service",
        label: "Build viewport parcel chunks and search shards",
        command: `echo Build ${county.countyId} viewport parcel chunks and search shards after universal GeoJSON exists.`,
        requiredOutputs: [`public/data/counties/${county.countyId}/parcels/manifest.json`],
      },
      {
        id: "build-owner-matches",
        label: "Build owner/appraisal parcel intelligence",
        command: `echo Build ${county.countyId} owner/appraisal index after official assessor/appraisal source is verified.`,
        requiredOutputs: [`${outputRoot}/${county.countyId}-owner-appraisal-index.json`, `${outputRoot}/join-key-report.md`],
      },
      {
        id: "validate",
        label: "Run county QC",
        command: "npm.cmd run county:qc",
        requiredOutputs: [`output/county-qc/${county.countyId}.json`, `output/county-qc/${county.countyId}.md`],
      },
    ],
    uiConstraint: "Do not redesign or restyle any White Rabbit pages while running this pilot county ingestion pipeline.",
  };
}

function seedCounty(county) {
  const folder = countyFolder(county);
  const adapterFile = path.join(folder, "adapter.json");
  const pipelineFile = path.join(folder, "pipeline.json");
  const existed = fs.existsSync(adapterFile);
  if (!existed) {
    writeJson(adapterFile, sourceNeededAdapter(county));
    writeJson(pipelineFile, sourceNeededPipeline(county));
  }
  return {
    countyId: county.countyId,
    countyName: county.countyName,
    state: county.state,
    status: existed ? "skipped-existing" : "created-source-needed-shell",
    workMode: county.state === "TX" ? "active-texas-work" : "kentucky-prep-blocked-until-state-gate",
    adapterPath: relative(adapterFile),
    pipelinePath: relative(pipelineFile),
  };
}

function main() {
  const seeded = counties.map(seedCounty);
  const report = {
    version: "wr-tx-ky-county-start-v1",
    generatedAt: new Date().toISOString(),
    uiConstraint: "Do not redesign White Rabbit pages while starting TX/KY county data plumbing.",
    stateGate: {
      activeState: "TX",
      kentuckyMode: "prep-only-until-texas-complete",
      rule: "Finish Texas counties before activating Kentucky work.",
    },
    seeded,
  };
  writeJson(outputJson, report);
  const lines = [
    "# TX/KY County Start Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `- Active state: ${report.stateGate.activeState}`,
    `- Kentucky mode: ${report.stateGate.kentuckyMode}`,
    `- Rule: ${report.stateGate.rule}`,
    "",
    "## Seeded Counties",
    "",
    "| State | County | Status | Mode | Adapter |",
    "| --- | --- | --- | --- | --- |",
    ...seeded.map((item) => `| ${item.state} | ${item.countyName} | ${item.status} | ${item.workMode} | \`${item.adapterPath}\` |`),
    "",
    "## UI Constraint",
    "",
    report.uiConstraint,
    "",
  ];
  ensureDir(outputDir);
  fs.writeFileSync(outputMd, lines.join("\n"));
  console.log(`Wrote ${relative(outputJson)}`);
  console.log(`Wrote ${relative(outputMd)}`);
}

main();

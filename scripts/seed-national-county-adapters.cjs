const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const workQueuePath = path.join(root, "data", "national-county-intelligence", "source-work-queue.json");
const adaptersDir = path.join(root, "data", "county-adapters");
const outputDir = path.join(root, "output", "national-county-intelligence");
const outputJson = path.join(outputDir, "adapter-seed-report.json");
const outputMd = path.join(outputDir, "adapter-seed-report.md");

const defaults = {
  "los-angeles-county-ca": {
    appraisalDistrictName: "Los Angeles County Assessor",
    appraisalDistrictAcronym: "LACA",
    coordinates: [-118.2437, 34.0522],
    geoBounds: { minLng: -118.95, minLat: 33.65, maxLng: -117.6, maxLat: 34.85 },
  },
  "cook-county-il": {
    appraisalDistrictName: "Cook County Assessor's Office",
    appraisalDistrictAcronym: "CCAO",
    coordinates: [-87.6298, 41.8781],
    geoBounds: { minLng: -88.35, minLat: 41.45, maxLng: -87.45, maxLat: 42.2 },
  },
  "maricopa-county-az": {
    appraisalDistrictName: "Maricopa County Assessor",
    appraisalDistrictAcronym: "MCA",
    coordinates: [-112.074, 33.4484],
    geoBounds: { minLng: -113.35, minLat: 32.5, maxLng: -111.0, maxLat: 34.1 },
  },
  "san-diego-county-ca": {
    appraisalDistrictName: "San Diego County Assessor/Recorder/County Clerk",
    appraisalDistrictAcronym: "SDARCC",
    coordinates: [-117.1611, 32.7157],
    geoBounds: { minLng: -117.65, minLat: 32.5, maxLng: -116.05, maxLat: 33.55 },
  },
  "orange-county-ca": {
    appraisalDistrictName: "Orange County Assessor",
    appraisalDistrictAcronym: "OCA",
    coordinates: [-117.8531, 33.7879],
    geoBounds: { minLng: -118.15, minLat: 33.35, maxLng: -117.4, maxLat: 33.95 },
  },
  "miami-dade-county-fl": {
    appraisalDistrictName: "Miami-Dade County Property Appraiser",
    appraisalDistrictAcronym: "MDCOPA",
    coordinates: [-80.1918, 25.7617],
    geoBounds: { minLng: -80.9, minLat: 25.1, maxLng: -80.0, maxLat: 26.1 },
  },
  "kings-county-ny": {
    appraisalDistrictName: "New York City Department of Finance",
    appraisalDistrictAcronym: "NYCDOF",
    coordinates: [-73.9442, 40.6782],
    geoBounds: { minLng: -74.05, minLat: 40.55, maxLng: -73.83, maxLat: 40.75 },
  },
  "queens-county-ny": {
    appraisalDistrictName: "New York City Department of Finance",
    appraisalDistrictAcronym: "NYCDOF",
    coordinates: [-73.7949, 40.7282],
    geoBounds: { minLng: -73.96, minLat: 40.48, maxLng: -73.7, maxLat: 40.82 },
  },
  "riverside-county-ca": {
    appraisalDistrictName: "Riverside County Assessor-County Clerk-Recorder",
    appraisalDistrictAcronym: "RCACR",
    coordinates: [-117.3962, 33.9533],
    geoBounds: { minLng: -117.7, minLat: 33.4, maxLng: -114.4, maxLat: 34.1 },
  },
  "clark-county-nv": {
    appraisalDistrictName: "Clark County Assessor",
    appraisalDistrictAcronym: "CCA",
    coordinates: [-115.1398, 36.1699],
    geoBounds: { minLng: -115.95, minLat: 35.0, maxLng: -114.0, maxLat: 37.1 },
  },
  "king-county-wa": {
    appraisalDistrictName: "King County Department of Assessments",
    appraisalDistrictAcronym: "KCDOA",
    coordinates: [-122.3321, 47.6062],
    geoBounds: { minLng: -122.55, minLat: 47.05, maxLng: -121.0, maxLat: 47.85 },
  },
  "bexar-county-tx": {
    appraisalDistrictName: "Bexar Appraisal District",
    appraisalDistrictAcronym: "BCAD",
    coordinates: [-98.4936, 29.4241],
    geoBounds: { minLng: -99.0, minLat: 29.0, maxLng: -98.0, maxLat: 29.8 },
  },
  "broward-county-fl": {
    appraisalDistrictName: "Broward County Property Appraiser",
    appraisalDistrictAcronym: "BCPA",
    coordinates: [-80.1373, 26.1224],
    geoBounds: { minLng: -80.9, minLat: 25.95, maxLng: -80.0, maxLat: 26.35 },
  },
  "santa-clara-county-ca": {
    appraisalDistrictName: "Santa Clara County Assessor",
    appraisalDistrictAcronym: "SCCA",
    coordinates: [-121.8863, 37.3382],
    geoBounds: { minLng: -122.25, minLat: 36.9, maxLng: -121.2, maxLat: 37.55 },
  },
  "wayne-county-mi": {
    appraisalDistrictName: "Wayne County Register of Deeds / local assessment offices",
    appraisalDistrictAcronym: "WAYNE",
    coordinates: [-83.0458, 42.3314],
    geoBounds: { minLng: -83.55, minLat: 42.0, maxLng: -82.75, maxLat: 42.5 },
  },
  "alameda-county-ca": {
    appraisalDistrictName: "Alameda County Assessor",
    appraisalDistrictAcronym: "ACA",
    coordinates: [-122.2711, 37.8044],
    geoBounds: { minLng: -122.45, minLat: 37.45, maxLng: -121.45, maxLat: 38.0 },
  },
  "philadelphia-county-pa": {
    appraisalDistrictName: "Philadelphia Office of Property Assessment",
    appraisalDistrictAcronym: "OPA",
    coordinates: [-75.1652, 39.9526],
    geoBounds: { minLng: -75.3, minLat: 39.85, maxLng: -74.95, maxLat: 40.15 },
  },
  "travis-county-tx": {
    appraisalDistrictName: "Travis Central Appraisal District",
    appraisalDistrictAcronym: "TCAD",
    coordinates: [-97.7431, 30.2672],
    geoBounds: { minLng: -98.2, minLat: 30.0, maxLng: -97.35, maxLat: 30.65 },
  },
  "collin-county-tx": {
    appraisalDistrictName: "Collin Central Appraisal District",
    appraisalDistrictAcronym: "CCAD",
    coordinates: [-96.6398, 33.1972],
    geoBounds: { minLng: -96.95, minLat: 32.95, maxLng: -96.25, maxLat: 33.45 },
  },
  "denton-county-tx": {
    appraisalDistrictName: "Denton Central Appraisal District",
    appraisalDistrictAcronym: "DCAD-DENTON",
    coordinates: [-97.1331, 33.2148],
    geoBounds: { minLng: -97.55, minLat: 32.95, maxLng: -96.75, maxLat: 33.45 },
  },
  "fort-bend-county-tx": {
    appraisalDistrictName: "Fort Bend Central Appraisal District",
    appraisalDistrictAcronym: "FBCAD",
    coordinates: [-95.8143, 29.5693],
    geoBounds: { minLng: -96.15, minLat: 29.25, maxLng: -95.25, maxLat: 29.9 },
  },
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function writeText(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, value);
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function stateFromCounty(county) {
  return county.state || county.countyId.split("-").at(-1).toUpperCase();
}

function seedAdapterFor(county, index) {
  const folder = path.join(adaptersDir, county.countyId);
  const adapterFile = path.join(folder, "adapter.json");
  const pipelineFile = path.join(folder, "pipeline.json");
  if (fs.existsSync(adapterFile)) {
    return { countyId: county.countyId, countyName: county.countyName, status: "skipped-existing", adapterPath: relative(adapterFile) };
  }

  const defaultsForCounty = defaults[county.countyId];
  if (!defaultsForCounty) throw new Error(`Missing national seed defaults for ${county.countyId}`);
  const outputRoot = `output/${county.countyId}`;
  const publicRoot = `/data/counties/${county.countyId}`;
  const adapter = {
    id: county.countyId,
    countyId: county.countyId,
    countyName: county.countyName,
    state: stateFromCounty(county),
    fips: county.fips,
    marketName: county.market,
    appraisalDistrictName: defaultsForCounty.appraisalDistrictName,
    appraisalDistrictAcronym: defaultsForCounty.appraisalDistrictAcronym,
    gisSource: "source-needed: official county parcel/GIS source not verified yet",
    uniqueGisKey: "source-needed",
    parcelIdField: "source-needed",
    accountIdField: "source-needed",
    geometryType: "polygon",
    sourceSpatialReference: "source-needed",
    status: "pilot",
    map: {
      locationId: 1000 + index,
      locationName: `${county.countyName} ${stateFromCounty(county)} / ${county.market} Pilot`,
      locationType: defaultsForCounty.appraisalDistrictName,
      status: "pilot adapter shell - source discovery needed",
      coordinates: defaultsForCounty.coordinates,
      camera: { x: 50, y: 50, zoom: 1.2, pitch: 48, bearing: 0 },
      geoBounds: defaultsForCounty.geoBounds,
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
        id: "parcel-dimensions",
        label: "Parcel dimensions",
        source: "source-needed",
        status: "source-needed",
        joinBehavior: "source-needed: direct dimension fields, label layer, or generated measurement fallback",
        defaultVisible: false,
        renderStrategy: "build-time official source inspection, offline mapping, viewport chunks",
        maxFeaturesPerViewport: 750,
      },
      {
        id: "block-grid",
        label: "Block, subdivision, and map-grid context",
        source: "source-needed",
        status: "source-needed",
        joinBehavior: "source-needed: direct parcel fields or spatial join to subdivision/block/grid sources",
        defaultVisible: false,
        renderStrategy: "build-time official source inspection, offline joins, viewport chunks",
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
      priorityReason: county.priorityReason,
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
    productionGap:
      "Pilot adapter shell only. Official parcel geometry, assessor/appraisal owner/value source, exact join keys, viewport chunks, search shards, permits/CO, zoning, floodplain, development signals, migration/demand, QA reports, and PMTiles are not built yet.",
    pilotNotes: "Do not activate this county in the app. Do not redesign any pages. Fill official sources and exact join keys before any visible behavior changes.",
  };

  const pipeline = {
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
        id: "build-parcel-geojson",
        label: "Build county universal parcel GeoJSON",
        command: `echo Build ${county.countyId} universal parcel GeoJSON after source verification.`,
        requiredOutputs: [`${outputRoot}/${county.countyId}-parcels.geojson`, `${outputRoot}/full-parcel-access-report.md`],
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
        id: "build-permit-service",
        label: "Normalize and publish permits and certificates of occupancy",
        command: `echo Build ${county.countyId} permits/CO after official source verification.`,
        requiredOutputs: [`public/data/counties/${county.countyId}/permits/manifest.json`],
      },
      {
        id: "build-zoning-index",
        label: "Build zoning and overlay parcel index",
        command: `echo Build ${county.countyId} zoning after official source verification.`,
        requiredOutputs: [`public/data/counties/${county.countyId}/zoning/manifest.json`, `${outputRoot}/zoning-source-report.md`],
      },
      {
        id: "build-floodplain-index",
        label: "Build floodplain parcel index",
        command: `echo Build ${county.countyId} floodplain after FEMA/local source verification.`,
        requiredOutputs: [`public/data/counties/${county.countyId}/floodplain/manifest.json`, `${outputRoot}/floodplain-source-report.md`],
      },
      {
        id: "build-migration-demand",
        label: "Build aggregate migration and demand parcel index",
        command: `echo Build ${county.countyId} aggregate migration/demand after approved geography sources are verified.`,
        requiredOutputs: [`public/data/counties/${county.countyId}/demand/manifest.json`],
      },
      {
        id: "validate",
        label: "Run county QC",
        command: "npm.cmd run county:qc",
        requiredOutputs: [`output/county-qc/${county.countyId}.json`, `output/county-qc/${county.countyId}.md`],
      },
    ],
    productionTileStep: {
      id: "build-pmtiles",
      label: "Build PMTiles/vector tiles after the parcel GeoJSON exists",
      handoff: `${outputRoot}/vector-tiles/README.md`,
      expectedOutput: `${outputRoot}/${county.countyId}-parcels.pmtiles`,
    },
    uiConstraint: "Do not redesign or restyle any White Rabbit pages while running this pilot county ingestion pipeline.",
  };

  writeJson(adapterFile, adapter);
  writeJson(pipelineFile, pipeline);
  writeText(
    path.join(folder, "README.md"),
    [
      `# ${county.countyName} Adapter Shell`,
      "",
      "This is a disabled pilot adapter shell created from the national DCAD-style rollout queue.",
      "",
      "- Status: source discovery needed",
      "- Production enabled: no",
      "- UI/page redesign: no",
      "- Next step: verify official county parcel, assessor/appraisal, permit, zoning, floodplain, and aggregate demand sources.",
      "",
    ].join("\n"),
  );

  return { countyId: county.countyId, countyName: county.countyName, status: "created", adapterPath: relative(adapterFile), pipelinePath: relative(pipelineFile) };
}

function main() {
  const workQueue = readJson(workQueuePath);
  ensureDir(outputDir);
  const seeded = workQueue.priorityCountyQueue.map(seedAdapterFor);
  const report = {
    generatedAt: new Date().toISOString(),
    coverageGoal: workQueue.coverageGoal,
    createdCount: seeded.filter((item) => item.status === "created").length,
    skippedExistingCount: seeded.filter((item) => item.status === "skipped-existing").length,
    totalPriorityCount: seeded.length,
    seeded,
    uiConstraint: "No White Rabbit pages were redesigned or activated. These are disabled pilot adapter shells.",
  };
  writeJson(outputJson, report);
  writeText(
    outputMd,
    [
      "# National County Adapter Seed Report",
      "",
      `Generated: ${report.generatedAt}`,
      "",
      `- Coverage goal: ${report.coverageGoal}`,
      `- Priority counties processed: ${report.totalPriorityCount}`,
      `- Created adapter shells: ${report.createdCount}`,
      `- Skipped existing adapters: ${report.skippedExistingCount}`,
      "",
      "| Status | County | Adapter |",
      "| --- | --- | --- |",
      ...seeded.map((item) => `| ${item.status} | ${item.countyName} | \`${item.adapterPath}\` |`),
      "",
      "No page files were changed by this seed step.",
      "",
    ].join("\n"),
  );
  console.log(`Wrote ${relative(outputJson)}`);
  console.log(`Wrote ${relative(outputMd)}`);
  console.log(JSON.stringify({ createdCount: report.createdCount, skippedExistingCount: report.skippedExistingCount, totalPriorityCount: report.totalPriorityCount }, null, 2));
}

main();

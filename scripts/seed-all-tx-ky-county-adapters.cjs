const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const universePath = path.join(root, "data", "national-county-intelligence", "us-county-universe.json");
const adaptersDir = path.join(root, "data", "county-adapters");
const outputDir = path.join(root, "output", "tx-ky-full-state-coverage");
const outputJson = path.join(outputDir, "tx-ky-full-state-coverage-report.json");
const outputMd = path.join(outputDir, "tx-ky-full-state-coverage-report.md");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

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

function discoverExistingAdapterIds() {
  const existing = new Map();
  if (!fs.existsSync(adaptersDir)) return existing;
  for (const entry of fs.readdirSync(adaptersDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const adapterPath = path.join(adaptersDir, entry.name, "adapter.json");
    if (!fs.existsSync(adapterPath)) continue;
    const adapter = readJson(adapterPath);
    const id = adapter.countyId || adapter.id || entry.name;
    existing.set(id, { folder: entry.name, adapterPath });
  }
  return existing;
}

function canonicalCountyId(county) {
  if (county.state === "TX" && county.countyName === "Dallas County") return "dallas-county-dcad";
  if (county.state === "TX" && county.countyName === "Tarrant County") return "tarrant-county-tad";
  if (county.state === "KY" && county.countyName === "Jefferson County") return "jefferson-ky";
  return county.countyId;
}

function titleWithoutCounty(countyName) {
  return String(countyName || "").replace(/\s+County$/i, "");
}

function appraisalDistrictName(county) {
  const base = titleWithoutCounty(county.countyName);
  if (county.state === "TX") return `${base} County Appraisal District`;
  if (county.state === "KY") return `${base} County Property Valuation Administrator`;
  return `${county.countyName} appraisal office`;
}

function appraisalDistrictAcronym(county) {
  const base = titleWithoutCounty(county.countyName)
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return county.state === "TX" ? `${base}CAD` : `${base}PVA`;
}

function roughCoordinates(county, index, totalInState) {
  if (county.state === "TX") {
    const columns = 18;
    const row = Math.floor(index / columns);
    const col = index % columns;
    return [-106.65 + col * 0.66, 25.85 + row * 0.44];
  }
  const columns = 12;
  const row = Math.floor(index / columns);
  const col = index % columns;
  return [-89.55 + col * 0.52, 36.55 + row * 0.23 + (totalInState ? 0 : 0)];
}

function roughBounds([lng, lat]) {
  return {
    minLng: Number((lng - 0.28).toFixed(4)),
    minLat: Number((lat - 0.18).toFixed(4)),
    maxLng: Number((lng + 0.28).toFixed(4)),
    maxLat: Number((lat + 0.18).toFixed(4)),
  };
}

function sourceQueries(county) {
  const district = appraisalDistrictName(county);
  if (county.state === "TX") {
    return [
      `${district} parcel data official`,
      `${county.countyName} Texas GIS parcel boundaries official`,
      `${county.countyName} Texas permits open data parcel address`,
    ];
  }
  return [
    `${district} parcel data official`,
    `${county.countyName} Kentucky GIS parcel boundaries official`,
    `${county.countyName} Kentucky permits open data parcel address`,
  ];
}

function buildAdapter(county, index, totalInState) {
  const coordinates = roughCoordinates(county, index, totalInState);
  const publicRoot = `/data/counties/${county.countyId}`;
  const outputRoot = `output/${county.countyId}`;
  const district = appraisalDistrictName(county);
  return {
    id: county.countyId,
    countyId: county.countyId,
    countyName: county.countyName,
    state: county.state,
    fips: county.fips,
    marketName: county.countyName,
    appraisalDistrictName: district,
    appraisalDistrictAcronym: appraisalDistrictAcronym(county),
    gisSource: "source-needed: official county parcel/GIS source not verified yet",
    uniqueGisKey: "source-needed",
    parcelIdField: "source-needed",
    accountIdField: "source-needed",
    geometryType: "polygon",
    sourceSpatialReference: "source-needed",
    status: "pilot",
    map: {
      locationId: 2000 + index,
      locationName: `${county.countyName} ${county.state} Pilot`,
      locationType: district,
      status: "pilot adapter shell - source discovery needed",
      coordinates,
      camera: { x: 50, y: 50, zoom: 1.2, pitch: 48, bearing: 0 },
      geoBounds: roughBounds(coordinates),
      boundsStatus: "pilot approximate statewide grid bounds; replace with verified parcel extent during source inspection",
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
      developmentRaw: "source-needed",
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
        joinBehavior: "source-needed: direct parcel fields or spatial join to subdivision, block, or grid sources",
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
        id: "development-signals",
        label: "Development signals",
        source: "source-needed",
        status: "source-needed",
        joinBehavior: "source-needed: normalized permit, certificate, demolition, plat, and project evidence joined to parcel IDs",
        defaultVisible: false,
        publicDataRoot: `${publicRoot}/developments/`,
        manifestPath: `public/data/counties/${county.countyId}/developments/parcel-development-index.json`,
        renderStrategy: "build-time evidence normalization, parcel/address/spatial joins, viewport-safe parcel index lookup",
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
      priorityReason: `${county.state} full-state county coverage shell; source verification required before ingest.`,
      sourceSearchQueries: sourceQueries(county),
      sourceRules: [
        "Use official county, assessor/appraiser, GIS, municipal, state, or federal sources first.",
        "Do not activate this county until exact parcel counts and join keys are verified.",
        "Do not infer owner phone/email from permits, contractors, applicants, or scraped pages.",
      ],
      problemSolvingLoop: [
        "Discover official sources and preserve source dataset identifiers.",
        "Audit schema, exact counts, geometry validity, nulls, and duplicate candidate keys.",
        "Select a complete duplicate-safe feature identity and document secondary business identifiers.",
        "Build a bounded-memory sample before attempting the full county snapshot.",
        "Publish viewport chunks and search shards, then reconcile source, emitted, skipped, and joined counts.",
        "Run county QC and keep visible activation disabled until every individual gate passes."
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
      developmentSignals: "source-needed: verified permit, plat, demolition, certificate, project, address, or spatial join evidence",
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

function synchronizeAdapter(existingAdapter, template) {
  const existingLayers = new Map((existingAdapter.optionalLayers || []).map((layer) => [layer.id, layer]));
  const templateIds = new Set(template.optionalLayers.map((layer) => layer.id));
  const optionalLayers = template.optionalLayers.map((defaultLayer) => ({
    ...defaultLayer,
    ...(existingLayers.get(defaultLayer.id) || {}),
    defaultVisible: existingLayers.get(defaultLayer.id)?.defaultVisible ?? false,
  }));
  for (const layer of existingAdapter.optionalLayers || []) {
    if (!templateIds.has(layer.id)) optionalLayers.push(layer);
  }
  return {
    ...existingAdapter,
    sourceFiles: { ...template.sourceFiles, ...(existingAdapter.sourceFiles || {}) },
    publicDataRoots: { ...template.publicDataRoots, ...(existingAdapter.publicDataRoots || {}) },
    productionOutputs: { ...template.productionOutputs, ...(existingAdapter.productionOutputs || {}) },
    optionalLayers,
    publicSourceDiscovery: {
      ...template.publicSourceDiscovery,
      ...(existingAdapter.publicSourceDiscovery || {}),
      sourceRules: [...new Set([...(template.publicSourceDiscovery.sourceRules || []), ...(existingAdapter.publicSourceDiscovery?.sourceRules || [])])],
      problemSolvingLoop: existingAdapter.publicSourceDiscovery?.problemSolvingLoop || template.publicSourceDiscovery.problemSolvingLoop,
    },
    joinKeys: { ...template.joinKeys, ...(existingAdapter.joinKeys || {}) },
    verifiedCounts: { ...template.verifiedCounts, ...(existingAdapter.verifiedCounts || {}) },
    requiredOutputs: [...new Set([...(template.requiredOutputs || []), ...(existingAdapter.requiredOutputs || [])])],
  };
}

function buildPipeline(county, adapterPath = `data/county-adapters/${county.countyId}/adapter.json`) {
  const outputRoot = `output/${county.countyId}`;
  return {
    id: `${county.countyId}-ingestion`,
    countyAdapter: adapterPath,
    universalParcelSchema: "data/schemas/universal-parcel.schema.json",
    defaultMode: "plan",
    enabledForProduction: false,
    scaffoldOnly: true,
    pipelineContract: {
      mode: "evidence-gated",
      sourcePriority: "official assessor/appraiser, county GIS, municipal, state, or federal sources first",
      identityRule: "Do not emit countyParcelId until a complete duplicate-safe source key or documented composite key is proven.",
      geometryRule: "Preprocess county geometry at build time and publish viewport chunks, search shards, or PMTiles.",
      failurePolicy: "Preserve exact source, emitted, skipped, unmatched, duplicate, and null counts; never hide a discrepancy.",
      activationRule: "Keep the county disabled until its individual map/search, owner/appraisal, QC, and activation gates pass."
    },
    steps: [
      {
        id: "verify-official-sources",
        label: "Verify official parcel, assessor/appraisal, permit, zoning, floodplain, and demand sources",
        command: `echo Verify official sources for ${county.countyId} before ingesting large files.`,
        dependsOn: [],
        requiredOutputs: [`${outputRoot}/schema-report.md`, `${outputRoot}/schema-report.json`],
      },
      {
        id: "verify-join-keys",
        label: "Document exact parcel/account/GIS join keys",
        command: `echo Replace source-needed join keys for ${county.countyId}.`,
        dependsOn: ["verify-official-sources"],
        requiredOutputs: [`${outputRoot}/join-key-report.md`],
      },
      {
        id: "build-parcel-geojson",
        label: "Build universal county parcel GeoJSON",
        command: `echo Build ${county.countyId} universal parcel GeoJSON after source verification.`,
        dependsOn: ["verify-official-sources", "verify-join-keys"],
        requiredOutputs: [`${outputRoot}/${county.countyId}-parcels.geojson`, `${outputRoot}/full-parcel-access-report.md`],
      },
      {
        id: "build-parcel-service",
        label: "Build viewport parcel chunks and search shards",
        command: `echo Build ${county.countyId} viewport parcel chunks and search shards after universal GeoJSON exists.`,
        dependsOn: ["build-parcel-geojson"],
        requiredOutputs: [`public/data/counties/${county.countyId}/parcels/manifest.json`],
      },
      {
        id: "build-owner-matches",
        label: "Build owner/appraisal parcel intelligence",
        command: `echo Build ${county.countyId} owner/appraisal index after official assessor/appraisal source is verified.`,
        dependsOn: ["verify-join-keys", "build-parcel-service"],
        requiredOutputs: [`${outputRoot}/${county.countyId}-owner-appraisal-index.json`, `${outputRoot}/join-key-report.md`],
      },
      {
        id: "build-permit-service",
        label: "Normalize and publish permits and certificates of occupancy",
        command: `echo Build ${county.countyId} permits/CO after official source verification.`,
        dependsOn: ["build-parcel-service"],
        requiredOutputs: [`public/data/counties/${county.countyId}/permits/manifest.json`],
      },
      {
        id: "build-zoning-index",
        label: "Build zoning and overlay parcel index",
        command: `echo Build ${county.countyId} zoning after official source verification.`,
        dependsOn: ["build-parcel-service"],
        requiredOutputs: [`public/data/counties/${county.countyId}/zoning/manifest.json`, `${outputRoot}/zoning-source-report.md`],
      },
      {
        id: "build-floodplain-index",
        label: "Build floodplain parcel index",
        command: `echo Build ${county.countyId} floodplain after FEMA or local source verification.`,
        dependsOn: ["build-parcel-service"],
        requiredOutputs: [`public/data/counties/${county.countyId}/floodplain/manifest.json`, `${outputRoot}/floodplain-source-report.md`],
      },
      {
        id: "build-development-index",
        label: "Build parcel development-signal index",
        command: `echo Build ${county.countyId} development signals from verified permits and parcel joins.`,
        dependsOn: ["build-parcel-service", "build-permit-service"],
        requiredOutputs: [`public/data/counties/${county.countyId}/developments/parcel-development-index.json`],
      },
      {
        id: "build-migration-demand",
        label: "Build aggregate migration and demand index",
        command: `echo Build ${county.countyId} aggregate migration and demand after approved geography source verification.`,
        dependsOn: ["build-parcel-service"],
        requiredOutputs: [`public/data/counties/${county.countyId}/demand/manifest.json`],
      },
      {
        id: "validate",
        label: "Run county QC",
        command: "npm.cmd run county:qc",
        dependsOn: ["build-parcel-service", "build-owner-matches"],
        requiredOutputs: [`output/county-qc/${county.countyId}.json`, `output/county-qc/${county.countyId}.md`],
      },
    ],
    productionTileStep: {
      id: "build-pmtiles",
      label: "Build PMTiles/vector tiles after verified parcel GeoJSON exists",
      dependsOn: ["build-parcel-geojson", "validate"],
      handoff: `${outputRoot}/vector-tiles/README.md`,
      expectedOutput: `${outputRoot}/${county.countyId}-parcels.pmtiles`
    },
    uiConstraint: "Do not redesign or restyle any White Rabbit pages while running this pilot county ingestion pipeline.",
  };
}

function synchronizePipeline(existingPipeline, template) {
  const existingSteps = new Map((existingPipeline?.steps || []).map((step) => [step.id, step]));
  const templateIds = new Set(template.steps.map((step) => step.id));
  const steps = template.steps.map((defaultStep) => {
    const current = existingSteps.get(defaultStep.id);
    if (!current) return defaultStep;
    return {
      ...defaultStep,
      ...current,
      dependsOn: [...new Set([...(defaultStep.dependsOn || []), ...(current.dependsOn || [])])],
      requiredOutputs: [...new Set([...(defaultStep.requiredOutputs || []), ...(current.requiredOutputs || [])])],
    };
  });
  for (const step of existingPipeline?.steps || []) {
    if (!templateIds.has(step.id)) steps.push(step);
  }
  return {
    ...template,
    ...(existingPipeline || {}),
    countyAdapter: existingPipeline?.countyAdapter || template.countyAdapter,
    enabledForProduction: existingPipeline?.enabledForProduction ?? template.enabledForProduction,
    scaffoldOnly: existingPipeline?.scaffoldOnly ?? template.scaffoldOnly,
    pipelineContract: { ...template.pipelineContract, ...(existingPipeline?.pipelineContract || {}) },
    steps,
    productionTileStep: { ...template.productionTileStep, ...(existingPipeline?.productionTileStep || {}) },
    uiConstraint: existingPipeline?.uiConstraint || template.uiConstraint,
  };
}

function main() {
  const universe = readJson(universePath);
  const targets = universe.counties.filter((county) => county.state === "TX" || county.state === "KY");
  const byState = {
    TX: targets.filter((county) => county.state === "TX"),
    KY: targets.filter((county) => county.state === "KY"),
  };
  const existing = discoverExistingAdapterIds();
  const seeded = [];

  for (const state of ["TX", "KY"]) {
    byState[state].forEach((county, index) => {
      const canonicalId = canonicalCountyId(county);
      const known = existing.get(canonicalId);
      if (known) {
        const legacyAlias = canonicalId !== county.countyId;
        const existingAdapter = readJson(known.adapterPath);
        if (!legacyAlias) writeJson(known.adapterPath, synchronizeAdapter(existingAdapter, buildAdapter(county, index, byState[state].length)));
        const pipelinePath = path.join(adaptersDir, known.folder, "pipeline.json");
        const existingPipeline = fs.existsSync(pipelinePath) ? readJson(pipelinePath) : null;
        const template = buildPipeline({ ...county, countyId: canonicalId }, relative(known.adapterPath));
        const synchronized = legacyAlias && existingPipeline
          ? {
              ...existingPipeline,
              pipelineContract: { ...template.pipelineContract, ...(existingPipeline.pipelineContract || {}) },
              productionTileStep: existingPipeline.productionTileStep || template.productionTileStep,
              uiConstraint: existingPipeline.uiConstraint || template.uiConstraint,
            }
          : synchronizePipeline(existingPipeline, template);
        writeJson(pipelinePath, synchronized);
        seeded.push({
          countyId: canonicalId,
          censusCountyId: county.countyId,
          countyName: county.countyName,
          state,
          status: legacyAlias && existingPipeline ? "preserved-promoted-alias-pipeline" : existingPipeline ? "synchronized-existing-pipeline" : "created-missing-pipeline",
          adapterPath: relative(known.adapterPath),
          pipelinePath: relative(pipelinePath),
        });
        return;
      }
      const folder = path.join(adaptersDir, county.countyId);
      const adapterPath = path.join(folder, "adapter.json");
      const pipelinePath = path.join(folder, "pipeline.json");
      writeJson(adapterPath, buildAdapter(county, index, byState[state].length));
      writeJson(pipelinePath, buildPipeline(county));
      seeded.push({
        countyId: county.countyId,
        censusCountyId: county.countyId,
        countyName: county.countyName,
        state,
        status: "created-source-needed-shell",
        adapterPath: relative(adapterPath),
        pipelinePath: relative(pipelinePath),
      });
      existing.set(county.countyId, { folder: county.countyId, adapterPath });
    });
  }

  const created = seeded.filter((item) => item.status === "created-source-needed-shell");
  const report = {
    version: "wr-tx-ky-full-state-coverage-v1",
    generatedAt: new Date().toISOString(),
    source: "data/national-county-intelligence/us-county-universe.json",
    sourceName: universe.sourceName,
    uiConstraint: "Do not redesign White Rabbit pages while completing TX/KY county adapter coverage.",
    completionMeaning: "Adapter coverage and source-needed county gates are complete; official parcel/appraisal/permit/zoning/floodplain data is not complete until each county has verified counts, join keys, viewport chunks, search shards, and QC artifacts.",
    stateGate: {
      activeStates: ["TX", "KY"],
      kentuckyMode: "active-concurrent-state-pipeline",
      rule: "Advance Texas and Kentucky concurrently; every county remains independently evidence-gated and disabled until its own gate passes.",
    },
    stateCounts: {
      TX: byState.TX.length,
      KY: byState.KY.length,
      total: targets.length,
    },
    createdCount: created.length,
    synchronizedExistingCount: seeded.filter((item) => item.status === "synchronized-existing-pipeline").length,
    preservedPromotedAliasCount: seeded.filter((item) => item.status === "preserved-promoted-alias-pipeline").length,
    createdMissingPipelineCount: seeded.filter((item) => item.status === "created-missing-pipeline").length,
    skippedExistingCount: seeded.length - created.length,
    seeded,
  };

  writeJson(outputJson, report);
  const lines = [
    "# TX/KY Full-State County Coverage Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `- Source: ${report.sourceName}`,
    `- Texas counties tracked: ${report.stateCounts.TX}`,
    `- Kentucky counties tracked: ${report.stateCounts.KY}`,
    `- Total TX/KY counties tracked: ${report.stateCounts.total}`,
    `- Created source-needed shells: ${report.createdCount}`,
    `- Existing adapters preserved: ${report.skippedExistingCount}`,
    `- Synchronized existing pipelines: ${report.synchronizedExistingCount}`,
    `- Preserved promoted alias pipelines: ${report.preservedPromotedAliasCount}`,
    `- Created missing pipelines: ${report.createdMissingPipelineCount}`,
    `- Active states: ${report.stateGate.activeStates.join(", ")}`,
    `- Kentucky mode: ${report.stateGate.kentuckyMode}`,
    "",
    "## Completion Meaning",
    "",
    report.completionMeaning,
    "",
    "## Created Counties",
    "",
    "| State | County | Adapter |",
    "| --- | --- | --- |",
    ...created.map((item) => `| ${item.state} | ${item.countyName} | \`${item.adapterPath}\` |`),
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
  console.log(JSON.stringify({ created: report.createdCount, tx: report.stateCounts.TX, ky: report.stateCounts.KY }, null, 2));
}

main();

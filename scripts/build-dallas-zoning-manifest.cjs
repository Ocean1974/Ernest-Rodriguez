const fs = require("fs");
const https = require("https");
const path = require("path");

const root = path.join(__dirname, "..");
const outputDir = path.join(root, "output");
const publicZoningDir = path.join(root, "public", "data", "zoning");
const publicChunksDir = path.join(publicZoningDir, "chunks");

const SOURCE_COUNTY_ID = "dallas-county-dcad";
const PUBLIC_ZONING_APP_URL = "https://developmentweb.dallascityhall.com/publiczoningweb/";
const PUBLIC_ZONING_CONFIG_URL = "https://developmentweb.dallascityhall.com/publiczoningweb/cdn/2/config.json";
const PUBLIC_ZONING_WEB_MAP_URL = "https://dallasgis.maps.arcgis.com/sharing/rest/content/items/ab03f7a62af4431aa19659b66154d5f3/data?f=json";
const SCHEMA_VERSION = "wr-dallas-zoning-manifest-v1";
const RECORD_SCHEMA_VERSION = "wr-dallas-zoning-layer-v1";
const MAX_FEATURES_PER_VIEWPORT = 750;

const COUNT_QUERY = "where=1%3D1&returnCountOnly=true&f=json";
const SAMPLE_QUERY = "where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=3&f=json";

const SOURCE_LAYERS = [
  {
    id: "city-tax-parcels",
    title: "Dallas Tax Parcels",
    recordType: "tax-parcel-bridge",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/CRMHostedLayers/FeatureServer/13",
    joinCandidates: ["ACCT", "GIS_ACCT"],
    fallbackCount: 496810,
    keyFields: ["OBJECTID", "ACCT", "GIS_ACCT", "ST_NUM", "ST_NAME", "ST_TYPE", "CITY", "COUNTY", "TAXPANAME1"],
  },
  {
    id: "deed-restrictions",
    title: "Deed Restrictions",
    recordType: "overlay",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/0",
    joinCandidates: ["spatial"],
    fallbackCount: 0,
    keyFields: ["OBJECTID", "DEED_RES", "ORD_NUM", "CASE_NUMBER"],
  },
  {
    id: "dry-overlay",
    title: "Dry Overlay",
    recordType: "overlay",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/1",
    joinCandidates: ["spatial"],
    fallbackCount: 0,
    keyFields: ["OBJECTID", "D_OVERLAY", "ORD_NUM", "CASE_NUMBER"],
  },
  {
    id: "historic-overlay",
    title: "Historic Overlay",
    recordType: "overlay",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/2",
    joinCandidates: ["spatial"],
    fallbackCount: 0,
    keyFields: ["OBJECTID", "H_OVERLAY", "ORD_NUM", "CASE_NUMBER", "COMMON_NAME"],
  },
  {
    id: "historic-subdistricts",
    title: "Historic Subdistricts",
    recordType: "subdistrict",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/3",
    joinCandidates: ["spatial"],
    fallbackCount: 0,
    keyFields: ["OBJECTID", "H_OVERLAY", "SUBDIST1", "SUBDIST2", "COMMON_NAME"],
  },
  {
    id: "special-use-permits",
    title: "Special Use Permits",
    recordType: "special-use-permit",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/4",
    joinCandidates: ["spatial"],
    fallbackCount: 0,
    keyFields: ["OBJECTID", "SUP_NUM", "CASE_NUMBER", "ORD_NUM", "COUNCIL_DATE", "USE_"],
  },
  {
    id: "nso-overlay",
    title: "NSO Overlay",
    recordType: "overlay",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/5",
    joinCandidates: ["spatial"],
    fallbackCount: 0,
    keyFields: ["OBJECTID", "COMMON_NAME", "CASE_NUMBER", "ORD_NUM"],
  },
  {
    id: "nso-subdistricts",
    title: "NSO Subdistricts",
    recordType: "subdistrict",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/6",
    joinCandidates: ["spatial"],
    fallbackCount: 0,
    keyFields: ["OBJECTID", "SUBDIST1", "SUBDIST2", "COMMON_NAME", "CASE_NUMBER"],
  },
  {
    id: "md-overlay",
    title: "MD Overlay",
    recordType: "overlay",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/7",
    joinCandidates: ["spatial"],
    fallbackCount: 0,
    keyFields: ["OBJECTID", "MD_OVERLAY", "COMMON_NAME", "CASE_NUMBER"],
  },
  {
    id: "cd-subdistricts",
    title: "CD Subdistricts",
    recordType: "subdistrict",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/8",
    joinCandidates: ["spatial"],
    fallbackCount: 0,
    keyFields: ["OBJECTID", "CD_NUM", "SUBDIST1", "SUBDIST2", "COMMON_NAME"],
  },
  {
    id: "pd-subdistricts",
    title: "PD Subdistricts",
    recordType: "subdistrict",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/9",
    joinCandidates: ["spatial"],
    fallbackCount: 0,
    keyFields: ["OBJECTID", "PD_NUM", "SUBDIST1", "SUBDIST2", "COMMON_NAME"],
  },
  {
    id: "pd193-oaklawn",
    title: "PD193 Oaklawn",
    recordType: "subdistrict",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/10",
    joinCandidates: ["spatial"],
    fallbackCount: 0,
    keyFields: ["OBJECTID", "PD_NUM", "SUBDIST1", "SUBDIST2", "COMMON_NAME"],
  },
  {
    id: "pds-subdistricts",
    title: "PDS Subdistricts",
    recordType: "subdistrict",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/11",
    joinCandidates: ["spatial"],
    fallbackCount: 0,
    keyFields: ["OBJECTID", "PDS_NUM", "PD_NUM", "SUBDIST1", "SUBDIST2", "COMMON_NAME"],
  },
  {
    id: "height-map-overlay",
    title: "Height Map Overlay",
    recordType: "overlay",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/12",
    joinCandidates: ["spatial"],
    fallbackCount: 0,
    keyFields: ["OBJECTID", "COMMON_NAME", "CASE_NUMBER", "ORD_NUM"],
  },
  {
    id: "shop-front-overlay",
    title: "Shop Front Overlay",
    recordType: "overlay",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/13",
    joinCandidates: ["spatial"],
    fallbackCount: 0,
    keyFields: ["OBJECTID", "COMMON_NAME", "CASE_NUMBER", "ORD_NUM"],
  },
  {
    id: "parking-management-overlay",
    title: "Parking Management Overlay",
    recordType: "overlay",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/14",
    joinCandidates: ["spatial"],
    fallbackCount: 0,
    keyFields: ["OBJECTID", "COMMON_NAME", "CASE_NUMBER", "ORD_NUM"],
  },
  {
    id: "base-zoning",
    title: "Base Zoning",
    recordType: "base-zoning",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/15",
    joinCandidates: ["spatial"],
    fallbackCount: 496810,
    keyFields: ["OBJECTID", "ZONE_DIST", "PD_NUM", "CD_NUM", "CASE_NUMBER", "COMMON_NAME", "LONG_ZONE_DIST", "ORD_NUM", "COUNCIL_DATE"],
  },
  {
    id: "spsd-overlay",
    title: "SPSD Overlay",
    recordType: "overlay",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/16",
    joinCandidates: ["spatial"],
    fallbackCount: 0,
    keyFields: ["OBJECTID", "COMMON_NAME", "CASE_NUMBER", "ORD_NUM"],
  },
  {
    id: "pedestrian-overlay",
    title: "Pedestrian Overlay",
    recordType: "overlay",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/17",
    joinCandidates: ["spatial"],
    fallbackCount: 0,
    keyFields: ["OBJECTID", "P_OVERLAY", "COMMON_NAME", "CASE_NUMBER", "ORD_NUM"],
  },
  {
    id: "turtle-creek-setback",
    title: "Turtle Creek Setback",
    recordType: "overlay",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/18",
    joinCandidates: ["spatial"],
    fallbackCount: 0,
    keyFields: ["OBJECTID", "COMMON_NAME", "CASE_NUMBER", "ORD_NUM"],
  },
  {
    id: "demolition-delay",
    title: "Demolition Delay",
    recordType: "overlay",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/19",
    joinCandidates: ["spatial"],
    fallbackCount: 0,
    keyFields: ["OBJECTID", "COMMON_NAME", "CASE_NUMBER", "ORD_NUM"],
  },
  {
    id: "aor-search",
    title: "Area of Request Search",
    recordType: "area-of-request",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/AORSearch/FeatureServer/0",
    joinCandidates: ["spatial"],
    fallbackCount: 496810,
    keyFields: ["OBJECTID", "ZONE_DIST", "PD_NUM", "PDS_NUM", "SUP_NUM", "ZONE_CHANGE", "CASE_NUMBER", "LOCATION", "DATE_VERIFIED"],
  },
  {
    id: "current-year-zoning-cases",
    title: "Current Year Zoning Cases",
    recordType: "zoning-case",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/AreasOfRequest/FeatureServer/10",
    joinCandidates: ["spatial"],
    fallbackCount: 71,
    keyFields: ["OBJECTID", "ZONE_CHANGE", "CASE_NUMBER", "DATE_VERIFIED"],
  },
];

function ensureDirectories() {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(publicZoningDir, { recursive: true });
  fs.mkdirSync(publicChunksDir, { recursive: true });
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { Accept: "application/json" }, timeout: 20000 }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode} for ${url}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Invalid JSON for ${url}: ${error.message}`));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error(`Request timed out for ${url}`)));
    request.on("error", reject);
  });
}

function withQuery(baseUrl, query) {
  return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${query}`;
}

function normalizeField(field) {
  return {
    name: field.name,
    type: field.type,
    alias: field.alias || "",
    nullable: field.nullable !== false,
  };
}

function pickSampleAttributes(features = [], keyFields = []) {
  return features.slice(0, 3).map((feature) => {
    const attributes = feature.attributes || {};
    const picked = {};
    for (const field of keyFields) {
      if (Object.prototype.hasOwnProperty.call(attributes, field)) picked[field] = attributes[field];
    }
    return {
      attributes: Object.keys(picked).length ? picked : attributes,
    };
  });
}

async function inspectLayer(layer) {
  const metadataUrl = withQuery(layer.url, "f=json");
  const countUrl = `${layer.url}/query?${COUNT_QUERY}`;
  const sampleUrl = `${layer.url}/query?${SAMPLE_QUERY}`;
  const inspectedAt = new Date().toISOString();

  try {
    const [metadata, countPayload, samplePayload] = await Promise.all([
      requestJson(metadataUrl),
      requestJson(countUrl),
      requestJson(sampleUrl),
    ]);
    const fields = Array.isArray(metadata.fields) ? metadata.fields.map(normalizeField) : [];
    const sourceCount = Number.isFinite(countPayload.count) ? countPayload.count : layer.fallbackCount;
    return {
      ...layer,
      serviceName: metadata.name || metadata.serviceItemId || layer.title,
      objectIdField: metadata.objectIdField || "",
      geometryType: metadata.geometryType || "",
      capabilities: metadata.capabilities || "",
      extent: metadata.extent || null,
      fields,
      fieldNames: fields.map((field) => field.name),
      featureCount: sourceCount,
      countSource: Number.isFinite(countPayload.count) ? "live-arcgis-count-query" : "known-inspection-fallback",
      sampleFeatures: pickSampleAttributes(samplePayload.features || [], layer.keyFields),
      inspectedAt,
      metadataUrl,
      countUrl,
      sampleUrl,
      status: "metadata-ready",
    };
  } catch (error) {
    return {
      ...layer,
      serviceName: layer.title,
      objectIdField: "OBJECTID",
      geometryType: "",
      capabilities: "Query",
      extent: null,
      fields: layer.keyFields.map((name) => ({ name, type: "unknown", alias: "", nullable: true })),
      fieldNames: layer.keyFields,
      featureCount: layer.fallbackCount,
      countSource: "known-inspection-fallback",
      sampleFeatures: [],
      inspectedAt,
      metadataUrl,
      countUrl,
      sampleUrl,
      status: "metadata-ready-with-fetch-warning",
      warning: error.message,
    };
  }
}

function writeSearchIndex(generatedAt) {
  const searchIndex = {
    schemaVersion: "wr-dallas-zoning-search-index-v1",
    sourceCountyId: SOURCE_COUNTY_ID,
    generatedAt,
    status: "metadata-only",
    zoningRecordCount: 0,
    records: [],
    note: "No zoning records are activated in the browser until normalized viewport chunks are built.",
  };
  fs.writeFileSync(path.join(publicZoningDir, "search-index.json"), JSON.stringify(searchIndex, null, 2));
}

function writeChunksReadme(generatedAt) {
  const lines = [
    "# Dallas Zoning Chunks",
    "",
    `Generated: ${generatedAt}`,
    "",
    "This directory is reserved for normalized, viewport-safe Dallas zoning chunks.",
    "",
    "Do not place raw ArcGIS service exports here. Build zoning chunks from normalized records that map into `data/schemas/dallas-zoning-layer.schema.json`.",
    "",
  ];
  fs.writeFileSync(path.join(publicChunksDir, "README.md"), lines.join("\n"));
}

function buildManifest(sourceLayers, generatedAt) {
  return {
    schemaVersion: SCHEMA_VERSION,
    recordSchemaVersion: RECORD_SCHEMA_VERSION,
    sourceCountyId: SOURCE_COUNTY_ID,
    countyName: "Dallas County",
    appraisalDistrictName: "Dallas County Appraisal District",
    generatedAt,
    status: "metadata-ready",
    defaultVisible: false,
    renderDirectlyInBrowser: false,
    runtimeReadiness: "metadata-only; no visible map layer is mounted",
    publicDataRoot: "/data/zoning/",
    schemaPath: "data/schemas/dallas-zoning-layer.schema.json",
    reportPath: "output/dallas-zoning-source-report.md",
    sourceApp: {
      url: PUBLIC_ZONING_APP_URL,
      configUrl: PUBLIC_ZONING_CONFIG_URL,
      webMapDataUrl: PUBLIC_ZONING_WEB_MAP_URL,
      title: "City of Dallas Zoning Map 2.3",
      platform: "ArcGIS Experience Builder",
    },
    joinPlan: {
      primary: "ACCT -> White Rabbit accountNum",
      secondary: "GIS_ACCT -> White Rabbit gisParcelId",
      fallback: "Spatial join for zoning polygons, overlays, and case areas",
      baseParcelProtection: "Zoning records enrich parcels and never overwrite DCAD base parcel data.",
    },
    maxFeaturesPerViewport: MAX_FEATURES_PER_VIEWPORT,
    chunkCount: 0,
    chunks: [],
    searchIndex: "search-index.json",
    searchIndexCount: 0,
    parcelIndex: "parcel-zoning-index.json",
    parcelIndexDirectory: "parcel-index/",
    parcelIndexCount: 0,
    parcelIndexSchemaPath: "data/schemas/parcel-zoning-index.schema.json",
    sourceLayers,
  };
}

function buildReport(manifest) {
  const lines = [
    "# Dallas Zoning Source Report",
    "",
    `Generated: ${manifest.generatedAt}`,
    "",
    "## Safety",
    "",
    "- Status: metadata-ready",
    "- Default visible: false",
    "- Render directly in browser: false",
    "- Runtime strategy: build-time inspection, offline normalization, viewport chunks, capped loader",
    "- Base parcel data: DCAD parcel data is not overwritten",
    "",
    "## Source App",
    "",
    `- Public zoning app: ${manifest.sourceApp.url}`,
    `- App config: ${manifest.sourceApp.configUrl}`,
    `- Web map data: ${manifest.sourceApp.webMapDataUrl}`,
    "",
    "## Join Plan",
    "",
    `- Primary join: ${manifest.joinPlan.primary}`,
    `- Secondary join: ${manifest.joinPlan.secondary}`,
    `- Fallback: ${manifest.joinPlan.fallback}`,
    `- Parcel protection: ${manifest.joinPlan.baseParcelProtection}`,
    "",
    "## Source Layers",
    "",
    "| Layer | Record type | Count | Count source | Join candidates | Object ID | Geometry | Status |",
    "| --- | --- | ---: | --- | --- | --- | --- | --- |",
    ...manifest.sourceLayers.map((layer) =>
      `| ${layer.title} | ${layer.recordType} | ${layer.featureCount} | ${layer.countSource} | ${(layer.joinCandidates || []).join(", ")} | ${layer.objectIdField || ""} | ${layer.geometryType || ""} | ${layer.status} |`,
    ),
    "",
    "## Field Inventory",
    "",
    ...manifest.sourceLayers.flatMap((layer) => [
      `### ${layer.title}`,
      "",
      `- URL: ${layer.url}`,
      `- Fields: ${layer.fieldNames.join(", ")}`,
      layer.sampleFeatures.length ? `- Sample attributes: \`${JSON.stringify(layer.sampleFeatures[0].attributes)}\`` : "- Sample attributes: unavailable from current inspection",
      layer.warning ? `- Fetch warning: ${layer.warning}` : "",
      "",
    ]),
    "## Runtime Outputs",
    "",
    "- Manifest: `public/data/zoning/manifest.json`",
    "- Search index: `public/data/zoning/search-index.json`",
    "- Parcel zoning index: `public/data/zoning/parcel-zoning-index.json`",
    "- Parcel zoning index shards: `public/data/zoning/parcel-index/`",
    "- Chunk directory: `public/data/zoning/chunks/`",
    "",
    "The live White Rabbit pages do not import or render this zoning layer yet.",
    "",
  ];
  return lines.filter((line) => line !== "").join("\n");
}

function writeReports(manifest) {
  fs.writeFileSync(path.join(publicZoningDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(outputDir, "dallas-zoning-source-report.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(outputDir, "dallas-zoning-source-report.md"), buildReport(manifest));
}

async function main() {
  ensureDirectories();
  const generatedAt = new Date().toISOString();
  const sourceLayers = [];
  for (const layer of SOURCE_LAYERS) {
    sourceLayers.push(await inspectLayer(layer));
  }
  const manifest = buildManifest(sourceLayers, generatedAt);
  writeSearchIndex(generatedAt);
  writeChunksReadme(generatedAt);
  writeReports(manifest);
  console.log(
    JSON.stringify(
      {
        status: manifest.status,
        sourceCountyId: manifest.sourceCountyId,
        sourceLayerCount: manifest.sourceLayers.length,
        chunkCount: manifest.chunkCount,
        maxFeaturesPerViewport: manifest.maxFeaturesPerViewport,
      },
      null,
      2,
    ),
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  MAX_FEATURES_PER_VIEWPORT,
  PUBLIC_ZONING_APP_URL,
  PUBLIC_ZONING_CONFIG_URL,
  PUBLIC_ZONING_WEB_MAP_URL,
  RECORD_SCHEMA_VERSION,
  SOURCE_COUNTY_ID,
  SOURCE_LAYERS,
  buildManifest,
  inspectLayer,
};

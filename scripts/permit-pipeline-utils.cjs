const fs = require("fs");
const https = require("https");
const path = require("path");

const root = path.join(__dirname, "..");
const permitDirs = {
  raw: path.join(root, "data", "permits", "raw"),
  processed: path.join(root, "data", "permits", "processed"),
  output: path.join(root, "output"),
  publicPermits: path.join(root, "public", "data", "permits"),
  publicMarketIntelPermits: path.join(root, "public", "data", "market-intel", "permits"),
  parcelChunks: path.join(root, "public", "data", "parcels", "chunks"),
};

const permitSources = [
  {
    id: "e7gq-4sah",
    name: "Dallas OpenData Building Permits",
    sourceUrl: "https://www.dallasopendata.com/resource/e7gq-4sah.json",
    pageSize: 50000,
  },
  {
    id: "9qet-qt9e",
    name: "Dallas OpenData Building Inspection Certificates Of Occupancy",
    sourceUrl: "https://www.dallasopendata.com/resource/9qet-qt9e.json",
    pageSize: 50000,
  },
];

const louisvillePermitSources = [
  {
    id: "louisville-building-permit-applications",
    name: "Louisville Metro Active Construction Permits",
    sourceUrl: "https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services/active_construction_permits/FeatureServer/0",
    pageSize: 1000,
    market: "Louisville",
    state: "KY",
  },
];

function ensureDirs() {
  Object.values(permitDirs).forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
  fs.mkdirSync(path.join(permitDirs.publicPermits, "chunks"), { recursive: true });
  fs.mkdirSync(path.join(permitDirs.publicMarketIntelPermits, "chunks"), { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function sourceMetadataTimestamp(metadata = {}) {
  const value = Number(metadata.rowsUpdatedAt || metadata.metadataUpdatedAt || 0);
  return Number.isFinite(value) && value > 0 ? new Date(value * 1000).toISOString() : "";
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "WhiteRabbitPermitPipeline/1.0" } }, (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`GET ${url} failed with ${response.statusCode}: ${data.slice(0, 240)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });
}

function arcgisQueryUrl(source, params = {}) {
  const query = new URL(`${source.sourceUrl}/query`);
  Object.entries({ f: "json", ...params }).forEach(([key, value]) => query.searchParams.set(key, String(value)));
  return query.toString();
}

async function fetchArcgisLayerMetadata(source) {
  return fetchJson(`${source.sourceUrl}?f=json`);
}

async function fetchArcgisSource(source) {
  const countPayload = await fetchJson(arcgisQueryUrl(source, { where: "1=1", returnCountOnly: "true" }));
  const rowCount = Number(countPayload?.count || 0);
  const rows = [];
  for (let offset = 0; offset < rowCount; offset += source.pageSize) {
    const payload = await fetchJson(
      arcgisQueryUrl(source, {
        where: "1=1",
        outFields: "*",
        returnGeometry: "true",
        outSR: 4326,
        resultOffset: offset,
        resultRecordCount: source.pageSize,
      }),
    );
    rows.push(...(payload.features || []));
  }
  const metadata = await fetchArcgisLayerMetadata(source);
  writeJson(path.join(permitDirs.raw, `${source.id}.json`), rows);
  writeJson(path.join(permitDirs.raw, `${source.id}-metadata.json`), metadata);
  return { ...source, rowCount, fetchedRows: rows.length, sourceUpdatedAt: sourceMetadataTimestamp(metadata) };
}

async function fetchSource(source) {
  const countPayload = await fetchJson(`${source.sourceUrl}?$select=count(*)`);
  const rowCount = Number(countPayload?.[0]?.count || 0);
  const rows = [];
  for (let offset = 0; offset < rowCount; offset += source.pageSize) {
    const url = `${source.sourceUrl}?$limit=${source.pageSize}&$offset=${offset}`;
    rows.push(...(await fetchJson(url)));
  }
  const metadata = await fetchJson(`https://www.dallasopendata.com/api/views/${source.id}`);
  writeJson(path.join(permitDirs.raw, `${source.id}.json`), rows);
  writeJson(path.join(permitDirs.raw, `${source.id}-metadata.json`), metadata);
  return { ...source, rowCount, fetchedRows: rows.length, sourceUpdatedAt: sourceMetadataTimestamp(metadata) };
}

async function fetchDallasPermits() {
  ensureDirs();
  const fetched = [];
  for (const source of permitSources) fetched.push(await fetchSource(source));
  writeJson(path.join(permitDirs.raw, "source-manifest.json"), {
    generatedAt: new Date().toISOString(),
    sources: fetched,
  });
  return fetched;
}

async function fetchLouisvillePermits() {
  ensureDirs();
  const fetched = [];
  for (const source of louisvillePermitSources) fetched.push(await fetchArcgisSource(source));
  writeJson(path.join(permitDirs.raw, "louisville-source-manifest.json"), {
    generatedAt: new Date().toISOString(),
    sources: fetched,
  });
  return fetched;
}

async function fetchMarketPermitIntel() {
  const dallasSources = await fetchDallasPermits();
  const louisvilleSources = await fetchLouisvillePermits();
  writeJson(path.join(permitDirs.raw, "market-intel-source-manifest.json"), {
    generatedAt: new Date().toISOString(),
    sources: [...dallasSources, ...louisvilleSources],
  });
  return [...dallasSources, ...louisvilleSources];
}

function allFieldNames(rows) {
  return Array.from(
    rows.reduce((fields, row) => {
      Object.keys(row || {}).forEach((field) => fields.add(field));
      return fields;
    }, new Set()),
  ).sort();
}

function fieldValue(row, aliases) {
  const entries = Object.entries(row || {});
  for (const alias of aliases) {
    const exact = row?.[alias];
    if (exact !== undefined && exact !== null && String(exact).trim() !== "") return exact;
    const lowerAlias = alias.toLowerCase();
    const found = entries.find(([key, value]) => key.toLowerCase() === lowerAlias && String(value ?? "").trim() !== "");
    if (found) return found[1];
  }
  return "";
}

function numberValue(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeAddress(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/\bDALLAS\b/g, "")
    .replace(/\bLOUISVILLE\b/g, "")
    .replace(/\bTX\b/g, "")
    .replace(/\bKY\b/g, "")
    .replace(/\bKENTUCKY\b/g, "")
    .replace(/\bTEXAS\b/g, "")
    .replace(/\bSTREET\b/g, "ST")
    .replace(/\bAVENUE\b/g, "AVE")
    .replace(/\bBOULEVARD\b/g, "BLVD")
    .replace(/\bDRIVE\b/g, "DR")
    .replace(/\bROAD\b/g, "RD")
    .replace(/\bLANE\b/g, "LN")
    .replace(/\bHIGHWAY\b/g, "HWY")
    .replace(/\bINTERSTATE\b/g, "IH")
    .replace(/[^\dA-Z]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const numeric = /^\d{10,13}$/.test(text) ? Number(text) : null;
  const parsed = numeric === null ? new Date(text) : new Date(text.length === 10 ? numeric * 1000 : numeric);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toISOString().slice(0, 10);
}

function pointFromRow(row) {
  const location = fieldValue(row, ["location", "geocoded_column", "the_geom"]);
  if (location && typeof location === "object") {
    const lat = numberValue(location.latitude ?? location.lat);
    const lng = numberValue(location.longitude ?? location.lon ?? location.lng);
    if (lat !== null && lng !== null) return { latitude: lat, longitude: lng };
  }
  const lat = numberValue(fieldValue(row, ["latitude", "lat", "y", "location_1_latitude"]));
  const lng = numberValue(fieldValue(row, ["longitude", "lon", "lng", "x", "location_1_longitude"]));
  if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { latitude: lat, longitude: lng };
  return { latitude: null, longitude: null };
}

function normalizePermitRow(row, source) {
  const address = fieldValue(row, [
    "address",
    "permit_address",
    "site_address",
    "street_address",
    "project_address",
    "full_address",
    "property_address",
  ]);
  const point = pointFromRow(row);
  return {
    sourceDataset: source.id,
    sourceName: source.name,
    sourceUrl: source.sourceUrl,
    permitNumber: String(fieldValue(row, ["permit_number", "permit_no", "permitnum", "record_number", "certificate_number", "co_number", "co", "id"]) || "").trim(),
    permitType: String(fieldValue(row, ["permit_type", "type", "record_type", "certificate_type", "type_of_co"]) || "").trim(),
    permitSubtype: String(fieldValue(row, ["permit_subtype", "subtype", "work_class", "work_type", "occupancy_type"]) || "").trim(),
    permitStatus: String(fieldValue(row, ["permit_status", "status", "record_status", "certificate_status"]) || "").trim(),
    applicationDate: normalizeDate(fieldValue(row, ["application_date", "applied_date", "applieddate", "created_date", "applicationdate"])),
    issueDate: normalizeDate(fieldValue(row, ["issued_date", "issue_date", "issueddate", "date_issued"])),
    finalDate: normalizeDate(fieldValue(row, ["final_date", "closed_date", "completed_date", "expiration_date", "finaled_date"])),
    address: String(address || "").trim(),
    normalizedAddress: normalizeAddress(address),
    city: String(fieldValue(row, ["city", "property_city"]) || "Dallas").trim() || "Dallas",
    state: String(fieldValue(row, ["state"]) || "TX").trim() || "TX",
    zip: String(fieldValue(row, ["zip", "zipcode", "zip_code", "property_zipcode"]) || "").trim(),
    description: String(fieldValue(row, ["description", "work_description", "scope_of_work", "comments", "project_name"]) || "").trim(),
    valuation: numberValue(fieldValue(row, ["valuation", "job_value", "declared_valuation", "value", "estimated_cost"])),
    contractor: String(fieldValue(row, ["contractor", "contractor_name", "applicant", "applicant_name"]) || "").trim(),
    businessName: String(fieldValue(row, ["business_name", "business", "tenant_name", "company_name"]) || "").trim(),
    landUse: String(fieldValue(row, ["land_use", "use", "proposed_use"]) || "").trim(),
    occupancy: String(fieldValue(row, ["occupancy", "occupancy_type", "occupancy_group"]) || "").trim(),
    codeDistrict: String(fieldValue(row, ["code_district", "district"]) || "").trim(),
    latitude: point.latitude,
    longitude: point.longitude,
    rawSourceId: String(fieldValue(row, [":id", "id", "sid", "permit_number", "certificate_number", "co"]) || "").trim(),
    raw: row,
  };
}

function normalizeLouisvillePermitFeature(feature, source, index) {
  const attributes = feature?.attributes || {};
  const geometry = feature?.geometry || {};
  const permitNumber = fieldValue(attributes, ["PERMIT_NUMBER", "ObjectId", "OBJECTID"]);
  const address = fieldValue(attributes, ["ADDRESS", "LOCATION", "site_address"]);
  const latitudeCandidate = numberValue(fieldValue(attributes, ["LATITUDE"])) ?? numberValue(geometry.y);
  const longitudeCandidate = numberValue(fieldValue(attributes, ["LONGITUDE"])) ?? numberValue(geometry.x);
  const latitude = latitudeCandidate !== null && latitudeCandidate >= 37.8 && latitudeCandidate <= 38.5 ? latitudeCandidate : null;
  const longitude = longitudeCandidate !== null && longitudeCandidate >= -86.1 && longitudeCandidate <= -85.2 ? longitudeCandidate : null;
  return {
    permitRecordId: `${source.id}-${index + 1}`,
    market: "Louisville",
    sourceDataset: source.id,
    sourceName: source.name,
    sourceUrl: source.sourceUrl,
    permitNumber: String(permitNumber || "").trim(),
    permitType: String(fieldValue(attributes, ["PERMIT_TYPE", "TYPE"]) || "").trim(),
    permitSubtype: String(fieldValue(attributes, ["WORK_TYPE", "CATEGORY_NAME", "ADD_DESC"]) || "").trim(),
    permitStatus: String(fieldValue(attributes, ["PERMIT_STATUS", "STATUS"]) || "").trim(),
    applicationDate: "",
    issueDate: normalizeDate(fieldValue(attributes, ["ISSUE_DATE", "STAT_DATE"])),
    finalDate: "",
    address: String(address || "").trim(),
    normalizedAddress: normalizeAddress(address),
    city: String(fieldValue(attributes, ["CITY"]) || "Louisville").trim(),
    state: String(fieldValue(attributes, ["STATE"]) || "KY").trim(),
    zip: String(fieldValue(attributes, ["ZIPCODE", "ZIP"]) || "").trim(),
    description: String(fieldValue(attributes, ["CATEGORY_NAME", "WORK_TYPE", "PERMIT_TYPE", "ADD_DESC"]) || "").trim(),
    valuation: numberValue(fieldValue(attributes, ["PROJECT_COSTS", "VALUATION"])),
    contractor: String(fieldValue(attributes, ["CONTRACTOR"]) || "").trim(),
    latitude: latitude !== null ? latitude : null,
    longitude: longitude !== null ? longitude : null,
    rawSourceId: String(fieldValue(attributes, ["ObjectId", "OBJECTID"]) || "").trim(),
    raw: attributes,
  };
}

function normalizeLouisvillePermits() {
  ensureDirs();
  const permits = louisvillePermitSources.flatMap((source) => {
    const rows = readJson(path.join(permitDirs.raw, `${source.id}.json`));
    return rows.map((feature, index) => normalizeLouisvillePermitFeature(feature, source, index));
  });
  writeJson(path.join(permitDirs.processed, "louisville-permits-normalized.json"), {
    generatedAt: new Date().toISOString(),
    count: permits.length,
    permits,
  });
  return permits;
}

function inspectDallasPermits() {
  ensureDirs();
  const sourceReports = permitSources.map((source) => {
    const rows = readJson(path.join(permitDirs.raw, `${source.id}.json`));
    const metadata = readJson(path.join(permitDirs.raw, `${source.id}-metadata.json`));
    const fields = allFieldNames(rows);
    const dateFields = fields.filter((field) => /date/i.test(field));
    const addressFields = fields.filter((field) => /address|location|street|zip|city|state/i.test(field));
    const permitIdFields = fields.filter((field) => /permit|certificate|record|number|id/i.test(field));
    const statusTypeFields = fields.filter((field) => /status|type|class|work|occup/i.test(field));
    return {
      sourceName: source.name,
      sourceUrl: source.sourceUrl,
      datasetIdentifier: source.id,
      rowCount: rows.length,
      metadataName: metadata.name,
      metadataUpdatedAt: metadata.rowsUpdatedAt,
      fields,
      sampleRecords: rows.slice(0, 5),
      dateFields,
      addressFields,
      permitIdentifierFields: permitIdFields,
      statusTypeFields,
    };
  });
  writeJson(path.join(permitDirs.output, "permit-schema-report.json"), {
    generatedAt: new Date().toISOString(),
    sources: sourceReports,
  });
  const md = [
    "# Dallas Permit Schema Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    ...sourceReports.flatMap((report) => [
      `## ${report.sourceName}`,
      "",
      `- Source URL: ${report.sourceUrl}`,
      `- Dataset identifier: ${report.datasetIdentifier}`,
      `- Row count: ${report.rowCount}`,
      `- Fields: ${report.fields.join(", ")}`,
      `- Date fields: ${report.dateFields.join(", ") || "None identified"}`,
      `- Address/location fields: ${report.addressFields.join(", ") || "None identified"}`,
      `- Permit identifier fields: ${report.permitIdentifierFields.join(", ") || "None identified"}`,
      `- Status/type fields: ${report.statusTypeFields.join(", ") || "None identified"}`,
      "",
      "Sample records:",
      "",
      "```json",
      JSON.stringify(report.sampleRecords, null, 2),
      "```",
      "",
    ]),
  ].join("\n");
  fs.writeFileSync(path.join(permitDirs.output, "permit-schema-report.md"), md);
  return sourceReports;
}

function normalizeDallasPermits() {
  ensureDirs();
  const permits = permitSources.flatMap((source) => {
    const rows = readJson(path.join(permitDirs.raw, `${source.id}.json`));
    return rows.map((row, index) => ({
      ...normalizePermitRow(row, source),
      permitRecordId: `${source.id}-${index + 1}`,
    }));
  });
  writeJson(path.join(permitDirs.processed, "dallas-permits-normalized.json"), {
    generatedAt: new Date().toISOString(),
    count: permits.length,
    permits,
  });
  return permits;
}

function loadParcelAddressIndex() {
  const index = new Map();
  const chunkFiles = fs.readdirSync(permitDirs.parcelChunks).filter((name) => name.endsWith(".json"));
  for (const file of chunkFiles) {
    const payload = readJson(path.join(permitDirs.parcelChunks, file));
    for (const parcel of payload.parcels || []) {
      const normalized = normalizeAddress(parcel.address || parcel.propertyAddress);
      if (!normalized || index.has(normalized)) continue;
      index.set(normalized, {
        accountNum: parcel.accountNum,
        gisParcelId: parcel.gisParcelId,
        address: parcel.address,
        propertyName: parcel.propertyName,
        centroid: parcel.liveGeometry?.center || null,
        screenCentroid: parcel.centroid || null,
      });
    }
  }
  return index;
}

function joinPermitsToParcels() {
  ensureDirs();
  const normalizedPayload = readJson(path.join(permitDirs.processed, "dallas-permits-normalized.json"));
  const addressIndex = loadParcelAddressIndex();
  const permits = normalizedPayload.permits.map((permit) => {
    const parcel = addressIndex.get(permit.normalizedAddress);
    if (!parcel) return { ...permit, parcel: null, joinMethod: null };
    const [longitude, latitude] = parcel.centroid || [permit.longitude, permit.latitude];
    return {
      ...permit,
      parcelAccountNum: parcel.accountNum,
      parcelGisId: parcel.gisParcelId,
      parcelAddress: parcel.address,
      parcelPropertyName: parcel.propertyName,
      joinMethod: "address_match",
      longitude: permit.longitude ?? longitude ?? null,
      latitude: permit.latitude ?? latitude ?? null,
      parcel,
    };
  });
  const joined = permits.filter((permit) => permit.joinMethod);
  const unmatched = permits.length - joined.length;
  const report = {
    generatedAt: new Date().toISOString(),
    totalPermitRowsInspected: permits.length,
    totalNormalizedPermits: permits.length,
    totalPermitsJoinedToParcels: joined.length,
    totalPermitsUnmatched: unmatched,
    joinMethodCounts: {
      addressMatch: joined.length,
      parcelIdMatch: 0,
      spatialJoin: 0,
    },
    limitations: [
      "Direct parcel/account fields were not found in the inspected permit schemas.",
      "Address joins are exact after normalization; unmatched rows need geocoding or manual address standardization.",
      "Spatial join is prepared for records with usable coordinates, but the current official exports are joined through address matching in this pipeline run.",
    ],
  };
  writeJson(path.join(permitDirs.processed, "dallas-permits-joined.json"), {
    ...report,
    permits,
  });
  const md = [
    "# DCAD Permit Join Method Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Scope",
    "",
    "- Permit and Certificate of Occupancy rows are municipal City of Dallas sources.",
    "- Parcel/account records are Dallas County Appraisal District (DCAD) sources.",
    "- Permit rows are joined back to DCAD parcels when a normalized permit address exactly matches a normalized DCAD parcel situs address.",
    "",
    `- Total permit rows inspected: ${report.totalPermitRowsInspected}`,
    `- Total normalized permits: ${report.totalNormalizedPermits}`,
    `- Total permits joined to parcels: ${report.totalPermitsJoinedToParcels}`,
    `- Total permits unmatched: ${report.totalPermitsUnmatched}`,
    `- Address match joins: ${report.joinMethodCounts.addressMatch}`,
    `- Parcel ID joins: ${report.joinMethodCounts.parcelIdMatch}`,
    `- Spatial joins: ${report.joinMethodCounts.spatialJoin}`,
    "",
    "## Join Method Counts",
    "",
    "| Method | Count | Notes |",
    "| --- | ---: | --- |",
    `| Address match | ${report.joinMethodCounts.addressMatch} | Exact normalized permit address to DCAD parcel situs address |`,
    `| Parcel/account ID | ${report.joinMethodCounts.parcelIdMatch} | No direct parcel/account field was present in inspected permit schemas |`,
    `| Spatial join | ${report.joinMethodCounts.spatialJoin} | Prepared but not used in this run |`,
    `| Unmatched | ${report.totalPermitsUnmatched} | Needs geocoding, manual standardization, or source improvements |`,
    "",
    "## Limitations",
    "",
    ...report.limitations.map((item) => `- ${item}`),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(permitDirs.output, "permit-join-report.md"), md);
  fs.writeFileSync(path.join(permitDirs.output, "dcad-permit-join-method-report.md"), md);
  return { report, permits };
}

function permitPointFeature(permit) {
  if (permit.latitude === null || permit.longitude === null) return null;
  return {
    type: "Feature",
    properties: {
      permitRecordId: permit.permitRecordId,
      sourceDataset: permit.sourceDataset,
      permitNumber: permit.permitNumber,
      permitType: permit.permitType,
      permitSubtype: permit.permitSubtype,
      permitStatus: permit.permitStatus,
      applicationDate: permit.applicationDate,
      issueDate: permit.issueDate,
      finalDate: permit.finalDate,
      address: permit.address,
      valuation: permit.valuation,
      contractor: permit.contractor,
      parcelAccountNum: permit.parcelAccountNum || "",
      parcelGisId: permit.parcelGisId || "",
      joinMethod: permit.joinMethod || "",
    },
    geometry: {
      type: "Point",
      coordinates: [permit.longitude, permit.latitude],
    },
  };
}

function permitSearchText(permit) {
  return [
    permit.market,
    permit.permitNumber,
    permit.permitType,
    permit.permitSubtype,
    permit.permitStatus,
    permit.address,
    permit.normalizedAddress,
    permit.description,
    permit.contractor,
    permit.parcelAccountNum,
    permit.parcelGisId,
    permit.sourceDataset,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function permitBounds(permit) {
  if (permit.latitude === null || permit.longitude === null) return null;
  return {
    minLng: permit.longitude,
    minLat: permit.latitude,
    maxLng: permit.longitude,
    maxLat: permit.latitude,
  };
}

function chunkKey(permit) {
  if (permit.latitude === null || permit.longitude === null) return "unlocated";
  if (permit.market === "Louisville" || permit.city === "Louisville") {
    const lngBucket = Math.floor((permit.longitude + 86.05) / 0.025);
    const latBucket = Math.floor((permit.latitude - 38.0) / 0.025);
    return `louisville-${lngBucket}-${latBucket}`;
  }
  const lngBucket = Math.floor((permit.longitude + 97.1) / 0.025);
  const latBucket = Math.floor((permit.latitude - 32.55) / 0.025);
  return `dallas-${lngBucket}-${latBucket}`;
}

function permitPublicRecord(permit) {
  const { raw, parcel, ...publicPermit } = permit;
  return publicPermit;
}

function buildMarketPermitIntelOutput() {
  ensureDirs();
  const dallasPayload = readJson(path.join(permitDirs.processed, "dallas-permits-joined.json"));
  const louisvillePayload = readJson(path.join(permitDirs.processed, "louisville-permits-normalized.json"));
  const dallasPermits = (dallasPayload.permits || []).map((permit) => ({
    ...permit,
    market: "Dallas",
    city: permit.city || "Dallas",
    state: permit.state || "TX",
  }));
  const louisvillePermits = louisvillePayload.permits || [];
  const permits = [...dallasPermits, ...louisvillePermits];
  const located = permits.filter((permit) => permit.latitude !== null && permit.longitude !== null);
  const searchIndex = permits.map((permit) => ({
    permitRecordId: permit.permitRecordId,
    market: permit.market || permit.city || "",
    sourceDataset: permit.sourceDataset,
    permitNumber: permit.permitNumber,
    permitType: permit.permitType,
    permitStatus: permit.permitStatus,
    address: permit.address,
    parcelAccountNum: permit.parcelAccountNum || "",
    parcelGisId: permit.parcelGisId || "",
    issueDate: permit.issueDate,
    searchText: permitSearchText(permit),
    chunkId: chunkKey(permit),
  }));

  fs.rmSync(path.join(permitDirs.publicMarketIntelPermits, "chunks"), { recursive: true, force: true });
  fs.mkdirSync(path.join(permitDirs.publicMarketIntelPermits, "chunks"), { recursive: true });
  const chunks = new Map();
  for (const permit of permits) {
    const key = chunkKey(permit);
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(permit);
  }
  const manifestChunks = [];
  for (const [id, records] of chunks) {
    const file = `chunks/${id}.json`;
    const bounds = records.reduce(
      (acc, permit) => {
        const bounds = permitBounds(permit);
        if (!bounds) return acc;
        return {
          minLng: Math.min(acc.minLng, bounds.minLng),
          minLat: Math.min(acc.minLat, bounds.minLat),
          maxLng: Math.max(acc.maxLng, bounds.maxLng),
          maxLat: Math.max(acc.maxLat, bounds.maxLat),
        };
      },
      { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity },
    );
    writeJson(path.join(permitDirs.publicMarketIntelPermits, file), {
      chunkId: id,
      permits: records.map(permitPublicRecord),
    });
    manifestChunks.push({
      id,
      file,
      count: records.length,
      bounds: Number.isFinite(bounds.minLng) ? bounds : null,
    });
  }

  writeJson(path.join(permitDirs.publicMarketIntelPermits, "search-index.json"), {
    generatedAt: new Date().toISOString(),
    count: searchIndex.length,
    permits: searchIndex,
  });
  const marketCounts = permits.reduce((counts, permit) => {
    const market = permit.market || permit.city || "Unknown";
    counts[market] = (counts[market] || 0) + 1;
    return counts;
  }, {});
  const locatedMarketCounts = located.reduce((counts, permit) => {
    const market = permit.market || permit.city || "Unknown";
    counts[market] = (counts[market] || 0) + 1;
    return counts;
  }, {});
  const manifest = {
    generatedAt: new Date().toISOString(),
    sources: [...permitSources, ...louisvillePermitSources],
    permitCount: permits.length,
    locatedPermitCount: located.length,
    marketCounts,
    locatedMarketCounts,
    dallasJoinedPermitCount: dallasPayload.totalPermitsJoinedToParcels,
    dallasUnmatchedPermitCount: dallasPayload.totalPermitsUnmatched,
    louisvillePermitCount: louisvillePermits.length,
    chunkCount: manifestChunks.length,
    chunks: manifestChunks,
    searchIndex: "search-index.json",
    searchIndexCount: searchIndex.length,
  };
  writeJson(path.join(permitDirs.publicMarketIntelPermits, "manifest.json"), manifest);
  writeJson(path.join(permitDirs.output, "white-rabbit-market-permit-intel.json"), {
    ...manifest,
    permits: permits.map(permitPublicRecord),
  });
  return manifest;
}

function buildPermitOutput() {
  ensureDirs();
  const joinedPayload = readJson(path.join(permitDirs.processed, "dallas-permits-joined.json"));
  const rawSourceManifestFile = path.join(permitDirs.raw, "source-manifest.json");
  const rawSourceManifest = fs.existsSync(rawSourceManifestFile) ? readJson(rawSourceManifestFile) : { generatedAt: "", sources: [] };
  const permits = joinedPayload.permits;
  const located = permits.filter((permit) => permit.latitude !== null && permit.longitude !== null);
  const features = located.map(permitPointFeature).filter(Boolean);
  writeJson(path.join(permitDirs.output, "white-rabbit-dallas-permits.geojson"), {
    type: "FeatureCollection",
    metadata: {
      generatedAt: new Date().toISOString(),
      sources: permitSources,
      permitCount: permits.length,
      locatedPermitCount: located.length,
    },
    features,
  });
  writeJson(path.join(permitDirs.output, "white-rabbit-dallas-parcel-permit-join.geojson"), {
    type: "FeatureCollection",
    metadata: {
      generatedAt: new Date().toISOString(),
      joinedPermitCount: joinedPayload.totalPermitsJoinedToParcels,
      joinMethodCounts: joinedPayload.joinMethodCounts,
    },
    features: features.filter((feature) => feature.properties.parcelAccountNum),
  });
  const searchIndex = permits.map((permit) => ({
    permitRecordId: permit.permitRecordId,
    sourceDataset: permit.sourceDataset,
    permitNumber: permit.permitNumber,
    permitType: permit.permitType,
    permitStatus: permit.permitStatus,
    address: permit.address,
    parcelAccountNum: permit.parcelAccountNum || "",
    parcelGisId: permit.parcelGisId || "",
    issueDate: permit.issueDate,
    searchText: permitSearchText(permit),
    chunkId: chunkKey(permit),
  }));
  writeJson(path.join(permitDirs.output, "white-rabbit-dallas-permit-index.json"), {
    generatedAt: new Date().toISOString(),
    count: searchIndex.length,
    permits: searchIndex,
  });

  const chunks = new Map();
  for (const permit of permits) {
    const key = chunkKey(permit);
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(permit);
  }
  fs.rmSync(path.join(permitDirs.publicPermits, "chunks"), { recursive: true, force: true });
  fs.mkdirSync(path.join(permitDirs.publicPermits, "chunks"), { recursive: true });
  const manifestChunks = [];
  for (const [id, records] of chunks) {
    const file = `chunks/${id}.json`;
    const bounds = records.reduce(
      (acc, permit) => {
        const bounds = permitBounds(permit);
        if (!bounds) return acc;
        return {
          minLng: Math.min(acc.minLng, bounds.minLng),
          minLat: Math.min(acc.minLat, bounds.minLat),
          maxLng: Math.max(acc.maxLng, bounds.maxLng),
          maxLat: Math.max(acc.maxLat, bounds.maxLat),
        };
      },
      { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity },
    );
    writeJson(path.join(permitDirs.publicPermits, file), {
      chunkId: id,
      permits: records.map(({ raw, parcel, ...permit }) => permit),
    });
    manifestChunks.push({
      id,
      file,
      count: records.length,
      bounds: Number.isFinite(bounds.minLng) ? bounds : null,
    });
  }
  writeJson(path.join(permitDirs.publicPermits, "search-index.json"), {
    generatedAt: new Date().toISOString(),
    count: searchIndex.length,
    permits: searchIndex,
  });
  const manifest = {
    generatedAt: new Date().toISOString(),
    sources: permitSources,
    sourceSnapshot: {
      fetchedAt: rawSourceManifest.generatedAt || "",
      sources: (rawSourceManifest.sources || []).map((source) => ({
        id: source.id,
        rowCount: source.rowCount,
        fetchedRows: source.fetchedRows,
        sourceUpdatedAt: source.sourceUpdatedAt || "",
      })),
    },
    permitCount: permits.length,
    locatedPermitCount: located.length,
    joinedPermitCount: joinedPayload.totalPermitsJoinedToParcels,
    unmatchedPermitCount: joinedPayload.totalPermitsUnmatched,
    joinMethodCounts: joinedPayload.joinMethodCounts,
    chunkCount: manifestChunks.length,
    chunks: manifestChunks,
    searchIndex: "search-index.json",
    searchIndexCount: searchIndex.length,
  };
  writeJson(path.join(permitDirs.publicPermits, "manifest.json"), manifest);
  return manifest;
}

module.exports = {
  permitDirs,
  permitSources,
  louisvillePermitSources,
  fetchDallasPermits,
  fetchLouisvillePermits,
  fetchMarketPermitIntel,
  inspectDallasPermits,
  normalizeDallasPermits,
  normalizeLouisvillePermits,
  joinPermitsToParcels,
  buildPermitOutput,
  buildMarketPermitIntelOutput,
  normalizeAddress,
};

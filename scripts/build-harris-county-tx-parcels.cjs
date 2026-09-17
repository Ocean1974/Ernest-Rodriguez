const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const adapterPath = path.join(root, "data", "county-adapters", "harris-county-tx", "adapter.json");
const sourceManifestPath = path.join(root, "data", "county-adapters", "harris-county-tx", "harris-county-parcel-source-manifest.json");
const fieldMapPath = path.join(root, "data", "county-adapters", "harris-county-tx", "harris-universal-field-map.json");
const outputDir = path.join(root, "output", "harris-county-tx");

const adapter = readJson(adapterPath);
const sourceManifest = readJson(sourceManifestPath);
const fieldMap = readJson(fieldMapPath);

const args = new Set(process.argv.slice(2));
const sampleArg = process.argv.find((arg) => arg.startsWith("--sample=") || arg.startsWith("--limit="));
const sampleLimit = sampleArg ? Number(sampleArg.split("=")[1]) : args.has("--owner-appraisal") ? 25 : null;
const qaOnly = args.has("--qa-only");
const fullBuild = args.has("--full");
const ownerAppraisal = args.has("--owner-appraisal");

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

function compact(value) {
  return String(value ?? "").trim();
}

function firstNonEmpty(...values) {
  return values.map(compact).find(Boolean) || "";
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sourceFieldNames() {
  return Array.from(new Set([...(sourceManifest.schema_fields || []), ...(sourceManifest.query?.out_fields || [])]));
}

function arcgisQueryUrl(params) {
  const url = new URL(`${sourceManifest.arcgis_rest_url}/query`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  });
  return url.toString();
}

async function requestJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`Harris County request failed ${response.status}: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Harris County response was not JSON: ${text.slice(0, 500)}`);
  }
}

async function fetchCount(where = "1=1") {
  const payload = await requestJson(
    arcgisQueryUrl({
      where,
      returnCountOnly: "true",
      f: "json",
    }),
  );
  return Number(payload.count || 0);
}

async function fetchGeoJsonSample(limit) {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const payload = await requestJson(
    arcgisQueryUrl({
      where: sourceManifest.query.primary_where,
      outFields: sourceManifest.query.out_fields.join(","),
      returnGeometry: "true",
      outSR: String(sourceManifest.query.geometry_out_sr),
      orderByFields: sourceManifest.query.order_by || "OBJECTID",
      resultRecordCount: String(limit),
      f: "geojson",
    }),
  );
  return Array.isArray(payload.features) ? payload.features : [];
}

function flattenRings(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  if (geometry.type === "Polygon") return geometry.coordinates.filter(Array.isArray);
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flatMap((polygon) => (Array.isArray(polygon) ? polygon : []));
  return [];
}

function ringArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function ringCentroid(ring) {
  const area = ringArea(ring);
  if (!Number.isFinite(area) || Math.abs(area) < 1e-12) return null;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  return [cx / (6 * area), cy / (6 * area)];
}

function boundsCentroid(ring) {
  const bounds = ring.reduce(
    (acc, point) => {
      const [lng, lat] = Array.isArray(point) ? point : [NaN, NaN];
      return {
        minLng: Math.min(acc.minLng, lng),
        minLat: Math.min(acc.minLat, lat),
        maxLng: Math.max(acc.maxLng, lng),
        maxLat: Math.max(acc.maxLat, lat),
      };
    },
    { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity },
  );
  if (!Number.isFinite(bounds.minLng) || !Number.isFinite(bounds.minLat)) return null;
  return [(bounds.minLng + bounds.maxLng) / 2, (bounds.minLat + bounds.maxLat) / 2];
}

function geometryCentroid(geometry) {
  const rings = flattenRings(geometry).filter((ring) => Array.isArray(ring) && ring.length >= 4);
  if (!rings.length) return null;
  const largestRing = [...rings].sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
  return ringCentroid(largestRing) || boundsCentroid(largestRing);
}

function largestRing(geometry) {
  const rings = flattenRings(geometry).filter((ring) => Array.isArray(ring) && ring.length >= 4);
  if (!rings.length) return [];
  return [...rings].sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
}

function simplifyRing(ring, maxPoints = 48) {
  if (!Array.isArray(ring) || ring.length <= maxPoints) return ring || [];
  const step = Math.ceil(ring.length / maxPoints);
  const simplified = ring.filter((_, index) => index % step === 0);
  const last = ring[ring.length - 1];
  if (simplified.length && last && simplified[simplified.length - 1] !== last) simplified.push(last);
  return simplified;
}

function toScreenPoint([lng, lat]) {
  const bounds = adapter.map.geoBounds;
  const x = ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100;
  const y = (1 - (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 100;
  return [Number(Math.min(100, Math.max(0, x)).toFixed(4)), Number(Math.min(100, Math.max(0, y)).toFixed(4))];
}

function roundLngLat(point) {
  return Array.isArray(point) ? point.map((value) => Number(Number(value).toFixed(7))) : point;
}

function siteAddress(properties) {
  return [
    properties.site_str_pfx,
    properties.site_str_num,
    properties.site_str_num_sfx,
    properties.site_str_name,
    properties.site_str_sfx,
    properties.site_str_sfx_dir,
  ]
    .map(compact)
    .filter(Boolean)
    .join(" ");
}

function legalDescription(properties) {
  return [properties.legal_dscr_1, properties.legal_dscr_2, properties.legal_dscr_3, properties.legal_dscr_4]
    .map(compact)
    .filter(Boolean)
    .join(" ");
}

function mapFeatureToUniversal(feature) {
  const properties = feature.properties || feature.attributes || {};
  const geometry = feature.geometry || null;
  const centroidLngLat = geometryCentroid(geometry) || adapter.map.coordinates;
  const ring = simplifyRing(largestRing(geometry)).filter((point) => Array.isArray(point) && point.length >= 2);
  const hcadNum = compact(properties.HCAD_NUM);
  const accountNum = firstNonEmpty(properties.acct_num, hcadNum);
  const globalId = firstNonEmpty(properties.GlobalID, properties.OBJECTID);
  const sourceParcelId = firstNonEmpty(hcadNum, properties.LOWPARCELID, accountNum);
  const countyParcelId = `${adapter.id}:${globalId || accountNum || sourceParcelId}`;
  const address = firstNonEmpty(siteAddress(properties), properties.LOWPARCELID);
  const landAreaSqFt = firstNonEmpty(properties.land_sqft, properties.Shape__Area);
  const areaLabel = [
    compact(properties.land_sqft) ? `${compact(properties.land_sqft)} land sq ft` : "",
    compact(properties.acreage_1) ? `${compact(properties.acreage_1)} acres` : "",
  ]
    .filter(Boolean)
    .join(" / ");

  return {
    schemaVersion: "wr-universal-parcel-v1",
    sourceCountyId: adapter.id,
    countyParcelId,
    sourceParcelId,
    accountNum,
    accountNumber: accountNum,
    gisParcelId: globalId,
    address,
    propertyAddress: address,
    city: compact(properties.site_city),
    propertyZip: compact(properties.site_zip),
    propertyName: `HCAD Parcel ${sourceParcelId || accountNum}`,
    ownerName: compact(properties.owner_name_1),
    ownerName2: [properties.owner_name_2, properties.owner_name_3].map(compact).filter(Boolean).join(" "),
    businessName: "",
    ownerMailingAddress: compact(properties.mail_addr_1),
    ownerMailingAddress2: compact(properties.mail_addr_2),
    ownerCity: compact(properties.mail_city),
    ownerState: compact(properties.mail_state),
    ownerZip: compact(properties.mail_zip),
    ownerPhone: "",
    ownerEmail: "",
    landValue: compact(properties.land_value),
    improvementValue: firstNonEmpty(properties.impr_value, properties.bld_value),
    totalValue: firstNonEmpty(properties.total_appraised_val, properties.total_market_val, properties.tax_value),
    landUseCode: compact(properties.land_use),
    landUseDescription: compact(properties.dscr),
    landAreaSize: firstNonEmpty(properties.acreage_1, properties.Acreage),
    landAreaUnit: "acres",
    landAreaSqFt,
    areaLabel,
    perimeter: compact(properties.Shape__Length),
    blockId: [properties.BLK_NUM ? `BLK ${compact(properties.BLK_NUM)}` : "", properties.LOT_NUM ? `LOT ${compact(properties.LOT_NUM)}` : "", properties.map_facet ? `MAP ${compact(properties.map_facet)}` : ""]
      .filter(Boolean)
      .join(" "),
    dimensions: {
      perimeterFt: compact(properties.Shape__Length),
      areaSqFt: landAreaSqFt,
      acreage: firstNonEmpty(properties.acreage_1, properties.Acreage),
      dimensionLabel: areaLabel,
      sourceLayer: "Harris County parcel/property FeatureServer",
      frontageFt: "",
      depthFt: "",
    },
    centroid: toScreenPoint(centroidLngLat),
    points: ring.map(toScreenPoint),
    liveGeometry: {
      center: roundLngLat(centroidLngLat),
      points: ring.map(roundLngLat),
    },
    realGeometry: {
      type: "Feature",
      properties: {
        countyParcelId,
        accountNum,
        sourceParcelId,
        gisParcelId: globalId,
      },
      geometry,
    },
    joins: {
      accountInfo: Boolean(accountNum),
      hcadOwnerAppraisal: true,
      appraisal: Boolean(properties.land_value || properties.impr_value || properties.total_appraised_val || properties.total_market_val),
      land: Boolean(properties.land_sqft || properties.land_use || properties.acreage_1 || properties.Acreage),
      parcelDimension: Boolean(properties.Shape__Area || properties.Shape__Length || properties.land_sqft),
      permits: false,
      zoning: false,
      floodplain: false,
      developmentSignals: false,
      migrationDemand: false,
    },
    sourceReferences: {
      harris: {
        OBJECTID: properties.OBJECTID ?? "",
        LOWPARCELID: properties.LOWPARCELID ?? "",
        HCAD_NUM: properties.HCAD_NUM ?? "",
        acct_num: properties.acct_num ?? "",
        GlobalID: properties.GlobalID ?? "",
        tax_year: properties.tax_year ?? "",
        state_class: properties.state_class ?? "",
        legalDescription: legalDescription(properties),
        Shape__Area: properties.Shape__Area ?? "",
        Shape__Length: properties.Shape__Length ?? "",
        sourceSpatialReference: sourceManifest.source_spatial_reference.label,
      },
    },
  };
}

function geoJsonFeatureForRecord(record) {
  const { realGeometry, ...properties } = record;
  return {
    type: "Feature",
    properties,
    geometry: realGeometry.geometry,
  };
}

function searchRecordFor(record) {
  return {
    countyParcelId: record.countyParcelId,
    sourceCountyId: record.sourceCountyId,
    accountNum: record.accountNum,
    accountNumber: record.accountNumber,
    sourceParcelId: record.sourceParcelId,
    hcadNum: record.sourceParcelId,
    gisParcelId: record.gisParcelId,
    ownerName: record.ownerName,
    address: record.address,
    city: record.city,
    propertyZip: record.propertyZip,
    searchText: [record.accountNum, record.sourceParcelId, record.gisParcelId, record.countyParcelId, record.address, record.ownerName]
      .filter(Boolean)
      .join(" "),
    centroid: record.centroid,
    liveCenter: record.liveGeometry.center,
  };
}

function duplicateSummary(records, field) {
  const counts = new Map();
  let missing = 0;
  for (const record of records) {
    const value = compact(record[field]);
    if (!value) {
      missing += 1;
      continue;
    }
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const duplicateGroups = [...counts.entries()].filter(([, count]) => count > 1);
  return {
    field,
    uniqueCount: counts.size,
    missing,
    duplicateGroupCount: duplicateGroups.length,
    duplicateFeatureCount: duplicateGroups.reduce((sum, [, count]) => sum + count, 0),
    sampleDuplicateGroups: duplicateGroups.slice(0, 25).map(([value, count]) => ({ value, count })),
  };
}

function writeSchemaReport(liveCount, sampleRecords, generatedAt) {
  const schemaFields = sourceFieldNames();
  const mappedSourceFields = Array.from(
    new Set(
      Object.values(fieldMap.field_map || {})
        .map((mapping) => mapping?.sourceField)
        .filter(Boolean),
    ),
  );
  const requiredUniversalFields = [
    "sourceCountyId",
    "countyParcelId",
    "sourceParcelId",
    "accountNum",
    "gisParcelId",
    "address",
    "ownerName",
    "landValue",
    "improvementValue",
    "totalValue",
    "landAreaSqFt",
    "centroid",
    "realGeometry",
  ];
  const report = {
    generatedAt,
    county_id: adapter.id,
    county_name: adapter.countyName,
    market_name: adapter.marketName,
    cad_name: adapter.appraisalDistrictName,
    source: sourceManifest.gis_source,
    source_url: sourceManifest.arcgis_rest_url,
    service_owner: sourceManifest.service_owner,
    layer_id: sourceManifest.layer_id,
    layer_name: sourceManifest.layer_name,
    geometry_type: sourceManifest.geometry_type,
    source_spatial_reference: sourceManifest.source_spatial_reference,
    verified_counts: sourceManifest.verified_counts,
    live_count_check: liveCount,
    universal_schema_version: fieldMap.schema_version,
    unique_gis_key: sourceManifest.unique_gis_key,
    parcel_id_field: sourceManifest.parcel_id_field,
    account_id_field: sourceManifest.account_id_field,
    mapped_source_fields: mappedSourceFields,
    required_universal_fields: requiredUniversalFields,
    schema_fields: schemaFields,
    sample_record_count: sampleRecords.length,
    privacy_notes: [
      "The verified Harris parcel/property layer does not expose official owner phone or email fields.",
      "Do not infer owner phone/email from permits, contractors, applicants, or scraped sources.",
    ],
  };
  writeJson(path.join(outputDir, "schema-report.json"), report);
  const fieldLines = schemaFields.map((field) => `| \`${field}\` | ${mappedSourceFields.includes(field) ? "mapped" : "available"} |`);
  writeText(
    path.join(outputDir, "schema-report.md"),
    [
      "# Harris County TX / HCAD Schema Report",
      "",
      `Generated: ${generatedAt}`,
      "",
      "## Source",
      "",
      `- Source: ${report.source}`,
      `- URL: ${report.source_url}`,
      `- Service owner: ${report.service_owner}`,
      `- Layer: ${report.layer_id} / ${report.layer_name}`,
      `- Geometry: ${report.geometry_type}`,
      `- Spatial reference: ${sourceManifest.source_spatial_reference.label}`,
      "",
      "## Verified Counts",
      "",
      `- All layer features: ${sourceManifest.verified_counts.all_layer_features.toLocaleString()}`,
      `- Live count check: ${liveCount === null ? "not checked" : liveCount.toLocaleString()}`,
      `- Missing geometry: ${sourceManifest.verified_counts.missing_geometry}`,
      `- Distinct HCAD_NUM values: ${sourceManifest.verified_counts.hcad_num_distinct_values.toLocaleString()}`,
      `- Missing HCAD_NUM: ${sourceManifest.verified_counts.hcad_num_missing}`,
      `- Distinct acct_num values: ${sourceManifest.verified_counts.acct_num_distinct_values.toLocaleString()}`,
      `- Missing acct_num: ${sourceManifest.verified_counts.acct_num_missing.toLocaleString()}`,
      `- Distinct GlobalID values: ${sourceManifest.verified_counts.globalid_distinct_values.toLocaleString()}`,
      `- Missing GlobalID: ${sourceManifest.verified_counts.globalid_missing}`,
      "",
      "## White Rabbit Field Contract",
      "",
      `- Unique GIS key: \`${sourceManifest.unique_gis_key}\``,
      `- Parcel ID field: \`${sourceManifest.parcel_id_field}\``,
      `- Account ID field: \`${sourceManifest.account_id_field}\``,
      `- Sample parcel records generated: ${sampleRecords.length}`,
      "",
      "## Fields",
      "",
      "| Field | Status |",
      "| --- | --- |",
      ...fieldLines,
      "",
      "## Build Notes",
      "",
      "- Use `HCAD_NUM` and `acct_num` as the parcel/account join foundation.",
      "- Use `GlobalID` as the unique GIS feature key.",
      "- Owner, mailing, situs, land, building, value, legal, area, and perimeter fields are present in the parcel/property layer.",
      "- Owner phone and owner email remain blank unless an official owner/appraisal source exposes those fields.",
      "- Keep Harris in pilot until full viewport chunks, search shards, parcel QA, zoning/floodplain/permit joins, and production tiles are built.",
      "- No White Rabbit page design is changed by this report.",
      "",
    ].join("\n"),
  );
}

function writeJoinKeyReport(sampleRecords, generatedAt) {
  const report = {
    generatedAt,
    county_id: adapter.id,
    status: "source-verified-sample-built",
    primary_join: "HCAD_NUM/acct_num -> White Rabbit accountNum",
    secondary_join: "GlobalID -> White Rabbit gisParcelId and countyParcelId",
    fallback_join: "LOWPARCELID can help display/search but is not the primary account key.",
    verified_counts: sourceManifest.verified_counts,
    sample_count: sampleRecords.length,
    sample_duplicates: {
      accountNum: duplicateSummary(sampleRecords, "accountNum"),
      sourceParcelId: duplicateSummary(sampleRecords, "sourceParcelId"),
      gisParcelId: duplicateSummary(sampleRecords, "gisParcelId"),
    },
    owner_appraisal_decision:
      "The Harris parcel/property FeatureServer already exposes owner, mailing, situs, legal, land, building, and value fields. HCAD public data downloads remain the preferred full bulk confirmation source before production activation.",
    privacy_decision: "No official owner phone or owner email field was identified. Leave those fields blank.",
  };
  writeJson(path.join(outputDir, "join-key-report.json"), report);
  writeText(
    path.join(outputDir, "join-key-report.md"),
    [
      "# Harris County TX / HCAD Join Key Report",
      "",
      `Generated: ${generatedAt}`,
      "",
      `- Status: ${report.status}`,
      `- Primary join: ${report.primary_join}`,
      `- Secondary join: ${report.secondary_join}`,
      `- Fallback display/search key: ${report.fallback_join}`,
      `- Sample records inspected: ${sampleRecords.length}`,
      "",
      "## Verified Source Counts",
      "",
      `- Parcel features: ${sourceManifest.verified_counts.all_layer_features.toLocaleString()}`,
      `- Missing geometry: ${sourceManifest.verified_counts.missing_geometry}`,
      `- Missing HCAD_NUM: ${sourceManifest.verified_counts.hcad_num_missing}`,
      `- Missing acct_num: ${sourceManifest.verified_counts.acct_num_missing.toLocaleString()}`,
      `- Missing GlobalID: ${sourceManifest.verified_counts.globalid_missing}`,
      `- Distinct GlobalID values: ${sourceManifest.verified_counts.globalid_distinct_values.toLocaleString()}`,
      "",
      "## Decision",
      "",
      report.owner_appraisal_decision,
      "",
      report.privacy_decision,
      "",
    ].join("\n"),
  );
}

function writeSearchOutputs(records, generatedAt) {
  const searchRecords = records.map(searchRecordFor);
  const jsonFile = path.join(outputDir, "harris-county-tx-parcel-search-index.json");
  const csvFile = path.join(outputDir, "harris-county-tx-parcel-search-index.csv");
  writeJson(jsonFile, {
    generatedAt,
    county_id: adapter.id,
    source: sourceManifest.arcgis_rest_url,
    mode: "sample-search-index",
    searchFields: ["HCAD_NUM", "acct_num", "LOWPARCELID", "GlobalID", "owner_name_1", "site address"],
    searchRecordCount: searchRecords.length,
    parcels: searchRecords,
  });
  const headers = ["countyParcelId", "accountNum", "HCAD_NUM", "GlobalID", "address", "ownerName", "searchText", "centroidX", "centroidY"];
  const lines = [
    headers.join(","),
    ...searchRecords.map((record) =>
      [
        record.countyParcelId,
        record.accountNum,
        record.sourceParcelId,
        record.gisParcelId,
        record.address,
        record.ownerName,
        record.searchText,
        record.centroid?.[0] ?? "",
        record.centroid?.[1] ?? "",
      ]
        .map(csvEscape)
        .join(","),
    ),
  ];
  writeText(csvFile, `${lines.join("\n")}\n`);
  return { jsonFile, csvFile, searchRecordCount: searchRecords.length };
}

function writeOwnerAppraisalIndex(records, generatedAt) {
  const indexRecords = records.map((record) => ({
    countyParcelId: record.countyParcelId,
    accountNum: record.accountNum,
    accountNumber: record.accountNumber,
    sourceParcelId: record.sourceParcelId,
    gisParcelId: record.gisParcelId,
    address: record.address,
    ownerName: record.ownerName,
    ownerName2: record.ownerName2,
    ownerMailingAddress: record.ownerMailingAddress,
    ownerMailingAddress2: record.ownerMailingAddress2,
    ownerCity: record.ownerCity,
    ownerState: record.ownerState,
    ownerZip: record.ownerZip,
    ownerPhone: "",
    ownerEmail: "",
    landValue: record.landValue,
    improvementValue: record.improvementValue,
    totalValue: record.totalValue,
    landUseCode: record.landUseCode,
    landUseDescription: record.landUseDescription,
    landAreaSize: record.landAreaSize,
    landAreaUnit: record.landAreaUnit,
    landAreaSqFt: record.landAreaSqFt,
    areaLabel: record.areaLabel,
    perimeter: record.perimeter,
    blockId: record.blockId,
    sourceReferences: record.sourceReferences,
  }));
  writeJson(path.join(outputDir, "harris-county-tx-owner-appraisal-index.json"), {
    generatedAt,
    county_id: adapter.id,
    mode: "sample-owner-appraisal-index",
    source: sourceManifest.arcgis_rest_url,
    primaryJoin: "HCAD_NUM/acct_num",
    secondaryJoin: "GlobalID",
    sourceRecordCount: sourceManifest.verified_counts.all_layer_features,
    indexedRecordCount: indexRecords.length,
    privacyNote: "Owner phone and owner email are blank because no official owner phone/email field was identified.",
    fields: Object.keys(indexRecords[0] || {}),
    records: indexRecords,
  });
}

function writeSampleGeoJson(records, generatedAt) {
  writeJson(path.join(outputDir, "harris-county-tx-parcel-sample.geojson"), {
    type: "FeatureCollection",
    metadata: {
      generatedAt,
      county_id: adapter.id,
      source: sourceManifest.arcgis_rest_url,
      sourceSpatialReference: sourceManifest.source_spatial_reference.label,
      buildMode: "sample",
      recordCount: records.length,
      fullBuildStatus: "not-built-use-viewport-chunks-before-app-activation",
    },
    features: records.map(geoJsonFeatureForRecord),
  });
}

function writeQaReport(liveCount, records, generatedAt, sampleFetchError) {
  const sampleMissingGeometry = records.filter((record) => !record.realGeometry?.geometry).length;
  const sampleMissingHcad = records.filter((record) => !record.sourceParcelId).length;
  const sampleMissingAccount = records.filter((record) => !record.accountNum).length;
  const sampleMissingGlobalId = records.filter((record) => !record.gisParcelId).length;
  const report = {
    generatedAt,
    county_id: adapter.id,
    county_name: adapter.countyName,
    market_name: adapter.marketName,
    cad_name: adapter.appraisalDistrictName,
    status: records.length ? "sample-built-source-verified" : "source-verified-reports-built",
    source_url: sourceManifest.arcgis_rest_url,
    live_count_check: liveCount,
    source_verified_counts: sourceManifest.verified_counts,
    sample: {
      requested: sampleLimit || 0,
      records: records.length,
      missingGeometry: sampleMissingGeometry,
      missingHCAD_NUM: sampleMissingHcad,
      missingAcctNum: sampleMissingAccount,
      missingGlobalID: sampleMissingGlobalId,
      fetchError: sampleFetchError || "",
      duplicates: {
        accountNum: duplicateSummary(records, "accountNum"),
        sourceParcelId: duplicateSummary(records, "sourceParcelId"),
        gisParcelId: duplicateSummary(records, "gisParcelId"),
      },
    },
    outputArtifacts: {
      schemaReportJson: "output/harris-county-tx/schema-report.json",
      schemaReportMd: "output/harris-county-tx/schema-report.md",
      joinKeyReportMd: "output/harris-county-tx/join-key-report.md",
      qaReportJson: "output/harris-county-tx/qa-report.json",
      qaReportMd: "output/harris-county-tx/qa-report.md",
      sampleGeojson: records.length ? "output/harris-county-tx/harris-county-tx-parcel-sample.geojson" : "",
      sampleSearchIndexJson: records.length ? "output/harris-county-tx/harris-county-tx-parcel-search-index.json" : "",
      ownerAppraisalIndex: records.length ? "output/harris-county-tx/harris-county-tx-owner-appraisal-index.json" : "",
    },
    blockingProductionGaps: [
      "Full viewport parcel chunks are not built yet.",
      "Production search shards are not built yet.",
      "PMTiles/vector tiles are not built yet.",
      "Permit/CO source and joins remain source-needed.",
      "Zoning is fragmented by municipality and remains source-needed.",
      "Floodplain source/join remains source-needed.",
      "Migration/demand layer remains aggregate source-needed.",
    ],
    uiConstraint: "Data plumbing only. No page redesign and no visible Harris app activation in this step.",
  };
  writeJson(path.join(outputDir, "qa-report.json"), report);
  writeText(
    path.join(outputDir, "qa-report.md"),
    [
      "# Harris County TX / HCAD QA Report",
      "",
      `Generated: ${generatedAt}`,
      "",
      `- Status: ${report.status}`,
      `- Source URL: ${report.source_url}`,
      `- Live count check: ${liveCount === null ? "not checked" : liveCount.toLocaleString()}`,
      `- Verified source parcel features: ${sourceManifest.verified_counts.all_layer_features.toLocaleString()}`,
      `- Verified missing geometry: ${sourceManifest.verified_counts.missing_geometry}`,
      `- Verified missing HCAD_NUM: ${sourceManifest.verified_counts.hcad_num_missing}`,
      `- Verified missing acct_num: ${sourceManifest.verified_counts.acct_num_missing.toLocaleString()}`,
      `- Verified missing GlobalID: ${sourceManifest.verified_counts.globalid_missing}`,
      "",
      "## Sample QA",
      "",
      `- Requested sample records: ${sampleLimit || 0}`,
      `- Sample records built: ${records.length}`,
      `- Sample missing geometry: ${sampleMissingGeometry}`,
      `- Sample missing HCAD_NUM/source parcel ID: ${sampleMissingHcad}`,
      `- Sample missing account number: ${sampleMissingAccount}`,
      `- Sample missing GlobalID/GIS ID: ${sampleMissingGlobalId}`,
      sampleFetchError ? `- Sample fetch error: ${sampleFetchError}` : "",
      "",
      "## Production Gaps",
      "",
      ...report.blockingProductionGaps.map((gap) => `- ${gap}`),
      "",
      "No White Rabbit pages were redesigned by this QA step.",
      "",
    ]
      .filter((line) => line !== "")
      .join("\n"),
  );
}

function writeFullParcelAccessReport(records, generatedAt) {
  writeText(
    path.join(outputDir, "full-parcel-access-report.md"),
    [
      "# Harris County TX / Houston Parcel Access Report",
      "",
      `Generated: ${generatedAt}`,
      "",
      "## Status",
      "",
      `- County ID: \`${adapter.id}\``,
      `- Market: ${adapter.marketName}`,
      `- CAD: ${adapter.appraisalDistrictName}`,
      `- GIS source: ${sourceManifest.gis_source}`,
      `- Source URL: ${sourceManifest.arcgis_rest_url}`,
      "- Status: pilot source verified; DCAD-like parcel-window data contract is now report-backed and sample-backed, but not promoted as an active production county",
      "",
      "## Available Foundation",
      "",
      "- Parcel boundary polygons: available from the official FeatureServer",
      "- Owner, mailing, address, value, land, legal, area, perimeter fields: available from the parcel/property layer",
      `- Unique GIS feature key: \`${sourceManifest.unique_gis_key}\``,
      `- Parcel ID field: \`${sourceManifest.parcel_id_field}\``,
      `- Account ID field: \`${sourceManifest.account_id_field}\``,
      `- Source spatial reference: ${sourceManifest.source_spatial_reference.label}`,
      "",
      "## Counts",
      "",
      `- All Harris parcel-layer features: ${sourceManifest.verified_counts.all_layer_features.toLocaleString()}`,
      `- Missing geometry: ${sourceManifest.verified_counts.missing_geometry}`,
      `- Missing HCAD_NUM: ${sourceManifest.verified_counts.hcad_num_missing}`,
      `- Missing acct_num: ${sourceManifest.verified_counts.acct_num_missing.toLocaleString()}`,
      `- Missing GlobalID: ${sourceManifest.verified_counts.globalid_missing}`,
      `- Sample records generated: ${records.length}`,
      "",
      "## Owner/Appraisal Contract",
      "",
      "Harris can fill more of the parcel intelligence window than Jefferson currently can because owner, mailing, situs, value, land, legal, area, and perimeter fields are exposed in the verified parcel/property layer. Owner phone and owner email remain blank because no official owner phone/email field was identified.",
      "",
      "Configured joins:",
      "",
      "- Primary: `HCAD_NUM/acct_num -> White Rabbit accountNum`",
      "- Secondary: `GlobalID -> White Rabbit gisParcelId`",
      "- Search: `HCAD_NUM`, `acct_num`, `LOWPARCELID`, `GlobalID`, owner name, and situs address",
      "",
      "## Output Contract",
      "",
      "- Schema report: `output/harris-county-tx/schema-report.md`",
      "- Join-key report: `output/harris-county-tx/join-key-report.md`",
      "- QA report: `output/harris-county-tx/qa-report.md`",
      "- Sample universal parcel GeoJSON: `output/harris-county-tx/harris-county-tx-parcel-sample.geojson`",
      "- Sample search index: `output/harris-county-tx/harris-county-tx-parcel-search-index.json`",
      "- Sample owner/appraisal index: `output/harris-county-tx/harris-county-tx-owner-appraisal-index.json`",
      "",
      "## Not Built Yet",
      "",
      "- Full production parcel GeoJSON remains intentionally blocked until viewport chunks/search shards are built.",
      "- Production PMTiles/vector tiles are not built yet.",
      "- Permits/CO, zoning/overlays, floodplain, development signals, and migration/demand joins remain source-needed.",
      "",
      "No White Rabbit page design changed in this step.",
      "",
    ].join("\n"),
  );
}

async function main() {
  if (adapter.id !== "harris-county-tx") throw new Error("Harris adapter must use county_id harris-county-tx");
  if (fullBuild) {
    throw new Error("Harris full build is intentionally blocked for now. Build viewport chunks/search shards before exporting 1.5M parcels for app activation.");
  }
  ensureDir(outputDir);
  console.log("Building Harris County TX / HCAD parcel plumbing...");
  const generatedAt = new Date().toISOString();
  let liveCount = null;
  try {
    liveCount = await fetchCount(sourceManifest.query.primary_where);
  } catch (error) {
    console.warn(`Live count check skipped: ${error.message}`);
  }

  let sampleFetchError = "";
  let features = [];
  if (!qaOnly && (sampleLimit || ownerAppraisal)) {
    try {
      features = await fetchGeoJsonSample(sampleLimit || 25);
    } catch (error) {
      sampleFetchError = error.message;
      console.warn(`Sample fetch skipped: ${sampleFetchError}`);
    }
  }
  const records = features.map(mapFeatureToUniversal).filter(Boolean);

  writeSchemaReport(liveCount, records, generatedAt);
  writeJoinKeyReport(records, generatedAt);
  writeQaReport(liveCount, records, generatedAt, sampleFetchError);
  writeFullParcelAccessReport(records, generatedAt);
  if (records.length) {
    writeSampleGeoJson(records, generatedAt);
    writeSearchOutputs(records, generatedAt);
    writeOwnerAppraisalIndex(records, generatedAt);
  }

  console.log("Wrote output/harris-county-tx/schema-report.json");
  console.log("Wrote output/harris-county-tx/schema-report.md");
  console.log("Wrote output/harris-county-tx/join-key-report.md");
  console.log("Wrote output/harris-county-tx/qa-report.json");
  console.log("Wrote output/harris-county-tx/qa-report.md");
  console.log("Wrote output/harris-county-tx/full-parcel-access-report.md");
  if (records.length) {
    console.log("Wrote output/harris-county-tx/harris-county-tx-parcel-sample.geojson");
    console.log("Wrote output/harris-county-tx/harris-county-tx-parcel-search-index.json");
    console.log("Wrote output/harris-county-tx/harris-county-tx-owner-appraisal-index.json");
  }
  console.log(JSON.stringify({ liveCount, sampleRecords: records.length, qaOnly }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const adapterPath = path.join(root, "data", "county-adapters", "maricopa-county-az", "adapter.json");
const sourceManifestPath = path.join(root, "data", "county-adapters", "maricopa-county-az", "maricopa-county-parcel-source-manifest.json");
const fieldMapPath = path.join(root, "data", "county-adapters", "maricopa-county-az", "maricopa-universal-field-map.json");
const outputDir = path.join(root, "output", "maricopa-county-az");

const adapter = readJson(adapterPath);
const sourceManifest = readJson(sourceManifestPath);
const fieldMap = readJson(fieldMapPath);

const args = new Set(process.argv.slice(2));
const sampleArg = process.argv.find((arg) => arg.startsWith("--sample=") || arg.startsWith("--limit="));
const sampleLimit = sampleArg ? Number(sampleArg.split("=")[1]) : args.has("--qa-only") ? 0 : 25;
const qaOnly = args.has("--qa-only");
const fullBuild = args.has("--full");

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
  if (!response.ok) throw new Error(`Maricopa request failed ${response.status}: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Maricopa response was not JSON: ${text.slice(0, 500)}`);
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
  const largest = [...rings].sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
  return ringCentroid(largest) || boundsCentroid(largest);
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

function physicalAddress(properties) {
  return firstNonEmpty(
    properties.PHYSICAL_ADDRESS,
    [
      properties.PHYSICAL_STREET_NUM,
      properties.PHYSICAL_STREET_DIR,
      properties.PHYSICAL_STREET_NAME,
      properties.PHYSICAL_STREET_TYPE,
      properties.PHYSICAL_STREET_POSTDIR,
      properties.PHYSICAL_SUITE,
      properties.PHYSICAL_CITY,
      properties.PHYSICAL_ZIP,
    ]
      .map(compact)
      .filter(Boolean)
      .join(" "),
  );
}

function legalLabel(properties) {
  return [properties.SUBNAME, properties.LOT_NUM ? `Lot ${compact(properties.LOT_NUM)}` : "", properties.BLOCK ? `Block ${compact(properties.BLOCK)}` : "", properties.TRACT ? `Tract ${compact(properties.TRACT)}` : "", properties.STR ? `STR ${compact(properties.STR)}` : ""]
    .filter(Boolean)
    .join(" / ");
}

function mapFeatureToUniversal(feature) {
  const properties = feature.properties || feature.attributes || {};
  const geometry = feature.geometry || null;
  const apn = compact(properties.APN);
  const objectId = compact(properties.OBJECTID);
  const centroidLngLat = geometryCentroid(geometry) || [Number(properties.LONGITUDE) || adapter.map.coordinates[0], Number(properties.LATITUDE) || adapter.map.coordinates[1]];
  const ring = simplifyRing(largestRing(geometry)).filter((point) => Array.isArray(point) && point.length >= 2);
  const address = physicalAddress(properties);
  const displayParcelId = firstNonEmpty(properties.APN_DASH, apn);
  const countyParcelId = `${adapter.id}:${apn || objectId}`;
  const areaLabel = [
    compact(properties.LAND_SIZE) ? `${compact(properties.LAND_SIZE)} land sq ft` : "",
    compact(properties.Shape__Area) ? `${compact(properties.Shape__Area)} source area` : "",
  ]
    .filter(Boolean)
    .join(" / ");

  return {
    schemaVersion: "wr-universal-parcel-v1",
    sourceCountyId: adapter.id,
    countyParcelId,
    sourceParcelId: apn,
    accountNum: apn,
    accountNumber: apn,
    gisParcelId: objectId,
    displayParcelId,
    address,
    propertyAddress: address,
    city: compact(properties.PHYSICAL_CITY),
    propertyZip: compact(properties.PHYSICAL_ZIP),
    propertyName: displayParcelId ? `Maricopa Parcel ${displayParcelId}` : "Maricopa Parcel",
    ownerName: compact(properties.OWNER_NAME),
    ownerName2: "",
    businessName: "",
    ownerMailingAddress: firstNonEmpty(properties.MAIL_ADDRESS, properties.MAIL_ADDR1),
    ownerMailingAddress2: compact(properties.MAIL_ADDR2),
    ownerCity: compact(properties.MAIL_CITY),
    ownerState: compact(properties.MAIL_STATE),
    ownerZip: compact(properties.MAIL_ZIP),
    ownerCountry: compact(properties.MAIL_CNTRY),
    ownerPhone: "",
    ownerEmail: "",
    zoning: compact(properties.CITY_ZONING),
    landUseCode: compact(properties.PUC),
    landUseDescription: "",
    landSection: compact(properties.STR),
    landAreaSize: compact(properties.LAND_SIZE),
    landAreaUnit: compact(properties.LAND_SIZE) ? "sq ft" : "",
    landAreaSqFt: compact(properties.LAND_SIZE),
    yearBuilt: compact(properties.CONST_YEAR),
    grossBuildingArea: compact(properties.LIVING_SPACE),
    totalValue: compact(properties.FCV_CUR),
    limitedPropertyValue: compact(properties.LPV_CUR),
    previousTotalValue: compact(properties.FCV_PREV),
    cityJurisdiction: compact(properties.JURISDICTION),
    blockId: firstNonEmpty(properties.BLOCK, properties.MCRNUM, [properties.MCR_BOOK, properties.MCR_PAGE].map(compact).filter(Boolean).join("-")),
    areaLabel,
    perimeter: compact(properties.Shape__Length),
    dimensions: {
      dimensionId: apn ? `${apn}:geometry` : "",
      perimeterFt: compact(properties.Shape__Length),
      dimensionLabel: areaLabel,
      sourceLayer: sourceManifest.gis_source,
      notes: "Parcel service exposes source area/perimeter fields; segment-by-segment dimension labels still need ParcelLabel inspection."
    },
    sale: {
      deedNumber: compact(properties.DEED_NUMBER),
      deedDate: compact(properties.DEED_DATE),
      saleDate: compact(properties.SALE_DATE),
      salePrice: compact(properties.SALE_PRICE),
    },
    legal: {
      subdivisionName: compact(properties.SUBNAME),
      mcrNumber: compact(properties.MCRNUM),
      lotNumber: compact(properties.LOT_NUM),
      block: compact(properties.BLOCK),
      tract: compact(properties.TRACT),
      sectionTownshipRange: compact(properties.STR),
      label: legalLabel(properties),
    },
    centroid: toScreenPoint(centroidLngLat),
    points: ring.map(roundLngLat).map(toScreenPoint),
    liveGeometry: {
      center: roundLngLat(centroidLngLat),
      points: ring.map(roundLngLat),
    },
    realGeometry: {
      type: "Feature",
      geometry,
      properties: {
        APN: apn,
        APN_DASH: displayParcelId,
        OBJECTID: objectId,
      },
    },
    joins: {
      accountInfo: Boolean(apn),
      ownerAppraisal: Boolean(apn),
      parcelGeometry: Boolean(geometry),
      zoning: Boolean(properties.CITY_ZONING),
      permits: false,
      floodplain: false,
      migrationDemand: false,
    },
    sourceReferences: {
      countyAdapter: "data/county-adapters/maricopa-county-az/adapter.json",
      sourceManifest: "data/county-adapters/maricopa-county-az/maricopa-county-parcel-source-manifest.json",
      fieldMap: "data/county-adapters/maricopa-county-az/maricopa-universal-field-map.json",
      gisSource: sourceManifest.gis_source,
      arcgisRestUrl: sourceManifest.arcgis_rest_url,
      uniqueGisKey: sourceManifest.unique_gis_key,
      parcelIdField: sourceManifest.parcel_id_field,
      accountIdField: sourceManifest.account_id_field,
    },
    sourceProperties: properties,
  };
}

function writeSampleArtifacts(records, generatedAt) {
  const features = records.map((record) => ({
    type: "Feature",
    geometry: record.realGeometry.geometry,
    properties: record,
  }));
  writeJson(path.join(outputDir, "maricopa-county-az-parcel-sample.geojson"), {
    type: "FeatureCollection",
    generatedAt,
    sourceCountyId: adapter.id,
    sourceVerifiedFeatureCount: sourceManifest.verified_counts.all_layer_features,
    features,
  });
  writeJson(path.join(outputDir, "maricopa-county-az-parcel-search-index.json"), {
    county_id: adapter.id,
    generatedAt,
    searchRecordCount: records.length,
    searchFields: fieldMap.search_index_fields,
    records: records.map((record) => ({
      countyParcelId: record.countyParcelId,
      sourceParcelId: record.sourceParcelId,
      accountNum: record.accountNum,
      displayParcelId: record.displayParcelId,
      ownerName: record.ownerName,
      address: record.address,
      city: record.city,
      jurisdiction: record.cityJurisdiction,
      subdivisionName: record.legal.subdivisionName,
      centroid: record.liveGeometry.center,
    })),
  });
  writeJson(path.join(outputDir, "maricopa-county-az-owner-appraisal-index.json"), {
    county_id: adapter.id,
    generatedAt,
    source: sourceManifest.gis_source,
    officialJoinKey: "APN",
    indexedRecordCount: records.length,
    privacyNote: "Owner phone and owner email are intentionally blank because the official parcel service does not expose those fields.",
    records: records.map((record) => ({
      accountNum: record.accountNum,
      sourceParcelId: record.sourceParcelId,
      displayParcelId: record.displayParcelId,
      ownerName: record.ownerName,
      ownerMailingAddress: record.ownerMailingAddress,
      ownerCity: record.ownerCity,
      ownerState: record.ownerState,
      ownerZip: record.ownerZip,
      address: record.address,
      cityJurisdiction: record.cityJurisdiction,
      zoning: record.zoning,
      landUseCode: record.landUseCode,
      landAreaSqFt: record.landAreaSqFt,
      yearBuilt: record.yearBuilt,
      grossBuildingArea: record.grossBuildingArea,
      totalValue: record.totalValue,
      limitedPropertyValue: record.limitedPropertyValue,
      previousTotalValue: record.previousTotalValue,
      ownerPhone: "",
      ownerEmail: "",
    })),
  });
}

function writeSchemaReport(generatedAt) {
  const mappedFields = Object.values(fieldMap.field_map)
    .map((mapping) => mapping.sourceField)
    .filter(Boolean);
  const report = {
    generatedAt,
    county_id: adapter.id,
    county_name: adapter.countyName,
    status: "official-source-verified-current-service",
    source: sourceManifest.gis_source,
    source_url: sourceManifest.arcgis_rest_url,
    source_lineage: sourceManifest.source_lineage,
    service_owner: sourceManifest.service_owner,
    layer_id: sourceManifest.layer_id,
    layer_name: sourceManifest.layer_name,
    geometry_type: sourceManifest.geometry_type,
    source_spatial_reference: sourceManifest.source_spatial_reference,
    output_spatial_reference: sourceManifest.output_spatial_reference,
    verified_counts: sourceManifest.verified_counts,
    schema_fields: sourceManifest.schema_fields,
    mapped_source_fields: mappedFields,
    required_universal_fields: [
      "schemaVersion",
      "sourceCountyId",
      "countyParcelId",
      "accountNum",
      "accountNumber",
      "gisParcelId",
      "address",
      "ownerName",
      "centroid",
      "points",
      "liveGeometry",
      "realGeometry",
      "joins",
      "sourceReferences",
    ],
    privacy_notes: ["Do not infer owner phone/email. Maricopa official parcel service does not expose owner phone or owner email fields."],
    uiConstraint: "Data plumbing only. No White Rabbit page redesign or visible Maricopa activation.",
  };
  writeJson(path.join(outputDir, "schema-report.json"), report);
  writeText(
    path.join(outputDir, "schema-report.md"),
    [
      "# Maricopa County AZ / Assessor Schema Report",
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
      `- Spatial reference: ${report.source_spatial_reference.label}`,
      "",
      "## Verified Counts",
      "",
      `- Total parcel features: ${report.verified_counts.all_layer_features.toLocaleString()}`,
      `- Missing geometry: ${report.verified_counts.missing_geometry}`,
      `- Missing APN: ${report.verified_counts.apn_missing}`,
      `- Missing APN_DASH: ${report.verified_counts.apn_dash_missing}`,
      `- Distinct APN values: ${report.verified_counts.apn_distinct_values.toLocaleString()}`,
      `- Duplicate APN values: ${report.verified_counts.duplicate_apn}`,
      "",
      "## Source Fields",
      "",
      "| Field | Status |",
      "| --- | --- |",
      ...sourceManifest.schema_fields.map((field) => `| \`${field}\` | ${mappedFields.includes(field) ? "mapped" : "available"} |`),
      "",
      "## Parcel Window Notes",
      "",
      "- APN is the primary parcel/account join key.",
      "- OBJECTID is the FeatureServer GIS object id.",
      "- Owner, mailing, situs, sale/deed, land size, zoning text, jurisdiction, construction year, living space, and value fields are present.",
      "- Owner phone and owner email remain blank unless an official owner/appraisal source exposes those fields.",
      "- No White Rabbit page design is changed by this report.",
      "",
    ].join("\n"),
  );
}

function writeJoinKeyReport(sampleRecords, generatedAt) {
  const report = {
    generatedAt,
    county_id: adapter.id,
    status: "official-source-verified-sample-built",
    primary_join: "APN -> White Rabbit accountNum/sourceParcelId",
    secondary_join: "OBJECTID -> White Rabbit gisParcelId",
    display_join: "APN_DASH -> formatted parcel display/search label",
    verified_counts: sourceManifest.verified_counts,
    sample_records: sampleRecords.map((record) => ({
      countyParcelId: record.countyParcelId,
      sourceParcelId: record.sourceParcelId,
      displayParcelId: record.displayParcelId,
      gisParcelId: record.gisParcelId,
      address: record.address,
      ownerName: record.ownerName,
      totalValue: record.totalValue,
    })),
    owner_appraisal_decision: "The Maricopa Assessor parcel service exposes owner, mailing, situs, sale/deed, land size, zoning text, jurisdiction, construction year, living space, and current/previous value fields on the same APN-keyed parcel layer.",
    privacy_decision: "No official owner phone or owner email field was identified. Leave those fields blank.",
  };
  writeJson(path.join(outputDir, "join-key-report.json"), report);
  writeText(
    path.join(outputDir, "join-key-report.md"),
    [
      "# Maricopa County AZ / Assessor Join Key Report",
      "",
      `Generated: ${generatedAt}`,
      "",
      `- Status: ${report.status}`,
      `- Primary join: ${report.primary_join}`,
      `- Secondary join: ${report.secondary_join}`,
      `- Display/search key: ${report.display_join}`,
      `- Sample records inspected: ${sampleRecords.length}`,
      "",
      "## Verified Counts",
      "",
      ...Object.entries(report.verified_counts).map(([key, value]) => `- ${key}: ${value}`),
      "",
      "## Owner/Appraisal Decision",
      "",
      report.owner_appraisal_decision,
      "",
      "## Privacy Decision",
      "",
      report.privacy_decision,
      "",
    ].join("\n"),
  );
}

function writeQaReport(records, liveCount, liveWarnings, generatedAt) {
  const report = {
    generatedAt,
    county_id: adapter.id,
    status: "pilot-source-verified",
    source_url: sourceManifest.arcgis_rest_url,
    live_count_check: liveCount,
    live_warnings: liveWarnings,
    source_verified_counts: sourceManifest.verified_counts,
    sampleRecordCount: records.length,
    sampleChecks: {
      allSamplesHaveAccountNum: records.every((record) => Boolean(record.accountNum)),
      allSamplesHaveGeometry: records.every((record) => Boolean(record.realGeometry?.geometry)),
      allSamplesKeepOwnerPhoneBlank: records.every((record) => record.ownerPhone === ""),
      allSamplesKeepOwnerEmailBlank: records.every((record) => record.ownerEmail === ""),
    },
    outputArtifacts: {
      schemaReportJson: "output/maricopa-county-az/schema-report.json",
      schemaReportMd: "output/maricopa-county-az/schema-report.md",
      joinKeyReportMd: "output/maricopa-county-az/join-key-report.md",
      qaReportJson: "output/maricopa-county-az/qa-report.json",
      qaReportMd: "output/maricopa-county-az/qa-report.md",
      sampleGeojson: records.length ? "output/maricopa-county-az/maricopa-county-az-parcel-sample.geojson" : "",
      sampleSearchIndexJson: records.length ? "output/maricopa-county-az/maricopa-county-az-parcel-search-index.json" : "",
      ownerAppraisalIndex: records.length ? "output/maricopa-county-az/maricopa-county-az-owner-appraisal-index.json" : "",
    },
    blockingProductionGaps: [
      "Full viewport parcel chunks are not built yet.",
      "Production search shards are not built yet.",
      "PMTiles/vector tiles are not built yet.",
      "Permit/CO source and joins remain source-needed.",
      "Floodplain source/join remains source-needed.",
      "Migration/demand layer remains aggregate source-needed.",
    ],
    uiConstraint: "Data plumbing only. No page redesign and no visible Maricopa app activation in this step.",
  };
  writeJson(path.join(outputDir, "qa-report.json"), report);
  writeText(
    path.join(outputDir, "qa-report.md"),
    [
      "# Maricopa County AZ / Assessor QA Report",
      "",
      `Generated: ${generatedAt}`,
      "",
      `- Status: ${report.status}`,
      `- Source URL: ${report.source_url}`,
      `- Live count check: ${liveCount === null ? "not checked" : liveCount.toLocaleString()}`,
      `- Verified source parcel features: ${sourceManifest.verified_counts.all_layer_features.toLocaleString()}`,
      `- Missing geometry: ${sourceManifest.verified_counts.missing_geometry}`,
      `- Missing APN: ${sourceManifest.verified_counts.apn_missing}`,
      `- Duplicate APN: ${sourceManifest.verified_counts.duplicate_apn}`,
      "",
      "## Sample QA",
      "",
      ...Object.entries(report.sampleChecks).map(([key, value]) => `- ${key}: ${value}`),
      "",
      "## Blocking Production Gaps",
      "",
      ...report.blockingProductionGaps.map((gap) => `- ${gap}`),
      "",
      "## UI Constraint",
      "",
      report.uiConstraint,
      "",
    ].join("\n"),
  );
}

function writeFullParcelAccessReport(records, generatedAt) {
  writeText(
    path.join(outputDir, "full-parcel-access-report.md"),
    [
      "# Maricopa County AZ / Phoenix Parcel Access Report",
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
      `- Parcel polygons: ${sourceManifest.verified_counts.all_layer_features.toLocaleString()}`,
      "- Parcel IDs: `APN`",
      "- Formatted parcel IDs: `APN_DASH`",
      "- GIS object ids: `OBJECTID`",
      "- Owner/value fields: available in the verified parcel service",
      "- Parcel geometry is queried as GeoJSON in EPSG:4326 for White Rabbit samples.",
      "",
      "## Owner/Appraisal Contract",
      "",
      "Maricopa can fill owner, mailing, situs, sale/deed, land size, zoning text, jurisdiction, construction year, living space, and current/previous value fields from the verified Assessor parcel service. Owner phone and owner email remain blank because no official owner phone/email field was identified.",
      "",
      "Configured joins:",
      "",
      "- Primary: `APN -> White Rabbit accountNum/sourceParcelId`",
      "- Secondary: `OBJECTID -> White Rabbit gisParcelId`",
      "- Search: `APN`, `APN_DASH`, owner name, situs address, mailing address, subdivision, and jurisdiction",
      "",
      "## Output Contract",
      "",
      "- Schema report: `output/maricopa-county-az/schema-report.md`",
      "- Join-key report: `output/maricopa-county-az/join-key-report.md`",
      "- QA report: `output/maricopa-county-az/qa-report.md`",
      "- Sample universal parcel GeoJSON: `output/maricopa-county-az/maricopa-county-az-parcel-sample.geojson`",
      "- Sample search index: `output/maricopa-county-az/maricopa-county-az-parcel-search-index.json`",
      "- Sample owner/appraisal index: `output/maricopa-county-az/maricopa-county-az-owner-appraisal-index.json`",
      "",
      "## Not Built Yet",
      "",
      "- Full production parcel GeoJSON remains intentionally blocked until viewport chunks/search shards are built.",
      "- Production PMTiles/vector tiles are not built yet.",
      "- Permits/CO, floodplain, development signals, and migration/demand joins remain source-needed.",
      `- Sample records built in this run: ${records.length}`,
      "",
      "No White Rabbit page design changed in this step.",
      "",
    ].join("\n"),
  );
}

async function main() {
  if (adapter.id !== "maricopa-county-az") throw new Error("Maricopa adapter must use county_id maricopa-county-az");
  if (fullBuild) {
    throw new Error("Maricopa full build is intentionally blocked for now. Build viewport chunks/search shards before exporting 1.75M parcels for app activation.");
  }
  ensureDir(outputDir);
  console.log("Building Maricopa County AZ / Assessor parcel plumbing...");
  const generatedAt = new Date().toISOString();
  const liveWarnings = [];
  let liveCount = null;
  try {
    liveCount = await fetchCount(sourceManifest.query.primary_where);
    if (liveCount !== sourceManifest.verified_counts.all_layer_features) {
      liveWarnings.push(`Live count ${liveCount} differs from locked verified count ${sourceManifest.verified_counts.all_layer_features}`);
    }
  } catch (error) {
    liveWarnings.push(`Live count check skipped: ${error.message}`);
  }

  let features = [];
  let sampleFetchError = "";
  if (!qaOnly) {
    try {
      features = await fetchGeoJsonSample(sampleLimit);
    } catch (error) {
      sampleFetchError = error.message;
      console.warn(`Sample fetch skipped: ${error.message}`);
    }
  }
  const records = features.map(mapFeatureToUniversal);
  if (records.length) writeSampleArtifacts(records, generatedAt);
  writeSchemaReport(generatedAt);
  writeJoinKeyReport(records, generatedAt);
  writeQaReport(records, liveCount, sampleFetchError ? [...liveWarnings, sampleFetchError] : liveWarnings, generatedAt);
  writeFullParcelAccessReport(records, generatedAt);

  console.log("Wrote output/maricopa-county-az/schema-report.json");
  console.log("Wrote output/maricopa-county-az/schema-report.md");
  console.log("Wrote output/maricopa-county-az/join-key-report.md");
  console.log("Wrote output/maricopa-county-az/qa-report.json");
  console.log("Wrote output/maricopa-county-az/qa-report.md");
  console.log("Wrote output/maricopa-county-az/full-parcel-access-report.md");
  if (records.length) {
    console.log("Wrote output/maricopa-county-az/maricopa-county-az-parcel-sample.geojson");
    console.log("Wrote output/maricopa-county-az/maricopa-county-az-parcel-search-index.json");
    console.log("Wrote output/maricopa-county-az/maricopa-county-az-owner-appraisal-index.json");
  }
  console.log(JSON.stringify({ liveCount, sampleRecords: records.length, qaOnly }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

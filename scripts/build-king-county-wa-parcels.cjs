const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const adapterPath = path.join(root, "data", "county-adapters", "king-county-wa", "adapter.json");
const sourceManifestPath = path.join(root, "data", "county-adapters", "king-county-wa", "king-county-parcel-source-manifest.json");
const fieldMapPath = path.join(root, "data", "county-adapters", "king-county-wa", "king-universal-field-map.json");
const outputDir = path.join(root, "output", "king-county-wa");

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

function arcgisQueryUrl(baseUrl, params) {
  const url = new URL(`${baseUrl}/query`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  });
  return url.toString();
}

async function requestJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`King County request failed ${response.status}: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`King County response was not JSON: ${text.slice(0, 500)}`);
  }
}

async function fetchCount(baseUrl, where = "1=1") {
  const payload = await requestJson(
    arcgisQueryUrl(baseUrl, {
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
    arcgisQueryUrl(sourceManifest.query.sample_rest_url, {
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

function mapFeatureToUniversal(feature) {
  const properties = feature.properties || feature.attributes || {};
  const geometry = feature.geometry || null;
  const pin = compact(properties.PIN);
  const objectId = compact(properties.OBJECTID);
  const centroidLngLat = geometryCentroid(geometry) || adapter.map.coordinates;
  const ring = simplifyRing(largestRing(geometry)).filter((point) => Array.isArray(point) && point.length >= 2);
  const address = compact(properties.ADDR_FULL);
  const countyParcelId = `${adapter.id}:${objectId || pin}`;
  const landValue = Number(properties.APPRLNDVAL || 0);
  const improvementValue = Number(properties.APPR_IMPR || 0);
  const totalValue = landValue + improvementValue || "";
  const areaLabel = [
    compact(properties.LOTSQFT) ? `${compact(properties.LOTSQFT)} land sq ft` : "",
    compact(properties.KCA_ACRES) ? `${compact(properties.KCA_ACRES)} acres` : "",
  ]
    .filter(Boolean)
    .join(" / ");

  return {
    schemaVersion: "wr-universal-parcel-v1",
    sourceCountyId: adapter.id,
    countyParcelId,
    sourceParcelId: pin,
    accountNum: pin,
    accountNumber: pin,
    gisParcelId: objectId,
    address,
    propertyAddress: address,
    city: firstNonEmpty(properties.CTYNAME, properties.POSTALCTYNAME),
    propertyZip: compact(properties.ZIP5),
    propertyName: firstNonEmpty(properties.PROP_NAME, properties.PLAT_NAME, pin ? `King Parcel ${pin}` : "King Parcel"),
    ownerName: "",
    ownerName2: "",
    businessName: "",
    ownerMailingAddress: "",
    ownerMailingAddress2: "",
    ownerCity: "",
    ownerState: "",
    ownerZip: "",
    ownerPhone: "",
    ownerEmail: "",
    zoning: compact(properties.KCA_ZONING),
    landUseCode: compact(properties.PREUSE_CODE),
    landUseDescription: compact(properties.PREUSE_DESC),
    landAreaSize: compact(properties.LOTSQFT),
    landAreaUnit: compact(properties.LOTSQFT) ? "sq ft" : "",
    landAreaSqFt: compact(properties.LOTSQFT),
    landValue: compact(properties.APPRLNDVAL),
    improvementValue: compact(properties.APPR_IMPR),
    totalValue,
    cityJurisdiction: firstNonEmpty(properties.CTYNAME, properties.POSTALCTYNAME),
    blockId: firstNonEmpty(properties.PLAT_NAME, properties.MAJOR),
    areaLabel,
    perimeter: compact(properties["Shape.STLength()"]),
    dimensions: {
      dimensionId: pin ? `${pin}:geometry` : "",
      perimeterFt: compact(properties["Shape.STLength()"]),
      dimensionLabel: areaLabel,
      sourceLayer: sourceManifest.property_info_layer_name,
      notes: "PropertyInfo exposes lot area and shape length; segment-by-segment dimensions still need label/source inspection."
    },
    legal: {
      major: compact(properties.MAJOR),
      minor: compact(properties.MINOR),
      platName: compact(properties.PLAT_NAME),
      propertyType: compact(properties.PROPTYPE),
      presentUseCode: compact(properties.PREUSE_CODE),
      presentUseDescription: compact(properties.PREUSE_DESC),
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
        PIN: pin,
        OBJECTID: objectId,
        MAJOR: compact(properties.MAJOR),
        MINOR: compact(properties.MINOR),
      },
    },
    joins: {
      accountInfo: Boolean(pin),
      ownerAppraisal: false,
      propertyInfo: Boolean(pin),
      parcelGeometry: Boolean(geometry),
      zoning: Boolean(properties.KCA_ZONING),
      permits: false,
      floodplain: false,
      migrationDemand: false,
    },
    sourceReferences: {
      countyAdapter: "data/county-adapters/king-county-wa/adapter.json",
      sourceManifest: "data/county-adapters/king-county-wa/king-county-parcel-source-manifest.json",
      fieldMap: "data/county-adapters/king-county-wa/king-universal-field-map.json",
      gisSource: sourceManifest.gis_source,
      parcelGeometryUrl: sourceManifest.arcgis_rest_url,
      propertyInfoUrl: sourceManifest.property_info_rest_url,
      uniqueGisKey: sourceManifest.unique_gis_key,
      parcelIdField: sourceManifest.parcel_id_field,
      accountIdField: sourceManifest.account_id_field,
    },
    sourceProperties: properties,
  };
}

function writeSampleArtifacts(records, generatedAt) {
  writeJson(path.join(outputDir, "king-county-wa-parcel-sample.geojson"), {
    type: "FeatureCollection",
    generatedAt,
    sourceCountyId: adapter.id,
    sourceVerifiedFeatureCount: sourceManifest.verified_counts.parcel_geometry_features,
    features: records.map((record) => ({
      type: "Feature",
      geometry: record.realGeometry.geometry,
      properties: record,
    })),
  });
  writeJson(path.join(outputDir, "king-county-wa-parcel-search-index.json"), {
    county_id: adapter.id,
    generatedAt,
    searchRecordCount: records.length,
    searchFields: fieldMap.search_index_fields,
    records: records.map((record) => ({
      countyParcelId: record.countyParcelId,
      sourceParcelId: record.sourceParcelId,
      accountNum: record.accountNum,
      gisParcelId: record.gisParcelId,
      address: record.address,
      city: record.city,
      propertyName: record.propertyName,
      zoning: record.zoning,
      presentUse: record.landUseDescription,
      centroid: record.liveGeometry.center,
    })),
  });
  writeJson(path.join(outputDir, "king-county-wa-property-info-index.json"), {
    county_id: adapter.id,
    generatedAt,
    source: sourceManifest.property_info_rest_url,
    officialJoinKey: "PIN one-to-many; OBJECTID unique per feature",
    indexedRecordCount: records.length,
    privacyNote: "Current owner name, owner phone, and owner email are intentionally blank because the verified official layers do not expose those fields.",
    records: records.map((record) => ({
      accountNum: record.accountNum,
      gisParcelId: record.gisParcelId,
      address: record.address,
      city: record.city,
      propertyZip: record.propertyZip,
      propertyName: record.propertyName,
      landValue: record.landValue,
      improvementValue: record.improvementValue,
      totalValue: record.totalValue,
      zoning: record.zoning,
      landUseDescription: record.landUseDescription,
      ownerName: "",
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
    status: "official-source-verified-current-services",
    source: sourceManifest.gis_source,
    source_url: sourceManifest.arcgis_rest_url,
    property_info_url: sourceManifest.property_info_rest_url,
    recent_sales_url: sourceManifest.recent_sales_rest_url,
    source_lineage: sourceManifest.source_lineage,
    service_owner: sourceManifest.service_owner,
    geometry_type: sourceManifest.geometry_type,
    source_spatial_reference: sourceManifest.source_spatial_reference,
    output_spatial_reference: sourceManifest.output_spatial_reference,
    verified_counts: sourceManifest.verified_counts,
    schema_fields: sourceManifest.schema_fields,
    property_info_fields: sourceManifest.property_info_fields,
    recent_sales_fields: sourceManifest.recent_sales_fields,
    mapped_source_fields: mappedFields,
    privacy_notes: ["Do not infer owner name, owner phone, or owner email. The verified King County layers inspected do not expose current owner contact fields."],
    join_key_notes: [sourceManifest.join_key_note],
    uiConstraint: "Data plumbing only. No White Rabbit page redesign or visible King County activation.",
  };
  writeJson(path.join(outputDir, "schema-report.json"), report);
  writeText(
    path.join(outputDir, "schema-report.md"),
    [
      "# King County WA / GIS Schema Report",
      "",
      `Generated: ${generatedAt}`,
      "",
      "## Source",
      "",
      `- Parcel geometry URL: ${report.source_url}`,
      `- Property info URL: ${report.property_info_url}`,
      `- Recent sales URL: ${report.recent_sales_url}`,
      `- Service owner: ${report.service_owner}`,
      `- Geometry: ${report.geometry_type}`,
      `- Spatial reference: ${report.source_spatial_reference.label}`,
      "",
      "## Verified Counts",
      "",
      ...Object.entries(report.verified_counts).map(([key, value]) => `- ${key}: ${value}`),
      "",
      "## Join Warning",
      "",
      sourceManifest.join_key_note,
      "",
      "## Parcel Window Notes",
      "",
      "- PIN is the parcel/account key, but it is not unique in the raw geometry layer.",
      "- OBJECTID is the unique GIS feature key.",
      "- Address, land value, improvement value, lot size, zoning text, property type, and present use fields are verified.",
      "- Current owner name, owner phone, and owner email remain source-needed.",
      "- No White Rabbit page design is changed by this report.",
      "",
    ].join("\n"),
  );
}

function writeJoinKeyReport(records, generatedAt) {
  const report = {
    generatedAt,
    county_id: adapter.id,
    status: "official-source-verified-sample-built",
    primary_join: "PIN -> White Rabbit accountNum/sourceParcelId, one-to-many allowed",
    secondary_join: "OBJECTID -> White Rabbit gisParcelId and unique feature id",
    verified_counts: sourceManifest.verified_counts,
    join_warning: sourceManifest.join_key_note,
    sample_records: records.map((record) => ({
      countyParcelId: record.countyParcelId,
      sourceParcelId: record.sourceParcelId,
      gisParcelId: record.gisParcelId,
      address: record.address,
      totalValue: record.totalValue,
    })),
    owner_appraisal_decision: "The verified PropertyInfo layer supports address, land/improvement value, lot size, zoning, property type, and use fields. Current owner fields remain source-needed.",
    privacy_decision: "No current owner name, owner phone, or owner email field was identified. Leave those fields blank.",
  };
  writeJson(path.join(outputDir, "join-key-report.json"), report);
  writeText(
    path.join(outputDir, "join-key-report.md"),
    [
      "# King County WA / GIS Join Key Report",
      "",
      `Generated: ${generatedAt}`,
      "",
      `- Status: ${report.status}`,
      `- Primary join: ${report.primary_join}`,
      `- Secondary join: ${report.secondary_join}`,
      `- Sample records inspected: ${records.length}`,
      "",
      "## Verified Counts",
      "",
      ...Object.entries(report.verified_counts).map(([key, value]) => `- ${key}: ${value}`),
      "",
      "## Join Warning",
      "",
      report.join_warning,
      "",
      "## Privacy Decision",
      "",
      report.privacy_decision,
      "",
    ].join("\n"),
  );
}

function writeQaReport(records, liveCounts, liveWarnings, generatedAt) {
  const report = {
    generatedAt,
    county_id: adapter.id,
    status: "pilot-source-verified",
    source_url: sourceManifest.arcgis_rest_url,
    property_info_url: sourceManifest.property_info_rest_url,
    live_count_check: liveCounts,
    live_warnings: liveWarnings,
    source_verified_counts: sourceManifest.verified_counts,
    sampleRecordCount: records.length,
    sampleChecks: {
      allSamplesHaveAccountNum: records.every((record) => Boolean(record.accountNum)),
      allSamplesHaveGeometry: records.every((record) => Boolean(record.realGeometry?.geometry)),
      allSamplesKeepOwnerNameBlank: records.every((record) => record.ownerName === ""),
      allSamplesKeepOwnerPhoneBlank: records.every((record) => record.ownerPhone === ""),
      allSamplesKeepOwnerEmailBlank: records.every((record) => record.ownerEmail === ""),
    },
    outputArtifacts: {
      schemaReportJson: "output/king-county-wa/schema-report.json",
      schemaReportMd: "output/king-county-wa/schema-report.md",
      joinKeyReportMd: "output/king-county-wa/join-key-report.md",
      qaReportJson: "output/king-county-wa/qa-report.json",
      qaReportMd: "output/king-county-wa/qa-report.md",
      sampleGeojson: records.length ? "output/king-county-wa/king-county-wa-parcel-sample.geojson" : "",
      sampleSearchIndexJson: records.length ? "output/king-county-wa/king-county-wa-parcel-search-index.json" : "",
      propertyInfoIndex: records.length ? "output/king-county-wa/king-county-wa-property-info-index.json" : "",
    },
    blockingProductionGaps: [
      "Full viewport parcel chunks are not built yet.",
      "Production search shards are not built yet.",
      "PMTiles/vector tiles are not built yet.",
      "Current owner source and joins remain source-needed.",
      "Permit/CO source and joins remain source-needed.",
      "Floodplain source/join remains source-needed.",
      "Migration/demand layer remains aggregate source-needed.",
    ],
    uiConstraint: "Data plumbing only. No page redesign and no visible King County app activation in this step.",
  };
  writeJson(path.join(outputDir, "qa-report.json"), report);
  writeText(
    path.join(outputDir, "qa-report.md"),
    [
      "# King County WA / GIS QA Report",
      "",
      `Generated: ${generatedAt}`,
      "",
      `- Status: ${report.status}`,
      `- Parcel geometry URL: ${report.source_url}`,
      `- Property info URL: ${report.property_info_url}`,
      `- Live geometry count: ${liveCounts.geometry === null ? "not checked" : liveCounts.geometry.toLocaleString()}`,
      `- Live property info count: ${liveCounts.propertyInfo === null ? "not checked" : liveCounts.propertyInfo.toLocaleString()}`,
      `- Verified parcel geometry features: ${sourceManifest.verified_counts.parcel_geometry_features.toLocaleString()}`,
      `- Geometry duplicate PIN count: ${sourceManifest.verified_counts.geometry_duplicate_pin}`,
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
      "# King County WA / Seattle Parcel Access Report",
      "",
      `Generated: ${generatedAt}`,
      "",
      "## Status",
      "",
      `- County ID: \`${adapter.id}\``,
      `- Market: ${adapter.marketName}`,
      `- Assessment office: ${adapter.appraisalDistrictName}`,
      `- GIS source: ${sourceManifest.gis_source}`,
      "- Status: pilot source verified; parcel geometry and property info are report-backed and sample-backed, but not promoted as an active production county",
      "",
      "## Available Foundation",
      "",
      `- Parcel geometry polygons: ${sourceManifest.verified_counts.parcel_geometry_features.toLocaleString()}`,
      `- Property info parcel records: ${sourceManifest.verified_counts.property_info_features.toLocaleString()}`,
      `- Recent sales records: ${sourceManifest.verified_counts.recent_sales_last_3_years.toLocaleString()}`,
      "- Parcel/account key: `PIN`",
      "- GIS feature key: `OBJECTID`",
      "- Important join note: PIN is not unique in the raw geometry layer; keep OBJECTID for feature uniqueness.",
      "",
      "## Parcel Window Contract",
      "",
      "King County can fill identity, address, land/improvement value, lot size, zoning text, property type, present use, geometry, and source-lineage fields from the verified official services. Current owner name, owner phone, owner email, permits/CO, floodplain, development signals, and migration/demand remain source-needed.",
      "",
      "## Output Contract",
      "",
      "- Schema report: `output/king-county-wa/schema-report.md`",
      "- Join-key report: `output/king-county-wa/join-key-report.md`",
      "- QA report: `output/king-county-wa/qa-report.md`",
      "- Sample universal parcel GeoJSON: `output/king-county-wa/king-county-wa-parcel-sample.geojson`",
      "- Sample search index: `output/king-county-wa/king-county-wa-parcel-search-index.json`",
      "- Sample property info index: `output/king-county-wa/king-county-wa-property-info-index.json`",
      "",
      "## Not Built Yet",
      "",
      "- Full production parcel GeoJSON remains intentionally blocked until viewport chunks/search shards are built.",
      "- Production PMTiles/vector tiles are not built yet.",
      "- Current owner, permits/CO, floodplain, development signals, and migration/demand joins remain source-needed.",
      `- Sample records built in this run: ${records.length}`,
      "",
      "No White Rabbit page design changed in this step.",
      "",
    ].join("\n"),
  );
}

async function main() {
  if (adapter.id !== "king-county-wa") throw new Error("King adapter must use county_id king-county-wa");
  if (fullBuild) {
    throw new Error("King County full build is intentionally blocked for now. Build viewport chunks/search shards before exporting 638k parcels for app activation.");
  }
  ensureDir(outputDir);
  console.log("Building King County WA / GIS parcel plumbing...");
  const generatedAt = new Date().toISOString();
  const liveWarnings = [];
  const liveCounts = { geometry: null, propertyInfo: null };
  try {
    liveCounts.geometry = await fetchCount(sourceManifest.arcgis_rest_url);
    if (liveCounts.geometry !== sourceManifest.verified_counts.parcel_geometry_features) {
      liveWarnings.push(`Live geometry count ${liveCounts.geometry} differs from locked verified count ${sourceManifest.verified_counts.parcel_geometry_features}`);
    }
  } catch (error) {
    liveWarnings.push(`Live geometry count skipped: ${error.message}`);
  }
  try {
    liveCounts.propertyInfo = await fetchCount(sourceManifest.property_info_rest_url);
    if (liveCounts.propertyInfo !== sourceManifest.verified_counts.property_info_features) {
      liveWarnings.push(`Live property info count ${liveCounts.propertyInfo} differs from locked verified count ${sourceManifest.verified_counts.property_info_features}`);
    }
  } catch (error) {
    liveWarnings.push(`Live property info count skipped: ${error.message}`);
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
  writeQaReport(records, liveCounts, sampleFetchError ? [...liveWarnings, sampleFetchError] : liveWarnings, generatedAt);
  writeFullParcelAccessReport(records, generatedAt);

  console.log("Wrote output/king-county-wa/schema-report.json");
  console.log("Wrote output/king-county-wa/schema-report.md");
  console.log("Wrote output/king-county-wa/join-key-report.md");
  console.log("Wrote output/king-county-wa/qa-report.json");
  console.log("Wrote output/king-county-wa/qa-report.md");
  console.log("Wrote output/king-county-wa/full-parcel-access-report.md");
  if (records.length) {
    console.log("Wrote output/king-county-wa/king-county-wa-parcel-sample.geojson");
    console.log("Wrote output/king-county-wa/king-county-wa-parcel-search-index.json");
    console.log("Wrote output/king-county-wa/king-county-wa-property-info-index.json");
  }
  console.log(JSON.stringify({ liveCounts, sampleRecords: records.length, qaOnly }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

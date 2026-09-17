const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { parse } = require("csv-parse");
const shapefile = require("shapefile");
const proj4 = require("proj4");

const root = path.join(__dirname, "..");
const paths = {
  raw: path.join(root, "data", "raw"),
  extracted: path.join(root, "data", "extracted"),
  output: path.join(root, "output"),
};

const sourceFiles = {
  parcelGeomZip: path.join(paths.raw, "PARCEL_GEOM.zip"),
  dcadZip: path.join(paths.raw, "DCAD2026_CURRENT.ZIP"),
  blkidZip: path.join(paths.raw, "BLKID.zip"),
  parcelDimensionZip: path.join(paths.raw, "ParcelDimension.zip"),
};

const extracted = {
  dcad: path.join(paths.extracted, "DCAD2026_CURRENT"),
  parcelGeom: path.join(paths.extracted, "PARCEL_GEOM"),
  blkid: path.join(paths.extracted, "BLKID"),
  parcelDimension: path.join(paths.extracted, "ParcelDimension"),
};

const outputFile = path.join(paths.output, "white-rabbit-dallas-parcels.geojson");
const outputManifest = path.join(paths.output, "white-rabbit-dallas-parcels-manifest.json");

const statePlane =
  "+proj=lcc +lat_1=32.13333333333333 +lat_2=33.96666666666667 +lat_0=31.66666666666667 +lon_0=-98.5 +x_0=600000 +y_0=2000000 +datum=NAD83 +units=us-ft +no_defs";

const cellSizeFt = 1250;
const maxDimensionLabels = Number(process.env.WR_MAX_DIMENSION_LABELS || 350000);

function ensureSources() {
  Object.entries(sourceFiles).forEach(([name, file]) => {
    if (!fs.existsSync(file)) throw new Error(`Missing source ${name}: ${file}`);
  });
}

function extractZip(zipPath, outDir, stripComponents = 0) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const args = ["-xf", zipPath, "-C", outDir];
  if (stripComponents) args.push(`--strip-components=${stripComponents}`);
  execFileSync("tar", args, { stdio: "ignore" });
}

function inspectSources() {
  return {
    parcelGeomFiles: fs.readdirSync(extracted.parcelGeom).sort(),
    dcadFiles: fs.readdirSync(extracted.dcad).sort(),
    blkidFiles: fs.readdirSync(extracted.blkid).sort(),
    parcelDimensionFiles: fs.readdirSync(extracted.parcelDimension).sort(),
  };
}

function normalizeAccount(value) {
  return String(value || "").trim().toUpperCase();
}

function firstNonEmpty(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function numberOrNull(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function csvMap(csvPath, rowMapper) {
  return new Promise((resolve, reject) => {
    const rows = new Map();
    fs.createReadStream(csvPath)
      .pipe(parse({ columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }))
      .on("data", (row) => {
        const mapped = rowMapper(row);
        if (mapped?.key) rows.set(mapped.key, mapped.value);
      })
      .on("error", reject)
      .on("end", () => resolve(rows));
  });
}

function flattenCoordinates(coordinates, points = []) {
  if (!Array.isArray(coordinates)) return points;
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    points.push(coordinates);
    return points;
  }
  coordinates.forEach((child) => flattenCoordinates(child, points));
  return points;
}

function transformCoordinates(coordinates) {
  if (!Array.isArray(coordinates)) return coordinates;
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") return proj4(statePlane, "WGS84", coordinates);
  return coordinates.map(transformCoordinates);
}

function geometrySummary(geometry) {
  const statePlanePoints = flattenCoordinates(geometry.coordinates);
  const bounds = statePlanePoints.reduce(
    (acc, [x, y]) => ({
      minX: Math.min(acc.minX, x),
      minY: Math.min(acc.minY, y),
      maxX: Math.max(acc.maxX, x),
      maxY: Math.max(acc.maxY, y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  return {
    center: [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2],
    bounds,
  };
}

function gridKey(point) {
  return `${Math.floor(point[0] / cellSizeFt)},${Math.floor(point[1] / cellSizeFt)}`;
}

function neighborKeys(point) {
  const cx = Math.floor(point[0] / cellSizeFt);
  const cy = Math.floor(point[1] / cellSizeFt);
  const keys = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) keys.push(`${cx + dx},${cy + dy}`);
  }
  return keys;
}

function pushGrid(grid, item) {
  const key = gridKey(item.center);
  if (!grid.has(key)) grid.set(key, []);
  grid.get(key).push(item);
}

function geometryCenter(geometry) {
  const points = flattenCoordinates(geometry.coordinates);
  if (!points.length) return null;
  const sum = points.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
}

async function buildLabelGrid(folder, basename, options = {}) {
  const source = await shapefile.open(path.join(folder, `${basename}.shp`), path.join(folder, `${basename}.dbf`));
  const grid = new Map();
  let count = 0;
  while (true) {
    const next = await source.read();
    if (next.done) break;
    const text = String(next.value.properties?.TEXT || "").trim();
    if (!text) continue;
    if (options.numericOnly && !/^\d+(\.\d+)?$/.test(text)) continue;
    const center = geometryCenter(next.value.geometry);
    if (!center) continue;
    pushGrid(grid, { text, center });
    count += 1;
    if (options.limit && count >= options.limit) break;
  }
  return { grid, count };
}

function nearestLabel(grid, center, maxDistanceFt, predicate = () => true) {
  let best = null;
  for (const key of neighborKeys(center)) {
    for (const label of grid.get(key) || []) {
      if (!predicate(label)) continue;
      const distanceFt = Math.hypot(center[0] - label.center[0], center[1] - label.center[1]);
      if (distanceFt <= maxDistanceFt && (!best || distanceFt < best.distanceFt)) best = { ...label, distanceFt };
    }
  }
  return best;
}

function nearestDimensionLabels(grid, center, maxDistanceFt) {
  const labels = [];
  const seen = new Set();
  for (const key of neighborKeys(center)) {
    for (const label of grid.get(key) || []) {
      const distanceFt = Math.hypot(center[0] - label.center[0], center[1] - label.center[1]);
      if (distanceFt <= maxDistanceFt && !seen.has(label.text)) {
        seen.add(label.text);
        labels.push({ text: label.text, distanceFt });
      }
    }
  }
  labels.sort((a, b) => a.distanceFt - b.distanceFt);
  return labels.slice(0, 6);
}

function parseBlockFromLegal(legal) {
  const match = String(legal || "").match(/\b(?:BLK|BLOCK)\s+([A-Z0-9/-]+)/i);
  return match ? match[1] : "";
}

async function loadDcadMaps() {
  const accountInfo = await csvMap(path.join(extracted.dcad, "ACCOUNT_INFO.CSV"), (row) => {
    const key = normalizeAccount(row.ACCOUNT_NUM);
    if (!key) return null;
    return {
      key,
      value: {
        propertyAddress: [row.STREET_NUM, row.STREET_HALF_NUM, row.FULL_STREET_NAME, row.BLDG_ID, row.UNIT_ID].map((value) => String(value || "").trim()).filter(Boolean).join(" "),
        propertyCity: firstNonEmpty(row.PROPERTY_CITY),
        propertyZip: firstNonEmpty(row.PROPERTY_ZIPCODE),
        ownerName: firstNonEmpty(row.OWNER_NAME1, row.BIZ_NAME),
        ownerName2: firstNonEmpty(row.OWNER_NAME2),
        businessName: firstNonEmpty(row.BIZ_NAME),
        ownerMailingAddress: [row.OWNER_ADDRESS_LINE1, row.OWNER_ADDRESS_LINE2].map((value) => String(value || "").trim()).filter(Boolean).join(", "),
        ownerMailingAddress2: [row.OWNER_ADDRESS_LINE3, row.OWNER_ADDRESS_LINE4].map((value) => String(value || "").trim()).filter(Boolean).join(", "),
        ownerCity: firstNonEmpty(row.OWNER_CITY),
        ownerState: firstNonEmpty(row.OWNER_STATE),
        ownerZip: firstNonEmpty(row.OWNER_ZIPCODE),
        ownerCountry: firstNonEmpty(row.OWNER_COUNTRY),
        ownerPhone: firstNonEmpty(row.PHONE_NUM),
        propertyName: firstNonEmpty(row.BIZ_NAME, row.OWNER_NAME1),
        legal: [row.LEGAL1, row.LEGAL2, row.LEGAL3, row.LEGAL4, row.LEGAL5].map((value) => String(value || "").trim()).filter(Boolean).join(" "),
        gisParcelId: firstNonEmpty(row.GIS_PARCEL_ID),
      },
    };
  });

  const appraisal = await csvMap(path.join(extracted.dcad, "ACCOUNT_APPRL_YEAR.CSV"), (row) => {
    const key = normalizeAccount(row.ACCOUNT_NUM);
    if (!key) return null;
    return {
      key,
      value: {
        landValue: numberOrNull(row.LAND_VAL),
        improvementValue: numberOrNull(row.IMPR_VAL),
        totalValue: numberOrNull(row.TOT_VAL),
        buildingClass: firstNonEmpty(row.BLDG_CLASS_CD, row.SPTD_CODE),
        gisParcelId: firstNonEmpty(row.GIS_PARCEL_ID),
      },
    };
  });

  const land = await csvMap(path.join(extracted.dcad, "LAND.CSV"), (row) => {
    const key = normalizeAccount(row.ACCOUNT_NUM);
    if (!key) return null;
    return {
      key,
      value: {
        landSection: firstNonEmpty(row.SECTION_NUM),
        landUseCode: firstNonEmpty(row.SPTD_CD),
        landUseDescription: firstNonEmpty(row.SPTD_DESC),
        zoning: firstNonEmpty(row.ZONING),
        landSquareFeet: String(row.AREA_UOM_DESC || "").toUpperCase().includes("SQUARE") ? numberOrNull(row.AREA_SIZE) : null,
        landAreaSize: numberOrNull(row.AREA_SIZE),
        landAreaUnit: firstNonEmpty(row.AREA_UOM_DESC),
        frontage: numberOrNull(row.FRONT_DIM),
        depth: numberOrNull(row.DEPTH_DIM),
        landPricingMethod: firstNonEmpty(row.PRICING_METH_DESC),
        landCostPerUnit: numberOrNull(row.COST_PER_UOM),
        landMarketAdjustmentPct: numberOrNull(row.MARKET_ADJ_PCT),
        landValuationAmount: numberOrNull(row.VAL_AMT),
      },
    };
  });

  return { accountInfo, appraisal, land };
}

function featureForParcel(parcel, dcad, blkidGrid, dimensionGrid) {
  const account = normalizeAccount(parcel.properties?.Acct);
  const appraisal = dcad.appraisal.get(account) || {};
  const accountInfo = dcad.accountInfo.get(account) || {};
  const land = dcad.land.get(account) || {};
  const summary = geometrySummary(parcel.geometry);
  const transformedGeometry = { ...parcel.geometry, coordinates: transformCoordinates(parcel.geometry.coordinates) };
  const legalBlock = parseBlockFromLegal(accountInfo.legal);
  const blkidLabel = nearestLabel(blkidGrid, summary.center, 750, (label) => label.text.includes("/"));
  const dimLabels = nearestDimensionLabels(dimensionGrid, summary.center, 600);
  const numericDims = dimLabels.map((label) => Number.parseFloat(label.text)).filter(Number.isFinite).sort((a, b) => b - a);
  const frontage = land.frontage || numericDims[0] || null;
  const depth = land.depth || numericDims[1] || null;
  const perimeter = frontage && depth ? Math.round((frontage + depth) * 2 * 100) / 100 : numericDims[2] || null;

  return {
    type: "Feature",
    properties: {
      accountNumber: account,
      gisParcelId: firstNonEmpty(accountInfo.gisParcelId, appraisal.gisParcelId),
      propertyAddress: accountInfo.propertyAddress || "",
      ownerPropertyName: firstNonEmpty(accountInfo.ownerName, accountInfo.propertyName),
      ownerName: accountInfo.ownerName || "",
      ownerName2: accountInfo.ownerName2 || "",
      businessName: accountInfo.businessName || "",
      ownerMailingAddress: accountInfo.ownerMailingAddress || "",
      ownerMailingAddress2: accountInfo.ownerMailingAddress2 || "",
      ownerCity: accountInfo.ownerCity || "",
      ownerState: accountInfo.ownerState || "",
      ownerZip: accountInfo.ownerZip || "",
      ownerCountry: accountInfo.ownerCountry || "",
      ownerPhone: accountInfo.ownerPhone || "",
      landValue: appraisal.landValue,
      improvementValue: appraisal.improvementValue,
      totalValue: appraisal.totalValue,
      landSquareFeet: land.landSquareFeet,
      landSection: land.landSection || "",
      landUseCode: land.landUseCode || "",
      landUseDescription: land.landUseDescription || "",
      zoning: land.zoning || "",
      landAreaSize: land.landAreaSize,
      landAreaUnit: land.landAreaUnit || "",
      landPricingMethod: land.landPricingMethod || "",
      landCostPerUnit: land.landCostPerUnit,
      landMarketAdjustmentPct: land.landMarketAdjustmentPct,
      landValuationAmount: land.landValuationAmount,
      buildingClass: appraisal.buildingClass || "",
      blockId: firstNonEmpty(legalBlock, blkidLabel?.text),
      frontage,
      depth,
      perimeter,
      parcelRecordedAcreage: parcel.properties?.RecAcs || "",
      joins: {
        appraisal: Boolean(dcad.appraisal.has(account) || dcad.accountInfo.has(account)),
        blockId: Boolean(legalBlock || blkidLabel),
        parcelDimension: dimLabels.length > 0 || Boolean(land.frontage || land.depth),
      },
    },
    geometry: transformedGeometry,
  };
}

function writeLine(stream, value) {
  return new Promise((resolve) => {
    if (stream.write(value)) resolve();
    else stream.once("drain", resolve);
  });
}

async function main() {
  ensureSources();
  fs.mkdirSync(paths.output, { recursive: true });
  extractZip(sourceFiles.parcelGeomZip, extracted.parcelGeom, 1);
  extractZip(sourceFiles.dcadZip, extracted.dcad, 0);
  extractZip(sourceFiles.blkidZip, extracted.blkid, 1);
  extractZip(sourceFiles.parcelDimensionZip, extracted.parcelDimension, 1);
  const inspection = inspectSources();

  console.log("Loading DCAD maps...");
  const dcad = await loadDcadMaps();
  console.log("Indexing BLKID labels...");
  const blkid = await buildLabelGrid(extracted.blkid, "BLKID");
  console.log("Indexing ParcelDimension labels...");
  const dimensions = await buildLabelGrid(extracted.parcelDimension, "ParcelDimension", { numericOnly: true, limit: maxDimensionLabels });

  console.log("Streaming parcels to GeoJSON...");
  const source = await shapefile.open(path.join(extracted.parcelGeom, "PARCEL_GEOM.shp"), path.join(extracted.parcelGeom, "PARCEL_GEOM.dbf"));
  const stream = fs.createWriteStream(outputFile, { encoding: "utf8" });
  await writeLine(stream, '{"type":"FeatureCollection","features":[\n');
  let count = 0;
  let joinedAppraisal = 0;
  let joinedBlockOrDimension = 0;

  while (true) {
    const next = await source.read();
    if (next.done) break;
    const feature = featureForParcel(next.value, dcad, blkid.grid, dimensions.grid);
    if (feature.properties.joins.appraisal) joinedAppraisal += 1;
    if (feature.properties.joins.blockId || feature.properties.joins.parcelDimension) joinedBlockOrDimension += 1;
    if (count > 0) await writeLine(stream, ",\n");
    await writeLine(stream, JSON.stringify(feature));
    count += 1;
    if (count % 25000 === 0) console.log(`Wrote ${count.toLocaleString()} parcels...`);
  }

  await writeLine(stream, "\n]}\n");
  await new Promise((resolve) => stream.end(resolve));

  const manifest = {
    generatedAt: new Date().toISOString(),
    output: "output/white-rabbit-dallas-parcels.geojson",
    featureCount: count,
    joinedAppraisalCount: joinedAppraisal,
    joinedBlockOrDimensionCount: joinedBlockOrDimension,
    indexedBlkIdLabels: blkid.count,
    indexedParcelDimensionLabels: dimensions.count,
    sourceInspection: inspection,
  };
  fs.writeFileSync(outputManifest, JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${outputFile}`);
  console.log(`Wrote ${outputManifest}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const path = require("path");

const root = path.join(__dirname, "..");
const outputRoot = path.join(root, "data", "raw", "travis-county-tx", "gis");
const pageSize = 2000;
const sources = [
  {
    id: "austin-zoning",
    title: "City of Austin Zoning",
    url: "https://maps.austintexas.gov/gis/rest/Shared/Zoning_1/MapServer/0",
  },
  {
    id: "austin-fully-developed-floodplain",
    title: "City of Austin Fully Developed Floodplain",
    url: "https://maps.austintexas.gov/gis/rest/Shared/Floodplain/MapServer/0",
  },
  {
    id: "austin-fema-floodplain",
    title: "City of Austin FEMA Floodplain",
    url: "https://maps.austintexas.gov/gis/rest/Shared/Floodplain/MapServer/1",
  },
];

function requestJson(url, attempt = 1) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { Accept: "application/geo+json, application/json" }, timeout: 120000 }, (response) => {
      const parts = [];
      response.on("data", (part) => parts.push(part));
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        try {
          const payload = JSON.parse(Buffer.concat(parts).toString("utf8"));
          if (payload.error) throw new Error(`${payload.error.code || "ArcGIS"}: ${payload.error.message || "query failed"}`);
          resolve(payload);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error(`Timeout for ${url}`)));
    request.on("error", (error) => {
      if (attempt < 4) return setTimeout(() => requestJson(url, attempt + 1).then(resolve, reject), attempt * 1000);
      reject(error);
    });
  });
}

async function capture(source) {
  const metadata = await requestJson(`${source.url}?f=json`);
  const countResult = await requestJson(`${source.url}/query?where=1%3D1&returnCountOnly=true&f=json`);
  const sourceFeatureCount = Number(countResult.count || 0);
  const finalFile = path.join(outputRoot, `${source.id}.ndjson`);
  const temporaryFile = `${finalFile}.partial`;
  const handle = fs.openSync(temporaryFile, "w");
  const hash = crypto.createHash("sha256");
  let emittedFeatureCount = 0;
  try {
    for (let offset = 0; offset < sourceFeatureCount; offset += pageSize) {
      const query = new URLSearchParams({
        where: "1=1",
        outFields: "*",
        returnGeometry: "true",
        outSR: "4326",
        geometryPrecision: "6",
        maxAllowableOffset: "0.00001",
        resultOffset: String(offset),
        resultRecordCount: String(pageSize),
        orderByFields: `${metadata.objectIdField || "OBJECTID"} ASC`,
        f: "geojson",
      });
      const page = await requestJson(`${source.url}/query?${query}`);
      for (const feature of page.features || []) {
        const line = `${JSON.stringify(feature)}\n`;
        fs.writeSync(handle, line);
        hash.update(line);
        emittedFeatureCount += 1;
      }
      process.stdout.write(`${source.id}: ${emittedFeatureCount.toLocaleString()} / ${sourceFeatureCount.toLocaleString()}\r`);
    }
  } finally {
    fs.closeSync(handle);
  }
  if (emittedFeatureCount !== sourceFeatureCount) {
    throw new Error(`${source.id} count mismatch: expected ${sourceFeatureCount}, emitted ${emittedFeatureCount}`);
  }
  fs.renameSync(temporaryFile, finalFile);
  process.stdout.write("\n");
  return {
    ...source,
    geometryType: metadata.geometryType,
    objectIdField: metadata.objectIdField || "OBJECTID",
    sourceSpatialReference: metadata.extent?.spatialReference || metadata.sourceSpatialReference || null,
    outputSpatialReference: 4326,
    sourceFeatureCount,
    emittedFeatureCount,
    file: path.relative(root, finalFile).replace(/\\/g, "/"),
    bytes: fs.statSync(finalFile).size,
    sha256: hash.digest("hex"),
  };
}

async function main() {
  fs.mkdirSync(outputRoot, { recursive: true });
  const captured = [];
  for (const source of sources) captured.push(await capture(source));
  const manifest = {
    schemaVersion: "wr-official-arcgis-capture-v1",
    generatedAt: new Date().toISOString(),
    countyId: "travis-county-tx",
    market: "Austin",
    format: "newline-delimited GeoJSON features",
    capturePolicy: "Official source features are stored unchanged except geometry is projected to EPSG:4326 and rounded to six decimal places for reproducible offline joins.",
    sources: captured,
  };
  fs.writeFileSync(path.join(outputRoot, "source-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

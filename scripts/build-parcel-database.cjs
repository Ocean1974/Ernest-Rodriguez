const fs = require("fs");
const path = require("path");
const shapefile = require("shapefile");
const proj4 = require("proj4");

const statePlane =
  "+proj=lcc +lat_1=32.13333333333333 +lat_2=33.96666666666667 +lat_0=31.66666666666667 +lon_0=-98.5 +x_0=600000 +y_0=2000000 +datum=NAD83 +units=us-ft +no_defs";

const shpPath = path.join(__dirname, "..", "data", "extracted", "PARCEL_GEOM", "PARCEL_GEOM.shp");
const dbfPath = path.join(__dirname, "..", "data", "extracted", "PARCEL_GEOM", "PARCEL_GEOM.dbf");
const outDir = path.join(__dirname, "..", "data", "processed");
const outFile = path.join(outDir, "parcel-database.ndjson");
const manifestFile = path.join(outDir, "parcel-database-manifest.json");

function flattenCoordinates(coordinates, points = []) {
  if (!Array.isArray(coordinates)) return points;
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    points.push(coordinates);
    return points;
  }
  coordinates.forEach((child) => flattenCoordinates(child, points));
  return points;
}

function summarizeGeometry(geometry) {
  const points = flattenCoordinates(geometry.coordinates);
  const bounds = points.reduce(
    (acc, [x, y]) => ({
      minX: Math.min(acc.minX, x),
      minY: Math.min(acc.minY, y),
      maxX: Math.max(acc.maxX, x),
      maxY: Math.max(acc.maxY, y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  const center = [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
  const centerWgs84 = proj4(statePlane, "WGS84", center);
  return { bounds, center, centerWgs84, pointCount: points.length };
}

function writeLine(stream, line) {
  return new Promise((resolve) => {
    if (stream.write(line)) resolve();
    else stream.once("drain", resolve);
  });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const source = await shapefile.open(shpPath, dbfPath);
  const stream = fs.createWriteStream(outFile, { encoding: "utf8" });
  let count = 0;
  let missingAccount = 0;

  while (true) {
    const next = await source.read();
    if (next.done) break;
    const properties = next.value.properties || {};
    const account = String(properties.Acct || "").trim().toUpperCase();
    if (!account) {
      missingAccount += 1;
      continue;
    }
    const geometry = summarizeGeometry(next.value.geometry);
    await writeLine(
      stream,
      `${JSON.stringify({
        account,
        recAcs: properties.RecAcs || "",
        type: properties.Type,
        geometryType: next.value.geometry?.type || "",
        center: {
          lng: Number(geometry.centerWgs84[0].toFixed(7)),
          lat: Number(geometry.centerWgs84[1].toFixed(7)),
        },
        boundsStatePlane: geometry.bounds,
        pointCount: geometry.pointCount,
      })}\n`,
    );
    count += 1;
    if (count % 50000 === 0) console.log(`Indexed ${count.toLocaleString()} parcels...`);
  }

  await new Promise((resolve) => stream.end(resolve));
  const manifest = {
    generatedAt: new Date().toISOString(),
    source: "data/extracted/PARCEL_GEOM",
    database: "data/processed/parcel-database.ndjson",
    recordCount: count,
    missingAccountCount: missingAccount,
    fields: ["account", "recAcs", "type", "geometryType", "center", "boundsStatePlane", "pointCount"],
    joinKey: "account",
    sourceJoinField: "Acct",
  };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${outFile}`);
  console.log(`Wrote ${manifestFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

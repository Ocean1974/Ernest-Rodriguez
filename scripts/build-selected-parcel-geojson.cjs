const fs = require("fs");
const path = require("path");
const shapefile = require("shapefile");
const proj4 = require("proj4");

const statePlane =
  "+proj=lcc +lat_1=32.13333333333333 +lat_2=33.96666666666667 +lat_0=31.66666666666667 +lon_0=-98.5 +x_0=600000 +y_0=2000000 +datum=NAD83 +units=us-ft +no_defs";

const targetAccounts = new Set([
  "008052000B01A0000",
  "00000155887000000",
  "00000182602000000",
  "00000156442000000",
]);

const shpPath = path.join(__dirname, "..", "data", "extracted", "PARCEL_GEOM", "PARCEL_GEOM.shp");
const dbfPath = path.join(__dirname, "..", "data", "extracted", "PARCEL_GEOM", "PARCEL_GEOM.dbf");
const outFile = path.join(__dirname, "..", "src", "data", "selectedParcelGeojson.json");

function transformCoordinates(coordinates) {
  if (!Array.isArray(coordinates)) return coordinates;
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    return proj4(statePlane, "WGS84", coordinates);
  }
  return coordinates.map(transformCoordinates);
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

function centerOfGeometry(geometry) {
  const points = flattenCoordinates(geometry.coordinates);
  const sum = points.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]);
  return points.length ? [sum[0] / points.length, sum[1] / points.length] : null;
}

async function main() {
  const source = await shapefile.open(shpPath, dbfPath);
  const features = [];

  while (features.length < targetAccounts.size) {
    const next = await source.read();
    if (next.done) break;
    const account = String(next.value.properties?.Acct || "").trim().toUpperCase();
    if (!targetAccounts.has(account)) continue;

    const geometry = {
      ...next.value.geometry,
      coordinates: transformCoordinates(next.value.geometry.coordinates),
    };

    features.push({
      type: "Feature",
      properties: {
        accountNum: account,
        recAcs: next.value.properties?.RecAcs || "",
        type: next.value.properties?.Type,
      },
      geometry,
      center: centerOfGeometry(geometry),
    });
  }

  fs.writeFileSync(outFile, JSON.stringify({ type: "FeatureCollection", generatedAt: new Date().toISOString(), features }, null, 2));
  console.log(`Wrote ${outFile} with ${features.length} features`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

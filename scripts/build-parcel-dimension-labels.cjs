const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const shapefile = require("shapefile");
const proj4 = require("proj4");

const zipPath = path.join(__dirname, "..", "data", "raw", "ParcelDimension.zip");
const outFile = path.join(__dirname, "..", "src", "data", "parcelDimensionLabels.json");
const tempDir = path.join(os.tmpdir(), "white-rabbit-parcel-dimension-labels");

const statePlane =
  "+proj=lcc +lat_1=32.13333333333333 +lat_2=33.96666666666667 +lat_0=31.66666666666667 +lon_0=-98.5 +x_0=600000 +y_0=2000000 +datum=NAD83 +units=us-ft +no_defs";

const targets = [
  { accountNum: "008052000B01A0000", center: [-96.6972, 32.8906] },
  { accountNum: "00000155887000000", center: [-96.7707, 32.8119] },
  { accountNum: "00000182602000000", center: [-96.7614, 32.8061] },
  { accountNum: "00000156442000000", center: [-96.7847, 32.8144] },
].map((target) => ({
  ...target,
  projected: proj4("WGS84", statePlane, target.center),
  nearest: [],
}));

function flattenCoordinates(coordinates, points = []) {
  if (!Array.isArray(coordinates)) return points;
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    points.push(coordinates);
    return points;
  }
  coordinates.forEach((child) => flattenCoordinates(child, points));
  return points;
}

function geometryCenter(geometry) {
  const points = flattenCoordinates(geometry.coordinates);
  if (!points.length) return null;
  const sum = points.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
}

function pushNearest(target, label) {
  target.nearest.push(label);
  target.nearest.sort((a, b) => a.distanceFt - b.distanceFt);
  target.nearest = target.nearest.slice(0, 16);
}

async function main() {
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });
  execFileSync("tar", ["-xf", zipPath, "-C", tempDir]);

  const source = await shapefile.open(
    path.join(tempDir, "ParcelDimension", "ParcelDimension.shp"),
    path.join(tempDir, "ParcelDimension", "ParcelDimension.dbf"),
  );

  while (true) {
    const next = await source.read();
    if (next.done) break;
    const text = String(next.value.properties?.TEXT || "").trim();
    if (!/^\d+(\.\d+)?$/.test(text)) continue;
    const center = geometryCenter(next.value.geometry);
    if (!center) continue;

    for (const target of targets) {
      const distanceFt = Math.hypot(center[0] - target.projected[0], center[1] - target.projected[1]);
      if (distanceFt <= 1200) {
        pushNearest(target, {
          text,
          distanceFt: Math.round(distanceFt),
        });
      }
    }
  }

  const parcels = targets.map((target) => {
    const seen = new Set();
    const labels = target.nearest.filter((item) => {
      if (seen.has(item.text)) return false;
      seen.add(item.text);
      return true;
    });
    return {
      accountNum: target.accountNum,
      sourceLayer: "ParcelDimension",
      labels,
    };
  });

  fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), parcels }, null, 2));
  console.log(`Wrote ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

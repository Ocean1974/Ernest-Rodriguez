const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const manifestArg = process.argv.find((arg) => arg.startsWith("--manifest="));
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
if (!manifestArg) throw new Error("--manifest is required");
const manifestPath = path.resolve(root, manifestArg.slice("--manifest=".length));
const allowedRoot = path.resolve(root, "public/data/counties");
if (!(manifestPath === allowedRoot || manifestPath.startsWith(`${allowedRoot}${path.sep}`))) throw new Error("Manifest must remain inside public/data/counties");
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : Infinity;
if (!(limit === Infinity || (Number.isSafeInteger(limit) && limit > 0))) throw new Error("--limit must be a positive integer");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const manifestDirectory = path.dirname(manifestPath);
const allowedFields = ["countyParcelId", "accountNum", "address", "propertyName", "totalValue", "landAreaSqFt", "landUseCode", "landUseDescription", "yearBuilt", "grossBuildingArea", "blockId"];
let streamed = 0;
let invalid = 0;
let inspected = 0;
for (const chunk of manifest.chunks || []) {
  if (streamed >= limit) break;
  const chunkPath = path.resolve(manifestDirectory, String(chunk.file || ""));
  if (!chunkPath.startsWith(`${manifestDirectory}${path.sep}`)) throw new Error(`Unsafe chunk path: ${chunk.file}`);
  const payload = JSON.parse(fs.readFileSync(chunkPath, "utf8"));
  const parcels = payload.parcels || [];
  if (parcels.length !== Number(chunk.count)) throw new Error(`Chunk count mismatch: ${chunk.id}`);
  inspected += parcels.length;
  for (const parcel of parcels) {
    if (streamed >= limit) break;
    const geometry = parcel.realGeometry?.geometry || null;
    if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type) || !Array.isArray(geometry.coordinates)) { invalid += 1; continue; }
    const properties = Object.fromEntries(allowedFields.map((field) => [field, parcel[field] ?? ""]));
    process.stdout.write(`${JSON.stringify({ type: "Feature", properties, geometry })}\n`);
    streamed += 1;
  }
}
if (limit === Infinity && inspected !== Number(manifest.featureCount)) throw new Error(`Manifest feature count mismatch: ${inspected} != ${manifest.featureCount}`);
process.stderr.write(`${JSON.stringify({ schemaVersion: "wr-county-tile-stream-summary-v1", countyId: manifest.countyId || manifest.sourceCountyId || "", expectedFeatureCount: Number(manifest.featureCount), inspectedFeatureCount: inspected, streamedFeatureCount: streamed, invalidGeometryCount: invalid, propertyFields: allowedFields })}\n`);

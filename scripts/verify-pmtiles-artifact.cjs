const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function sha256(file) {
  return new Promise((resolve, reject) => {
    const digest = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", (chunk) => digest.update(chunk)).on("error", reject).on("end", () => resolve(digest.digest("hex")));
  });
}

(async () => {
  const root = path.join(__dirname, "..");
  const artifactPath = path.resolve(process.argv[2] || path.join(root, "output", "white-rabbit-dallas-parcels.pmtiles"));
  const manifestPath = path.resolve(process.argv[3] || `${artifactPath}.manifest.json`);
  const expectedCountyId = process.argv[4] || "dallas-county-dcad";
  const expectedFeatureCount = Number(process.argv[5] || 696601);
  if (!fs.existsSync(artifactPath) || !fs.existsSync(manifestPath)) throw new Error("PMTiles artifact and manifest are both required");
  const stats = fs.statSync(artifactPath);
  const handle = fs.openSync(artifactPath, "r");
  const headerBytes = Buffer.alloc(127);
  fs.readSync(handle, headerBytes, 0, 127, 0); fs.closeSync(handle);
  const digest = await sha256(artifactPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const delivery = await import("../src/map/geospatialDelivery.mjs");
  const headerVerification = delivery.verifyPmtilesHeader(headerBytes, { minZoom: 10, maxZoom: 16 });
  const manifestVerification = delivery.verifyPmtilesArtifactManifest(manifest, { artifactBytes: stats.size, sha256: digest }, { sourceCountyId: expectedCountyId, expectedFeatureCount });
  const report = { schemaVersion: "wr-pmtiles-artifact-verification-v1", generatedAt: new Date().toISOString(), artifact: artifactPath, artifactBytes: stats.size, sha256: digest, status: headerVerification.status === "passed" && manifestVerification.status === "passed" ? "passed" : "failed", headerVerification, manifestVerification };
  fs.writeFileSync(`${artifactPath}.verification.json`, JSON.stringify(report, null, 2));
  if (report.status !== "passed") throw new Error("PMTiles artifact verification failed");
  console.log(`PMTiles artifact verified: ${artifactPath}`);
})().catch((error) => { console.error(error); process.exit(1); });

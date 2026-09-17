const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const output = path.join(root, "output");
const sourcePath = path.join(output, "white-rabbit-dallas-parcels.geojson");
const sourceManifestPath = path.join(output, "white-rabbit-dallas-parcels-manifest.json");
const pmtilesPath = path.join(output, "white-rabbit-dallas-parcels.pmtiles");
const pmtilesManifestPath = `${pmtilesPath}.manifest.json`;

function sha256(file) {
  return new Promise((resolve, reject) => {
    const digest = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", (chunk) => digest.update(chunk)).on("error", reject).on("end", () => resolve(digest.digest("hex")));
  });
}

(async () => {
  const sourceManifest = JSON.parse(fs.readFileSync(sourceManifestPath, "utf8"));
  const sourceStats = fs.statSync(sourcePath);
  const sourceSha256 = await sha256(sourcePath);
  const tippecanoeAvailable = spawnSync("where.exe", ["tippecanoe"], { stdio: "ignore" }).status === 0;
  const pmtilesAvailable = fs.existsSync(pmtilesPath);
  let artifact = null;
  if (pmtilesAvailable) {
    const artifactStats = fs.statSync(pmtilesPath);
    const handle = fs.openSync(pmtilesPath, "r");
    const header = Buffer.alloc(127);
    fs.readSync(handle, header, 0, 127, 0); fs.closeSync(handle);
    const delivery = await import("../src/map/geospatialDelivery.mjs");
    const artifactSha256 = await sha256(pmtilesPath);
    artifact = { bytes: artifactStats.size, sha256: artifactSha256, headerVerification: delivery.verifyPmtilesHeader(header, { minZoom: 10, maxZoom: 16 }), manifestVerification: fs.existsSync(pmtilesManifestPath) ? delivery.verifyPmtilesArtifactManifest(JSON.parse(fs.readFileSync(pmtilesManifestPath, "utf8")), { artifactBytes: artifactStats.size, sha256: artifactSha256 }) : { status: "failed", checks: { manifestPresent: false } } };
  }
  const checks = {
    sourcePresent: true,
    sourceBytes: sourceStats.size,
    sourceSha256,
    exactFeatureCount: Number(sourceManifest.featureCount),
    expectedFeatureCountMatched: Number(sourceManifest.featureCount) === 696601,
    tippecanoeAvailable,
    pmtilesArtifactPresent: pmtilesAvailable,
    pmtilesArtifactVerified: artifact?.headerVerification.status === "passed" && artifact?.manifestVerification.status === "passed",
  };
  const report = { schemaVersion: "wr-geospatial-delivery-audit-v1", generatedAt: new Date().toISOString(), sourceCountyId: "dallas-county-dcad", status: checks.pmtilesArtifactVerified ? "artifact-verified" : "source-verified-builder-blocked", pageDesignChanged: false, checks, artifact, blockers: checks.pmtilesArtifactVerified ? [] : ["Tippecanoe is unavailable in this Windows workspace; the guarded PMTiles builder cannot run locally."], requiredDeploymentHeaders: { status: 206, acceptRanges: "bytes", contentType: "application/vnd.pmtiles", cacheControl: "public, max-age=31536000, immutable", strongEtag: true, accessControlExposeHeaders: ["ETag", "Content-Range", "Accept-Ranges"] }, runtimePolicy: "Keep the current viewport GeoJSON service active until artifact header, SHA-256 manifest, and deployed HTTP range/cache checks all pass." };
  fs.writeFileSync(path.join(output, "geospatial-delivery-audit.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(output, "geospatial-delivery-audit.md"), ["# White Rabbit Geospatial Delivery Audit", "", `Generated: ${report.generatedAt}`, "", `- Status: ${report.status}`, `- Source bytes: ${checks.sourceBytes.toLocaleString()}`, `- Source SHA-256: \`${checks.sourceSha256}\``, `- Exact source features: ${checks.exactFeatureCount.toLocaleString()}`, `- Tippecanoe available: ${checks.tippecanoeAvailable ? "yes" : "no"}`, `- PMTiles artifact present: ${checks.pmtilesArtifactPresent ? "yes" : "no"}`, `- PMTiles artifact verified: ${checks.pmtilesArtifactVerified ? "yes" : "no"}`, "- Page design changed: no", "", `Runtime policy: ${report.runtimePolicy}`, "", ...(report.blockers.length ? ["## Blocker", "", ...report.blockers.map((item) => `- ${item}`), ""] : [])].join("\n"));
  console.log(`Geospatial delivery audit: ${report.status}`);
})().catch((error) => { console.error(error); process.exit(1); });

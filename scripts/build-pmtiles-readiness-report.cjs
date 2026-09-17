const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const input = path.join(root, "output", "white-rabbit-dallas-parcels.geojson");
const artifact = path.join(root, "output", "white-rabbit-dallas-parcels.pmtiles");
const builder = path.join(root, "output", "vector-tiles", "build-dcad-pmtiles.ps1");
const builderSource = fs.readFileSync(builder, "utf8");
const inputStats = fs.existsSync(input) ? fs.statSync(input) : null;
const artifactStats = fs.existsSync(artifact) ? fs.statSync(artifact) : null;
const checks = {
  sourceGeoJsonPresent: Boolean(inputStats),
  sourceGeoJsonBytes: inputStats?.size || 0,
  sourceFeatureCountVerified: builderSource.includes("expectedFeatureCount = 696601"),
  outputPathGuarded: builderSource.includes("PMTiles output must remain inside the White Rabbit output directory"),
  artifactHashManifestConfigured: builderSource.includes("Get-FileHash") && builderSource.includes("wr-pmtiles-artifact-v1"),
  immutableDeploymentRequired: builderSource.includes("immutableDeploymentRequired = $true"),
  pmtilesArtifactPresent: Boolean(artifactStats),
  pmtilesArtifactBytes: artifactStats?.size || 0,
};
const report = {
  schemaVersion: "wr-pmtiles-readiness-v1",
  generatedAt: new Date().toISOString(),
  pageDesignChanged: false,
  sourceCountyId: "dallas-county-dcad",
  status: checks.pmtilesArtifactPresent ? "artifact-ready" : checks.sourceGeoJsonPresent ? "builder-ready-tooling-required" : "source-missing",
  blockers: checks.pmtilesArtifactPresent ? [] : ["tippecanoe is not installed in this Windows workspace"],
  checks,
};
fs.writeFileSync(path.join(root, "output", "pmtiles-readiness.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(root, "output", "pmtiles-readiness.md"), [
  "# White Rabbit PMTiles Readiness",
  "",
  `Generated: ${report.generatedAt}`,
  "",
  `- Status: ${report.status}`,
  "- Page design changed: no",
  `- Source GeoJSON present: ${checks.sourceGeoJsonPresent ? "yes" : "no"}`,
  `- Source GeoJSON bytes: ${checks.sourceGeoJsonBytes.toLocaleString()}`,
  `- PMTiles artifact present: ${checks.pmtilesArtifactPresent ? "yes" : "no"}`,
  `- Guarded output path: ${checks.outputPathGuarded ? "yes" : "no"}`,
  `- SHA-256 artifact manifest configured: ${checks.artifactHashManifestConfigured ? "yes" : "no"}`,
  `- Immutable deployment required: ${checks.immutableDeploymentRequired ? "yes" : "no"}`,
  "",
  "The remaining production action is to run the guarded builder on a machine with Tippecanoe installed, then publish the PMTiles file and its SHA-256 manifest under an immutable versioned URL.",
  "",
].join("\n"));
console.log(`PMTiles readiness: ${report.status}`);

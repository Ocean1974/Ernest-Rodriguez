const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8").replace(/^\uFEFF/, ""));
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const universe = readJson("data/national-county-intelligence/us-county-universe.json");
const report = readJson("output/national-county-intelligence/all-county-pipeline-scaffold-report.json");
const aliases = { "dallas-county-tx": "dallas", "jefferson-county-ky": "louisville", "tarrant-county-tx": "tarrant" };

assert(report.coveredCountyCount === universe.countyEquivalentCount, "Every Census county/county-equivalent must have pipeline coverage");
let scaffoldOnlyCount = 0;

for (const county of universe.counties) {
  const folder = aliases[county.countyId] || county.countyId;
  assert(exists(`data/county-adapters/${folder}/adapter.json`), `Missing adapter scaffold for ${county.countyId}`);
  assert(exists(`data/county-adapters/${folder}/pipeline.json`), `Missing pipeline scaffold for ${county.countyId}`);
  const pipeline = readJson(`data/county-adapters/${folder}/pipeline.json`);
  assert(pipeline.defaultMode === "plan", `${county.countyId} pipeline must default to plan mode`);
  assert(pipeline.steps.some((step) => step.id === "build-parcel-service"), `${county.countyId} pipeline must include viewport/search build`);
  assert(pipeline.steps.some((step) => step.id === "validate"), `${county.countyId} pipeline must include QC`);
  const adapter = readJson(`data/county-adapters/${folder}/adapter.json`);
  if (adapter.scaffoldOnly === true) scaffoldOnlyCount += 1;
}

assert(scaffoldOnlyCount > 2800, "The national county universe must retain the generated scaffold-only pipelines");

for (const countyId of report.created) {
  const adapter = readJson(`data/county-adapters/${countyId}/adapter.json`);
  assert(adapter.status === "pilot" && adapter.enabledForProduction === false, `${countyId} must remain disabled`);
  assert(adapter.scaffoldOnly === true, `${countyId} must be labeled scaffold-only`);
  assert(adapter.verifiedCounts.parcelGeometryFeatures === 0, `${countyId} must not invent parcel counts`);
  assert(String(adapter.joinKeys.primaryParcelAccount).includes("source-needed"), `${countyId} must not invent join keys`);
}

console.log(`All ${report.coveredCountyCount} U.S. county pipeline scaffolds passed.`);

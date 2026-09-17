const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

const scriptSource = fs.readFileSync(path.join(root, "scripts", "build-county-qc-reports.cjs"), "utf8");
assert(scriptSource.includes("discoverCountyAdapters"), "QC builder must discover county adapter folders");
assert(scriptSource.includes("ownerEnrichment"), "QC builder must validate owner enrichment config");
assert(scriptSource.includes("Pipeline protects no-redesign UI constraint"), "QC builder must protect the no-redesign constraint");

execFileSync("node", ["scripts/build-county-qc-reports.cjs"], { cwd: root, stdio: "pipe" });

const index = readJson("output/county-qc/index.json");
const dallas = readJson("output/county-qc/dallas-county-dcad.json");
const tarrant = readJson("output/county-qc/tarrant-county-tad.json");
const dallasMd = fs.readFileSync(path.join(root, "output", "county-qc", "dallas-county-dcad.md"), "utf8");
const tarrantMd = fs.readFileSync(path.join(root, "output", "county-qc", "tarrant-county-tad.md"), "utf8");
const indexMd = fs.readFileSync(path.join(root, "output", "county-qc", "index.md"), "utf8");

assert(index.countyCount >= 1, "QC index must include at least one county");
assert(index.counties.some((county) => county.adapterId === "dallas-county-dcad"), "QC index must include Dallas County DCAD");
assert(index.counties.some((county) => county.adapterId === "tarrant-county-tad"), "QC index must include the Tarrant County pilot");
assert(dallas.adapterId === "dallas-county-dcad", "Dallas QC report must identify the adapter");
assert(dallas.countyName === "Dallas County", "Dallas QC report must identify the county");
assert(dallas.failCount === 0, "Dallas QC report should not have failing checks");
assert(dallas.checks.some((item) => item.label === "Owner enrichment join key is configured" && item.status === "pass"), "Dallas QC must validate owner enrichment");
assert(dallas.checks.some((item) => item.label === "Optional county layers are declared" && item.status === "pass"), "Dallas QC must validate optional county layers");
assert(dallas.checks.some((item) => item.label === "Pipeline protects no-redesign UI constraint" && item.status === "pass"), "Dallas QC must validate no-redesign pipeline constraint");
assert(dallas.checks.some((item) => item.label === "Parcel manifest count matches verified county count" && item.status === "pass"), "Dallas QC must validate parcel count");
assert(dallas.productionGap.includes("PMTiles"), "Dallas QC must preserve the PMTiles production gap");
assert(dallasMd.includes("County QC Report: Dallas County"), "Dallas QC markdown report must exist");
assert(dallasMd.includes("This QC report is data plumbing only"), "Dallas QC markdown must state that pages are not redesigned");
assert(tarrant.adapterId === "tarrant-county-tad", "Tarrant QC report must identify the pilot adapter");
assert(tarrant.adapterStatus === "pilot", "Tarrant QC report must mark pilot status");
assert(tarrant.failCount === 0, "Tarrant's remaining intelligence-layer gaps should be warnings, not failures");
assert(tarrant.warningCount > 0, "Tarrant should retain readiness warnings until optional intelligence layers and activation review are complete");
assert(tarrant.verifiedCounts.parcelGeometryFeatures === 758633, "Tarrant QC must preserve the exact official parcel count");
assert(tarrant.verifiedCounts.appParcelChunks === 1608, "Tarrant QC must preserve the full viewport chunk count");
assert(tarrant.verifiedCounts.parcelSearchShards === 1111, "Tarrant QC must preserve the full search shard count");
assert(tarrant.productionGap.includes("Full official parcel snapshot"), "Tarrant QC must recognize the completed full parcel service");
assert(tarrant.productionGap.includes("Permits, zoning, floodplain, development, demand, PMTiles"), "Tarrant QC must preserve its remaining intelligence and production gaps");
assert(tarrantMd.includes("County QC Report: Tarrant County"), "Tarrant QC markdown report must exist");
assert(indexMd.includes("County QC Report Index"), "QC index markdown must exist");

console.log("White Rabbit county QC report tests passed.");

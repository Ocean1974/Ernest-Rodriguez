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

const adapter = readJson("data/county-adapters/dallas/adapter.json");
const pipeline = readJson("data/county-adapters/dallas/pipeline.json");
const tarrantAdapter = readJson("data/county-adapters/tarrant/adapter.json");
const tarrantPipeline = readJson("data/county-adapters/tarrant/pipeline.json");
const schema = readJson("data/schemas/universal-parcel.schema.json");
const runnerSource = fs.readFileSync(path.join(root, "scripts", "run-county-ingestion.cjs"), "utf8");
const docs = fs.readFileSync(path.join(root, "docs", "county-ingestion-pipeline.md"), "utf8");

assert(pipeline.countyAdapter === "data/county-adapters/dallas/adapter.json", "Dallas pipeline must point to the Dallas adapter");
assert(pipeline.universalParcelSchema === adapter.universalParcelSchema.schemaPath, "Dallas pipeline must point to the universal parcel schema");
assert(adapter.universalParcelSchema.version === schema.properties.schemaVersion.const, "Dallas adapter schema version must match the universal schema");
assert(pipeline.steps.length >= 8, "County pipeline must include the full repeatable ingestion flow");
assert(pipeline.steps.some((step) => step.id === "inspect-sources"), "County pipeline must inspect source schemas");
assert(pipeline.steps.some((step) => step.id === "build-parcel-geojson"), "County pipeline must build parcel GeoJSON");
assert(pipeline.steps.some((step) => step.id === "build-parcel-service"), "County pipeline must build viewport parcel chunks");
assert(pipeline.steps.some((step) => step.id === "fetch-permits" && step.requiresNetwork), "County pipeline must mark network permit fetches");
assert(pipeline.steps.some((step) => step.id === "validate" && step.command === "npm.cmd test"), "County pipeline must run tests");
assert(pipeline.productionTileStep.expectedOutput === "output/white-rabbit-dallas-parcels.pmtiles", "County pipeline must document the PMTiles production output");
assert(pipeline.uiConstraint.includes("Do not redesign"), "County pipeline must protect the locked page visuals");
assert(tarrantAdapter.status === "pilot", "Tarrant adapter must be a pilot county");
assert(tarrantPipeline.countyAdapter === "data/county-adapters/tarrant/adapter.json", "Tarrant pipeline must point to the Tarrant adapter");
assert(tarrantPipeline.steps.some((step) => step.id === "validate" && step.command === "npm.cmd run county:qc"), "Tarrant pilot pipeline must validate through county QC");

assert(runnerSource.includes("validateAdapter"), "County ingestion runner must validate adapters before execution");
assert(runnerSource.includes("replace(/^\\uFEFF/, \"\")"), "County ingestion runner must accept BOM-prefixed county adapter JSON");
assert(runnerSource.includes("--execute"), "County ingestion runner must support execute mode");
assert(runnerSource.includes("Plan mode only"), "County ingestion runner must default to safe plan mode");
assert(docs.includes("Repeatable County Ingestion Pipeline"), "County ingestion docs must exist");
assert(docs.includes("Do not redesign or restyle"), "County ingestion docs must protect the UI baseline");

execFileSync("node", ["scripts/run-county-ingestion.cjs", "--county", "dallas", "--plan"], { cwd: root, stdio: "pipe" });
const plan = readJson("output/county-ingestion-plan-dallas-county-dcad.json");
assert(plan.adapterId === "dallas-county-dcad", "County ingestion plan must identify the Dallas adapter");
assert(plan.steps.some((step) => step.id === "build-development-intelligence"), "County ingestion plan must include development intelligence");
assert(plan.validation.errors.length === 0, "County ingestion plan must have no validation errors");
assert(fs.existsSync(path.join(root, "output", "county-ingestion-plan-dallas-county-dcad.md")), "County ingestion markdown plan must be written");

execFileSync("node", ["scripts/run-county-ingestion.cjs", "--county", "collin-county-tx", "--plan"], { cwd: root, stdio: "pipe" });
const collinPlan = readJson("output/county-ingestion-plan-collin-county-tx.json");
assert(collinPlan.adapterId === "collin-county-tx", "County ingestion runner must plan BOM-prefixed Collin adapter JSON");
assert(collinPlan.validation.errors.length === 0, "Collin ingestion plan must have no validation errors");

execFileSync("node", ["scripts/run-county-ingestion.cjs", "--county", "fayette-county-ky", "--plan"], { cwd: root, stdio: "pipe" });
const fayettePlan = readJson("output/county-ingestion-plan-fayette-county-ky.json");
const fayettePlanMd = fs.readFileSync(path.join(root, "output", "county-ingestion-plan-fayette-county-ky.md"), "utf8");
assert(fayettePlan.adapterId === "fayette-county-ky", "County ingestion runner must plan generic Kentucky adapters");
assert(fayettePlan.productionTileStep?.id === "build-pmtiles", "Generic Kentucky plans must include the canonical production tile handoff");
assert(fayettePlan.productionTileStep?.expectedOutput.endsWith("fayette-county-ky-parcels.pmtiles"), "Kentucky tile output must remain county-scoped");
assert(fayettePlanMd.includes("Expected output"), "Configured production tile handoff must be documented in the plan");
assert(!fayettePlanMd.includes("Not configured"), "Synchronized Kentucky plans must not lose their production tile handoff");

console.log("White Rabbit county ingestion pipeline tests passed.");

const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const { planParcelQuery } = await import("../src/search/parcelQueryPlanner.mjs");
  const plan = planParcelQuery("Show parcels over 5 acres owned by an LLC, built before 1990, with no recent permits and improvement value below land value");
  assert.equal(plan.schemaVersion, "wr-parcel-query-plan-v1");
  assert(plan.filters.some((filter) => filter.field === "landAreaAcres" && filter.operator === ">" && filter.value === 5));
  assert(plan.filters.some((filter) => filter.field === "ownerEntityType" && filter.value === "llc"));
  assert(plan.filters.some((filter) => filter.field === "yearBuilt" && filter.value === 1990));
  assert(plan.filters.some((filter) => filter.field === "recentPermitCount" && filter.value === 0));
  assert(plan.filters.some((filter) => filter.field === "improvementValue" && filter.operator === "<field"));
  assert.equal(plan.execution.requiresPermitData, true);
  assert(plan.explanation.length === plan.filters.length);

  const acquisition = planParcelQuery("Find vacant land between 5 and 20 acres with buildings over 50k sqft, valued under $4m, having recent permits");
  assert(acquisition.filters.some((filter) => filter.field === "landAreaAcres" && filter.operator === ">=" && filter.value === 5));
  assert(acquisition.filters.some((filter) => filter.field === "landAreaAcres" && filter.operator === "<=" && filter.value === 20));
  assert(acquisition.filters.some((filter) => filter.field === "grossBuildingArea" && filter.operator === ">" && filter.value === 50000));
  assert(acquisition.filters.some((filter) => filter.field === "totalValue" && filter.operator === "<" && filter.value === 4000000));
  assert(acquisition.filters.some((filter) => filter.field === "vacantLand" && filter.value === true));
  assert(acquisition.filters.some((filter) => filter.field === "recentPermitCount" && filter.operator === ">"));
  assert.equal(acquisition.keywords.length, 0, "Structured acquisition phrases should not leak into keyword matching");

  const spatial = planParcelQuery("industrial land within 10 minutes of downtown");
  assert(spatial.unsupported.includes("spatial-proximity-requires-map-context"));
  assert.equal(spatial.execution.requiresSpatialContext, true);
  assert(spatial.keywords.includes("industrial"));
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "parcel-query-plan.schema.json"), "utf8"));
  assert.equal(schema.properties.schemaVersion.const, "wr-parcel-query-plan-v1");
  assert(schema.required.includes("explanation"));
  console.log("White Rabbit explainable parcel query planner tests passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

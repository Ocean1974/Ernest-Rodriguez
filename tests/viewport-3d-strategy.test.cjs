const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const { createViewport3dRequest, planViewport3dLoading } = await import("../src/analysis3d/viewport3dStrategy.mjs");
  const request = createViewport3dRequest({ bounds: [-96.9, 32.7, -96.7, 32.9], zoom: 18, pitch: 60, estimatedFeatureCount: 2000, requestedAt: "2026-08-13T12:00:00.000Z" });
  assert.equal(request.schemaVersion, "wr-3d-viewport-request-v1");
  const detailed = planViewport3dLoading(request);
  assert.equal(detailed.schemaVersion, "wr-3d-viewport-plan-v1");
  assert.equal(detailed.levelOfDetail, "detailed");
  assert(detailed.layers.find((layer) => layer.id === "terrain").enabled);
  assert(detailed.layers.find((layer) => layer.id === "proposals").enabled);
  assert(detailed.clientRules.includes("never-load-countywide-3d-geometry"));
  assert(detailed.requiredServerBehavior.includes("clip-to-viewport"));

  const overloaded = planViewport3dLoading({ ...request, estimatedFeatureCount: 20000 });
  assert.equal(overloaded.levelOfDetail, "building");
  assert.equal(overloaded.layers.find((layer) => layer.id === "proposals").enabled, false);
  const regional = planViewport3dLoading({ bounds: [-100, 30, -95, 35], zoom: 8, estimatedFeatureCount: 500 });
  assert.equal(regional.levelOfDetail, "regional");
  assert.equal(regional.layers.find((layer) => layer.id === "parcels").enabled, false);
  assert.throws(() => createViewport3dRequest({ bounds: [-96, 33, -97, 32], zoom: 15 }), /bounds/);

  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "viewport-3d-plan.schema.json"), "utf8"));
  assert.equal(schema.properties.schemaVersion.const, "wr-3d-viewport-plan-v1");
  console.log("White Rabbit 3D viewport and level-of-detail strategy tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

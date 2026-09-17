const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const analysis = await import("../src/analysis3d/developmentAnalysis.mjs");
  const propertyId = "wrp:v1:dallas-county-dcad:A1";
  const site = analysis.createDevelopmentSiteModel({
    whiteRabbitPropertyId: propertyId,
    siteAreaSqFt: { value: 43560, source: "dcad-2026", sourceField: "landAreaSqFt", asOf: "2026-01-01", confidence: 0.98 },
    terrain: { minimumElevationFt: 490, maximumElevationFt: 505, meanElevationFt: 497, sourceDatasetId: "usgs-3dep" },
    constraints: { maximumHeightFt: 60, maximumFar: 2, maximumCoveragePct: 50, minimumFrontSetbackFt: 20, minimumRearSetbackFt: 10, minimumSideSetbackFt: 5 },
  });
  assert.equal(site.schemaVersion, "wr-development-site-model-v1");
  assert.equal(site.status, "ready");
  assert.equal(site.siteAreaSqFt.source, "dcad-2026");

  const proposal = analysis.createMassingProposal({ footprintAreaSqFt: 10000, stories: 4, clearances: { frontFt: 25, rearFt: 12, sideFt: 8 } });
  assert.equal(proposal.grossFloorAreaSqFt.value, 40000);
  assert.equal(proposal.grossFloorAreaSqFt.status, "derived");
  assert.equal(proposal.floorToFloorHeightFt.status, "defaulted");
  const feasible = analysis.evaluateDevelopmentFeasibility(site, proposal);
  assert.equal(feasible.schemaVersion, "wr-development-feasibility-v1");
  assert.equal(feasible.status, "feasible");
  assert.equal(feasible.metrics.heightFt, 48);
  assert(Math.abs(feasible.metrics.far - 0.918) < 0.001);
  assert(feasible.checks.every((check) => check.status === "pass"));

  const failing = analysis.evaluateDevelopmentFeasibility(site, analysis.createMassingProposal({ footprintAreaSqFt: 25000, stories: 6, clearances: { frontFt: 10, rearFt: 12, sideFt: 8 } }));
  assert.equal(failing.status, "not-feasible");
  assert(failing.checks.some((check) => check.id === "height" && check.status === "fail"));
  assert(failing.checks.some((check) => check.id === "front-setback" && check.status === "fail"));

  const unknownConstraints = analysis.evaluateDevelopmentFeasibility({ whiteRabbitPropertyId: propertyId, siteAreaSqFt: 43560 }, { footprintAreaSqFt: 10000, stories: 2 });
  assert.equal(unknownConstraints.status, "indeterminate");
  assert(unknownConstraints.missingEvidence.includes("height"));
  const missingProposal = analysis.evaluateDevelopmentFeasibility({ whiteRabbitPropertyId: propertyId, siteAreaSqFt: 43560 }, {});
  assert.equal(missingProposal.status, "insufficient-evidence");

  const shadow = analysis.calculateShadow({ heightFt: 100, sunElevationDeg: 45, sunAzimuthDeg: 180, observedAt: "2026-08-13T12:00:00Z" });
  assert.equal(shadow.status, "modeled");
  assert(Math.abs(shadow.shadowLengthFt - 100) < 0.001);
  assert.equal(shadow.shadowBearingDeg, 0);
  assert(Math.abs(shadow.vector.northFt - 100) < 0.001);
  assert.equal(analysis.calculateShadow({ heightFt: 100, sunElevationDeg: 0, sunAzimuthDeg: 180 }).status, "insufficient-evidence");

  const clear = analysis.analyzeLineOfSight({ observer: { groundElevationFt: 0, eyeHeightFt: 6 }, target: { distanceFt: 1000, groundElevationFt: 0, heightFt: 6 }, obstructions: [{ id: "b1", distanceFt: 500, groundElevationFt: 0, heightFt: 5 }] });
  assert.equal(clear.visible, true);
  assert.equal(clear.minimumClearanceFt, 1);
  const blocked = analysis.analyzeLineOfSight({ observer: { groundElevationFt: 0, eyeHeightFt: 6 }, target: { distanceFt: 1000, groundElevationFt: 0, heightFt: 6 }, obstructions: [{ id: "b1", distanceFt: 500, groundElevationFt: 0, heightFt: 10 }] });
  assert.equal(blocked.visible, false);
  assert.equal(blocked.minimumClearanceFt, -4);

  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "development-3d-analysis.schema.json"), "utf8"));
  assert.equal(schema.$defs.feasibility.properties.schemaVersion.const, "wr-development-feasibility-v1");
  console.log("White Rabbit 3D development feasibility and geometry-math tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

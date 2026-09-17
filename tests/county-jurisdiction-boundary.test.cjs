const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const boundary = await import("../src/operations/countyJurisdictionBoundary.mjs");
  const digest = boundary.countyBoundarySha256;
  const baseProbe = { countyId: "test-county", sourceId: "city-boundaries", publisher: "Official County", serviceUrl: "https://official.example/MapServer", layerUrl: "https://official.example/MapServer/0", layerName: "City Boundaries", geometryType: "esriGeometryPolygon", spatialReference: "EPSG:4326", objectIdField: "OBJECTID", jurisdictionNameField: "NAME", maxRecordCount: 1000, featureCount: 3, distinctNames: ["City A", "City B"], expectedUniverseNames: ["City A", "City B"], metadataSha256: digest("metadata"), countResponseSha256: digest("count"), distinctResponseSha256: digest("names"), observedAt: "2026-08-23" };
  const probe = boundary.createCountyBoundarySourceProbe(baseProbe);
  assert.equal(probe.status, "discovery-only");
  assert.equal(probe.capturesGeometry, false);
  assert.equal(probe.captureAuthorized, false);
  assert.deepEqual(probe.missingExpectedNames, []);
  assert.throws(() => boundary.createCountyBoundarySourceProbe({ ...baseProbe, featureCount: 1 }), /smaller/);
  assert.throws(() => boundary.createCountyBoundarySourceProbe({ ...baseProbe, serviceUrl: "http://insecure.example" }), /HTTPS/);

  const mismatch = boundary.createCountyEtjReconciliation({ countyId: "test-county", guidanceUrl: "https://official.example/etj-guidance", guidanceObservedAt: "2026-08-23", guidanceNames: ["City A ETJ", "City B ETJ"], serviceNames: ["City A ETJ", "City C ETJ"], serviceProbeSha256: probe.probeSha256 });
  assert.equal(mismatch.status, "inconsistent-needs-review");
  assert.deepEqual(mismatch.missingFromService, ["CITY B ETJ"]);
  assert.deepEqual(mismatch.serviceOnly, ["CITY C ETJ"]);
  const blocked = boundary.createCountyBoundarySnapshotPolicy({ countyId: "test-county", sourceProbeSha256: probe.probeSha256, reconciliationSha256: mismatch.reconciliationSha256, reconciliationStatus: mismatch.status, effectiveAt: "2026-08-22", observedAt: "2026-08-23", rights: [], approvalRefs: [] });
  assert.equal(blocked.status, "blocked");
  const reviewed = boundary.createCountyEtjReconciliation({ ...mismatch, resolutionEvidenceRef: "artifact://review/etj" });
  const authorized = boundary.createCountyBoundarySnapshotPolicy({ countyId: "test-county", sourceProbeSha256: probe.probeSha256, reconciliationSha256: reviewed.reconciliationSha256, reconciliationStatus: reviewed.status, effectiveAt: "2026-08-22", observedAt: "2026-08-23", rights: ["store", "derive", "query"], rightsEvidenceRef: "artifact://license", approvalRefs: ["approval://gis", "approval://data-governance"] });
  assert.equal(authorized.status, "capture-authorized");

  const baseAssignment = { countyId: "test-county", countyParcelId: "P-1", boundarySnapshotSha256: digest("snapshot"), effectiveAt: "2026-08-23", geometryValid: true, boundarySnapshotCertified: true };
  const incorporated = boundary.classifyParcelJurisdiction({ ...baseAssignment, candidates: [{ jurisdictionId: "city-a", scope: "incorporated", intersectionRatio: 0.25, containsCentroid: false, boundaryFeatureId: "C1" }, { jurisdictionId: "city-a", scope: "incorporated", intersectionRatio: 0.5, containsCentroid: true, boundaryFeatureId: "C2" }, { jurisdictionId: "city-a-etj", scope: "etj", intersectionRatio: 1, containsCentroid: true, boundaryFeatureId: "E1" }] });
  assert.equal(incorporated.assignedJurisdictionId, "city-a");
  assert.equal(incorporated.candidates[0].intersectionRatio, 0.75);
  assert.equal(incorporated.zoningEligible, true);
  assert.equal(incorporated.etjReviewRequired, false);
  const etj = boundary.classifyParcelJurisdiction({ ...baseAssignment, candidates: [{ jurisdictionId: "city-a-etj", scope: "etj", intersectionRatio: 1, containsCentroid: true, boundaryFeatureId: "E1" }] });
  assert.equal(etj.etjReviewRequired, true);
  assert.equal(etj.zoningEligible, false);
  const tie = boundary.classifyParcelJurisdiction({ ...baseAssignment, candidates: [{ jurisdictionId: "city-a", scope: "incorporated", intersectionRatio: 0.5, containsCentroid: true, boundaryFeatureId: "A" }, { jurisdictionId: "city-b", scope: "incorporated", intersectionRatio: 0.5, containsCentroid: true, boundaryFeatureId: "B" }] });
  assert.equal(tie.ambiguous, true);
  assert.equal(tie.ambiguityReason, "equal-precedence-overlap");
  assert.equal(tie.assignedJurisdictionId, "");
  const uncertified = boundary.classifyParcelJurisdiction({ ...baseAssignment, boundarySnapshotCertified: false, candidates: [{ jurisdictionId: "city-a", scope: "incorporated", intersectionRatio: 1, containsCentroid: true, boundaryFeatureId: "A" }] });
  assert.equal(uncertified.ambiguityReason, "boundary-snapshot-not-certified");

  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/schemas/county-jurisdiction-boundary.schema.json"), "utf8"));
  assert.equal(schema.$defs.assignment.properties.schemaVersion.const, boundary.COUNTY_PARCEL_JURISDICTION_ASSIGNMENT_VERSION);
  const gates = fs.readFileSync(path.join(__dirname, "../src/data/platformFeatureGates.ts"), "utf8");
  for (const gate of ["countyJurisdictionBoundaryCapture", "countyEtjReconciliation", "countyParcelJurisdictionAssignment", "countyTemporalBoundaryHistory"]) assert(gates.includes(`${gate}: false`));
  console.log("White Rabbit effective-dated boundary, ETJ reconciliation, and fail-closed parcel jurisdiction tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const certification = await import("../src/operations/feedCertification.mjs");
  const manifest = certification.createFeedConnectorManifest({ connectorId: "licensed-events", connectorVersion: "1.0.0", providerId: "provider-a", datasetId: "transactions-and-listings", expectedEventSchemaVersion: "wr-property-event-v1", licenseId: "license-2026", contractStartsAt: "2026-01-01", contractExpiresAt: "2027-12-31", permittedCountyIds: ["dallas-county-dcad"], thresholds: { minimumFixtureCount: 20, minimumSampleCount: 1000, maximumP95LagMs: 3600000, maximumLagMs: 7200000, minimumCurrentPct: 99, minimumCanonicalIdentityPct: 99.9, minimumRequiredFieldPct: 99, minimumGeometryPct: 95, maximumDuplicatePct: 0.1, maximumInvalidIdentityPct: 0.1, maximumQuarantinePct: 2 } });
  const loadReport = { schemaVersion: "wr-load-resilience-report-v1", status: "passed", scenarioId: "connector-load" };
  const evidenceInput = {
    connectorId: "licensed-events", connectorVersion: "1.0.0", generatedAt: "2026-08-14T13:00:00.000Z",
    license: { contractExecuted: true, licenseId: "license-2026", rights: { store: true, derive: true, query: true, display: false } },
    schema: { schemaVersion: "wr-property-event-v1", fixtureCount: 25, failedFixtureCount: 0 },
    pointInTime: { futureEvidenceRejected: true, availabilityTimePreserved: true, expiryEnforced: true },
    replay: { idempotencyPassed: true, checkpointResumePassed: true, duplicateWriteCount: 0 },
    freshness: { sampleCount: 5000, p95LagMs: 1800000, maxLagMs: 3600000, currentPct: 99.8 },
    coverage: { sampleCount: 5000, canonicalIdentityPct: 100, requiredFieldPct: 99.5, geometryPct: 98 },
    dataQuality: { duplicatePct: 0.02, invalidIdentityPct: 0, quarantinePct: 0.5 },
    security: { secretRefOnly: true, encryptedTransport: true, ssrfProtection: true, leastPrivilege: true },
    loadReport,
    provenance: { artifactSha256: "a".repeat(64), testRunId: "run-100", independentReviewer: true },
  };
  const evidence = certification.createFeedCertificationEvidence(evidenceInput);
  const decision = certification.certifyFeedConnector({ manifest, evidence, asOf: "2026-08-14T14:00:00.000Z" });
  assert.equal(decision.schemaVersion, "wr-feed-certification-decision-v1");
  assert.equal(decision.status, "certified");
  assert.equal(decision.activationAuthorized, true);
  assert.equal(decision.blockers.length, 0);
  assert.match(decision.certificationSha256, /^[a-f0-9]{64}$/);
  const noQueryRights = certification.createFeedCertificationEvidence({ ...evidenceInput, license: { ...evidenceInput.license, rights: { ...evidenceInput.license.rights, query: false } } });
  const rejected = certification.certifyFeedConnector({ manifest, evidence: noQueryRights, asOf: "2026-08-14T14:00:00.000Z" });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.activationAuthorized, false);
  assert(rejected.blockers.some((blocker) => blocker.checkId === "license-rights"));
  const sparse = certification.certifyFeedConnector({ manifest, evidence: certification.createFeedCertificationEvidence({ connectorId: "licensed-events", connectorVersion: "1.0.0", generatedAt: "2026-08-14T13:00:00.000Z" }), asOf: "2026-08-14T14:00:00.000Z" });
  assert.equal(sparse.status, "rejected", "missing evidence must fail closed");
  assert(sparse.blockers.length >= 10);
  const expired = certification.certifyFeedConnector({ manifest, evidence, asOf: "2028-01-01T00:00:00.000Z" });
  assert(expired.blockers.some((blocker) => blocker.checkId === "contract-window"));
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "feed-certification.schema.json"), "utf8"));
  assert.equal(schema.oneOf[2].properties.schemaVersion.const, "wr-feed-certification-decision-v1");
  console.log("White Rabbit fail-closed license, schema, freshness, coverage, security, load, and feed-certification tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

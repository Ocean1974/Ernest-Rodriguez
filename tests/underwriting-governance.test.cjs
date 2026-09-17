const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

(async () => {
  const governance = await import("../src/underwriting/underwritingGovernance.mjs");
  const comparables = await import("../src/underwriting/marketComparables.mjs");
  const persistence = await import("../src/persistence/platformPersistenceService.mjs");
  const { SqlitePlatformRepository } = await import("../src/persistence/sqlitePlatformRepository.mjs");
  const propertyId = "wrp:v1:dallas-county-dcad:A1";
  const analysisAsOf = "2026-08-14T12:00:00.000Z";
  const createdAt = "2026-08-14T13:00:00.000Z";
  const subject = { whiteRabbitPropertyId: propertyId, propertyType: "office", location: { latitude: 32.7767, longitude: -96.797 }, buildingSqFt: 10000, yearBuilt: 2005 };
  const adjustmentPolicy = {
    annualMarketGrowthPct: { value: 3, source: "licensed-index", asOf: analysisAsOf },
    sizeElasticityPct: { value: -5, source: "approved-policy", asOf: analysisAsOf },
    ageAdjustmentPctPerYear: { value: 0.1, source: "approved-policy", asOf: analysisAsOf },
  };
  const rentComparables = [0, 1, 2].map((index) => ({ id: `rent-${index + 1}`, comparableType: "rent", propertyType: "office", transactionDate: `2026-0${7 - index}-01T00:00:00.000Z`, location: { latitude: 32.7767 + index * 0.005, longitude: -96.797 - index * 0.005 }, economics: { annualRent: 230000 + index * 10000, buildingSqFt: 9500 + index * 500 }, yearBuilt: 2000 + index * 3, source: { datasetId: "licensed-feed", recordId: `rent-${index + 1}`, sourceUrl: "https://data.example", licenseId: "license-1", licenseStatus: "authorized", observedAt: "2026-08-01T00:00:00.000Z", availableAt: "2026-08-02T00:00:00.000Z", expiresAt: "2026-12-31T00:00:00.000Z", sourceFields: {} } }));
  const rentAnalysis = comparables.analyzeMarketComparables({ analysisType: "rent", analysisAsOf, subject, comparables: rentComparables, selectionPolicy: { minComparableCount: 3 }, adjustmentPolicy });
  assert.equal(rentAnalysis.status, "adjusted-estimate");
  const assumptionInput = { purchasePrice: 1000000, rentableAreaSqFt: 10000, rentPerSqFtAnnual: rentAnalysis.estimate.weightedUnitValue, exitCapRatePct: 7 };
  const writer = { organizationId: "org-a", actorUserId: "writer", permissions: ["underwriting:write"] };
  const reviewer = { organizationId: "org-a", actorUserId: "reviewer", permissions: ["underwriting:review"] };
  const approver = { organizationId: "org-a", actorUserId: "approver", permissions: ["underwriting:approve"] };
  let state = governance.createUnderwritingGovernanceState({ organizationId: "org-a", updatedAt: createdAt });
  state = governance.addUnderwritingScenario(state, { id: "scenario-1", whiteRabbitPropertyId: propertyId, name: "Base acquisition", assumptionInput, comparableAnalyses: [rentAnalysis], requiredComparableTypes: ["rent"], createdAt }, writer, { expectedStateRevision: 1 });
  assert.equal(state.revision, 2);
  assert.equal(state.scenarios[0].status, "draft");
  assert.match(state.scenarios[0].evidenceDigest, /^[a-f0-9]{64}$/);
  state = governance.submitUnderwritingScenario(state, "scenario-1", writer, { expectedStateRevision: 2, expectedScenarioRevision: 1, occurredAt: "2026-08-14T13:05:00.000Z" });
  assert.equal(state.scenarios[0].status, "in-review");
  assert.throws(() => governance.recordUnderwritingReview(state, "scenario-1", { decision: "recommended", comment: "Self review" }, { ...writer, permissions: ["underwriting:review"] }, { expectedStateRevision: 3, expectedScenarioRevision: 2, occurredAt: "2026-08-14T13:10:00.000Z" }), (error) => error.code === "WR_SEPARATION_OF_DUTIES");
  state = governance.recordUnderwritingReview(state, "scenario-1", { decision: "recommended", comment: "Comparable evidence and assumptions reviewed" }, reviewer, { expectedStateRevision: 3, expectedScenarioRevision: 2, occurredAt: "2026-08-14T13:10:00.000Z" });
  assert.equal(state.reviews.length, 1);
  assert.equal(state.reviews[0].evidenceDigest, state.scenarios[0].evidenceDigest);
  assert.throws(() => governance.decideUnderwritingScenario(state, "scenario-1", { comment: "Self approval" }, { organizationId: "org-a", actorUserId: "writer", permissions: ["underwriting:approve"] }, { expectedStateRevision: 4, expectedScenarioRevision: 2, occurredAt: "2026-08-14T13:15:00.000Z" }), (error) => error.code === "WR_SEPARATION_OF_DUTIES");
  assert.throws(() => governance.decideUnderwritingScenario(state, "scenario-1", { comment: "Stale approval" }, approver, { expectedStateRevision: 4, expectedScenarioRevision: 1, occurredAt: "2026-08-14T13:15:00.000Z" }), (error) => error.code === "WR_REVISION_CONFLICT");
  state = governance.decideUnderwritingScenario(state, "scenario-1", { decision: "approved", comment: "Approved for acquisition committee" }, approver, { expectedStateRevision: 4, expectedScenarioRevision: 2, occurredAt: "2026-08-14T13:15:00.000Z" });
  assert.equal(state.scenarios[0].status, "approved");
  assert.equal(state.approvals.length, 1);
  assert.equal(state.approvals[0].reviewId, state.reviews[0].id);
  assert.equal(state.approvals[0].evidenceDigest, state.scenarios[0].evidenceDigest);
  assert.throws(() => governance.reviseUnderwritingScenario(state, "scenario-1", { assumptionInput: { ...assumptionInput, purchasePrice: 900000 } }, writer, { expectedStateRevision: 5, expectedScenarioRevision: 3, occurredAt: "2026-08-14T13:20:00.000Z" }), /immutable/);

  state = governance.addUnderwritingScenario(state, { id: "scenario-2", whiteRabbitPropertyId: propertyId, name: "Alternative", assumptionInput, comparableAnalyses: [rentAnalysis], requiredComparableTypes: ["rent"], createdAt: "2026-08-14T13:20:00.000Z" }, writer, { expectedStateRevision: 5 });
  state = governance.submitUnderwritingScenario(state, "scenario-2", writer, { expectedStateRevision: 6, expectedScenarioRevision: 1, occurredAt: "2026-08-14T13:21:00.000Z" });
  state = governance.recordUnderwritingReview(state, "scenario-2", { decision: "changes-requested", comment: "Revise vacancy assumption" }, reviewer, { expectedStateRevision: 7, expectedScenarioRevision: 2, occurredAt: "2026-08-14T13:22:00.000Z" });
  assert.equal(state.scenarios.find((item) => item.id === "scenario-2").status, "changes-requested");
  state = governance.reviseUnderwritingScenario(state, "scenario-2", { assumptionInput: { ...assumptionInput, vacancyPct: 8 } }, writer, { expectedStateRevision: 8, expectedScenarioRevision: 3, occurredAt: "2026-08-14T13:23:00.000Z" });
  assert.equal(state.scenarios.find((item) => item.id === "scenario-2").status, "draft");
  assert.throws(() => governance.submitUnderwritingScenario(state, "scenario-2", { ...writer, organizationId: "org-b" }, { expectedStateRevision: 9, expectedScenarioRevision: 4, occurredAt: "2026-08-14T13:24:00.000Z" }), (error) => error.code === "WR_TENANT_ISOLATION_VIOLATION");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "white-rabbit-underwriting-governance-"));
  const databasePath = path.join(tempDir, "underwriting.sqlite");
  const repository = new SqlitePlatformRepository({ filename: databasePath, clock: () => createdAt });
  const persistenceContext = { organizationId: "org-a", actorUserId: "writer", subjectUserId: "writer", sessionId: "session-writer", requestId: "persist-underwriting", grants: ["persistence:read", "persistence:write"], issuedAt: "2026-08-14T12:00:00.000Z", expiresAt: "2026-08-14T14:00:00.000Z" };
  const otherPersistenceContext = { ...persistenceContext, organizationId: "org-b", actorUserId: "other", subjectUserId: "other", sessionId: "session-other" };
  persistence.persistUnderwritingGovernanceState(repository, persistenceContext, state, { expectedTenantRevision: 0, expectedRecordRevision: 0, idempotencyKey: "persist-governance-1", occurredAt: "2026-08-14T13:30:00.000Z", validation: { now: "2026-08-14T13:30:00.000Z" } });
  const loaded = persistence.loadUnderwritingGovernanceState(repository, persistenceContext, { validation: { now: "2026-08-14T13:30:00.000Z" } });
  assert.equal(loaded.approvals.length, 1);
  assert.equal(loaded.scenarios[0].status, "approved");
  assert.equal(persistence.loadUnderwritingGovernanceState(repository, otherPersistenceContext, { validation: { now: "2026-08-14T13:30:00.000Z" } }), null);
  assert.throws(() => persistence.persistUnderwritingGovernanceState(repository, persistenceContext, { organizationId: "org-b", updatedAt: createdAt }, { expectedTenantRevision: 1 }), (error) => error.code === "WR_TENANT_ISOLATION_VIOLATION");
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "underwriting-governance.schema.json"), "utf8"));
  assert.equal(schema.properties.schemaVersion.const, "wr-underwriting-governance-state-v1");
  repository.close();
  for (const suffix of ["", "-wal", "-shm"]) { const target = `${databasePath}${suffix}`; if (fs.existsSync(target)) fs.rmSync(target); }
  fs.rmdirSync(tempDir);
  console.log("White Rabbit underwriting separation-of-duties, review, approval, immutability, revision, and tenant persistence tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

(async () => {
  const pipeline = await import("../src/operations/countyReleasePipeline.mjs");
  const { SqlitePlatformRepository } = await import("../src/persistence/sqlitePlatformRepository.mjs");
  const persistence = await import("../src/persistence/platformPersistenceService.mjs");
  const sha = (text) => pipeline.countyReleaseSha256(text);
  const fixed = "2026-08-23T12:00:00.000Z";
  const organizationId = "org-county";
  const countyId = "tarrant-county-tad";

  const snapshot = pipeline.createCountySourceSnapshot({
    organizationId,
    countyId,
    countyFips: "48439",
    datasetId: "tad-2026-parcel-export",
    sourceRevision: "2026.08.22",
    officialSourceUrl: "https://example.gov/tarrant/parcels/2026.08.22.zip",
    officialSource: true,
    license: "public-records",
    sourcePublishedAt: "2026-08-22T08:00:00.000Z",
    capturedAt: "2026-08-22T10:00:00.000Z",
    sourceFeatureCount: 10,
    sourceBytes: 4096,
    sourceSha256: sha("official-source"),
    joinKeys: [{ canonicalField: "sourceParcelId", sourceField: "ACCOUNT", normalization: "trim-uppercase", verified: true }],
  });
  assert.equal(snapshot.schemaVersion, pipeline.COUNTY_SOURCE_SNAPSHOT_VERSION);
  assert.equal(snapshot.contentKind, "source-data");
  assert.throws(() => pipeline.createCountySourceSnapshot({ ...snapshot, officialSourceUrl: "http://insecure.example" }), /HTTPS/);

  const requiredArtifactTypes = ["parcel-manifest", "viewport-index", "search-index", "qc-report", "schema-report", "join-key-report", "full-access-report"];
  const artifacts = requiredArtifactTypes.map((type, index) => ({ type, ref: `artifact://county-releases/${countyId}/release-1/${type}`, sha256: sha(`artifact-${type}`), bytes: 100 + index, immutable: true }));
  const bundle = pipeline.createCountyArtifactBundle({
    organizationId,
    countyId,
    releaseId: "release-1",
    sourceSnapshotSha256: snapshot.snapshotSha256,
    generatedAt: "2026-08-22T11:00:00.000Z",
    builderActorId: "builder-1",
    buildRevision: "build-a1",
    counts: {
      emittedFeatureCount: 10,
      geometryFeatureCount: 10,
      uniquePrimaryIdCount: 10,
      searchIndexCount: 10,
      viewportIndexedFeatureCount: 10,
      duplicatePrimaryIdCount: 0,
      missingGeometryCount: 0,
      sourceLineageCount: 10,
      placeholderPathCount: 0,
      qcFailureCount: 0,
      qcWarningCount: 0,
    },
    exclusions: [],
    artifacts,
  });
  assert.equal(bundle.schemaVersion, pipeline.COUNTY_ARTIFACT_BUNDLE_VERSION);
  assert.throws(() => pipeline.createCountyArtifactBundle({ ...bundle, artifacts: [...artifacts, artifacts[0]] }), /unique/);

  const policy = pipeline.createCountyReleasePolicy({ id: "tarrant-production-v1", policyVersion: "1", organizationId, countyId, maximumSourceAgeHours: 72, maximumArtifactAgeHours: 48 });
  const approvals = policy.requiredApprovalRoles.map((role, index) => ({ role, actorId: `reviewer-${index + 1}`, decision: "approve", approvedBundleSha256: bundle.bundleSha256, approvedAt: "2026-08-23T10:00:00.000Z", expiresAt: "2026-08-24T10:00:00.000Z" }));
  const platformReleaseAuthorization = { schemaVersion: "wr-capability-release-decision-v1", capabilityId: `county:${countyId}`, activationAuthorized: true, expiresAt: "2026-08-24T12:00:00.000Z", decisionSha256: sha("platform-decision") };
  const decision = pipeline.evaluateCountyRelease({ policy, sourceSnapshot: snapshot, artifactBundle: bundle, approvals, platformReleaseAuthorization, asOf: fixed });
  assert.equal(decision.status, "authorized");
  assert.equal(decision.activationAuthorized, true);
  assert.equal(decision.blockers.length, 0);
  assert(decision.checks.length >= 20, "release decision must expose detailed checks");

  const tamperedSnapshot = { ...snapshot, sourceFeatureCount: 11 };
  const tampered = pipeline.evaluateCountyRelease({ policy, sourceSnapshot: tamperedSnapshot, artifactBundle: bundle, approvals, platformReleaseAuthorization, asOf: fixed });
  assert.equal(tampered.activationAuthorized, false);
  assert(tampered.blockers.some((item) => item.checkId === "source-integrity"));
  assert(tampered.blockers.some((item) => item.checkId === "source-count-reconciliation"));

  const auditOnlySnapshot = pipeline.createCountySourceSnapshot({ ...snapshot, contentKind: "source-audit" });
  const auditOnlyBundle = pipeline.createCountyArtifactBundle({ ...bundle, sourceSnapshotSha256: auditOnlySnapshot.snapshotSha256 });
  const auditOnlyApprovals = approvals.map((item) => ({ ...item, approvedBundleSha256: auditOnlyBundle.bundleSha256 }));
  const auditOnly = pipeline.evaluateCountyRelease({ policy, sourceSnapshot: auditOnlySnapshot, artifactBundle: auditOnlyBundle, approvals: auditOnlyApprovals, platformReleaseAuthorization, asOf: fixed });
  assert.equal(auditOnly.activationAuthorized, false);
  assert(auditOnly.blockers.some((item) => item.checkId === "source-content"));

  const stale = pipeline.evaluateCountyRelease({ policy, sourceSnapshot: snapshot, artifactBundle: bundle, approvals, platformReleaseAuthorization, asOf: "2026-09-30T12:00:00.000Z" });
  assert.equal(stale.activationAuthorized, false);
  assert(stale.blockers.some((item) => item.checkId === "source-freshness"));
  assert(stale.blockers.some((item) => item.checkId === "artifact-freshness"));
  assert(stale.blockers.some((item) => item.checkId === "platform-release-authorization"));

  const missingApproval = pipeline.evaluateCountyRelease({ policy, sourceSnapshot: snapshot, artifactBundle: bundle, approvals: approvals.slice(0, 2), platformReleaseAuthorization, asOf: fixed });
  assert.equal(missingApproval.activationAuthorized, false);
  assert(missingApproval.blockers.some((item) => item.checkId.startsWith("approval:")));

  const sharedApprover = approvals.map((item) => ({ ...item, actorId: "same-reviewer" }));
  const separated = pipeline.evaluateCountyRelease({ policy, sourceSnapshot: snapshot, artifactBundle: bundle, approvals: sharedApprover, platformReleaseAuthorization, asOf: fixed });
  assert.equal(separated.activationAuthorized, false);
  assert(separated.blockers.some((item) => item.checkId === "approval-separation"));

  const missingArtifactBundle = pipeline.createCountyArtifactBundle({ ...bundle, artifacts: artifacts.slice(1) });
  const missingArtifactApprovals = approvals.map((item) => ({ ...item, approvedBundleSha256: missingArtifactBundle.bundleSha256 }));
  const missingArtifact = pipeline.evaluateCountyRelease({ policy, sourceSnapshot: snapshot, artifactBundle: missingArtifactBundle, approvals: missingArtifactApprovals, platformReleaseAuthorization, asOf: fixed });
  assert.equal(missingArtifact.activationAuthorized, false);
  assert(missingArtifact.blockers.some((item) => item.checkId === "required-artifacts"));

  const excludedBundle = pipeline.createCountyArtifactBundle({
    ...bundle,
    counts: { ...bundle.counts, emittedFeatureCount: 9, geometryFeatureCount: 9, uniquePrimaryIdCount: 9, searchIndexCount: 9, viewportIndexedFeatureCount: 9, sourceLineageCount: 9 },
    exclusions: [{ reasonCode: "invalid-upstream-geometry", count: 1, evidenceRef: "artifact://county-releases/tarrant/exclusions/1", evidenceSha256: sha("excluded-record") }],
  });
  const exclusionPolicy = pipeline.createCountyReleasePolicy({ ...policy, maximumExcludedFeatures: 1 });
  const excludedApprovals = approvals.map((item) => ({ ...item, approvedBundleSha256: excludedBundle.bundleSha256 }));
  const excludedDecision = pipeline.evaluateCountyRelease({ policy: exclusionPolicy, sourceSnapshot: snapshot, artifactBundle: excludedBundle, approvals: excludedApprovals, platformReleaseAuthorization, asOf: fixed });
  assert.equal(excludedDecision.activationAuthorized, true, "an explicitly evidenced exclusion within policy should reconcile exactly");

  let state = pipeline.createCountyReleaseState({ organizationId, countyId, updatedAt: fixed });
  assert.throws(() => pipeline.stageCountyRelease(state, { ...decision, bundleSha256: sha("tampered") }, { actorId: "release-actor", stagedAt: fixed }), (error) => error.code === "WR_COUNTY_RELEASE_NOT_AUTHORIZED");
  state = pipeline.stageCountyRelease(state, decision, { actorId: "release-actor", stagedAt: fixed });
  assert.equal(state.stagedRelease.releaseId, "release-1");

  const createPointerAdapter = (initial = null, failRollback = false) => {
    let pointer = initial;
    const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
    return {
      read: async () => pointer,
      compareAndSwap: async (_countyId, expected, desired) => {
        if (!same(pointer, expected)) throw Object.assign(new Error("pointer conflict"), { code: "WR_POINTER_CONFLICT" });
        if (failRollback && desired === null && pointer !== null) throw new Error("rollback storage unavailable");
        pointer = desired;
        return { changed: true, pointer };
      },
      current: () => pointer,
    };
  };
  const activeAdapter = createPointerAdapter();
  const activeState = await pipeline.activateStagedCountyRelease(state, { actorId: "release-actor", activatedAt: fixed, pointerAdapter: activeAdapter, healthEvaluator: async () => ({ healthy: true, signals: [] }) });
  assert.equal(activeState.activeRelease.releaseId, "release-1");
  assert.equal(activeState.stagedRelease, null);
  assert.equal(activeState.runs.at(-1).status, "active");
  assert.equal(activeAdapter.current().releaseId, "release-1");

  const rollbackAdapter = createPointerAdapter();
  const rolledBackState = await pipeline.activateStagedCountyRelease(state, { actorId: "release-actor", activatedAt: fixed, pointerAdapter: rollbackAdapter, healthEvaluator: async () => ({ healthy: false, signals: ["search-count-drift"] }) });
  assert.equal(rolledBackState.runs.at(-1).status, "rolled-back");
  assert.equal(rollbackAdapter.current(), null);
  assert.equal(rolledBackState.stagedRelease.releaseId, "release-1", "failed release stays staged for investigation");

  const rollbackFailureAdapter = createPointerAdapter(null, true);
  await assert.rejects(() => pipeline.activateStagedCountyRelease(state, { actorId: "release-actor", activatedAt: fixed, pointerAdapter: rollbackFailureAdapter, healthEvaluator: async () => ({ healthy: false, signals: ["viewport-error-rate"] }) }), (error) => error.code === "WR_COUNTY_RELEASE_ROLLBACK_FAILED" && error.state.runs.at(-1).status === "rollback-failed");

  assert.equal(pipeline.verifyCountyReleaseState(activeState).valid, true);
  assert.equal(pipeline.verifyCountyReleaseState({ ...activeState, runs: [{ ...activeState.runs[0], countyId: "other" }] }).valid, false);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "white-rabbit-county-release-"));
  const databasePath = path.join(tempDir, "platform.sqlite");
  const repository = new SqlitePlatformRepository({ filename: databasePath, clock: () => fixed });
  const context = { organizationId, actorUserId: "release-actor", subjectUserId: "release-actor", sessionId: "session", requestId: "request", grants: ["persistence:read", "persistence:write"], issuedAt: "2026-08-23T11:00:00.000Z", expiresAt: "2026-08-23T13:00:00.000Z" };
  const otherContext = { ...context, organizationId: "org-other" };
  persistence.persistCountyReleaseState(repository, context, activeState, { expectedTenantRevision: 0, expectedRecordRevision: 0, idempotencyKey: "county-release-state-1", occurredAt: fixed, validation: { now: fixed } });
  assert.equal(persistence.loadCountyReleaseState(repository, context, countyId, { validation: { now: fixed } }).activeRelease.releaseId, "release-1");
  assert.equal(persistence.loadCountyReleaseState(repository, otherContext, countyId, { validation: { now: fixed } }), null);
  assert.throws(() => persistence.persistCountyReleaseState(repository, context, { ...activeState, organizationId: "org-other" }, { expectedTenantRevision: 1, expectedRecordRevision: 1, idempotencyKey: "foreign", occurredAt: fixed, validation: { now: fixed } }), (error) => error.code === "WR_TENANT_ISOLATION_VIOLATION");
  repository.close();
  for (const suffix of ["", "-wal", "-shm"]) { const target = `${databasePath}${suffix}`; if (fs.existsSync(target)) fs.rmSync(target); }
  fs.rmdirSync(tempDir);

  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/schemas/county-release-pipeline.schema.json"), "utf8"));
  assert.equal(schema.$defs.sourceSnapshot.properties.schemaVersion.const, pipeline.COUNTY_SOURCE_SNAPSHOT_VERSION);
  assert.equal(schema.$defs.releaseState.properties.schemaVersion.const, pipeline.COUNTY_RELEASE_STATE_VERSION);
  const app = fs.readFileSync(path.join(__dirname, "../src/App.tsx"), "utf8");
  assert(!app.includes("countyReleasePipeline"), "county release pipeline must remain outside the locked visible app");
  console.log("White Rabbit county release pipeline tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { generateKeyPairSync } = require("crypto");

(async () => {
  const release = await import("../src/operations/releaseActivation.mjs");
  const registry = await import("../src/operations/releaseEvidenceRegistry.mjs");
  const activation = await import("../src/operations/stagingActivationController.mjs");
  const { SqlitePlatformRepository } = await import("../src/persistence/sqlitePlatformRepository.mjs");
  const { createPersistenceContext } = await import("../src/persistence/persistenceContracts.mjs");
  const organizationId = "org-white-rabbit";
  const capabilityId = "property-intelligence-query";
  const at = "2026-08-15T14:00:00.000Z";
  const contextInput = { organizationId, actorUserId: "release-admin", sessionId: "release-session", requestId: "release-request", grants: ["persistence:read", "persistence:write", "release:trust-admin", "release:registry-read", "release:evidence-write", "release:manifest-write", "release:activate-staging"], issuedAt: "2026-08-15T13:00:00.000Z", expiresAt: "2026-08-15T17:00:00.000Z" };
  const context = createPersistenceContext(contextInput, { now: at });
  const actors = [
    ["evidence-reviewer", "operations-reviewer"],
    ["product-approver", "product-owner"],
    ["security-approver", "security-reviewer"],
    ["operations-approver", "operations-reviewer"],
    ["release-controller", "release-controller"],
  ].map(([actorId, role]) => ({ actorId, role, keyId: `key:${actorId}`, ...generateKeyPairSync("ed25519") }));
  let trustState = registry.createReleaseTrustState({ organizationId, revision: 0, updatedAt: "2026-08-15T12:00:00.000Z", keys: [] });
  actors.forEach((actor, index) => {
    trustState = registry.registerReleaseTrustKey(trustState, { keyId: actor.keyId, publicKey: actor.publicKey, allowedRoles: [actor.role], activeFrom: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" }, context, { expectedRevision: index, occurredAt: `2026-08-15T12:0${index + 1}:00.000Z` });
  });
  assert.equal(trustState.revision, 5);
  assert.throws(() => registry.registerReleaseTrustKey(trustState, { keyId: "late", publicKey: actors[0].publicKey, allowedRoles: ["operations-reviewer"], activeFrom: "2026-01-01", expiresAt: "2027-01-01" }, context, { expectedRevision: 4, occurredAt: at }), (error) => error.code === "WR_REVISION_CONFLICT");
  assert.equal(Object.keys(registry.trustStoreFromReleaseState(trustState)).length, 5);

  const signAttestation = (actor, input) => release.createReleaseEvidenceAttestation({ organizationId, capabilityId, artifactGeneratedAt: "2026-08-15T12:00:00.000Z", issuedAt: "2026-08-15T13:00:00.000Z", expiresAt: "2026-08-15T16:00:00.000Z", environment: "staging", artifactAuthorId: "test-runner", signer: { actorId: actor.actorId, role: actor.role, keyId: actor.keyId }, privateKey: actor.privateKey, ...input });
  const evidence = signAttestation(actors[0], { evidenceType: "slo-report", artifactId: "slo-staging", artifactRef: "artifact://slo/staging", artifactSchemaVersion: "wr-service-slo-report-v1", artifact: { status: "passed", sampleCount: 10000 } });
  const policy = release.createCapabilityReleasePolicy({ id: "query-staging-policy", policyVersion: "1.0.0", organizationId, capabilityId, featureGates: ["productionCandidateRetrieval", "propertyIntelligenceQueryService"], requiredEvidence: [{ evidenceType: "slo-report", allowedSignerRoles: ["operations-reviewer"], maximumArtifactAgeHours: 24 }], requiredApprovalRoles: ["product-owner", "security-reviewer", "operations-reviewer"], rollback: { maximumMinutes: 15, maximumDrillAgeDays: 30, requireAutomatedDisable: true } });
  const candidate = { sourceRevision: "git:staging-abc", buildSha256: "c".repeat(64), environment: "staging", activationStartsAt: "2026-08-15T13:30:00.000Z", activationExpiresAt: "2026-08-15T16:00:00.000Z", featureGates: ["productionCandidateRetrieval", "propertyIntelligenceQueryService"] };
  const candidateSha256 = release.computeReleaseCandidateSha256(candidate);
  const approvals = actors.slice(1, 4).map((actor) => signAttestation(actor, { evidenceType: "release-approval", artifactId: `approval:${actor.role}`, artifactRef: `approval://${actor.actorId}`, artifactSchemaVersion: "wr-release-approval-v1", artifactGeneratedAt: "2026-08-15T13:15:00.000Z", issuedAt: "2026-08-15T13:20:00.000Z", artifactAuthorId: actor.actorId, artifact: { decision: "approve", releaseCandidateSha256: candidateSha256 }, claims: { decision: "approve", releaseCandidateSha256: candidateSha256 } }));
  const rollbackPlan = { ownerActorId: "operations-owner", procedureRef: "runbook://query/rollback", recoveryPointRef: "deployment://query/previous", maximumMinutes: 10, lastTestedAt: "2026-08-10T14:00:00.000Z", automatedDisable: true, abortSignals: ["error-budget-burn", "source-lag"] };
  const decision = release.decideCapabilityRelease({ organizationId, capabilityId, policy, candidate, currentGateStates: { productionCandidateRetrieval: false, propertyIntelligenceQueryService: false }, evidenceAttestations: [evidence], approvalAttestations: approvals, trustStore: registry.trustStoreFromReleaseState(trustState), requestedBy: "release-requester", rollbackPlan, asOf: at });
  assert.equal(decision.activationAuthorized, true);
  assert.equal(decision.evidenceAttestationSha256s.length, 1);
  assert.equal(decision.approvalAttestationSha256s.length, 3);
  const controllerActor = actors[4];
  const manifest = release.createPlatformReleaseManifest({ organizationId, releaseId: "staging-release-1", environment: "staging", generatedAt: at, expiresAt: "2026-08-15T15:30:00.000Z", decisions: [decision], signer: { actorId: controllerActor.actorId, role: controllerActor.role, keyId: controllerActor.keyId }, privateKey: controllerActor.privateKey });

  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "white-rabbit-release-registry-"));
  const repository = new SqlitePlatformRepository({ filename: path.join(tempDirectory, "release.sqlite"), clock: () => at });
  let tenantRevision = 0;
  let receipt = registry.persistReleaseTrustState(repository, context, trustState, { expectedTenantRevision: tenantRevision, expectedRecordRevision: 0, idempotencyKey: "trust-state-v5", occurredAt: at, validation: { now: at } });
  tenantRevision = receipt.tenantRevision;
  const attestations = [evidence, ...approvals];
  for (const attestation of attestations) {
    receipt = registry.persistReleaseAttestation(repository, context, trustState, attestation, { asOf: at, expectedTenantRevision: tenantRevision, idempotencyKey: `attestation:${release.computeReleaseAttestationSha256(attestation)}`, occurredAt: at, validation: { now: at } });
    tenantRevision = receipt.tenantRevision;
  }
  receipt = registry.persistReleaseManifest(repository, context, trustState, manifest, { asOf: at, expectedTenantRevision: tenantRevision, idempotencyKey: "manifest:staging-release-1", occurredAt: at, validation: { now: at } });
  tenantRevision = receipt.tenantRevision;
  const evidenceHash = release.computeReleaseAttestationSha256(evidence);
  assert.equal(registry.loadReleaseAttestation(repository, context, evidenceHash, { validation: { now: at } }).content.artifactId, "slo-staging");
  assert.equal(registry.listReleaseRegistryEntries(repository, context, { keyPrefix: "attestation:", limit: 2, validation: { now: at } }).records.length, 2);
  assert.equal(registry.loadReleaseTrustState(repository, context, { validation: { now: at } }).revision, 5);

  const otherContext = createPersistenceContext({ ...contextInput, organizationId: "org-other", actorUserId: "other", sessionId: "other-session", requestId: "other-request" }, { now: at });
  assert.equal(registry.loadReleaseAttestation(repository, otherContext, evidenceHash, { validation: { now: at } }), null);
  assert.throws(() => registry.persistReleaseAttestation(repository, otherContext, trustState, evidence, { asOf: at, expectedTenantRevision: 0, idempotencyKey: "cross-tenant", occurredAt: at, validation: { now: at } }), (error) => error.code === "WR_RELEASE_EVIDENCE_REJECTED" || error.code === "WR_TENANT_ISOLATION_VIOLATION");

  const resolver = (hash) => registry.loadReleaseAttestation(repository, context, hash, { validation: { now: at } });
  const dryAdapter = activation.createInMemoryStagingGateAdapter({ initialStates: { productionCandidateRetrieval: false, propertyIntelligenceQueryService: false } });
  const dryController = activation.createStagingActivationController({ gateAdapter: dryAdapter, evidenceResolver: resolver, repository, context, clock: () => "2026-08-15T14:01:00.000Z" });
  const dryRun = await dryController.execute({ manifest, trustState, runId: "dry-run-1", mode: "dry-run", asOf: at, expectedTenantRevision: tenantRevision, validation: { now: at } });
  tenantRevision += 1;
  assert.equal(dryRun.status, "validated");
  assert.deepEqual(dryAdapter.readGateStates(dryRun.gates), { productionCandidateRetrieval: false, propertyIntelligenceQueryService: false });

  const healthyAdapter = activation.createInMemoryStagingGateAdapter({ initialStates: { productionCandidateRetrieval: false, propertyIntelligenceQueryService: false } });
  const healthyController = activation.createStagingActivationController({ gateAdapter: healthyAdapter, evidenceResolver: resolver, repository, context, clock: () => "2026-08-15T14:02:00.000Z", healthEvaluator: async () => ({ healthy: true, abortSignals: [] }) });
  const healthyRun = await healthyController.execute({ manifest, trustState, runId: "healthy-1", mode: "staging", allowStagingMutation: true, asOf: at, expectedTenantRevision: tenantRevision, validation: { now: at } });
  tenantRevision += 2;
  assert.equal(healthyRun.status, "active");
  assert.deepEqual(healthyAdapter.readGateStates(healthyRun.gates), { productionCandidateRetrieval: true, propertyIntelligenceQueryService: true });
  assert.equal(healthyRun.transactions.length, 1);

  const rollbackAdapter = activation.createInMemoryStagingGateAdapter({ initialStates: { productionCandidateRetrieval: false, propertyIntelligenceQueryService: false } });
  const rollbackController = activation.createStagingActivationController({ gateAdapter: rollbackAdapter, evidenceResolver: resolver, repository, context, clock: () => "2026-08-15T14:03:00.000Z", healthEvaluator: async () => ({ healthy: false, abortSignals: ["error-budget-burn"] }) });
  const rolledBack = await rollbackController.execute({ manifest, trustState, runId: "rollback-1", mode: "staging", allowStagingMutation: true, asOf: at, expectedTenantRevision: tenantRevision, validation: { now: at } });
  tenantRevision += 2;
  assert.equal(rolledBack.status, "rolled-back");
  assert.equal(rolledBack.transactions.length, 2);
  assert.deepEqual(rollbackAdapter.readGateStates(rolledBack.gates), { productionCandidateRetrieval: false, propertyIntelligenceQueryService: false });

  const retryRollbackAdapter = activation.createInMemoryStagingGateAdapter({ initialStates: { productionCandidateRetrieval: false, propertyIntelligenceQueryService: false }, failTransactions: ["rollback-retry:rollback"] });
  const retryRollbackController = activation.createStagingActivationController({ gateAdapter: retryRollbackAdapter, evidenceResolver: resolver, repository, context, clock: () => "2026-08-15T14:03:30.000Z", healthEvaluator: async () => ({ healthy: false, abortSignals: ["source-lag"] }) });
  const retryRollback = await retryRollbackController.execute({ manifest, trustState, runId: "rollback-retry", mode: "staging", allowStagingMutation: true, asOf: at, expectedTenantRevision: tenantRevision, validation: { now: at } });
  tenantRevision += 2;
  assert.equal(retryRollback.status, "rolled-back");
  assert.equal(retryRollback.health.rollbackErrors.length, 1);
  assert.equal(retryRollback.transactions[1]?.idempotencyKey || retryRollback.transactions[0].idempotencyKey, "rollback-retry:rollback-emergency");
  assert.deepEqual(retryRollbackAdapter.readGateStates(retryRollback.gates), { productionCandidateRetrieval: false, propertyIntelligenceQueryService: false });

  const failedRollbackAdapter = activation.createInMemoryStagingGateAdapter({ initialStates: { productionCandidateRetrieval: false, propertyIntelligenceQueryService: false }, failTransactions: ["rollback-failed:rollback", "rollback-failed:rollback-emergency"] });
  const failedRollbackController = activation.createStagingActivationController({ gateAdapter: failedRollbackAdapter, evidenceResolver: resolver, repository, context, clock: () => "2026-08-15T14:03:45.000Z", healthEvaluator: async () => ({ healthy: false, abortSignals: ["source-lag"] }) });
  await assert.rejects(() => failedRollbackController.execute({ manifest, trustState, runId: "rollback-failed", mode: "staging", allowStagingMutation: true, asOf: at, expectedTenantRevision: tenantRevision, validation: { now: at } }), (error) => error.code === "WR_ACTIVATION_ROLLBACK_FAILED" && error.run.status === "rollback-failed");
  tenantRevision += 2;
  assert.deepEqual(failedRollbackAdapter.readGateStates(["productionCandidateRetrieval", "propertyIntelligenceQueryService"]), { productionCandidateRetrieval: true, propertyIntelligenceQueryService: true }, "a double rollback failure must be surfaced as critical rather than misreported as safe");

  const journalFailureAdapter = activation.createInMemoryStagingGateAdapter({ initialStates: { productionCandidateRetrieval: false, propertyIntelligenceQueryService: false } });
  const failingRepository = { commit(input, options) { if (input.idempotencyKey === "activation:journal-failure:final") { const error = new Error("injected journal failure"); error.code = "WR_PERSISTENCE_CONFLICT"; throw error; } return repository.commit(input, options); } };
  const journalFailureController = activation.createStagingActivationController({ gateAdapter: journalFailureAdapter, evidenceResolver: resolver, repository: failingRepository, context, clock: () => "2026-08-15T14:04:00.000Z", healthEvaluator: async () => ({ healthy: true, abortSignals: [] }) });
  await assert.rejects(() => journalFailureController.execute({ manifest, trustState, runId: "journal-failure", mode: "staging", allowStagingMutation: true, asOf: at, expectedTenantRevision: tenantRevision, validation: { now: at } }), (error) => error.code === "WR_ACTIVATION_JOURNAL_FAILURE");
  tenantRevision += 1;
  assert.deepEqual(journalFailureAdapter.readGateStates(["productionCandidateRetrieval", "propertyIntelligenceQueryService"]), { productionCandidateRetrieval: false, propertyIntelligenceQueryService: false });

  const revokedTrust = registry.revokeReleaseTrustKey(trustState, actors[0].keyId, context, { expectedRevision: 5, occurredAt: "2026-08-15T14:05:00.000Z", reason: "staging compromise drill" });
  const revokedAdapter = activation.createInMemoryStagingGateAdapter({ initialStates: { productionCandidateRetrieval: false, propertyIntelligenceQueryService: false } });
  const revokedController = activation.createStagingActivationController({ gateAdapter: revokedAdapter, evidenceResolver: resolver, context, clock: () => "2026-08-15T14:06:00.000Z" });
  const rejected = await revokedController.execute({ manifest, trustState: revokedTrust, runId: "revoked-key", mode: "dry-run", asOf: "2026-08-15T14:06:00.000Z", validation: { now: at } });
  assert.equal(rejected.status, "rejected");
  assert(rejected.blockers.some((blocker) => blocker.code === "WR_ATTESTATION_INVALID"));
  await assert.rejects(() => dryController.execute({ manifest: { ...manifest, environment: "production" }, trustState, runId: "production-prohibited", mode: "staging", allowStagingMutation: true, asOf: at }), (error) => error.code === "WR_PRODUCTION_ACTIVATION_PROHIBITED");

  const journalPage = repository.listRecordsPage(context, "release-control", { keyPrefix: "activation-run:", limit: 20, validation: { now: at } });
  assert(journalPage.records.some((record) => record.value.status === "active"));
  assert(journalPage.records.some((record) => record.value.status === "rolled-back"));
  assert(journalPage.records.some((record) => record.value.status === "rollback-failed"));
  const registrySchema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "release-evidence-registry.schema.json"), "utf8"));
  const activationSchema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "staging-activation.schema.json"), "utf8"));
  assert.equal(registrySchema.$defs.trustState.properties.schemaVersion.const, "wr-release-trust-state-v1");
  assert.equal(activationSchema.oneOf[0].properties.schemaVersion.const, "wr-staging-activation-run-v1");
  repository.close();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
  console.log("White Rabbit durable release registry, key revocation, staging activation, health rollback, and journal-failure rollback tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

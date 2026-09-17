const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { generateKeyPairSync } = require("crypto");

(async () => {
  const release = await import("../src/operations/releaseActivation.mjs");
  const organizationId = "org-white-rabbit";
  const capabilityId = "property-intelligence-query";
  const at = "2026-08-14T14:00:00.000Z";
  const actors = [
    ["evidence-reviewer", "operations-reviewer"],
    ["product-approver", "product-owner"],
    ["security-approver", "security-reviewer"],
    ["operations-approver", "operations-reviewer"],
    ["release-controller", "release-controller"],
  ].map(([actorId, role]) => ({ actorId, role, keyId: `key:${actorId}`, ...generateKeyPairSync("ed25519") }));
  const trustStore = Object.fromEntries(actors.map((actor) => [actor.keyId, { publicKey: actor.publicKey, organizationId, allowedRoles: [actor.role], activeFrom: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" }]));
  const signAttestation = (actor, input) => release.createReleaseEvidenceAttestation({ organizationId, capabilityId, artifactGeneratedAt: "2026-08-14T12:00:00.000Z", issuedAt: "2026-08-14T13:00:00.000Z", expiresAt: "2026-08-14T15:00:00.000Z", environment: "production", artifactAuthorId: "test-runner", signer: { actorId: actor.actorId, role: actor.role, keyId: actor.keyId }, privateKey: actor.privateKey, ...input });
  const evidence = signAttestation(actors[0], { evidenceType: "slo-report", artifactId: "slo-query-100", artifactRef: "artifact://slo/query-100", artifactSchemaVersion: "wr-service-slo-report-v1", artifact: { schemaVersion: "wr-service-slo-report-v1", status: "passed", sampleCount: 100000 } });
  const verification = release.verifyReleaseEvidenceAttestation(evidence, { trustStore, asOf: at, expectedOrganizationId: organizationId, expectedCapabilityId: capabilityId, allowedRoles: ["operations-reviewer"], maximumArtifactAgeHours: 24 });
  assert.equal(verification.valid, true);
  const tamperedEvidence = { ...evidence, artifactSha256: "0".repeat(64) };
  assert.equal(release.verifyReleaseEvidenceAttestation(tamperedEvidence, { trustStore, asOf: at }).valid, false);
  assert(release.verifyReleaseEvidenceAttestation(tamperedEvidence, { trustStore, asOf: at }).checks.some((check) => check.id === "signature" && !check.passed));

  const policy = release.createCapabilityReleasePolicy({ id: "policy-query", policyVersion: "1.0.0", organizationId, capabilityId, featureGates: ["propertyIntelligenceQueryService", "productionCandidateRetrieval"], requiredEvidence: [{ evidenceType: "slo-report", allowedSignerRoles: ["operations-reviewer"], maximumArtifactAgeHours: 24, requireIndependentSigner: true }], requiredApprovalRoles: ["product-owner", "security-reviewer", "operations-reviewer"], decisionTtlHours: 24, rollback: { maximumMinutes: 15, maximumDrillAgeDays: 30, requireAutomatedDisable: true } });
  const candidate = { sourceRevision: "git:abc123", buildSha256: "b".repeat(64), environment: "production", activationStartsAt: "2026-08-14T13:30:00.000Z", activationExpiresAt: "2026-08-14T16:00:00.000Z", featureGates: ["productionCandidateRetrieval", "propertyIntelligenceQueryService"] };
  const candidateSha256 = release.computeReleaseCandidateSha256(candidate);
  const approvals = actors.slice(1, 4).map((actor) => signAttestation(actor, { evidenceType: "release-approval", artifactId: `approval:${actor.role}`, artifactRef: `approval://${actor.actorId}`, artifactSchemaVersion: "wr-release-approval-v1", artifactGeneratedAt: "2026-08-14T13:30:00.000Z", issuedAt: "2026-08-14T13:40:00.000Z", artifactAuthorId: actor.actorId, artifact: { decision: "approve", releaseCandidateSha256: candidateSha256 }, claims: { decision: "approve", releaseCandidateSha256: candidateSha256 } }));
  const rollbackPlan = { ownerActorId: "operations-owner", procedureRef: "runbook://query/rollback-v1", recoveryPointRef: "deployment://query/previous", maximumMinutes: 10, lastTestedAt: "2026-08-10T14:00:00.000Z", automatedDisable: true, abortSignals: ["error-budget-burn", "p95-latency", "source-lag"] };
  const decisionInput = { organizationId, capabilityId, policy, candidate, currentGateStates: { propertyIntelligenceQueryService: false, productionCandidateRetrieval: false }, evidenceAttestations: [evidence], approvalAttestations: approvals, trustStore, requestedBy: "release-requester", rollbackPlan, asOf: at };
  const decision = release.decideCapabilityRelease(decisionInput);
  assert.equal(decision.schemaVersion, "wr-capability-release-decision-v1");
  assert.equal(decision.status, "authorized");
  assert.equal(decision.activationAuthorized, true);
  assert.equal(decision.blockers.length, 0);
  assert.match(decision.decisionSha256, /^[a-f0-9]{64}$/);

  const syntheticEvidence = signAttestation(actors[0], { evidenceType: "slo-report", artifactId: "synthetic-slo", artifactRef: "artifact://synthetic", artifactSchemaVersion: "wr-service-slo-report-v1", artifact: { status: "passed" }, synthetic: true });
  const syntheticDecision = release.decideCapabilityRelease({ ...decisionInput, evidenceAttestations: [syntheticEvidence] });
  assert.equal(syntheticDecision.status, "rejected");
  assert(syntheticDecision.blockers.some((blocker) => blocker.checkId === "evidence:slo-report"));
  const enabledOutsideDecision = release.decideCapabilityRelease({ ...decisionInput, currentGateStates: { propertyIntelligenceQueryService: true, productionCandidateRetrieval: false } });
  assert(enabledOutsideDecision.blockers.some((blocker) => blocker.checkId === "gates-currently-off"));
  const reusedActorApprovals = approvals.map((approval) => ({ ...approval, signer: approvals[0].signer, signature: approvals[0].signature }));
  const separated = release.decideCapabilityRelease({ ...decisionInput, approvalAttestations: reusedActorApprovals });
  assert.equal(separated.status, "rejected");
  const staleRollback = release.decideCapabilityRelease({ ...decisionInput, rollbackPlan: { ...rollbackPlan, lastTestedAt: "2025-01-01T00:00:00.000Z" } });
  assert(staleRollback.blockers.some((blocker) => blocker.checkId === "rollback-drill"));

  const controller = actors[4];
  const manifest = release.createPlatformReleaseManifest({ organizationId, releaseId: "release-2026-08-14", environment: "production", generatedAt: at, expiresAt: "2026-08-14T15:00:00.000Z", decisions: [decision], signer: { actorId: controller.actorId, role: controller.role, keyId: controller.keyId }, privateKey: controller.privateKey });
  const manifestVerification = release.verifyPlatformReleaseManifest(manifest, { trustStore, asOf: "2026-08-14T14:30:00.000Z", expectedOrganizationId: organizationId });
  assert.equal(manifestVerification.valid, true);
  assert.equal(manifestVerification.activationAuthorized, true);
  const tamperedManifest = { ...manifest, releaseId: "tampered-release" };
  assert.equal(release.verifyPlatformReleaseManifest(tamperedManifest, { trustStore, asOf: "2026-08-14T14:30:00.000Z" }).valid, false);
  const expiredManifest = release.verifyPlatformReleaseManifest(manifest, { trustStore, asOf: "2026-08-14T15:30:00.000Z" });
  assert.equal(expiredManifest.activationAuthorized, false);

  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "release-activation.schema.json"), "utf8"));
  assert.equal(schema.$defs.manifest.properties.schemaVersion.const, "wr-platform-release-manifest-v1");
  console.log("White Rabbit Ed25519 evidence, independent approvals, rollback, expiry, and signed release-manifest tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

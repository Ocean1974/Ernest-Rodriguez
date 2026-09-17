const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

function canonicalJson(value) { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`; return JSON.stringify(value ?? null); }
const digest = (value) => crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");

(async () => {
  const { SqlitePlatformRepository } = await import("../src/persistence/sqlitePlatformRepository.mjs");
  const governance = await import("../src/underwriting/underwritingGovernance.mjs");
  const collaborationStore = await import("../src/collaboration/dealCollaborationStore.mjs");
  const diligence = await import("../src/collaboration/transactionDiligence.mjs");
  const dealRoom = await import("../src/collaboration/dealRoomRegistry.mjs");
  const { createCommitteeWorkspaceWorkflow } = await import("../src/collaboration/committeeWorkspaceWorkflow.mjs");
  const organizationId = "org-committee";
  const countyId = "dallas-county-dcad";
  const propertyId = `wrp:v1:${countyId}:COMMITTEE-1`;
  const authorAt = "2026-08-24T14:00:00.000Z";
  const submittedAt = "2026-08-24T14:05:00.000Z";
  const reviewedAt = "2026-08-24T14:10:00.000Z";
  const approvedAt = "2026-08-24T14:15:00.000Z";
  let now = "2026-08-24T14:30:00.000Z";
  const author = { organizationId, actorUserId: "underwriter", permissions: ["underwriting:write"] };
  const reviewer = { organizationId, actorUserId: "reviewer", permissions: ["underwriting:review"] };
  const approver = { organizationId, actorUserId: "approver", permissions: ["underwriting:approve"] };
  let underwriting = governance.createUnderwritingGovernanceState({ organizationId, updatedAt: authorAt });
  underwriting = governance.addUnderwritingScenario(underwriting, { id: "scenario-committee", whiteRabbitPropertyId: propertyId, name: "Committee base case", assumptionInput: { purchasePrice: 1000000, grossPotentialRentAnnual: 150000, exitCapRatePct: 7 }, comparableAnalyses: [], requiredComparableTypes: [], createdAt: authorAt }, author, { expectedStateRevision: 1 });
  underwriting = governance.submitUnderwritingScenario(underwriting, "scenario-committee", author, { expectedStateRevision: 2, expectedScenarioRevision: 1, occurredAt: submittedAt });
  underwriting = governance.recordUnderwritingReview(underwriting, "scenario-committee", { decision: "recommended", comment: "Evidence reviewed" }, reviewer, { expectedStateRevision: 3, expectedScenarioRevision: 2, occurredAt: reviewedAt });
  underwriting = governance.decideUnderwritingScenario(underwriting, "scenario-committee", { decision: "approved", comment: "Approved for committee workspace" }, approver, { expectedStateRevision: 4, expectedScenarioRevision: 2, occurredAt: approvedAt });
  const scenario = underwriting.scenarios[0], review = underwriting.reviews[0], approval = underwriting.approvals[0];
  assert.equal(scenario.status, "approved");
  const brief = { schemaVersion: "wr-opportunity-brief-v1", status: "partial", whiteRabbitPropertyId: propertyId, exportModel: { title: "100 Committee Way" }, evidenceSummary: { completenessPct: 80 } };
  const handoffCore = { schemaVersion: "wr-acquisition-handoff-v1", id: "handoff-committee", organizationId, whiteRabbitPropertyId: propertyId, sourceDecisionId: "decision-committee", scenarioId: scenario.id, scenarioEvidenceDigest: scenario.evidenceDigest, brief, briefSha256: digest(brief), createdAt: authorAt, createdBy: "underwriter", status: "draft-pending-independent-review", advisoryOnly: true, exportAuthorized: false, approvalAuthorized: false };
  const handoffLedger = { schemaVersion: "wr-acquisition-handoff-ledger-v1", organizationId, whiteRabbitPropertyId: propertyId, revision: 2, handoffs: [handoffCore], updatedAt: authorAt };
  const organization = collaborationStore.createOrganization({ id: organizationId, name: "Committee Org", createdAt: authorAt });
  const membership = collaborationStore.createMembership({ organizationId, userId: "deal-lead", role: "owner", createdAt: authorAt });
  const collaboration = collaborationStore.createCollaborationState({ organizations: [organization], memberships: [membership], updatedAt: authorAt });
  const context = { organizationId, actorUserId: "deal-lead", subjectUserId: "deal-lead", sessionId: "committee-session", requestId: "committee-request", grants: ["persistence:read", "persistence:write", "committee-workspace:create"], issuedAt: "2026-08-24T13:00:00.000Z", expiresAt: "2026-08-26T16:00:00.000Z" };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "white-rabbit-committee-workspace-"));
  const databasePath = path.join(tempDir, "committee.sqlite");
  const repository = new SqlitePlatformRepository({ filename: databasePath, clock: () => now });
  repository.commitMany({ context, mutations: [
    { namespace: "acquisition-handoff", key: `property:${propertyId}`, operation: "put", value: handoffLedger, expectedRecordRevision: 0 },
    { namespace: "underwriting", key: "governance-state", operation: "put", value: underwriting, expectedRecordRevision: 0 },
    { namespace: "collaboration", key: "state", operation: "put", value: collaboration, expectedRecordRevision: 0 }
  ], expectedTenantRevision: 0, idempotencyKey: "seed-approved-handoff", requestFingerprint: "seed-approved-handoff", occurredAt: approvedAt }, { now: approvedAt });
  const template = diligence.createDiligenceChecklistTemplate({ id: "committee-diligence", version: 1, name: "Committee acquisition diligence", transactionType: "purchase", jurisdiction: "US-TX-DALLAS", createdByUserId: "governance-admin", createdAt: "2026-08-01T00:00:00.000Z", tasks: [
    { id: "title", title: "Review title", phase: "title", dependencyIds: [], evidenceRequirements: [{ type: "document-version", minimumCount: 1, description: "Title evidence" }], assigneeRole: "legal", critical: true },
    { id: "environmental", title: "Environmental review", phase: "physical", dependencyIds: ["title"], evidenceRequirements: [{ type: "inspection", minimumCount: 1, description: "Environmental report" }], assigneeRole: "diligence", critical: true },
    { id: "committee-decision", title: "Record committee decision", phase: "approval", dependencyIds: ["title", "environmental"], evidenceRequirements: [{ type: "approval", minimumCount: 1, description: "Committee approval" }], assigneeRole: "committee", critical: true }
  ] });
  const calendar = diligence.createBusinessCalendar({ id: "dallas-2026", jurisdiction: "US-TX-DALLAS", timeZone: "America/Chicago", weekendDays: [0, 6], holidays: ["2026-09-07"], sourceAuthority: "Dallas County", sourceVersion: "2026.1", sourceRef: "calendar-ref:dallas-2026", sourceAsOf: "2026-08-01", validThrough: "2026-12-31" });
  const content = Buffer.from("Certified committee evidence manifest");
  const contentSha256 = dealRoom.dealRoomSha256(content);
  const malwareScan = dealRoom.createMalwareScanEvidence({ organizationId, contentSha256, engineId: "scanner-cert", engineVersion: "1", definitionsVersion: "2026-08-24", result: "clean", scannedAt: now, evidenceRef: "scan-ref:committee-package", verificationStatus: "verified", verificationPolicyId: "committee-scan-policy", scannerAttestationSha256: dealRoom.dealRoomSha256("committee-scan-attestation"), verifiedAt: now });
  const workspaceProvider = { schemaVersion: "wr-committee-workspace-provider-v1", activationAuthorized: true, async getWorkspacePack(id, source) { return { schemaVersion: "wr-committee-workspace-pack-v1", activationAuthorized: true, generatedAt: source.asOf, sourceHandoffId: source.handoff.id, sourceHandoffSha256: digest(source.handoff), scenarioId: source.scenario.id, scenarioEvidenceDigest: source.scenario.evidenceDigest, approvalId: source.approval.id, approvalEvidenceDigest: source.approval.evidenceDigest, template, calendar, anchors: {}, assignments: { title: "legal-user", environmental: "diligence-user", "committee-decision": "committee-chair" }, document: { whiteRabbitPropertyId: id, logicalName: "Investment Committee Evidence Package", fileName: "committee-evidence.json", mediaType: "application/json", byteLength: content.length, contentSha256, objectRef: "object-ref:committee-evidence", classification: "restricted", malwareScan } }; } };
  const releaseDecision = { schemaVersion: "wr-capability-release-decision-v1", capabilityId: "deal-workflow-collaboration", activationAuthorized: true };
  const verified = () => ({ valid: true, activationAuthorized: true });
  const workflow = createCommitteeWorkspaceWorkflow({ repository, allowedCountyIds: [countyId], releaseDecision, verifyReleaseDecision: verified, workspaceProvider, verifyProvider: verified, verifyWorkspacePack: verified, clock: () => now });
  assert.equal(workflow.activationAuthorized, true);
  const inactive = createCommitteeWorkspaceWorkflow({ repository, allowedCountyIds: [countyId] });
  await assert.rejects(() => inactive.create({}, context), (error) => error.code === "WR_COMMITTEE_WORKSPACE_INACTIVE");
  const input = { whiteRabbitPropertyId: propertyId, asOf: now, expectedTenantRevision: 1, expectedWorkspaceRecordRevision: 0, expectedCollaborationRecordRevision: 1, expectedDealRoomRecordRevision: 0, expectedDiligenceRecordRevision: 0, idempotencyKey: "committee-workspace-1" };
  const unsigned = createCommitteeWorkspaceWorkflow({ repository, allowedCountyIds: [countyId], releaseDecision, verifyReleaseDecision: verified, workspaceProvider, verifyProvider: verified });
  await assert.rejects(() => unsigned.create({ ...input, idempotencyKey: "unsigned-pack" }, context), (error) => error.code === "WR_COMMITTEE_PACK_SIGNATURE_REJECTED");
  const stale = createCommitteeWorkspaceWorkflow({ repository, allowedCountyIds: [countyId], releaseDecision, verifyReleaseDecision: verified, workspaceProvider, verifyProvider: verified, verifyWorkspacePack: verified, maximumApprovalAgeHours: 0.1 });
  await assert.rejects(() => stale.create({ ...input, asOf: "2026-08-24T15:16:00.000Z", idempotencyKey: "stale-approval" }, context), (error) => error.code === "WR_COMMITTEE_APPROVAL_STALE");
  const outsiderContext = { ...context, actorUserId: "outsider", subjectUserId: "outsider", sessionId: "outsider-session", requestId: "outsider-request" };
  await assert.rejects(() => workflow.create({ ...input, idempotencyKey: "outsider-workspace" }, outsiderContext), (error) => error.code === "WR_COMMITTEE_MEMBERSHIP_REQUIRED");
  assert.equal(repository.tenantRevision(context, { now }), 1);
  const created = await workflow.create(input, context);
  assert.equal(created.status, "created");
  assert.equal(created.receipt.mutationCount, 4);
  assert.deepEqual(created.receipt.records.map((item) => item.namespace).sort(), ["collaboration", "committee-workspace", "deal-room", "diligence"]);
  assert.equal(created.deal.stage, "due-diligence");
  assert.equal(created.deal.underwritingScenarioId, scenario.id);
  assert.equal(created.document.quarantineStatus, "released");
  assert.equal(created.diligence.tasks.length, 3);
  assert(created.diligence.tasks.every((task) => !["completed", "waived"].includes(task.status)));
  assert.equal(created.workspace.externalSharingAuthorized, false);
  assert.equal(created.workspace.externalReminderDeliveryAuthorized, false);
  assert.equal(created.workspace.committeeDecisionRecorded, false);
  const storedRoom = repository.readRecord(context, "deal-room", "state", { now }).value;
  assert.equal(storedRoom.rooms.length, 1);
  assert.equal(storedRoom.documentVersions.length, 1);
  assert.equal(storedRoom.shares.length, 0, "workspace creation must never manufacture external shares");
  const revisionBeforeReplay = repository.tenantRevision(context, { now });
  const replay = await workflow.create(input, context);
  assert.equal(replay.status, "replayed");
  assert.equal(replay.workspace.id, created.workspace.id);
  assert.equal(repository.tenantRevision(context, { now }), revisionBeforeReplay);
  await assert.rejects(() => workflow.create({ ...input, asOf: "2026-08-24T14:31:00.000Z" }, context), (error) => error.code === "WR_IDEMPOTENCY_CONFLICT");
  await assert.rejects(() => workflow.create({ ...input, expectedTenantRevision: 2, expectedWorkspaceRecordRevision: 1, expectedCollaborationRecordRevision: 2, expectedDealRoomRecordRevision: 1, expectedDiligenceRecordRevision: 1, idempotencyKey: "duplicate-workspace" }, context), (error) => error.code === "WR_COMMITTEE_WORKSPACE_DUPLICATE");
  const audit = repository.exportAuditLog(context, { now, exportedAt: now });
  assert.equal(audit.verification.valid, true);
  repository.close();
  for (const suffix of ["", "-wal", "-shm"]) { const target = `${databasePath}${suffix}`; if (fs.existsSync(target)) fs.rmSync(target); }
  fs.rmdirSync(tempDir);
  assert.equal(fs.readFileSync(path.join(__dirname, "..", "src", "App.tsx"), "utf8").includes("committeeWorkspaceWorkflow"), false);
  if (process.env.WR_COMMITTEE_CERTIFICATION_CHILD !== "1") {
    execFileSync(process.execPath, [path.join(__dirname, "..", "scripts", "build-committee-workspace-readiness.cjs")], { stdio: "inherit" });
    require("./committee-workspace-readiness.test.cjs");
  }
  console.log("White Rabbit approved-underwriting committee workspace, deal room, clean evidence package, diligence, atomic persistence, replay, and no-share boundary tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

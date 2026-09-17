const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

(async () => {
  const briefModule = await import("../src/briefs/opportunityBrief.mjs");
  const exportsModule = await import("../src/briefs/opportunityBriefExport.mjs");
  const worker = await import("../src/briefs/opportunityBriefExportWorker.mjs");
  const { SqlitePlatformRepository } = await import("../src/persistence/sqlitePlatformRepository.mjs");
  const now = "2026-08-15T12:00:00.000Z";
  const later = "2026-08-15T12:00:01.000Z";
  const profile = {
    schemaVersion: "wr-property-profile-v1", whiteRabbitPropertyId: "wrp:v1:dallas:123", accountNum: "123",
    parcel: { accountNum: "123", siteAddress: "100 Main St", ownerName: "Secret Owner LLC", totalValue: 900000, dataLineage: { sourceDatasetId: "dcad-2026", sourceAsOf: "2026-01-01" } },
    evidence: { layerStatus: { permits: "not-found" }, permitCount: 0, errors: [] },
  };
  const brief = briefModule.buildOpportunityBrief({ profile, underwriting: { generatedAt: now, metrics: { firstYearNoi: 70000 }, warnings: [] }, generatedAt: now });
  const briefSha256 = exportsModule.opportunityBriefSha256(brief);
  const policy = exportsModule.createOpportunityBriefExportPolicy({
    organizationId: "org-a", issuedAt: now, allowedEmailDomains: ["example.com"], allowedFormats: ["json"], maxRecipientClearance: "confidential",
    defaultClassification: "internal", fieldClassifications: { owner: "restricted", underwriting: "confidential", "sections.economics.noi": "confidential" }, maxAccessSeconds: 3600,
  });
  const request = exportsModule.createOpportunityBriefExportRequest({ organizationId: "org-a", requestedByUserId: "user-a", briefRef: "brief-ref:123", briefSha256, recipient: { type: "email", id: "buyer@example.com" }, recipientClearance: "internal", format: "json", purpose: "investment review", requestedAt: now, expiresAt: "2026-08-15T14:00:00.000Z" });
  const grant = exportsModule.grantOpportunityBriefAccess(policy, request, { grantedByUserId: "admin-a", grantedAt: now });
  assert.equal(grant.expiresAt, "2026-08-15T13:00:00.000Z", "policy must cap requested access lifetime");
  assert.throws(() => exportsModule.grantOpportunityBriefAccess(policy, { ...request, requestSha256: undefined, id: "bad-recipient", recipient: { type: "email", id: "buyer@evil.test" } }, { grantedByUserId: "admin-a", grantedAt: now }), (error) => error.code === "WR_BRIEF_RECIPIENT_DENIED");
  assert.throws(() => exportsModule.grantOpportunityBriefAccess(policy, { ...request, requestSha256: undefined, id: "cross-tenant", organizationId: "org-b" }, { grantedByUserId: "admin-a", grantedAt: now }), (error) => error.code === "WR_TENANT_ISOLATION_VIOLATION");
  const redacted = exportsModule.redactOpportunityBrief(brief, policy, "internal");
  const owner = redacted.sections.find((section) => section.id === "ownership").facts.find((fact) => fact.id === "owner");
  assert.equal(owner.status, "redacted");
  assert.equal(owner.value, null);
  assert.equal(redacted.underwriting, null);
  assert.equal(JSON.stringify(redacted).includes("Secret Owner LLC"), false, "restricted values must not survive redaction");
  const publicRedaction = exportsModule.redactOpportunityBrief(brief, policy, "public");
  assert.equal(publicRedaction.whiteRabbitPropertyId, null);
  assert.equal(publicRedaction.exportModel.title, "White Rabbit Opportunity Brief");
  assert.equal(JSON.stringify(publicRedaction).includes("100 Main St"), false, "top-level title metadata must not bypass fact redaction");
  const prepared = exportsModule.prepareOpportunityBriefExport({ policy, request, accessGrant: grant, brief, preparedAt: later });
  assert(prepared.watermark.text.includes("buyer@example.com"));
  assert(prepared.watermark.text.includes("EXPIRES"));
  const content = `${prepared.watermark.text}\n${prepared.redactedPayload}`;
  const artifact = exportsModule.sealOpportunityBriefExportArtifact({ prepared, createdAt: later, rendered: { format: "json", content, sourcePayloadSha256: prepared.redactedPayloadSha256, watermarkSha256: prepared.watermarkSha256 }, artifactRef: "artifact-ref:export-1" });
  assert.equal(artifact.sourceBriefSha256, briefSha256);
  assert.equal(artifact.lineage.some((item) => item.sourceDatasetId === "dcad-2026"), true);
  assert.equal(exportsModule.verifyOpportunityBriefExportArtifact(artifact, { content }).valid, true);
  assert.equal(exportsModule.verifyOpportunityBriefExportArtifact({ ...artifact, artifactRef: "artifact-ref:tampered" }, { content }).validManifest, false);
  assert.equal(exportsModule.verifyOpportunityBriefExportArtifact(artifact, { content: `${content}tampered` }).validContent, false);
  assert.throws(() => exportsModule.prepareOpportunityBriefExport({ policy, request, accessGrant: grant, brief: { ...brief, warnings: ["tampered"] }, preparedAt: later }), (error) => error.code === "WR_BRIEF_SOURCE_INTEGRITY_FAILURE");
  assert.throws(() => exportsModule.prepareOpportunityBriefExport({ policy: { ...policy, defaultClassification: "public" }, request, accessGrant: grant, brief, preparedAt: later }), (error) => error.code === "WR_BRIEF_POLICY_INTEGRITY_FAILURE");
  assert.throws(() => exportsModule.assertOpportunityBriefAccess({ ...grant, recipientClearance: "restricted" }, { organizationId: "org-a", requestId: request.id, now: later }), (error) => error.code === "WR_BRIEF_ACCESS_INTEGRITY_FAILURE");
  const revoked = exportsModule.revokeOpportunityBriefAccess(grant, { organizationId: "org-a", revokedByUserId: "admin-a", reason: "recipient removed", revokedAt: later });
  assert.throws(() => exportsModule.assertOpportunityBriefAccess(revoked.grant, { organizationId: "org-a", requestId: request.id, now: later }), (error) => error.code === "WR_BRIEF_ACCESS_REVOKED");
  assert.throws(() => exportsModule.assertOpportunityBriefAccess(grant, { organizationId: "org-a", requestId: request.id, now: "2026-08-15T13:00:00.000Z" }), (error) => error.code === "WR_BRIEF_ACCESS_EXPIRED");

  let state = worker.createOpportunityBriefExportWorkerState({ organizationId: "org-a", updatedAt: now });
  const jobInput = { organizationId: "org-a", requestId: request.id, policyRef: "policy-ref:p1", requestRef: "request-ref:r1", accessGrantRef: "grant-ref:g1", briefRef: "brief-ref:123", createdAt: now, maxAttempts: 2 };
  state = worker.enqueueOpportunityBriefExport(state, jobInput);
  assert.equal(worker.enqueueOpportunityBriefExport(state, jobInput).jobs.length, 1, "enqueue must be idempotent");
  assert.throws(() => worker.enqueueOpportunityBriefExport(state, { ...jobInput, policyRef: "policy-ref:other" }), (error) => error.code === "WR_BRIEF_EXPORT_IDEMPOTENCY_CONFLICT");
  const leased = worker.leaseOpportunityBriefExportJobs(state, { now, workerId: "worker-a", leaseSeconds: 30 });
  assert.equal(leased.leasedJobs.length, 1);
  assert.equal(worker.leaseOpportunityBriefExportJobs(leased.state, { now, workerId: "worker-b", leaseSeconds: 30 }).leasedJobs.length, 0, "active leases must be exclusive");
  let retry = worker.completeOpportunityBriefExportJob(leased.state, { jobId: leased.leasedJobs[0].id, result: { success: false, retryable: true, errorCode: "temporary" } }, { workerId: "worker-a", leaseToken: leased.leasedJobs[0].lease.token, completedAt: later, baseDelaySeconds: 10 });
  assert.equal(retry.jobs[0].status, "retry-scheduled");
  assert.equal(retry.jobs[0].nextAttemptAt, "2026-08-15T12:00:11.000Z");
  const secondLease = worker.leaseOpportunityBriefExportJobs(retry, { now: "2026-08-15T12:00:11.000Z", workerId: "worker-a" });
  const dead = worker.completeOpportunityBriefExportJob(secondLease.state, { jobId: secondLease.leasedJobs[0].id, result: { success: false, retryable: true, errorCode: "still-down" } }, { workerId: "worker-a", leaseToken: secondLease.leasedJobs[0].lease.token, completedAt: "2026-08-15T12:00:12.000Z" });
  assert.equal(dead.jobs[0].status, "dead-lettered");
  assert.equal(dead.deadLetters.length, 1);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "white-rabbit-brief-export-"));
  const databasePath = path.join(tempDir, "brief-exports.sqlite");
  const context = { organizationId: "org-a", actorUserId: "worker-service", subjectUserId: "worker-service", sessionId: "worker-session", requestId: "brief-worker-run", grants: ["persistence:read", "persistence:write"], issuedAt: "2026-08-15T11:00:00.000Z", expiresAt: "2026-08-15T14:00:00.000Z" };
  let repository = new SqlitePlatformRepository({ filename: databasePath, clock: () => now });
  const durableState = worker.enqueueOpportunityBriefExport(worker.createOpportunityBriefExportWorkerState({ organizationId: "org-a", updatedAt: now }), jobInput);
  repository.commit({ context, namespace: "brief-exports", key: "worker-state", value: durableState, expectedTenantRevision: 0, expectedRecordRevision: 0, idempotencyKey: "seed-brief-export", occurredAt: now }, { now });
  let rendererCalls = 0;
  const adapters = {
    resolver: { resolve: async () => ({ policy, request, accessGrant: grant, brief }), resolveAccessGrant: async () => grant },
    renderer: { render: async (renderInput) => { rendererCalls += 1; assert(renderInput.watermark.text.includes("buyer@example.com")); return { format: "json", content: `${renderInput.watermark.text}\n${renderInput.redactedPayload}`, contentType: "application/json", sourcePayloadSha256: renderInput.sourcePayloadSha256, watermarkSha256: renderInput.watermarkSha256 }; } },
    storage: { put: async (putInput) => { assert.equal(putInput.idempotencyKey, `brief-export:org-a:${request.id}`); return { artifactRef: "artifact-ref:durable-1" }; } },
  };
  const run = await worker.runOpportunityBriefExportWorkerCycle({ repository, context, workerId: "worker-a", now, clock: () => later, adapters });
  assert.deepEqual(run.artifactReadyJobIds, [durableState.jobs[0].id]);
  assert.equal(run.leaseReceipt.tenantRevision, 2);
  assert.equal(run.completionReceipt.tenantRevision, 3);
  assert.equal(repository.readRecord(context, "brief-exports", "worker-state", { now: later }).value.jobs[0].status, "artifact-ready");
  assert.equal(rendererCalls, 1);
  repository.close();
  repository = new SqlitePlatformRepository({ filename: databasePath, clock: () => later });
  assert.equal(repository.readRecord(context, "brief-exports", "worker-state", { now: later }).value.jobs[0].artifact.artifactRef, "artifact-ref:durable-1", "completed export must survive repository restart");
  const emptyRun = await worker.runOpportunityBriefExportWorkerCycle({ repository, context, workerId: "worker-b", now: "2026-08-15T12:00:02.000Z", adapters });
  assert.equal(emptyRun.leasedJobIds.length, 0);
  assert.equal(rendererCalls, 1);
  repository.close();
  for (const suffix of ["", "-wal", "-shm"]) { const target = `${databasePath}${suffix}`; if (fs.existsSync(target)) fs.rmSync(target); }
  fs.rmdirSync(tempDir);

  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "opportunity-brief-export.schema.json"), "utf8"));
  assert.equal(schema.$defs.artifact.properties.schemaVersion.const, "wr-opportunity-brief-export-artifact-v1");
  assert.equal(fs.readFileSync(path.join(__dirname, "..", "src", "App.tsx"), "utf8").includes("opportunityBriefExport"), false);
  console.log("White Rabbit evidence-bound opportunity brief export and durable worker tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

(async () => {
  const diligence = await import("../src/collaboration/transactionDiligence.mjs");
  const reminders = await import("../src/collaboration/diligenceReminderWorker.mjs");
  const alerts = await import("../src/alerts/alertDeliveryWorker.mjs");
  const persistence = await import("../src/persistence/platformPersistenceService.mjs");
  const { SqlitePlatformRepository } = await import("../src/persistence/sqlitePlatformRepository.mjs");
  const organizationId = "org-a", dealId = "deal-1", propertyId = "wrp:v1:dallas-county-dcad:A1";
  const calendar = diligence.createBusinessCalendar({ id: "calendar-dallas-2026", jurisdiction: "US-TX-DALLAS", timeZone: "America/Chicago", weekendDays: [0, 6], holidays: ["2026-09-07", "2026-11-26"], sourceAuthority: "Dallas County", sourceVersion: "2026.1", sourceRef: "calendar-ref:dallas-2026", sourceAsOf: "2026-08-01", validThrough: "2026-12-31" });
  assert.equal(diligence.addBusinessDays("2026-09-04", 3, calendar), "2026-09-10", "weekends and Labor Day must be excluded");
  assert.throws(() => diligence.createBusinessCalendar({ ...calendar, calendarSha256: undefined, timeZone: "Not/AZone" }), /IANA/);
  const template = diligence.createDiligenceChecklistTemplate({ id: "acquisition-dd", version: 1, name: "Commercial acquisition diligence", transactionType: "purchase", jurisdiction: "US-TX-DALLAS", createdByUserId: "admin-a", createdAt: "2026-09-01T12:00:00.000Z", tasks: [
    { id: "title-review", title: "Review title commitment", phase: "title", dependencyIds: [], deadlineRule: { anchorId: "effective-date", amount: 3, unit: "business-days", rollConvention: "following", deadlineLocalTime: "17:00:00" }, evidenceRequirements: [{ type: "document-version", minimumCount: 1, description: "Reviewed title commitment" }], assigneeRole: "legal", critical: true, reminderOffsetsSeconds: [86400, 3600], escalationAfterSeconds: 7200 },
    { id: "environmental", title: "Complete environmental review", phase: "physical", dependencyIds: ["title-review"], deadlineRule: { anchorId: "effective-date", amount: 10, unit: "calendar-days", rollConvention: "following", deadlineLocalTime: "17:00:00" }, evidenceRequirements: [{ type: "inspection", minimumCount: 1, description: "Environmental assessment" }], assigneeRole: "diligence", critical: true, reminderOffsetsSeconds: [172800], escalationAfterSeconds: 86400 },
    { id: "survey-waiver", title: "Confirm survey requirement", phase: "survey", dependencyIds: ["title-review"], evidenceRequirements: [], assigneeRole: "legal", waivable: true, critical: false },
    { id: "closing-package", title: "Approve closing package", phase: "closing", dependencyIds: [], deadlineRule: { anchorId: "closing-date", amount: -1, unit: "business-days", rollConvention: "preceding", deadlineLocalTime: "16:00:00" }, evidenceRequirements: [{ type: "approval", minimumCount: 1, description: "Closing approval" }], assigneeRole: "closing", critical: true }
  ] });
  assert.throws(() => diligence.createDiligenceChecklistTemplate({ ...template, templateSha256: undefined, id: "cycle", tasks: [{ ...template.tasks[0], taskSha256: undefined, id: "a", dependencyIds: ["b"] }, { ...template.tasks[1], taskSha256: undefined, id: "b", dependencyIds: ["a"] }] }), (error) => error.code === "WR_DILIGENCE_DEPENDENCY_CYCLE");
  let workflow = diligence.instantiateDiligenceWorkflow({ organizationId, dealId, whiteRabbitPropertyId: propertyId, template, calendar, anchors: { "effective-date": "2026-09-04" }, assignments: { "title-review": "lawyer-a", environmental: "analyst-a" }, createdByUserId: "user-a", createdAt: "2026-09-01T13:00:00.000Z" });
  assert.equal(workflow.tasks.find((item) => item.id === "title-review").criticalDate.localDueDate, "2026-09-10");
  assert.equal(workflow.tasks.find((item) => item.id === "title-review").criticalDate.dueAt, "2026-09-10T22:00:00.000Z", "Dallas 5 PM CDT must resolve to 22:00 UTC");
  assert.equal(workflow.tasks.find((item) => item.id === "closing-package").criticalDate.status, "unknown-anchor");
  assert.equal(workflow.tasks.find((item) => item.id === "environmental").status, "blocked");
  assert.throws(() => diligence.createDiligenceWorkflow({ ...workflow, tasks: workflow.tasks.map((item) => item.id === "title-review" ? { ...item, status: "completed" } : item) }), (error) => ["WR_DILIGENCE_TASK_INTEGRITY_FAILURE", "WR_DILIGENCE_HISTORY_INTEGRITY_FAILURE", "WR_DILIGENCE_WORKFLOW_INTEGRITY_FAILURE"].includes(error.code));
  assert.throws(() => diligence.completeDiligenceTask(workflow, "title-review", [], { organizationId, actorUserId: "lawyer-a", grants: ["diligence:complete"], expectedRevision: 1, occurredAt: "2026-09-02T13:00:00.000Z" }), (error) => error.code === "WR_DILIGENCE_EVIDENCE_INCOMPLETE");
  workflow = diligence.startDiligenceTask(workflow, "title-review", { organizationId, actorUserId: "lawyer-a", grants: ["diligence:write"], expectedRevision: 1, occurredAt: "2026-09-02T13:00:00.000Z" });
  const titleEvidence = diligence.createDiligenceEvidenceReceipt({ organizationId, dealId, workflowId: workflow.id, taskId: "title-review", type: "document-version", evidenceRef: "evidence-ref:title-v3", evidenceSha256: diligence.diligenceSha256("title-v3"), verifiedByUserId: "reviewer-a", verificationPolicyId: "title-review-policy", verifiedAt: "2026-09-02T14:00:00.000Z", expiresAt: "2026-10-01T00:00:00.000Z" });
  const futureEvidence = diligence.createDiligenceEvidenceReceipt({ ...titleEvidence, id: "future-title", receiptSha256: undefined, evidenceRef: "evidence-ref:future-title", verifiedAt: "2026-09-03T14:00:00.000Z" });
  assert.throws(() => diligence.completeDiligenceTask(workflow, "title-review", [futureEvidence], { organizationId, actorUserId: "lawyer-a", grants: ["diligence:complete"], expectedRevision: 2, occurredAt: "2026-09-02T14:00:00.000Z" }), (error) => error.code === "WR_DILIGENCE_EVIDENCE_FUTURE");
  assert.throws(() => diligence.completeDiligenceTask(workflow, "title-review", [titleEvidence, titleEvidence], { organizationId, actorUserId: "lawyer-a", grants: ["diligence:complete"], expectedRevision: 2, occurredAt: "2026-09-02T14:00:00.000Z" }), (error) => error.code === "WR_DILIGENCE_EVIDENCE_DUPLICATE");
  workflow = diligence.completeDiligenceTask(workflow, "title-review", [titleEvidence], { organizationId, actorUserId: "lawyer-a", grants: ["diligence:complete"], expectedRevision: 2, occurredAt: "2026-09-02T14:00:00.000Z" });
  assert.equal(workflow.tasks.find((item) => item.id === "environmental").status, "ready");
  assert.equal(workflow.history.filter((item) => item.action === "task.unblocked").length, 2);
  assert.throws(() => diligence.waiveDiligenceTask(workflow, "environmental", [], { organizationId, actorUserId: "admin-a", grants: ["diligence:waive"], expectedRevision: 3, occurredAt: "2026-09-02T15:00:00.000Z", reason: "Skip" }), (error) => error.code === "WR_DILIGENCE_WAIVER_DENIED");
  assert.throws(() => diligence.waiveDiligenceTask(workflow, "survey-waiver", [], { organizationId, actorUserId: "admin-a", grants: ["diligence:waive"], expectedRevision: 3, occurredAt: "2026-09-02T15:00:00.000Z", reason: "Existing current survey accepted" }), (error) => error.code === "WR_DILIGENCE_WAIVER_APPROVAL_REQUIRED");
  const waiverApproval = diligence.createDiligenceEvidenceReceipt({ organizationId, dealId, workflowId: workflow.id, taskId: "survey-waiver", type: "approval", evidenceRef: "evidence-ref:survey-waiver-approval", evidenceSha256: diligence.diligenceSha256("survey waiver approved"), verifiedByUserId: "legal-director", verificationPolicyId: "waiver-policy", verifiedAt: "2026-09-02T14:30:00.000Z" });
  workflow = diligence.waiveDiligenceTask(workflow, "survey-waiver", [waiverApproval], { organizationId, actorUserId: "admin-a", grants: ["diligence:waive"], expectedRevision: 3, occurredAt: "2026-09-02T15:00:00.000Z", reason: "Existing current survey accepted" });
  workflow = diligence.updateDiligenceAnchor(workflow, { template, calendar, anchorId: "closing-date", anchorDate: "2026-09-30" }, { organizationId, actorUserId: "closing-a", grants: ["diligence:calendar"], expectedRevision: 4, occurredAt: "2026-09-02T16:00:00.000Z" });
  assert.equal(workflow.tasks.find((item) => item.id === "closing-package").status, "ready");
  assert.equal(workflow.tasks.find((item) => item.id === "closing-package").criticalDate.localDueDate, "2026-09-29");
  const sla = diligence.evaluateDiligenceSla(workflow, { evaluatedAt: "2026-09-15T22:00:01.000Z" });
  assert.equal(sla.findings.find((item) => item.taskId === "title-review"), undefined, "completed tasks must not generate SLA findings");
  assert(["warning", "breached", "critical"].includes(sla.status));
  assert.equal(diligence.evaluateDiligenceSla(diligence.instantiateDiligenceWorkflow({ organizationId, dealId, whiteRabbitPropertyId: propertyId, template, calendar, anchors: { "effective-date": "2026-09-04" }, createdByUserId: "user-a", createdAt: "2026-09-01T13:00:00.000Z" }), { evaluatedAt: "2026-09-11T01:00:01.000Z" }).findings.find((item) => item.taskId === "title-review").severity, "critical");

  const reminderJobs = reminders.buildDiligenceReminderJobs(workflow, { createdAt: "2026-09-02T16:00:00.000Z", recipientForTask: (task) => ({ recipientRef: `recipient-ref:${task.assigneeUserId || task.assigneeRole}`, subscriptionId: `sub-${task.id}`, channelType: "email", providerId: "email-primary", endpointRef: `secret-ref:${task.id}` }), payloadRefForJob: ({ task, kind }) => `payload-ref:${task.id}:${kind}`, maxAttempts: 2 });
  assert(reminderJobs.length >= 3); assert(reminderJobs.every((item) => !JSON.stringify(item).includes("@")));
  let reminderState = reminders.createDiligenceReminderWorkerState({ organizationId, updatedAt: "2026-09-02T16:00:00.000Z" });
  reminderState = reminders.enqueueDiligenceReminderJobs(reminderState, reminderJobs, { updatedAt: "2026-09-02T16:00:00.000Z" });
  assert.equal(reminders.enqueueDiligenceReminderJobs(reminderState, reminderJobs, { updatedAt: "2026-09-02T16:00:00.000Z" }).jobs.length, reminderState.jobs.length);
  assert.throws(() => reminders.enqueueDiligenceReminderJobs(reminderState, [{ ...reminderJobs[0], payloadRef: "payload-ref:changed" }]), (error) => error.code === "WR_DILIGENCE_REMINDER_IDEMPOTENCY_CONFLICT");
  const dueTime = reminderState.jobs[0].scheduledAt;
  const lease = reminders.leaseDiligenceReminderJobs(reminderState, { now: dueTime, workerId: "worker-a", leaseSeconds: 30, limit: 1 });
  assert.equal(lease.leasedJobs.length, 1); assert.equal(reminders.leaseDiligenceReminderJobs(lease.state, { now: dueTime, workerId: "worker-b" }).leasedJobs.length, 0);
  const supersedingWorkflow = diligence.updateDiligenceAnchor(workflow, { template, calendar, anchorId: "effective-date", anchorDate: "2026-09-05" }, { organizationId, actorUserId: "admin-a", grants: ["diligence:calendar"], expectedRevision: workflow.revision, occurredAt: "2026-09-02T17:00:00.000Z" });
  let staleEnqueueCalls = 0;
  const staleResult = await reminders.emitDiligenceReminder(lease.leasedJobs[0], { resolveWorkflow: async () => supersedingWorkflow, enqueueDeliveryAttempt: async () => { staleEnqueueCalls += 1; return { success: true }; } });
  assert.equal(staleResult.cancelled, true); assert.equal(staleEnqueueCalls, 0, "superseded workflow reminders must fail closed before alert enqueue");
  let retryState = reminders.completeDiligenceReminderJob(lease.state, { jobId: lease.leasedJobs[0].id, result: { success: false, retryable: true, errorCode: "queue-down" } }, { workerId: "worker-a", leaseToken: lease.leasedJobs[0].lease.token, completedAt: new Date(new Date(dueTime).getTime() + 1000).toISOString(), baseDelaySeconds: 10 });
  assert.equal(retryState.jobs.find((item) => item.id === lease.leasedJobs[0].id).status, "retry-scheduled");
  const retryAt = retryState.jobs.find((item) => item.id === lease.leasedJobs[0].id).nextAttemptAt;
  const lease2 = reminders.leaseDiligenceReminderJobs(retryState, { now: retryAt, workerId: "worker-a", limit: 1 });
  const deadState = reminders.completeDiligenceReminderJob(lease2.state, { jobId: lease2.leasedJobs[0].id, result: { success: false, retryable: true, errorCode: "queue-down" } }, { workerId: "worker-a", leaseToken: lease2.leasedJobs[0].lease.token, completedAt: new Date(new Date(retryAt).getTime() + 1000).toISOString() });
  assert.equal(deadState.deadLetters.length, 1);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "white-rabbit-diligence-")); const dbPath = path.join(tempDir, "diligence.sqlite"); const workerNow = reminderJobs[0].scheduledAt;
  const authContext = { organizationId, actorUserId: "diligence-service", subjectUserId: "diligence-service", sessionId: "session-diligence", requestId: "diligence-run", grants: ["persistence:read", "persistence:write"], issuedAt: new Date(new Date(workerNow).getTime() - 3600000).toISOString(), expiresAt: new Date(new Date(workerNow).getTime() + 3600000).toISOString() };
  let repository = new SqlitePlatformRepository({ filename: dbPath, clock: () => workerNow });
  const workflowReceipt = persistence.persistDiligenceWorkflow(repository, authContext, workflow, { expectedTenantRevision: 0, expectedRecordRevision: 0, idempotencyKey: "workflow-1", occurredAt: workerNow, validation: { now: workerNow } }); assert.equal(workflowReceipt.tenantRevision, 1);
  let durableWorkerState = reminders.createDiligenceReminderWorkerState({ organizationId, updatedAt: reminderJobs[0].createdAt }); durableWorkerState = reminders.enqueueDiligenceReminderJobs(durableWorkerState, [reminderJobs[0]], { updatedAt: reminderJobs[0].createdAt });
  repository.commit({ context: authContext, namespace: "diligence", key: "reminder-worker", value: durableWorkerState, expectedTenantRevision: 1, expectedRecordRevision: 0, idempotencyKey: "seed-reminders", occurredAt: workerNow }, { now: workerNow });
  let enqueueCalls = 0;
  let workflowResolutions = 0;
  const adapter = { resolveWorkflow: async () => { workflowResolutions += 1; return workflow; }, enqueueDeliveryAttempt: async (request) => { enqueueCalls += 1; const stored = repository.readRecord(authContext, "diligence", "reminder-worker", { now: workerNow }).value; assert.equal(stored.jobs.find((item) => item.id === request.reminderJobId).status, "leased", "lease must persist before alert enqueue"); const alertJob = alerts.createAlertDeliveryJob({ organizationId: request.organizationId, deliveryAttemptId: request.deliveryAttemptId, alertEnvelopeId: request.alertEnvelopeId, subscriptionId: request.subscriptionId, channelType: request.channelType, providerId: request.providerId, endpointRef: request.endpointRef, payloadRef: request.payloadRef, providerIdempotencyKey: request.providerIdempotencyKey, createdAt: workerNow }); assert.equal(alertJob.providerIdempotencyKey, request.providerIdempotencyKey); return { success: true, deliveryAttemptId: request.deliveryAttemptId }; } };
  const run = await reminders.runDiligenceReminderWorkerCycle({ repository, context: authContext, workerId: "worker-durable", now: workerNow, clock: () => new Date(new Date(workerNow).getTime() + 1000).toISOString(), adapter, limit: 1 });
  assert.equal(run.emittedJobIds.length, 1); assert.equal(enqueueCalls, 1); assert.equal(workflowResolutions, 1); assert.equal(run.leaseReceipt.tenantRevision, 3); assert.equal(run.completionReceipt.tenantRevision, 4);
  assert.equal(persistence.loadDiligenceWorkflow(repository, authContext, workflow.id, { validation: { now: workerNow } }).workflowSha256, workflow.workflowSha256);
  assert.equal(persistence.listDiligenceWorkflows(repository, authContext, { limit: 10, validation: { now: workerNow } }).records.length, 1);
  repository.close(); repository = new SqlitePlatformRepository({ filename: dbPath, clock: () => workerNow });
  assert.equal(repository.readRecord(authContext, "diligence", "reminder-worker", { now: workerNow }).value.jobs[0].status, "emitted");
  const empty = await reminders.runDiligenceReminderWorkerCycle({ repository, context: authContext, workerId: "worker-durable", now: new Date(new Date(workerNow).getTime() + 2000).toISOString(), adapter }); assert.equal(empty.leasedJobIds.length, 0); assert.equal(enqueueCalls, 1);
  repository.close(); for (const suffix of ["", "-wal", "-shm"]) { const target = `${dbPath}${suffix}`; if (fs.existsSync(target)) fs.rmSync(target); } fs.rmdirSync(tempDir);

  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "transaction-diligence.schema.json"), "utf8")); assert.equal(schema.$defs.workflow.properties.schemaVersion.const, "wr-diligence-workflow-v1");
  const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.tsx"), "utf8"); assert.equal(/transactionDiligence|diligenceReminderWorker/.test(app), false);
  console.log("White Rabbit transaction diligence, critical-date, evidence-gate, SLA, and durable reminder tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

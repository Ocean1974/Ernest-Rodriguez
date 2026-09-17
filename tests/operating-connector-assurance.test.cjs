const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

(async () => {
  const feedCertification = await import("../src/operations/feedCertification.mjs");
  const telemetry = await import("../src/operations/serviceObservability.mjs");
  const runtime = await import("../src/portfolio/operatingConnectorRuntime.mjs");
  const assurance = await import("../src/portfolio/operatingConnectorAssurance.mjs");
  const persistence = await import("../src/persistence/platformPersistenceService.mjs");
  const { SqlitePlatformRepository } = await import("../src/persistence/sqlitePlatformRepository.mjs");

  const organizationId = "org-a", connectorId = "pm-statements", now = "2026-11-15T12:00:00.000Z";
  const manifest = feedCertification.createFeedConnectorManifest({ connectorId, connectorVersion: "1.0.0", providerId: "property-manager", datasetId: "operating-statements", expectedEventSchemaVersion: "wr-operating-feed-record-v1", licenseId: "license-feed", contractStartsAt: "2026-01-01", contractExpiresAt: "2027-12-31", thresholds: { minimumFixtureCount: 1, minimumSampleCount: 1, minimumGeometryPct: 0 } });
  const certificationEvidence = feedCertification.createFeedCertificationEvidence({ connectorId, connectorVersion: "1.0.0", generatedAt: "2026-11-15T11:00:00.000Z", license: { contractExecuted: true, licenseId: "license-feed", rights: { store: true, derive: true, query: true } }, schema: { schemaVersion: "wr-operating-feed-record-v1", fixtureCount: 5, failedFixtureCount: 0 }, pointInTime: { futureEvidenceRejected: true, availabilityTimePreserved: true, expiryEnforced: true }, replay: { idempotencyPassed: true, checkpointResumePassed: true, duplicateWriteCount: 0 }, freshness: { sampleCount: 10, p95LagMs: 100, maxLagMs: 200, currentPct: 100 }, coverage: { sampleCount: 10, canonicalIdentityPct: 100, requiredFieldPct: 100, geometryPct: 100 }, dataQuality: { duplicatePct: 0, invalidIdentityPct: 0, quarantinePct: 0 }, security: { secretRefOnly: true, encryptedTransport: true, ssrfProtection: true, leastPrivilege: true }, loadReport: { schemaVersion: "wr-load-resilience-report-v1", status: "passed" }, provenance: { artifactSha256: "a".repeat(64), testRunId: "assurance-1", independentReviewer: true } });
  const certification = feedCertification.certifyFeedConnector({ manifest, evidence: certificationEvidence, asOf: now });
  const connectorInput = { organizationId, connectorId, connectorVersion: "1.0.0", providerId: "property-manager", datasetId: "operating-statements", baseUrl: "https://api.provider.example/v1", allowedHosts: ["api.provider.example"], credentialRef: "secret-ref:vault/pm-statements-v1", licenseId: "license-feed", rights: { store: true, derive: true, query: true }, mappingProfileId: "statement-map", mappingProfileVersion: 1, maxPageSize: 10, maxPagesPerRun: 2, maxRecordsPerRun: 20, certification };
  const connector = runtime.createOperatingConnector(connectorInput);
  const profile = runtime.createOperatingMappingProfile({ id: "statement-map", organizationId, connectorId, version: 1, targetKind: "operating-statement", mappings: [{ sourceField: "statement_id", targetPath: "id", required: true }, { sourceField: "asset_id", targetPath: "assetId", required: true }, { sourceField: "entries", targetPath: "entries", required: true }], constants: { organizationId, whiteRabbitPropertyId: "wrp:v1:dallas-county-dcad:A1", periodStart: "2026-10-01", periodEnd: "2026-10-31", basis: "accrual", currency: "USD", expectedAccountCodes: ["rent"] }, createdByUserId: "mapping-author", createdAt: now, approvedByUserId: "mapping-approver", approvedAt: "2026-11-15T11:10:00.000Z" });

  const validFields = { statement_id: "statement-oct", asset_id: "asset-1", entries: [{ accountCode: "rent", amount: 10000 }] };
  const baseline = assurance.createConnectorSchemaBaseline({ id: "pm-schema", organizationId, connectorId, version: 1, sampleRecords: [validFields, { ...validFields, statement_id: "statement-nov" }], requiredPaths: ["statement_id", "asset_id", "entries", "entries[].accountCode", "entries[].amount"], createdByUserId: "data-engineer", createdAt: now, approvedByUserId: "data-governor", approvedAt: "2026-11-15T11:15:00.000Z" });
  assert.match(baseline.baselineSha256, /^[a-f0-9]{64}$/);
  assert.throws(() => assurance.createConnectorSchemaBaseline({ ...baseline, baselineSha256: undefined, approvedByUserId: "data-engineer" }), (error) => error.code === "WR_SCHEMA_BASELINE_APPROVAL_SEPARATION_REQUIRED");
  const page = (fields, pageSha256 = "b".repeat(64)) => ({ pageSha256, fetchedAt: now, records: [{ fields }] });
  const compatible = assurance.assessConnectorSchemaPage(baseline, page(validFields));
  assert.equal(compatible.status, "compatible");
  const additive = assurance.assessConnectorSchemaPage(baseline, page({ ...validFields, memo: "new optional field" }, "c".repeat(64)));
  assert.equal(additive.status, "compatible-with-drift");
  assert.deepEqual(additive.addedPaths, ["memo"]);
  const incompatible = assurance.assessConnectorSchemaPage(baseline, page({ statement_id: "bad", asset_id: 123, entries: [] }, "d".repeat(64)));
  assert.equal(incompatible.status, "incompatible");
  assert(incompatible.missingRequiredPaths.includes("entries[].accountCode"));
  assert(incompatible.typeChanges.some((item) => item.path === "asset_id"));

  const currentCredential = assurance.createConnectorCredentialBinding({ id: "credential-v1", organizationId, connectorId, version: 1, secretRef: "secret-ref:vault/pm-statements-v1", validFrom: "2026-01-01", expiresAt: "2026-12-31", status: "active", createdByUserId: "security-1", createdAt: "2026-01-01", evidenceRefs: ["evidence-ref:vault-version-1"] });
  const nextCredential = assurance.createConnectorCredentialBinding({ id: "credential-v2", organizationId, connectorId, version: 2, secretRef: "secret-ref:vault/pm-statements-v2", validFrom: "2026-11-01", expiresAt: "2027-12-31", status: "staged", createdByUserId: "security-2", createdAt: "2026-11-01", evidenceRefs: ["evidence-ref:vault-version-2", "evidence-ref:credential-smoke-test"] });
  assert.throws(() => assurance.createConnectorCredentialBinding({ ...nextCredential, bindingSha256: undefined, secretRef: "actual-secret" }), /opaque secret-ref/);
  const rotation = assurance.createConnectorCredentialRotation({ id: "rotation-1", organizationId, connectorId, fromBindingId: currentCredential.id, fromBindingSha256: currentCredential.bindingSha256, toBindingId: nextCredential.id, toBindingSha256: nextCredential.bindingSha256, requestedByUserId: "security-2", requestedAt: "2026-11-15T11:20:00.000Z", approvedByUserId: "security-director", approvedAt: "2026-11-15T11:30:00.000Z", evidenceRefs: ["evidence-ref:rotation-change-1"] });
  assert.throws(() => assurance.createConnectorCredentialRotation({ ...rotation, rotationSha256: undefined, approvedByUserId: "security-2" }), (error) => error.code === "WR_CREDENTIAL_ROTATION_APPROVAL_SEPARATION_REQUIRED");

  const drillPlan = assurance.createConnectorDrillPlan({ id: "drill-plan-1", organizationId, connectorId, connectorSha256: connector.connectorSha256, createdByUserId: "sre-1", createdAt: "2026-11-14T09:00:00.000Z", approvedByUserId: "sre-director", approvedAt: "2026-11-14T10:00:00.000Z" });
  const executedScenarios = [];
  const drillResult = await assurance.runConnectorDrillSuite(drillPlan, ({ scenario, idempotencyKey }) => { executedScenarios.push(scenario); assert.match(idempotencyKey, /^connector-drill:/); return { passed: true, assertionCount: 3, durationMs: 25, evidenceRefs: [`evidence-ref:${scenario}-run`] }; }, { startedAt: "2026-11-14T11:00:00.000Z", completedAt: "2026-11-14T11:05:00.000Z" });
  assert.equal(drillResult.status, "passed");
  assert.equal(executedScenarios.length, 5);
  const failedDrill = await assurance.runConnectorDrillSuite(drillPlan, ({ scenario }) => ({ passed: scenario !== "schema-drift", assertionCount: 2, errorCode: "not-contained", evidenceRefs: [`evidence-ref:${scenario}-failed-run`] }), { id: "failed-drill", startedAt: "2026-11-14T12:00:00.000Z", completedAt: "2026-11-14T12:05:00.000Z" });
  assert.equal(failedDrill.status, "failed");

  const passingCollector = telemetry.createTelemetryCollector({ organizationId });
  passingCollector.record({ organizationId, serviceName: "operating-connector", operation: "fetch-page", traceId: "trace-pass", spanId: "span-pass", startedAt: "2026-11-15T11:59:00.000Z", endedAt: "2026-11-15T11:59:00.100Z", status: "success", measurements: { durationMs: 100, records: 10, saturationPct: 10, sourceLagMs: 1000 }, attributes: { connectorId, providerId: "property-manager", datasetId: "operating-statements", credential: "must-be-dropped" } });
  const passingSnapshot = passingCollector.snapshot({ capturedAt: now, serviceName: "operating-connector", operation: "fetch-page" });
  assert(!Object.prototype.hasOwnProperty.call(passingSnapshot.events[0].attributes, "credential"));
  const sloPolicy = telemetry.createServiceSloPolicy({ serviceName: "operating-connector", operation: "fetch-page", windowMinutes: 10, minimumSampleCount: 1, availabilityTargetPct: 99, latencyP95Ms: 500, maxSaturationPct: 80, maxSourceLagMs: 5000 });
  const sloReport = telemetry.evaluateServiceSlo(passingSnapshot, sloPolicy, { evaluatedAt: now });
  assert.equal(sloReport.status, "passed");
  const adapterCertification = assurance.certifyOperatingAdapter({ connector, mappingProfile: profile, schemaBaseline: baseline, credentialBinding: currentCredential, drillResult, sloReport, reviewerUserId: "independent-risk-reviewer", certifiedAt: now });
  assert.equal(adapterCertification.status, "certified");
  assert.equal(adapterCertification.activationAuthorized, true);
  assert.throws(() => assurance.certifyOperatingAdapter({ connector, mappingProfile: profile, schemaBaseline: baseline, credentialBinding: currentCredential, drillResult, sloReport, reviewerUserId: "mapping-author", certifiedAt: now }), (error) => error.code === "WR_ADAPTER_CERTIFICATION_REVIEW_SEPARATION_REQUIRED");
  const rejectedCertification = assurance.certifyOperatingAdapter({ connector, mappingProfile: profile, schemaBaseline: baseline, credentialBinding: currentCredential, drillResult: failedDrill, sloReport, reviewerUserId: "independent-risk-reviewer", certifiedAt: now });
  assert.equal(rejectedCertification.status, "rejected");
  assert(rejectedCertification.blockers.includes("drills"));

  const emptyWorker = runtime.createOperatingConnectorWorkerState({ organizationId, connectors: [connector], mappingProfiles: [profile], updatedAt: now });
  let assuranceState = assurance.createConnectorAssuranceState({ organizationId, schemaBaselines: [baseline], credentialBindings: [currentCredential, nextCredential], credentialRotations: [rotation], drillPlans: [drillPlan], drillResults: [drillResult], adapterCertifications: [adapterCertification], schemaAssessments: [compatible, additive], updatedAt: now });
  const healthy = assurance.createConnectorHealthReport({ connector, sloReport, workerState: emptyWorker, schemaAssessments: assuranceState.schemaAssessments, evaluatedAt: now });
  assert.equal(healthy.status, "healthy");
  const blocked = assurance.createConnectorHealthReport({ connector, sloReport: { ...sloReport, status: "failed" }, workerState: emptyWorker, schemaAssessments: [incompatible], evaluatedAt: now });
  assert.equal(blocked.status, "blocked");
  assuranceState = assurance.createConnectorAssuranceState({ ...assuranceState, stateSha256: undefined, revision: 2, healthReports: [healthy], updatedAt: "2026-11-15T12:00:01.000Z" });
  assert.throws(() => assurance.createConnectorAssuranceState({ ...assuranceState, stateSha256: undefined, schemaAssessments: [{ ...compatible, addedPaths: ["tampered"] }] }), (error) => error.code === "WR_CONNECTOR_SCHEMA_ASSESSMENT_INTEGRITY_FAILURE");

  assert.throws(() => assurance.applyApprovedCredentialRotation(emptyWorker, assuranceState, rotation.id, { organizationId, grants: [], expectedWorkerRevision: emptyWorker.revision, expectedAssuranceRevision: assuranceState.revision, occurredAt: "2026-11-15T12:01:00.000Z" }), (error) => error.code === "WR_CONNECTOR_PERMISSION_DENIED");
  const rotated = assurance.applyApprovedCredentialRotation(emptyWorker, assuranceState, rotation.id, { organizationId, grants: ["connector:credential-rotate"], expectedWorkerRevision: emptyWorker.revision, expectedAssuranceRevision: assuranceState.revision, occurredAt: "2026-11-15T12:01:00.000Z" });
  assert.equal(rotated.workerState.connectors[0].credentialRef, nextCredential.secretRef);
  assert.equal(rotated.assuranceState.credentialBindings.find((item) => item.id === currentCredential.id).status, "retired");
  assert.equal(rotated.assuranceState.credentialBindings.find((item) => item.id === nextCredential.id).status, "active");
  assert.equal(rotated.assuranceState.credentialRotations[0].status, "applied");

  const driftJob = runtime.createOperatingConnectorJob({ id: "drift-job", organizationId, connectorId, maxFailures: 1, createdAt: "2026-11-15T12:02:00.000Z" });
  const driftWorker = runtime.createOperatingConnectorWorkerState({ organizationId, connectors: [connector], mappingProfiles: [profile], jobs: [driftJob], updatedAt: "2026-11-15T12:02:00.000Z" });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "white-rabbit-connector-assurance-")), dbPath = path.join(tempDir, "assurance.sqlite");
  const context = { organizationId, actorUserId: "connector-worker", subjectUserId: "connector-worker", sessionId: "session-1", requestId: "request-1", grants: ["persistence:read", "persistence:write", "connector:credential-rotate"], issuedAt: "2026-11-15T11:00:00.000Z", expiresAt: "2026-11-15T14:00:00.000Z" };
  let repository = new SqlitePlatformRepository({ filename: dbPath, clock: () => "2026-11-15T12:02:02.000Z" });
  persistence.persistOperatingConnectorWorkerState(repository, context, driftWorker, { expectedTenantRevision: 0, expectedRecordRevision: 0, idempotencyKey: "seed-drift-worker", occurredAt: "2026-11-15T12:02:00.000Z", validation: { now: "2026-11-15T12:02:00.000Z" } });
  persistence.persistConnectorAssuranceState(repository, context, assuranceState, { expectedTenantRevision: 1, expectedRecordRevision: 0, idempotencyKey: "seed-assurance-state", occurredAt: "2026-11-15T12:02:00.000Z", validation: { now: "2026-11-15T12:02:00.000Z" } });
  const driftCollector = telemetry.createTelemetryCollector({ organizationId });
  const assessments = [];
  const schemaGuard = assurance.createConnectorSchemaGuard(assuranceState, connectorId, { clock: () => "2026-11-15T12:02:01.000Z", onAssessment: (assessment) => assessments.push(assessment) });
  const driftRun = await runtime.runOperatingConnectorWorkerCycle({
    repository,
    context,
    workerId: "worker-drift",
    now: "2026-11-15T12:02:00.000Z",
    leaseSeconds: 60,
    clock: () => "2026-11-15T12:02:02.000Z",
    schemaGuard,
    telemetryCollector: driftCollector,
    adapterRegistry: {
      [connectorId]: {
        fetchPage: () => ({
          responseId: "drift-response",
          fetchedAt: "2026-11-15T12:02:01.000Z",
          nextCursor: "bad-0",
          hasMore: false,
          records: [{ id: "raw-bad", sequence: 0, cursor: "bad-0", observedAt: "2026-11-15T11:50:00.000Z", availableAt: "2026-11-15T11:51:00.000Z", effectiveAt: "2026-10-31T23:59:59.000Z", fields: { statement_id: "bad", asset_id: 123, entries: [] } }],
        }),
      },
    },
  });
  assert.deepEqual(driftRun.deadLetteredJobIds, ["drift-job"]);
  assert.equal(driftRun.pageApplicationSha256s.length, 0, "incompatible schemas must be blocked before ledger application");
  const driftSnapshot = driftCollector.snapshot({ capturedAt: "2026-11-15T12:03:00.000Z", serviceName: "operating-connector", operation: "fetch-page" });
  assert.equal(driftSnapshot.events[0].status, "rejected");
  assert.equal(driftSnapshot.events[0].errorCode, "WR_CONNECTOR_SCHEMA_DRIFT");
  assert.equal(assessments[0].status, "incompatible");
  assert.equal(repository.readRecord(context, "operating-feed", "checkpoint:operating-statements", { now: "2026-11-15T12:03:00.000Z" }), null);

  const persistedWorkerRecord = repository.readRecord(context, "operating-feed", "connector-worker-state", { now: "2026-11-15T12:03:00.000Z" });
  const persistedAssuranceRecord = repository.readRecord(context, "operating-feed", "connector-assurance-state", { now: "2026-11-15T12:03:00.000Z" });
  const atomicRotation = assurance.applyApprovedCredentialRotation(persistedWorkerRecord.value, persistedAssuranceRecord.value, rotation.id, { organizationId, grants: ["connector:credential-rotate"], expectedWorkerRevision: persistedWorkerRecord.value.revision, expectedAssuranceRevision: persistedAssuranceRecord.value.revision, occurredAt: "2026-11-15T12:03:01.000Z" });
  const rotationReceipt = assurance.persistAppliedCredentialRotation(repository, context, atomicRotation, { expectedTenantRevision: repository.tenantRevision(context, { now: "2026-11-15T12:03:01.000Z" }), expectedWorkerRecordRevision: persistedWorkerRecord.revision, expectedAssuranceRecordRevision: persistedAssuranceRecord.revision, idempotencyKey: "apply-credential-rotation-1", occurredAt: "2026-11-15T12:03:01.000Z", validation: { now: "2026-11-15T12:03:01.000Z" } });
  assert.equal(rotationReceipt.mutationCount, 2);

  repository.close(); repository = new SqlitePlatformRepository({ filename: dbPath, clock: () => "2026-11-15T12:03:00.000Z" });
  assert.equal(persistence.loadConnectorAssuranceState(repository, context, { validation: { now: "2026-11-15T12:03:00.000Z" } }).adapterCertifications[0].status, "certified");
  assert.equal(persistence.loadOperatingConnectorWorkerState(repository, context, { validation: { now: "2026-11-15T12:03:02.000Z" } }).connectors[0].credentialRef, nextCredential.secretRef);
  assert.equal(persistence.loadConnectorAssuranceState(repository, context, { validation: { now: "2026-11-15T12:03:02.000Z" } }).credentialRotations[0].status, "applied");
  assert.equal(persistence.loadConnectorAssuranceState(repository, { ...context, organizationId: "org-b" }, { validation: { now: "2026-11-15T12:03:00.000Z" } }), null);
  repository.close(); fs.rmSync(tempDir, { recursive: true, force: true });

  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "operating-connector-assurance.schema.json"), "utf8"));
  assert.equal(schema.$defs.assuranceState.properties.schemaVersion.const, "wr-connector-assurance-state-v1");
  const gates = fs.readFileSync(path.join(__dirname, "..", "src", "data", "platformFeatureGates.ts"), "utf8");
  for (const gate of ["connectorObservability", "connectorSchemaDriftContainment", "connectorCredentialRotation", "connectorOperationalDrills", "providerAdapterCertificationPacks"]) assert.match(gates, new RegExp(`${gate}: false`));
  const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.tsx"), "utf8");
  assert.equal(app.includes("operatingConnectorAssurance"), false);
  console.log("White Rabbit connector telemetry, schema containment, credential rotation, drill, certification, health, and durability tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

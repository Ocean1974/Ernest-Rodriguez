const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

(async () => {
  const certificationApi = await import("../src/operations/feedCertification.mjs");
  const connectors = await import("../src/portfolio/operatingConnectorRuntime.mjs");
  const assets = await import("../src/portfolio/assetOperations.mjs");
  const persistence = await import("../src/persistence/platformPersistenceService.mjs");
  const { SqlitePlatformRepository } = await import("../src/persistence/sqlitePlatformRepository.mjs");

  const organizationId = "org-a", connectorId = "pm-statements", datasetId = "operating-statements", now = "2026-11-15T12:00:00.000Z", operationNow = "2026-11-15T12:00:02.000Z";
  const manifest = certificationApi.createFeedConnectorManifest({ connectorId, connectorVersion: "1.0.0", providerId: "property-manager", datasetId, expectedEventSchemaVersion: "wr-operating-feed-record-v1", licenseId: "license-feed", contractStartsAt: "2026-01-01", contractExpiresAt: "2027-12-31", thresholds: { minimumFixtureCount: 1, minimumSampleCount: 1, minimumGeometryPct: 0 } });
  const evidence = certificationApi.createFeedCertificationEvidence({ connectorId, connectorVersion: "1.0.0", generatedAt: "2026-11-15T11:00:00.000Z", license: { contractExecuted: true, licenseId: "license-feed", rights: { store: true, derive: true, query: true } }, schema: { schemaVersion: "wr-operating-feed-record-v1", fixtureCount: 5, failedFixtureCount: 0 }, pointInTime: { futureEvidenceRejected: true, availabilityTimePreserved: true, expiryEnforced: true }, replay: { idempotencyPassed: true, checkpointResumePassed: true, duplicateWriteCount: 0 }, freshness: { sampleCount: 10, p95LagMs: 100, maxLagMs: 200, currentPct: 100 }, coverage: { sampleCount: 10, canonicalIdentityPct: 100, requiredFieldPct: 100, geometryPct: 100 }, dataQuality: { duplicatePct: 0, invalidIdentityPct: 0, quarantinePct: 0 }, security: { secretRefOnly: true, encryptedTransport: true, ssrfProtection: true, leastPrivilege: true }, loadReport: { schemaVersion: "wr-load-resilience-report-v1", status: "passed", scenarioId: "operating-connectors" }, provenance: { artifactSha256: "a".repeat(64), testRunId: "connector-runtime-1", independentReviewer: true } });
  const certification = certificationApi.certifyFeedConnector({ manifest, evidence, asOf: now });
  const connectorInput = { organizationId, connectorId, connectorVersion: "1.0.0", providerId: "property-manager", datasetId, baseUrl: "https://api.provider.example/v1", allowedHosts: ["api.provider.example"], credentialRef: "secret-ref:vault/pm-statements", licenseId: "license-feed", rights: { store: true, derive: true, query: true }, mappingProfileId: "statement-map", mappingProfileVersion: 1, cursorMode: "opaque", maxPageSize: 2, maxPagesPerRun: 2, maxRecordsPerRun: 4, maximumBackfillWindowDays: 31, certification };
  const connector = connectors.createOperatingConnector(connectorInput);
  assert.equal(connector.certificationSha256, certification.certificationSha256);
  assert.throws(() => connectors.createOperatingConnector({ ...connectorInput, credentialRef: "plain-text-secret" }), /opaque secret-ref/);
  assert.throws(() => connectors.createOperatingConnector({ ...connectorInput, baseUrl: "http://api.provider.example/v1" }), (error) => error.code === "WR_CONNECTOR_ENDPOINT_REJECTED");
  assert.throws(() => connectors.createOperatingConnector({ ...connectorInput, baseUrl: "https://172.20.1.2/v1", allowedHosts: ["172.20.1.2"] }), (error) => error.code === "WR_CONNECTOR_ENDPOINT_REJECTED");
  assert.throws(() => connectors.createOperatingConnector({ ...connectorInput, certification: { ...certification, certificationSha256: "b".repeat(64) } }), (error) => error.code === "WR_CONNECTOR_CERTIFICATION_REQUIRED");
  assert.throws(() => connectors.createOperatingConnector({ ...connectorInput, providerId: "uncertified-provider" }), (error) => error.code === "WR_CONNECTOR_CERTIFICATION_REQUIRED");
  assert.throws(() => connectors.createOperatingConnector({ ...connectorInput, licenseId: "uncertified-license" }), (error) => error.code === "WR_CONNECTOR_CERTIFICATION_REQUIRED");

  const profileInput = { id: "statement-map", organizationId, connectorId, version: 1, targetKind: "operating-statement", mappings: [
    { sourceField: "statement_id", targetPath: "id", transform: "string", required: true },
    { sourceField: "asset_id", targetPath: "assetId", transform: "string", required: true },
    { sourceField: "property_id", targetPath: "whiteRabbitPropertyId", transform: "string", required: true },
    { sourceField: "period_start", targetPath: "periodStart", transform: "date", required: true },
    { sourceField: "period_end", targetPath: "periodEnd", transform: "date", required: true },
    { sourceField: "expected_accounts", targetPath: "expectedAccountCodes", transform: "copy", required: true },
    { sourceField: "entries", targetPath: "entries", transform: "copy", required: true }
  ], constants: { basis: "accrual", currency: "USD" }, createdByUserId: "integration-engineer", createdAt: now, approvedByUserId: "data-controller", approvedAt: "2026-11-15T11:30:00.000Z" };
  const profile = connectors.createOperatingMappingProfile(profileInput);
  assert.throws(() => connectors.createOperatingMappingProfile({ ...profileInput, mappings: [{ sourceField: "__proto__.polluted", targetPath: "id" }] }), /unsafe/);
  const poisonedConstants = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => connectors.createOperatingMappingProfile({ ...profileInput, constants: poisonedConstants }), /unsafe key/);

  const statementFields = (id, start, end, amount = 10000) => ({ statement_id: id, asset_id: "asset-1", property_id: "wrp:v1:dallas-county-dcad:A1", period_start: start, period_end: end, expected_accounts: ["rent"], entries: [{ accountCode: "rent", accountName: "Rent", category: "revenue", status: "observed", amount, sourceField: "rent" }] });
  const rawRecord = (sequence, cursor, id, start, end, amount) => ({ id: `raw-${id}`, sequence, cursor, observedAt: "2026-11-15T11:30:00.000Z", availableAt: "2026-11-15T11:31:00.000Z", effectiveAt: `${end}T23:59:59.000Z`, fields: statementFields(id, start, end, amount) });
  const mapped = connectors.mapOperatingConnectorPage(connector, profile, { responseId: "fixture-1", fetchedAt: now, requestCursor: "", nextCursor: "c0", hasMore: false, records: [rawRecord(0, "c0", "statement-oct", "2026-10-01", "2026-10-31", 10000)] });
  assert.deepEqual(mapped.stats, { received: 1, mapped: 1, quarantined: 0 });
  assert.equal(mapped.feedInputs[0].payload.source.fieldMap.entries, "entries");
  const quarantined = connectors.mapOperatingConnectorPage(connector, profile, { responseId: "fixture-bad", fetchedAt: now, requestCursor: "", nextCursor: "", hasMore: false, records: [{ ...rawRecord(0, "c0", "bad", "2026-10-01", "2026-10-31", 1), fields: { asset_id: "asset-1" } }] });
  assert.equal(quarantined.stats.quarantined, 1);
  assert.throws(() => connectors.mapOperatingConnectorPage(connector, profile, { responseId: "fixture-stall", fetchedAt: now, requestCursor: "c0", nextCursor: "c0", hasMore: true, records: [rawRecord(1, "c0", "stall", "2026-11-01", "2026-11-30", 1)] }), (error) => error.code === "WR_CONNECTOR_CURSOR_STALLED");
  assert.throws(() => connectors.mapOperatingConnectorPage(connector, profile, { responseId: "fixture-future", fetchedAt: now, requestCursor: "", nextCursor: "", hasMore: false, records: [{ ...rawRecord(0, "c0", "future", "2026-10-01", "2026-10-31", 1), availableAt: "2026-11-15T12:01:00.000Z" }] }), /cannot follow fetchedAt/);

  const backfill = connectors.createOperatingBackfillPlan(connector, { startDate: "2026-01-01", endDate: "2026-03-11", createdAt: now });
  assert.equal(backfill.jobs.length, 3);
  assert(backfill.jobs.every((job) => (new Date(`${job.windowEnd}T00:00:00Z`) - new Date(`${job.windowStart}T00:00:00Z`)) / 86400000 < 31));

  const source = { datasetId: "asset-master", recordId: "asset-1", sourceRef: "source-ref:asset-1", licenseId: "license-feed", licenseStatus: "authorized", observedAt: "2026-11-01T00:00:00.000Z", availableAt: "2026-11-01T00:01:00.000Z", expiresAt: "", sourceVersion: "1", fieldMap: { id: "asset_id" }, contentSha256: assets.assetOperationsSha256("asset-1") };
  const asset = assets.createAssetRecord({ id: "asset-1", organizationId, whiteRabbitPropertyId: "wrp:v1:dallas-county-dcad:A1", name: "Rabbit Center", propertyType: "retail", currency: "USD", acquiredOn: "2025-01-01", rentableAreaSqFt: { status: "observed", value: 10000, sourceField: "area" }, unitCount: { status: "observed", value: 1, sourceField: "units" }, portfolioMemberships: [{ portfolioId: "main", effectiveFrom: "2025-01-01" }], source });
  const operations = assets.createAssetOperationsState({ organizationId, assets: [asset], updatedAt: now });
  const initialJob = connectors.createOperatingConnectorJob({ id: "job-initial", organizationId, connectorId, maxFailures: 2, createdAt: now });
  const workerState = connectors.createOperatingConnectorWorkerState({ organizationId, connectors: [connector], mappingProfiles: [profile], jobs: [initialJob], updatedAt: now });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "white-rabbit-connectors-")), dbPath = path.join(tempDir, "connectors.sqlite");
  const context = { organizationId, actorUserId: "connector-worker", subjectUserId: "connector-worker", sessionId: "session-1", requestId: "request-1", grants: ["persistence:read", "persistence:write", "connector:dead-letter-replay"], issuedAt: "2026-11-15T11:00:00.000Z", expiresAt: "2026-11-15T14:00:00.000Z" };
  const repository = new SqlitePlatformRepository({ filename: dbPath, clock: () => operationNow });
  persistence.persistAssetOperationsState(repository, context, operations, { expectedTenantRevision: 0, expectedRecordRevision: 0, idempotencyKey: "seed-connector-assets", occurredAt: now, validation: { now } });
  persistence.persistOperatingConnectorWorkerState(repository, context, workerState, { expectedTenantRevision: 1, expectedRecordRevision: 0, idempotencyKey: "seed-connector-worker", occurredAt: now, validation: { now } });

  let providerCalls = 0;
  const firstRun = await connectors.runOperatingConnectorWorkerCycle({ repository, context, workerId: "worker-1", now, leaseSeconds: 60, clock: () => operationNow, adapterRegistry: { [connectorId]: { fetchPage: (request) => { providerCalls += 1; const durable = persistence.loadOperatingConnectorWorkerState(repository, context, { validation: { now: operationNow } }); assert.equal(durable.jobs.find((job) => job.id === "job-initial").status, "leased", "lease must be durable before provider execution"); assert.equal(request.credentialRef, "secret-ref:vault/pm-statements"); assert.equal(request.cursor, ""); assert.equal(request.limit, 2); return { responseId: "response-0", fetchedAt: "2026-11-15T12:00:01.000Z", nextCursor: "c0", hasMore: false, records: [rawRecord(0, "c0", "statement-oct", "2026-10-01", "2026-10-31", 10000)] }; } } } });
  assert.equal(providerCalls, 1);
  assert.deepEqual(firstRun.succeededJobIds, ["job-initial"]);
  assert.equal(firstRun.pageApplicationSha256s.length, 1);
  assert.equal(persistence.loadAssetOperationsState(repository, context, { validation: { now: operationNow } }).statements.length, 1);
  assert.equal((await connectors.runOperatingConnectorWorkerCycle({ repository, context, workerId: "worker-idle", now: operationNow, adapterRegistry: {} })).leasedJobIds.length, 0);

  let current = persistence.loadOperatingConnectorWorkerState(repository, context, { validation: { now: operationNow } });
  const paginationJob = connectors.createOperatingConnectorJob({ id: "job-pagination", organizationId, connectorId, createdAt: "2026-11-15T12:00:03.000Z" });
  current = connectors.enqueueOperatingConnectorJobs(current, [paginationJob], { updatedAt: "2026-11-15T12:00:03.000Z" });
  let tenantRevision = repository.tenantRevision(context, { now: operationNow });
  const storedWorker = repository.readRecord(context, "operating-feed", "connector-worker-state", { now: operationNow });
  persistence.persistOperatingConnectorWorkerState(repository, context, current, { expectedTenantRevision: tenantRevision, expectedRecordRevision: storedWorker.revision, idempotencyKey: "enqueue-pagination-job", occurredAt: "2026-11-15T12:00:03.000Z", validation: { now: "2026-11-15T12:00:03.000Z" } });
  const cursors = [];
  const pages = [
    { responseId: "response-1", fetchedAt: "2026-11-15T12:00:04.000Z", nextCursor: "c1", hasMore: true, records: [rawRecord(1, "c1", "statement-nov", "2026-11-01", "2026-11-30", 11000)] },
    { responseId: "response-2", fetchedAt: "2026-11-15T12:00:05.000Z", nextCursor: "c2", hasMore: false, records: [rawRecord(2, "c2", "statement-dec", "2026-12-01", "2026-12-31", 12000)] }
  ];
  const paginationRun = await connectors.runOperatingConnectorWorkerCycle({ repository, context, workerId: "worker-2", now: "2026-11-15T12:00:03.000Z", leaseSeconds: 60, clock: () => "2026-11-15T12:00:06.000Z", adapterRegistry: { [connectorId]: { fetchPage: (request) => { cursors.push(request.cursor); return pages.shift(); } } } });
  assert.deepEqual(cursors, ["c0", "c1"], "each provider page must advance from the durable checkpoint");
  assert.deepEqual(paginationRun.succeededJobIds, ["job-pagination"]);
  assert.equal(persistence.loadAssetOperationsState(repository, context, { validation: { now: operationNow } }).statements.length, 3);

  current = persistence.loadOperatingConnectorWorkerState(repository, context, { validation: { now: "2026-11-15T12:00:07.000Z" } });
  const deadJob = connectors.createOperatingConnectorJob({ id: "job-dead", organizationId, connectorId, maxFailures: 1, createdAt: "2026-11-15T12:00:07.000Z" });
  current = connectors.enqueueOperatingConnectorJobs(current, [deadJob], { updatedAt: "2026-11-15T12:00:07.000Z" });
  tenantRevision = repository.tenantRevision(context, { now: "2026-11-15T12:00:07.000Z" });
  const beforeDead = repository.readRecord(context, "operating-feed", "connector-worker-state", { now: "2026-11-15T12:00:07.000Z" });
  persistence.persistOperatingConnectorWorkerState(repository, context, current, { expectedTenantRevision: tenantRevision, expectedRecordRevision: beforeDead.revision, idempotencyKey: "enqueue-dead-letter-job", occurredAt: "2026-11-15T12:00:07.000Z", validation: { now: "2026-11-15T12:00:07.000Z" } });
  const deadRun = await connectors.runOperatingConnectorWorkerCycle({ repository, context, workerId: "worker-3", now: "2026-11-15T12:00:08.000Z", leaseSeconds: 60, clock: () => "2026-11-15T12:00:09.000Z", adapterRegistry: { [connectorId]: { fetchPage: () => { throw new Error("provider unavailable"); } } } });
  assert.deepEqual(deadRun.deadLetteredJobIds, ["job-dead"]);
  current = persistence.loadOperatingConnectorWorkerState(repository, context, { validation: { now: "2026-11-15T12:00:10.000Z" } });
  assert.match(current.deadLetters[0].deadLetterSha256, /^[a-f0-9]{64}$/);
  assert.throws(() => connectors.createOperatingConnectorWorkerState({ ...current, stateSha256: undefined, deadLetters: [{ ...current.deadLetters[0], errorMessage: "tampered" }] }), (error) => error.code === "WR_CONNECTOR_DEAD_LETTER_INTEGRITY_FAILURE");
  assert.throws(() => connectors.requeueOperatingConnectorDeadLetter(current, current.deadLetters[0].id, { reason: "Provider restored", evidenceRef: "evidence-ref:incident-1" }, { organizationId, grants: [], expectedRevision: current.revision, occurredAt: "2026-11-15T12:00:11.000Z" }), (error) => error.code === "WR_CONNECTOR_PERMISSION_DENIED");
  const replayed = connectors.requeueOperatingConnectorDeadLetter(current, current.deadLetters[0].id, { reason: "Provider restored", evidenceRef: "evidence-ref:incident-1" }, { organizationId, grants: ["connector:dead-letter-replay"], expectedRevision: current.revision, occurredAt: "2026-11-15T12:00:11.000Z" });
  assert.equal(replayed.jobs.find((job) => job.id === "job-dead").status, "queued");
  assert.equal(replayed.jobs.find((job) => job.id === "job-dead").completedAt, "");
  assert.equal(replayed.deadLetters.length, 0);
  assert.throws(() => persistence.persistOperatingConnectorWorkerState(repository, { ...context, organizationId: "org-b" }, replayed, {}), (error) => error.code === "WR_TENANT_ISOLATION_VIOLATION");

  const recoveredSeed = connectors.createOperatingConnectorWorkerState({ ...replayed, stateSha256: undefined, revision: replayed.revision + 1, jobs: replayed.jobs.map((job) => job.id === "job-dead" ? connectors.createOperatingConnectorJob({ ...job, jobSha256: undefined, status: "leased", lease: { token: "old-token", workerId: "dead-worker", leasedAt: "2026-11-15T11:00:00.000Z", expiresAt: "2026-11-15T11:01:00.000Z" }, updatedAt: "2026-11-15T11:00:00.000Z" }) : job), updatedAt: "2026-11-15T12:00:12.000Z" });
  const recovered = connectors.leaseOperatingConnectorJobs(recoveredSeed, { now: "2026-11-15T12:00:13.000Z", workerId: "recovery-worker" });
  assert.deepEqual(recovered.recoveredLeaseJobIds, ["job-dead"]);

  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "operating-connector-runtime.schema.json"), "utf8"));
  assert.equal(schema.$defs.workerState.properties.schemaVersion.const, "wr-operating-connector-worker-state-v1");
  const gates = fs.readFileSync(path.join(__dirname, "..", "src", "data", "platformFeatureGates.ts"), "utf8");
  for (const gate of ["operatingConnectorRuntime", "operatingMappingRegistry", "operatingConnectorScheduler", "operatingBackfills", "operatingConnectorDeadLetters"]) assert.match(gates, new RegExp(`${gate}: false`));
  const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.tsx"), "utf8");
  assert.equal(app.includes("operatingConnectorRuntime"), false);
  repository.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log("White Rabbit certified connector, mapping registry, pagination, leasing, backfill, dead-letter, recovery, and durability tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

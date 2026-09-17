const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

(async () => {
  const ingestion = await import("../src/graph/propertyEventIngestion.mjs");
  const { SqlitePlatformRepository } = await import("../src/persistence/sqlitePlatformRepository.mjs");
  const { createPersistenceContext } = await import("../src/persistence/persistenceContracts.mjs");

  const organizationId = "org-white-rabbit";
  const propertyId = "wrp:v1:dallas-county-dcad:000001";
  const now = "2026-08-14T14:00:00.000Z";
  const source = (recordId, overrides = {}) => ({
    providerId: "licensed-market-provider",
    datasetId: "licensed-property-events",
    sourceVersion: "2026-08-14.1",
    recordId,
    sourceType: "mls",
    licenseId: "license-production-test",
    licenseStatus: "authorized",
    rights: { store: true, derive: true, query: true, display: false },
    observedAt: "2026-08-14T12:00:00.000Z",
    availableAt: "2026-08-14T12:05:00.000Z",
    sourceUri: `provider://events/${recordId}`,
    sourceFieldMap: { price: "ListPrice" },
    ...overrides,
  });
  const event = (sequence, eventType, resourceId, payload, overrides = {}) => ({ organizationId, whiteRabbitPropertyId: propertyId, sequence, eventType, resourceId, payload, effectiveAt: "2026-08-14T12:00:00.000Z", source: source(`record-${sequence}`), ...overrides });
  const transaction = event(1, "transaction", "transaction-1", {
    transactionType: "sale",
    recordedAt: "2026-08-14T12:00:00.000Z",
    effectiveAt: "2026-08-13T12:00:00.000Z",
    consideration: { value: 1250000, sourceField: "SalePrice" },
  });
  const listing = event(2, "listing", "listing-1", {
    listingStatus: "active",
    listedAt: "2026-08-14T12:00:00.000Z",
    askingPrice: { value: 1500000, sourceField: "ListPrice" },
  });
  const future = event(3, "listing", "future-listing", { listingStatus: "active", listedAt: "2026-08-15T12:00:00.000Z" }, { source: source("future", { observedAt: "2026-08-15T11:00:00.000Z", availableAt: "2026-08-15T12:00:00.000Z" }) });
  const restricted = event(4, "listing", "restricted-listing", { listingStatus: "active", listedAt: "2026-08-14T12:00:00.000Z" }, { source: source("restricted", { licenseStatus: "restricted" }) });

  const batch = ingestion.ingestPropertyEventBatch({ organizationId, datasetId: "licensed-property-events", asOf: now, events: [transaction, listing, listing, future, restricted], policy: { allowedLicenseIds: ["license-production-test"] } });
  assert.equal(batch.schemaVersion, "wr-property-event-batch-v1");
  assert.deepEqual(batch.stats, { received: 5, accepted: 2, quarantined: 2, replayed: 1 });
  assert(batch.quarantined.some((item) => item.code === "WR_EVENT_FUTURE_EVIDENCE"));
  assert(batch.quarantined.some((item) => item.code === "WR_EVENT_LICENSE_REJECTED"));
  assert(batch.replayed.some((item) => item.code === "WR_EVENT_DUPLICATE"));
  assert.equal(batch.checkpoint.lastSequence, 2);
  assert.equal(batch.accepted[0].source.rights.display, false, "display rights must remain distinct from storage and query rights");

  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "white-rabbit-property-events-"));
  const filename = path.join(tempDirectory, "platform.sqlite");
  const repository = new SqlitePlatformRepository({ filename, clock: () => now });
  const context = createPersistenceContext({ organizationId, actorUserId: "ingestion-worker", sessionId: "session-1", requestId: "request-1", grants: ["persistence:read", "persistence:write"], issuedAt: "2026-08-14T13:00:00.000Z", expiresAt: "2026-08-14T15:00:00.000Z" }, { now });
  const receipt = ingestion.persistPropertyEventBatch(repository, context, batch, { expectedTenantRevision: 0, occurredAt: now, validation: { now } });
  assert.equal(receipt.schemaVersion, "wr-persistence-batch-receipt-v1");
  assert.equal(receipt.tenantRevision, 1, "the entire event/checkpoint/manifest batch must consume one tenant revision");
  assert.equal(receipt.mutationCount, 4);
  const replay = ingestion.persistPropertyEventBatch(repository, context, batch, { expectedTenantRevision: 0, occurredAt: now, validation: { now } });
  assert.equal(replay.replayed, true);
  assert.equal(repository.tenantRevision(context, { now }), 1);

  const page = repository.listRecordsPage(context, "property-graph", { keyPrefix: `event:${encodeURIComponent(propertyId)}:`, limit: 1, now });
  assert.equal(page.records.length, 1);
  assert.equal(page.hasMore, true);
  const page2 = repository.listRecordsPage(context, "property-graph", { keyPrefix: `event:${encodeURIComponent(propertyId)}:`, afterKey: page.nextKey, limit: 1, now });
  assert.equal(page2.records.length, 1);
  assert.equal(page2.hasMore, false);

  const service = ingestion.createDurablePropertyGraphQueryService({ repository, context });
  const query = await service.queryProperty(propertyId, { at: now, maxDepth: 2, pageSize: 1, validation: { now } });
  assert.equal(query.serviceVersion, "wr-property-graph-query-service-v1");
  assert.equal(query.ledger.eventCount, 2);
  assert(query.nodes.some((node) => node.nodeType === "transaction"));
  assert(query.nodes.some((node) => node.nodeType === "listing"));
  const transactionNode = query.nodes.find((node) => node.nodeType === "transaction");
  assert.equal(transactionNode.source.licenseId, "license-production-test");
  assert.equal(transactionNode.source.availableAt, "2026-08-14T12:05:00.000Z");
  assert.equal(transactionNode.source.lineage.sourceFieldMap.price, "ListPrice");

  const deleteBatch = ingestion.ingestPropertyEventBatch({ organizationId, datasetId: "licensed-property-events", asOf: "2026-08-14T14:30:00.000Z", checkpoint: batch.checkpoint, events: [event(5, "listing", "listing-1", null, { operation: "delete", effectiveAt: "2026-08-14T14:15:00.000Z", source: source("record-5", { observedAt: "2026-08-14T14:10:00.000Z", availableAt: "2026-08-14T14:20:00.000Z" }) })], policy: { allowedLicenseIds: ["license-production-test"] } });
  ingestion.persistPropertyEventBatch(repository, context, deleteBatch, { expectedTenantRevision: 1, expectedCheckpointRevision: 1, occurredAt: "2026-08-14T14:30:00.000Z", validation: { now: "2026-08-14T14:30:00.000Z" } });
  const afterDelete = await service.queryProperty(propertyId, { at: "2026-08-14T14:30:00.000Z", validation: { now: "2026-08-14T14:30:00.000Z" } });
  assert(!afterDelete.nodes.some((node) => node.nodeType === "listing"), "the latest licensed delete event must remove the listing projection");

  const otherContext = createPersistenceContext({ organizationId: "org-other", actorUserId: "other", sessionId: "session-2", requestId: "request-2", grants: ["persistence:read", "persistence:write"], issuedAt: "2026-08-14T13:00:00.000Z", expiresAt: "2026-08-14T15:00:00.000Z" }, { now });
  assert.equal(repository.listRecordsPage(otherContext, "property-graph", { keyPrefix: "event:", now }).records.length, 0);
  assert.throws(() => ingestion.persistPropertyEventBatch(repository, otherContext, batch, { expectedTenantRevision: 0, occurredAt: now, validation: { now } }), (error) => error.code === "WR_TENANT_ISOLATION_VIOLATION");

  const beforeAtomicFailure = repository.tenantRevision(context, { now: "2026-08-14T14:30:00.000Z" });
  assert.throws(() => repository.commitMany({ context, expectedTenantRevision: beforeAtomicFailure, idempotencyKey: "atomic-failure", occurredAt: "2026-08-14T14:30:00.000Z", mutations: [
    { namespace: "property-graph", key: "atomic:first", value: { organizationId, value: 1 }, expectedRecordRevision: 0 },
    { namespace: "property-graph", key: `checkpoint:${encodeURIComponent(batch.datasetId)}`, value: batch.checkpoint, expectedRecordRevision: 999 },
  ] }, { now: "2026-08-14T14:30:00.000Z" }), (error) => error.code === "WR_PERSISTENCE_CONFLICT");
  assert.equal(repository.readRecord(context, "property-graph", "atomic:first", { now: "2026-08-14T14:30:00.000Z" }), null, "failed batches must roll back every record");
  assert.equal(repository.tenantRevision(context, { now: "2026-08-14T14:30:00.000Z" }), beforeAtomicFailure);
  assert(repository.exportAuditLog(context, { now: "2026-08-14T14:30:00.000Z" }).entries.some((entry) => entry.action === "records.batch-committed"));

  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "property-event-ingestion.schema.json"), "utf8"));
  assert(schema.oneOf.length === 3);
  assert.equal(schema.$defs.event.properties.schemaVersion.const, "wr-property-event-v1");
  repository.close();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
  console.log("White Rabbit licensed property-event ingestion, atomic persistence, checkpoint, pagination, and durable graph query tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

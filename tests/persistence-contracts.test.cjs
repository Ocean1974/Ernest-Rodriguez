const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const contracts = await import("../src/persistence/persistenceContracts.mjs");
  const base = {
    organizationId: "org-a", actorUserId: "user-a", subjectUserId: "user-a", sessionId: "session-a", requestId: "request-a",
    grants: ["persistence:read", "persistence:write"], issuedAt: "2026-08-14T12:00:00.000Z", expiresAt: "2026-08-14T14:00:00.000Z",
  };
  const context = contracts.createPersistenceContext(base, { now: "2026-08-14T13:00:00.000Z" });
  assert.equal(context.schemaVersion, "wr-persistence-context-v1");
  assert(Object.isFrozen(context));
  assert.throws(() => contracts.createPersistenceContext({ ...base, subjectUserId: "user-b" }, { now: "2026-08-14T13:00:00.000Z" }), (error) => error.code === "WR_PERSISTENCE_AUTHORIZATION_DENIED");
  assert.throws(() => contracts.createPersistenceContext(base, { now: "2026-08-15T13:00:00.000Z" }), (error) => error.code === "WR_PERSISTENCE_AUTHORIZATION_DENIED");
  assert.throws(() => contracts.createPersistenceContext({ ...base, issuedAt: "2026-08-14T13:05:00.000Z" }, { now: "2026-08-14T13:00:00.000Z" }), (error) => error.code === "WR_PERSISTENCE_AUTHORIZATION_DENIED");
  assert.throws(() => contracts.createPersistenceContext({ ...base, grants: ["persistence:write"] }, { now: "2026-08-14T13:00:00.000Z" }), (error) => error.code === "WR_PERSISTENCE_AUTHORIZATION_DENIED");
  const mutation = contracts.createPersistenceMutation({ context: base, namespace: "collaboration", key: "state", value: { deals: [{ organizationId: "org-a" }] }, expectedTenantRevision: 0, expectedRecordRevision: 0, idempotencyKey: "idem-1", occurredAt: "2026-08-14T13:00:00.000Z" }, { now: "2026-08-14T13:00:00.000Z" });
  assert.equal(mutation.schemaVersion, "wr-persistence-mutation-v1");
  assert.throws(() => contracts.createPersistenceMutation({ ...mutation, context: base, value: { deals: [{ organizationId: "org-b" }] } }, { now: "2026-08-14T13:00:00.000Z" }), (error) => error.code === "WR_TENANT_ISOLATION_VIOLATION");
  assert.throws(() => contracts.createPersistenceMutation({ ...mutation, context: { ...base, grants: ["persistence:read"] } }, { now: "2026-08-14T13:00:00.000Z" }), (error) => error.code === "WR_PERSISTENCE_AUTHORIZATION_DENIED");
  const batch = contracts.createPersistenceBatchMutation({ context: base, mutations: [{ namespace: "property-graph", key: "event:1", value: { organizationId: "org-a" }, expectedRecordRevision: 0 }], expectedTenantRevision: 0, idempotencyKey: "batch-1", occurredAt: "2026-08-14T13:00:00.000Z" }, { now: "2026-08-14T13:00:00.000Z" });
  assert.equal(batch.schemaVersion, "wr-persistence-batch-mutation-v1");
  assert.throws(() => contracts.createPersistenceBatchMutation({ ...batch, context: base, mutations: [...batch.mutations, batch.mutations[0]] }, { now: "2026-08-14T13:00:00.000Z" }), /Duplicate batch record target/);
  assert.throws(() => contracts.createPersistenceBatchMutation({ ...batch, context: base, mutations: [{ namespace: "property-graph", key: "event:2", value: { organizationId: "org-b" } }] }, { now: "2026-08-14T13:00:00.000Z" }), (error) => error.code === "WR_TENANT_ISOLATION_VIOLATION");
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "persistence-contract.schema.json"), "utf8"));
  assert.equal(schema.$defs.context.properties.schemaVersion.const, "wr-persistence-context-v1");
  assert.equal(schema.$defs.batchMutation.properties.schemaVersion.const, "wr-persistence-batch-mutation-v1");
  console.log("White Rabbit persistence context and tenant-isolation contract tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

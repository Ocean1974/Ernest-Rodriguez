const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const store = await import("../src/collaboration/dealCollaborationStore.mjs");
  const fixed = "2026-08-13T12:00:00.000Z";
  const propertyId = "wrp:v1:dallas-county-dcad:A1";
  const organization = store.createOrganization({ id: "org-1", name: "Rabbit Capital", createdAt: fixed });
  const owner = store.createMembership({ organizationId: organization.id, userId: "user-1", role: "owner", createdAt: fixed });
  const viewer = store.createMembership({ organizationId: organization.id, userId: "user-2", role: "viewer", createdAt: fixed });
  assert(store.hasOrganizationPermission(owner, "deals:write"));
  assert(!store.hasOrganizationPermission(viewer, "deals:write"));
  assert(!store.hasOrganizationPermission({ ...owner, status: "suspended" }, "deals:write"));

  let state = store.createCollaborationState({ organizations: [organization], memberships: [owner, viewer], updatedAt: fixed });
  state = store.upsertDeal(state, { id: "deal-1", organizationId: organization.id, whiteRabbitPropertyId: propertyId, title: "100 Main", createdAt: fixed }, { actorUserId: "user-1", expectedStateRevision: 1, occurredAt: fixed });
  assert.equal(state.revision, 2);
  assert.equal(state.deals[0].stage, "sourced");
  assert.equal(state.activity[0].action, "deal.created");
  assert(Object.isFrozen(state.activity[0]));

  state = store.upsertDeal(state, { ...state.deals[0], stage: "underwriting" }, { actorUserId: "user-1", expectedStateRevision: 2, expectedEntityRevision: 1, occurredAt: "2026-08-13T13:00:00.000Z" });
  assert.equal(state.deals[0].revision, 2);
  assert.equal(state.activity[1].changes[0].field, "stage");
  assert.throws(() => store.upsertDeal(state, state.deals[0], { actorUserId: "user-1", expectedStateRevision: 2 }), (error) => error.code === "WR_REVISION_CONFLICT");
  assert.throws(() => store.upsertDeal(state, { ...state.deals[0], stage: "offer" }, { actorUserId: "user-2", expectedStateRevision: 3 }), (error) => error.code === "WR_PERMISSION_DENIED");
  assert.throws(() => store.upsertMembership(state, { ...viewer, role: "member" }, { actorUserId: "user-2", expectedStateRevision: 3 }), (error) => error.code === "WR_PERMISSION_DENIED");

  state = store.addDealNote(state, { organizationId: organization.id, dealId: "deal-1", whiteRabbitPropertyId: propertyId, authorUserId: "user-1", body: "Confirm zoning assumptions", createdAt: fixed }, { actorUserId: "user-1", expectedStateRevision: 3, occurredAt: "2026-08-13T14:00:00.000Z" });
  assert.equal(state.notes.length, 1);
  assert.equal(state.notes[0].whiteRabbitPropertyId, propertyId);
  assert.equal(store.visibleDealNotes(state, { organizationId: "org-1", dealId: "deal-1", userId: "user-2" }).length, 1);
  assert.throws(() => store.addDealNote(state, { organizationId: organization.id, dealId: "deal-1", whiteRabbitPropertyId: propertyId, authorUserId: "user-2", body: "Forged author", createdAt: fixed }, { actorUserId: "user-1", expectedStateRevision: 4 }), /author must match/);
  state = store.upsertDealTask(state, { id: "task-1", organizationId: organization.id, dealId: "deal-1", whiteRabbitPropertyId: propertyId, title: "Order survey", assigneeUserId: "user-1", dueAt: "2026-08-20T12:00:00.000Z", createdAt: fixed }, { actorUserId: "user-1", expectedStateRevision: 4, occurredAt: "2026-08-13T15:00:00.000Z" });
  assert.equal(state.tasks[0].status, "open");
  assert.equal(state.activity.length, 4);
  assert(state.activity.every((event) => event.whiteRabbitPropertyId === propertyId));
  assert.throws(() => store.createDeal({ organizationId: "org-1", whiteRabbitPropertyId: "legacy-123" }), /wrp:v1/);
  const privateState = store.addDealNote(state, { organizationId: organization.id, dealId: "deal-1", whiteRabbitPropertyId: propertyId, authorUserId: "user-1", body: "Private bid ceiling", visibility: "private", createdAt: fixed }, { actorUserId: "user-1", expectedStateRevision: 5, occurredAt: "2026-08-13T16:00:00.000Z" });
  assert.equal(store.visibleDealNotes(privateState, { organizationId: "org-1", dealId: "deal-1", userId: "user-1" }).length, 2);
  assert.equal(store.visibleDealNotes(privateState, { organizationId: "org-1", dealId: "deal-1", userId: "user-2" }).length, 1);
  const memberState = store.upsertMembership(privateState, { organizationId: "org-1", userId: "user-3", role: "member", createdAt: fixed }, { actorUserId: "user-1", expectedStateRevision: 6, occurredAt: "2026-08-13T17:00:00.000Z" });
  assert(memberState.memberships.some((membership) => membership.userId === "user-3" && membership.permissions.includes("deals:write")));

  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "collaboration-state.schema.json"), "utf8"));
  assert.equal(schema.properties.schemaVersion.const, "wr-collaboration-state-v1");
  console.log("White Rabbit deal collaboration and concurrency tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

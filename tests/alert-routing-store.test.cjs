const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const routing = await import("../src/alerts/alertRoutingStore.mjs");
  const fixed = "2026-08-13T12:00:00.000Z";
  const propertyId = "wrp:v1:dallas-county-dcad:A1";
  const subscription = routing.createAlertSubscription({
    id: "subscription-1", organizationId: "org-1", ownerUserId: "user-1", sourceType: "watchlist", sourceId: "watchlist-1", createdAt: fixed,
    channels: [{ type: "in-app" }, { type: "email", endpointRef: "secret-ref:email-1" }],
    policy: { cadence: "immediate", minimumSeverity: "medium", materialChangesOnly: true, cooldownMinutes: 60 },
  });
  assert.equal(subscription.schemaVersion, "wr-alert-subscription-v1");
  assert.equal(subscription.channels[1].endpointRef, "secret-ref:email-1");
  let state = routing.createAlertRoutingState({ updatedAt: fixed });
  state = routing.upsertAlertSubscription(state, subscription, { expectedRevision: 1, updatedAt: fixed });
  assert.equal(state.revision, 2);
  assert.throws(() => routing.upsertAlertSubscription(state, subscription, { expectedRevision: 1 }), (error) => error.code === "WR_REVISION_CONFLICT");

  const profileA = { schemaVersion: "wr-property-profile-v1", whiteRabbitPropertyId: propertyId, parcel: { ownerName: "Rabbit LLC", totalValue: 100 }, lineage: { sourceDatasetId: "dcad" } };
  const profileAReordered = { lineage: { sourceDatasetId: "dcad" }, parcel: { totalValue: 100, ownerName: "Rabbit LLC" }, whiteRabbitPropertyId: propertyId, schemaVersion: "wr-property-profile-v1" };
  const snapshotA = routing.createPropertySnapshot({ profile: profileA, capturedAt: fixed });
  const snapshotA2 = routing.createPropertySnapshot({ profile: profileAReordered, capturedAt: "2026-08-13T13:00:00.000Z" });
  assert.equal(snapshotA.digest, snapshotA2.digest, "snapshot digest must be key-order independent");
  state = routing.appendPropertySnapshot(state, snapshotA, { expectedRevision: 2 });
  state = routing.appendPropertySnapshot(state, snapshotA2, { expectedRevision: 3 });
  assert.equal(routing.latestPropertySnapshots(state, propertyId)[0].capturedAt, "2026-08-13T13:00:00.000Z");

  const envelope = { id: "alert-1", events: [{ id: "event-1", category: "ownership", severity: "high" }] };
  const decision = routing.planAlertRouting({ subscription, envelope, routingState: state, now: fixed });
  assert.equal(decision.schemaVersion, "wr-alert-routing-decision-v1");
  assert.equal(decision.status, "queued");
  assert.equal(decision.attempts.length, 2);
  assert(decision.attempts.every((attempt) => attempt.status === "queued"));

  const quietSubscription = routing.createAlertSubscription({ ...subscription, policy: { ...subscription.policy, quietHours: { startHour: 22, endHour: 7, utcOffsetMinutes: 0 } } });
  const quiet = routing.planAlertRouting({ subscription: quietSubscription, envelope, routingState: state, now: "2026-08-14T03:00:00.000Z" });
  assert.equal(quiet.status, "suppressed");
  assert(quiet.reasons.includes("quiet-hours"));

  state = routing.recordDeliveryAttempts(state, decision.attempts.map((attempt) => ({ ...attempt, status: "delivered", completedAt: fixed })), { expectedRevision: 4, updatedAt: fixed });
  const cooldown = routing.planAlertRouting({ subscription, envelope: { ...envelope, id: "alert-2" }, routingState: state, now: "2026-08-13T12:30:00.000Z" });
  assert.equal(cooldown.status, "suppressed");
  assert(cooldown.reasons.includes("cooldown-active"));
  const lowOnly = routing.planAlertRouting({ subscription, envelope: { id: "alert-3", events: [{ id: "event-low", category: "valuation", severity: "low" }] }, routingState: routing.createAlertRoutingState({ updatedAt: fixed }), now: fixed });
  assert(lowOnly.reasons.includes("no-events-meet-routing-policy"));
  assert(lowOnly.reasons.includes("no-material-events"));

  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "alert-routing-state.schema.json"), "utf8"));
  assert.equal(schema.properties.schemaVersion.const, "wr-alert-routing-state-v1");
  console.log("White Rabbit durable snapshot and alert-routing tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

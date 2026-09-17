const assert = require("assert");

(async () => {
  const { detectPropertyChanges, createAlertEnvelope } = await import("../src/intelligence/changeEvents.mjs");
  const id = "wrp:v1:dallas-county-dcad:A1";
  const previous = { whiteRabbitPropertyId: id, parcel: { ownerName: "OLD OWNER", totalValue: 100000 }, permits: [], lineage: { serviceGeneratedAt: "2026-01-01" } };
  const current = { whiteRabbitPropertyId: id, parcel: { ownerName: "NEW OWNER LLC", totalValue: 150000 }, permits: [{ permitRecordId: "P-1", permitType: "New construction" }], lineage: { serviceGeneratedAt: "2026-08-13" } };
  const events = detectPropertyChanges(previous, current, "2026-08-13T12:00:00.000Z");
  assert(events.some((event) => event.category === "ownership" && event.severity === "high"));
  assert(events.some((event) => event.category === "valuation"));
  assert(events.some((event) => event.eventType === "permit-added"));
  assert(events.every((event) => event.evidence));
  const alert = createAlertEnvelope({ subscriptionId: "watchlist_1", events, createdAt: "2026-08-13T12:00:00.000Z" });
  assert.equal(alert.schemaVersion, "wr-alert-envelope-v1");
  assert(alert.materialEventCount >= 2);
  assert.equal(alert.deliveryStatus, "pending");
  console.log("White Rabbit property change-event and alert contract tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

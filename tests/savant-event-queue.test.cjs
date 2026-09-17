const assert = require("node:assert/strict");

(async () => {
  const queue = await import("../src/agents/savantEventQueue.mjs");
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const first = queue.enqueueSavantEvent({ eventId: "listing-1", eventType: "listing.uploaded", createdAt: "2026-09-14T12:00:00Z" }, storage);
  assert.equal(first.queued, true);
  assert.deepEqual(first.run.routes.map((route) => route.agentId), ["listing-intake", "buyer-seller-matchmaker"]);
  assert.equal(queue.enqueueSavantEvent({ eventId: "listing-1", eventType: "listing.uploaded" }, storage).duplicate, true);
  assert.equal(queue.loadSavantRuns(storage).length, 1);
  console.log("White Rabbit Savant event queue tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });

const assert = require("node:assert/strict");

(async () => {
  const orchestrator = await import("../src/agents/savantOrchestrator.mjs");
  assert.equal(orchestrator.SAVANT_SPECIALISTS.length, 3);
  const listing = orchestrator.createOrchestratorRun({ id: "run-1", eventId: "listing-44", eventType: "listing.uploaded", createdAt: "2026-09-14T12:00:00Z" });
  assert.equal(listing.status, "planned");
  assert.deepEqual(listing.routes.map((route) => route.agentId), ["listing-intake", "buyer-seller-matchmaker"]);
  assert.deepEqual(listing.routes[1].dependsOn, ["listing-intake"]);
  const reminder = orchestrator.routeSavantEvent({ eventId: "lead-1", eventType: "crm.followup.due" });
  assert.equal(reminder.routes[0].agentId, "crm-follow-up");
  assert.equal(orchestrator.evaluateAgentAction({ agentId: "crm-follow-up", action: "followup.draft" }).executable, true);
  const external = orchestrator.evaluateAgentAction({ agentId: "crm-follow-up", action: "message.send" });
  assert.equal(external.humanApprovalRequired, true);
  assert.equal(external.executable, false);
  assert.throws(() => orchestrator.approveAgentAction({ agentId: "crm-follow-up", action: "message.send", approved: false }), /Explicit approval/);
  const approval = orchestrator.approveAgentAction({ memberId: "member-1", agentId: "crm-follow-up", action: "message.send", approved: true, occurredAt: "2026-09-14T12:05:00Z" });
  assert.equal(approval.approved, true);
  assert(Object.isFrozen(listing));
  console.log("White Rabbit governed Savant Orchestrator tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });

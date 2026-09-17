export const SAVANT_ORCHESTRATOR_VERSION = "wr-savant-orchestrator-v1";

export const SAVANT_SPECIALISTS = Object.freeze([
  Object.freeze({ id: "listing-intake", name: "Listing Intake", purpose: "Validate uploaded listings, identify missing information, and prepare normalized listing intelligence.", eventTypes: ["listing.uploaded"], allowedActions: ["listing.validate", "listing.enrich", "listing.flag-missing-data"] }),
  Object.freeze({ id: "buyer-seller-matchmaker", name: "Buyer–Seller Matchmaker", purpose: "Match member listings with compatible buyer requirements using property type, market, price, and deal criteria.", eventTypes: ["listing.ready", "buyer-need.created"], allowedActions: ["match.evaluate", "match.propose", "conversation.propose"] }),
  Object.freeze({ id: "crm-follow-up", name: "CRM Follow-up", purpose: "Identify due buyer and seller follow-ups and propose the next member action.", eventTypes: ["crm.followup.due"], allowedActions: ["followup.prioritize", "followup.draft", "reminder.propose"] }),
]);

export const HUMAN_APPROVAL_ACTIONS = Object.freeze([
  "listing.publish", "message.send", "email.send", "sms.send", "call.place", "advertising.spend", "record.delete", "deal-equation.change", "production-code.change",
]);

const text = (value) => String(value || "").trim();
const stableId = (prefix, value) => {
  let hash = 2166136261;
  for (const character of String(value)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
};

export function routeSavantEvent(input = {}) {
  const eventType = text(input.eventType);
  const eventId = text(input.eventId);
  if (!eventType || !eventId) throw new TypeError("eventType and eventId are required");
  const routes = [];
  if (eventType === "listing.uploaded") {
    routes.push({ agentId: "listing-intake", objective: "Validate and enrich the uploaded listing", dependsOn: [] });
    routes.push({ agentId: "buyer-seller-matchmaker", objective: "Evaluate the validated listing against active buyer needs", dependsOn: ["listing-intake"] });
  } else {
    SAVANT_SPECIALISTS.filter((agent) => agent.eventTypes.includes(eventType)).forEach((agent) => routes.push({ agentId: agent.id, objective: agent.purpose, dependsOn: [] }));
  }
  return Object.freeze({ schemaVersion: SAVANT_ORCHESTRATOR_VERSION, eventId, eventType, routes: Object.freeze(routes.map(Object.freeze)), unrouted: routes.length === 0 });
}

export function evaluateAgentAction(input = {}) {
  const agent = SAVANT_SPECIALISTS.find((item) => item.id === input.agentId);
  const action = text(input.action);
  if (!agent || !action) throw new TypeError("Known agentId and action are required");
  const intrinsicallyAllowed = agent.allowedActions.includes(action);
  const humanApprovalRequired = HUMAN_APPROVAL_ACTIONS.includes(action) || !intrinsicallyAllowed;
  return Object.freeze({ schemaVersion: SAVANT_ORCHESTRATOR_VERSION, agentId: agent.id, action, intrinsicallyAllowed, humanApprovalRequired, executable: intrinsicallyAllowed && !humanApprovalRequired, reason: humanApprovalRequired ? "A member must approve this external or material action." : "Action is within the specialist's read-only or proposal authority." });
}

export function createOrchestratorRun(input = {}) {
  const routed = routeSavantEvent(input);
  const createdAt = new Date(input.createdAt || Date.now()).toISOString();
  return Object.freeze({ schemaVersion: SAVANT_ORCHESTRATOR_VERSION, id: text(input.id) || stableId("savant-run", `${routed.eventId}|${createdAt}`), eventId: routed.eventId, eventType: routed.eventType, status: routed.unrouted ? "needs-routing" : "planned", routes: routed.routes, approvals: Object.freeze([]), audit: Object.freeze([{ action: "run.planned", actor: "savant-orchestrator", occurredAt: createdAt }]), createdAt });
}

export function approveAgentAction(input = {}) {
  const memberId = text(input.memberId);
  if (!memberId || input.approved !== true) throw new TypeError("Explicit approval by an identified member is required");
  const decision = evaluateAgentAction(input);
  return Object.freeze({ schemaVersion: SAVANT_ORCHESTRATOR_VERSION, approvalId: stableId("approval", `${memberId}|${decision.agentId}|${decision.action}|${input.occurredAt || ""}`), memberId, agentId: decision.agentId, action: decision.action, approved: true, occurredAt: new Date(input.occurredAt || Date.now()).toISOString() });
}

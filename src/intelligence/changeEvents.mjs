export const PROPERTY_CHANGE_EVENT_VERSION = "wr-property-change-event-v1";
export const ALERT_ENVELOPE_VERSION = "wr-alert-envelope-v1";

const FIELD_RULES = [
  ["ownerName", "ownership", "high"], ["totalValue", "valuation", "medium"], ["landValue", "valuation", "medium"],
  ["improvementValue", "valuation", "medium"], ["zoning", "zoning", "high"], ["landUseCode", "land-use", "medium"],
];

function propertyId(profile) {
  return String(profile?.whiteRabbitPropertyId || profile?.parcel?.whiteRabbitPropertyId || "");
}

export function detectPropertyChanges(previousProfile, currentProfile, observedAt = new Date().toISOString()) {
  const previousId = propertyId(previousProfile);
  const currentId = propertyId(currentProfile);
  if (!previousProfile || !currentProfile || !previousId || previousId !== currentId) return [];
  const events = [];
  for (const [field, category, severity] of FIELD_RULES) {
    const before = previousProfile.parcel?.[field] ?? null;
    const after = currentProfile.parcel?.[field] ?? null;
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    events.push({ schemaVersion: PROPERTY_CHANGE_EVENT_VERSION, eventType: "field-changed", category, severity, whiteRabbitPropertyId: propertyId(currentProfile), field, before, after, observedAt, evidence: { previousLineage: previousProfile.lineage || null, currentLineage: currentProfile.lineage || null } });
  }
  const previousPermits = new Set((previousProfile.permits || []).map((item) => String(item.permitRecordId || item.permitNumber || "")).filter(Boolean));
  for (const permit of currentProfile.permits || []) {
    const permitId = String(permit.permitRecordId || permit.permitNumber || "");
    if (!permitId || previousPermits.has(permitId)) continue;
    events.push({ schemaVersion: PROPERTY_CHANGE_EVENT_VERSION, eventType: "permit-added", category: "permit", severity: "high", whiteRabbitPropertyId: propertyId(currentProfile), field: "permits", before: null, after: permitId, observedAt, evidence: { permit } });
  }
  return events;
}

export function createAlertEnvelope({ subscriptionId, subscriptionType, events = [], createdAt = new Date().toISOString() } = {}) {
  return {
    schemaVersion: ALERT_ENVELOPE_VERSION,
    id: `alert_${String(subscriptionId || "unassigned")}_${Date.parse(createdAt) || 0}`,
    subscriptionId: String(subscriptionId || ""),
    subscriptionType: String(subscriptionType || "watchlist"),
    createdAt,
    materialEventCount: events.filter((event) => event.severity === "high").length,
    events,
    deliveryStatus: "pending",
  };
}

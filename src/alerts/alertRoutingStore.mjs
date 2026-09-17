export const ALERT_SUBSCRIPTION_VERSION = "wr-alert-subscription-v1";
export const PROPERTY_SNAPSHOT_VERSION = "wr-property-snapshot-v1";
export const ALERT_DELIVERY_ATTEMPT_VERSION = "wr-alert-delivery-attempt-v1";
export const ALERT_ROUTING_STATE_VERSION = "wr-alert-routing-state-v1";
export const ALERT_ROUTING_DECISION_VERSION = "wr-alert-routing-decision-v1";

const SEVERITY = Object.freeze({ low: 1, medium: 2, high: 3, critical: 4 });

function stableId(prefix, seed) {
  let hash = 2166136261;
  for (const character of String(seed)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(36)}`;
}

function iso(value) {
  const date = new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) throw new TypeError(`Invalid date: ${value}`);
  return date.toISOString();
}

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

function evidenceDigest(value) {
  let hash = 2166136261;
  for (const character of canonicalJson(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function propertyId(value) {
  const normalized = required(value, "whiteRabbitPropertyId");
  if (!/^wrp:v1:[^:]+:.+$/.test(normalized)) throw new TypeError("whiteRabbitPropertyId must use wrp:v1 canonical identity");
  return normalized;
}

export function createAlertSubscription(input = {}) {
  const createdAt = iso(input.createdAt);
  const sourceType = ["watchlist", "saved-search"].includes(input.sourceType) ? input.sourceType : "watchlist";
  const sourceId = required(input.sourceId, "sourceId");
  const channels = (input.channels || []).map((channel) => ({
    type: ["in-app", "email", "webhook"].includes(channel.type) ? channel.type : "in-app",
    enabled: channel.enabled !== false,
    endpointRef: String(channel.endpointRef || ""),
  }));
  return {
    schemaVersion: ALERT_SUBSCRIPTION_VERSION,
    id: String(input.id || stableId("subscription", `${sourceType}|${sourceId}|${createdAt}`)),
    organizationId: required(input.organizationId, "organizationId"),
    ownerUserId: required(input.ownerUserId, "ownerUserId"),
    sourceType,
    sourceId,
    enabled: input.enabled !== false,
    channels,
    policy: {
      cadence: ["immediate", "hourly", "daily", "weekly"].includes(input.policy?.cadence) ? input.policy.cadence : "immediate",
      materialChangesOnly: input.policy?.materialChangesOnly !== false,
      minimumSeverity: SEVERITY[input.policy?.minimumSeverity] ? input.policy.minimumSeverity : "medium",
      categories: [...new Set((input.policy?.categories || []).map(String).filter(Boolean))],
      cooldownMinutes: Math.max(0, Number(input.policy?.cooldownMinutes ?? 60)),
      quietHours: input.policy?.quietHours ? { startHour: Math.max(0, Math.min(23, Number(input.policy.quietHours.startHour) || 0)), endHour: Math.max(0, Math.min(23, Number(input.policy.quietHours.endHour) || 0)), utcOffsetMinutes: Math.max(-720, Math.min(840, Number(input.policy.quietHours.utcOffsetMinutes) || 0)) } : null,
    },
    revision: Math.max(1, Math.trunc(Number(input.revision) || 1)),
    createdAt,
    updatedAt: iso(input.updatedAt || createdAt),
  };
}

export function createPropertySnapshot(input = {}) {
  const capturedAt = iso(input.capturedAt);
  const whiteRabbitPropertyId = propertyId(input.whiteRabbitPropertyId || input.profile?.whiteRabbitPropertyId);
  const profile = input.profile && typeof input.profile === "object" ? input.profile : null;
  if (!profile) throw new TypeError("profile is required");
  return {
    schemaVersion: PROPERTY_SNAPSHOT_VERSION,
    id: String(input.id || stableId("snapshot", `${String(input.organizationId || "")}|${String(input.ownerUserId || "")}|${String(input.sourceType || "")}|${String(input.sourceId || "")}|${whiteRabbitPropertyId}|${capturedAt}|${evidenceDigest(profile)}`)),
    organizationId: String(input.organizationId || ""),
    ownerUserId: String(input.ownerUserId || ""),
    sourceType: String(input.sourceType || ""),
    sourceId: String(input.sourceId || ""),
    whiteRabbitPropertyId,
    profileSchemaVersion: String(profile.schemaVersion || ""),
    capturedAt,
    digest: evidenceDigest(profile),
    sourceLineage: profile.lineage || null,
    profile,
  };
}

export function createAlertRoutingState(input = {}) {
  return {
    schemaVersion: ALERT_ROUTING_STATE_VERSION,
    revision: Math.max(1, Math.trunc(Number(input.revision) || 1)),
    subscriptions: (input.subscriptions || []).map(createAlertSubscription),
    snapshots: (input.snapshots || []).map(createPropertySnapshot),
    deliveryAttempts: (input.deliveryAttempts || []).map((attempt) => ({ ...attempt })),
    updatedAt: iso(input.updatedAt),
  };
}

function assertRevision(state, expectedRevision) {
  if (expectedRevision !== undefined && Number(expectedRevision) !== state.revision) {
    const error = new Error(`alert-routing-state revision conflict: expected ${expectedRevision}, found ${state.revision}`);
    error.code = "WR_REVISION_CONFLICT";
    error.expectedRevision = Number(expectedRevision);
    error.actualRevision = state.revision;
    throw error;
  }
}

export function upsertAlertSubscription(stateInput, subscriptionInput, options = {}) {
  const state = createAlertRoutingState(stateInput);
  assertRevision(state, options.expectedRevision);
  const subscription = createAlertSubscription(subscriptionInput);
  const existing = state.subscriptions.find((item) => item.id === subscription.id);
  if (existing && options.expectedEntityRevision !== undefined && Number(options.expectedEntityRevision) !== existing.revision) {
    const error = new Error(`alert-subscription ${subscription.id} revision conflict: expected ${options.expectedEntityRevision}, found ${existing.revision}`);
    error.code = "WR_REVISION_CONFLICT";
    throw error;
  }
  const next = existing ? { ...subscription, createdAt: existing.createdAt, revision: existing.revision + 1, updatedAt: iso(options.updatedAt) } : subscription;
  return { ...state, revision: state.revision + 1, subscriptions: [...state.subscriptions.filter((item) => item.id !== next.id), next], updatedAt: next.updatedAt };
}

export function appendPropertySnapshot(stateInput, snapshotInput, options = {}) {
  const state = createAlertRoutingState(stateInput);
  assertRevision(state, options.expectedRevision);
  const snapshot = createPropertySnapshot(snapshotInput);
  if (state.snapshots.some((item) => item.id === snapshot.id)) return state;
  return { ...state, revision: state.revision + 1, snapshots: [...state.snapshots, snapshot], updatedAt: snapshot.capturedAt };
}

export function latestPropertySnapshots(stateInput, whiteRabbitPropertyId) {
  return createAlertRoutingState(stateInput).snapshots
    .filter((item) => item.whiteRabbitPropertyId === whiteRabbitPropertyId)
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
    .slice(0, 2);
}

function isQuietHours(policy, now) {
  if (!policy.quietHours || policy.quietHours.startHour === policy.quietHours.endHour) return false;
  const local = new Date(new Date(now).getTime() + policy.quietHours.utcOffsetMinutes * 60000);
  const hour = local.getUTCHours();
  const { startHour, endHour } = policy.quietHours;
  return startHour < endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
}

function scheduledFor(cadence, now) {
  const date = new Date(now);
  if (cadence === "immediate") return date.toISOString();
  if (cadence === "hourly") { date.setUTCMinutes(0, 0, 0); date.setUTCHours(date.getUTCHours() + 1); }
  if (cadence === "daily") { date.setUTCHours(24, 0, 0, 0); }
  if (cadence === "weekly") { date.setUTCDate(date.getUTCDate() + (7 - date.getUTCDay())); date.setUTCHours(0, 0, 0, 0); }
  return date.toISOString();
}

export function planAlertRouting({ subscription, envelope, routingState = {}, now = new Date().toISOString() } = {}) {
  const normalizedSubscription = createAlertSubscription(subscription);
  const state = createAlertRoutingState(routingState);
  const evaluatedAt = iso(now);
  const events = Array.isArray(envelope?.events) ? envelope.events : [];
  const eligibleEvents = events.filter((event) => {
    const categoryAllowed = !normalizedSubscription.policy.categories.length || normalizedSubscription.policy.categories.includes(event.category);
    return categoryAllowed && (SEVERITY[event.severity] || 0) >= SEVERITY[normalizedSubscription.policy.minimumSeverity];
  });
  const reasons = [];
  if (!normalizedSubscription.enabled) reasons.push("subscription-disabled");
  if (!events.length) reasons.push("no-events");
  if (!eligibleEvents.length && events.length) reasons.push("no-events-meet-routing-policy");
  if (normalizedSubscription.policy.materialChangesOnly && !eligibleEvents.some((event) => (SEVERITY[event.severity] || 0) >= SEVERITY.high)) reasons.push("no-material-events");
  if (isQuietHours(normalizedSubscription.policy, evaluatedAt)) reasons.push("quiet-hours");
  const attempts = normalizedSubscription.channels.map((channel) => {
    const previous = state.deliveryAttempts.filter((item) => item.subscriptionId === normalizedSubscription.id && item.channelType === channel.type && item.status === "delivered").sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))[0];
    const cooldownActive = previous && new Date(evaluatedAt).getTime() - new Date(previous.completedAt).getTime() < normalizedSubscription.policy.cooldownMinutes * 60000;
    const duplicate = state.deliveryAttempts.some((item) => item.alertEnvelopeId === envelope?.id && item.channelType === channel.type && item.status !== "failed");
    const channelReasons = [...reasons, ...(!channel.enabled ? ["channel-disabled"] : []), ...(cooldownActive ? ["cooldown-active"] : []), ...(duplicate ? ["duplicate-alert-channel"] : [])];
    const status = channelReasons.length ? "suppressed" : "queued";
    return {
      schemaVersion: ALERT_DELIVERY_ATTEMPT_VERSION,
      id: stableId("delivery", `${envelope?.id}|${normalizedSubscription.id}|${channel.type}`),
      alertEnvelopeId: String(envelope?.id || ""),
      subscriptionId: normalizedSubscription.id,
      channelType: channel.type,
      endpointRef: channel.endpointRef,
      status,
      suppressionReasons: [...new Set(channelReasons)],
      eligibleEventCount: eligibleEvents.length,
      scheduledFor: status === "queued" ? scheduledFor(normalizedSubscription.policy.cadence, evaluatedAt) : "",
      createdAt: evaluatedAt,
      completedAt: "",
      providerMessageId: "",
      errorCode: "",
    };
  });
  return { schemaVersion: ALERT_ROUTING_DECISION_VERSION, subscriptionId: normalizedSubscription.id, alertEnvelopeId: String(envelope?.id || ""), evaluatedAt, eligibleEventIds: eligibleEvents.map((event) => String(event.id || "")), status: attempts.some((item) => item.status === "queued") ? "queued" : "suppressed", reasons: [...new Set(attempts.flatMap((item) => item.suppressionReasons))], attempts };
}

export function recordDeliveryAttempts(stateInput, attempts = [], options = {}) {
  const state = createAlertRoutingState(stateInput);
  assertRevision(state, options.expectedRevision);
  const normalized = attempts.map((attempt) => ({ ...attempt, schemaVersion: ALERT_DELIVERY_ATTEMPT_VERSION }));
  return { ...state, revision: state.revision + 1, deliveryAttempts: [...state.deliveryAttempts.filter((existing) => !normalized.some((item) => item.id === existing.id)), ...normalized], updatedAt: iso(options.updatedAt) };
}

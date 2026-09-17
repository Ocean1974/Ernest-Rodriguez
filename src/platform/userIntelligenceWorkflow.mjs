import { createHash } from "node:crypto";
import { assertPersistenceGrant } from "../persistence/persistenceContracts.mjs";
import { createSavedSearch, createUserIntelligenceState, createWatchlist, removeSavedSearch, removeWatchlist, upsertSavedSearch, upsertWatchlist } from "./userIntelligenceStore.mjs";
import { appendPropertySnapshot, createAlertRoutingState, createAlertSubscription, planAlertRouting, recordDeliveryAttempts, upsertAlertSubscription } from "../alerts/alertRoutingStore.mjs";
import { createAlertEnvelope, detectPropertyChanges } from "../intelligence/changeEvents.mjs";

export const USER_INTELLIGENCE_WORKFLOW_VERSION = "wr-user-intelligence-workflow-v1";
export const USER_INTELLIGENCE_OPERATION_RESULT_VERSION = "wr-user-intelligence-operation-result-v1";
export const USER_INTELLIGENCE_EVALUATION_RESULT_VERSION = "wr-user-intelligence-evaluation-result-v1";
export const SAVED_SEARCH_MONITOR_EXECUTOR_VERSION = "wr-saved-search-monitor-executor-v1";
export const PROPERTY_PROFILE_MONITOR_PROVIDER_VERSION = "wr-property-profile-monitor-provider-v1";

function required(value, name) { const normalized = String(value || "").trim(); if (!normalized) throw new TypeError(`${name} is required`); return normalized; }
function iso(value, name) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`); return date.toISOString(); }
function canonicalJson(value) { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`; return JSON.stringify(value ?? null); }
function digest(value) { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
function failure(code, message) { const error = new Error(message); error.code = code; return error; }
function canonicalPropertyId(value) { const id = required(value, "whiteRabbitPropertyId"); if (!/^wrp:v1:[^:]+:.+$/.test(id)) throw new TypeError("whiteRabbitPropertyId must use wrp:v1 canonical identity"); return id; }
function propertyCountyId(value) { return canonicalPropertyId(value).split(":").slice(2, -1).join(":"); }

function requireGrant(context, grant) {
  assertPersistenceGrant(context, "persistence:read");
  if (!context?.grants?.includes(grant)) throw failure("WR_USER_INTELLIGENCE_PERMISSION_DENIED", `${grant} grant is required`);
}

function authorizedRelease(decision, verifier) {
  if (!decision || typeof verifier !== "function") return false;
  let verification;
  try { verification = verifier(decision); } catch { return false; }
  return decision.schemaVersion === "wr-capability-release-decision-v1" && decision.capabilityId === "deal-workflow-collaboration" && decision.activationAuthorized === true && verification?.valid === true && verification?.activationAuthorized === true;
}

function validateBounds(bounds) {
  if (!bounds) return null;
  const west = Number(bounds.west ?? bounds.minLng);
  const east = Number(bounds.east ?? bounds.maxLng);
  const south = Number(bounds.south ?? bounds.minLat);
  const north = Number(bounds.north ?? bounds.maxLat);
  if (![west, east, south, north].every(Number.isFinite) || west >= east || south >= north || west < -180 || east > 180 || south < -90 || north > 90) throw failure("WR_SAVED_SEARCH_BOUNDS_INVALID", "Saved-search bounds are invalid");
  return { west, south, east, north };
}

function validateAlertPolicy(input, defaultCadence) {
  const cadence = String(input?.cadence || defaultCadence);
  if (!["immediate", "hourly", "daily", "weekly"].includes(cadence)) throw failure("WR_ALERT_POLICY_INVALID", `Unsupported alert cadence: ${cadence}`);
  return { enabled: input?.enabled === true, cadence, materialChangesOnly: input?.materialChangesOnly !== false };
}

function sourceIdValue(value, name) {
  const id = required(value, name);
  if (id.length > 128 || !/^[a-z0-9._-]+$/i.test(id)) throw failure("WR_USER_INTELLIGENCE_ID_INVALID", `${name} must be 128 or fewer letters, numbers, dots, underscores, or hyphens`);
  return id;
}

function normalizeSavedSearch(input, allowedCounties, now) {
  if (input?.queryPlan?.schemaVersion !== "wr-parcel-query-plan-v1") throw failure("WR_SAVED_SEARCH_PLAN_INVALID", "Saved search requires a wr-parcel-query-plan-v1 query plan");
  const countyIds = [...new Set((input.countyIds || []).map(String).filter(Boolean))];
  if (!countyIds.length || countyIds.length > 10 || countyIds.some((id) => !allowedCounties.has(id))) throw failure("WR_SAVED_SEARCH_COUNTY_SCOPE", "Saved search contains an unavailable county or exceeds the 10-county limit");
  const name = required(input.name, "savedSearch.name");
  if (name.length > 120) throw failure("WR_USER_INTELLIGENCE_NAME_TOO_LONG", "Saved-search names cannot exceed 120 characters");
  if (String(input.queryPlan.rawQuery || "").length > 500 || (input.queryPlan.filters || []).length > 25 || (input.queryPlan.keywords || []).length > 50 || Buffer.byteLength(canonicalJson(input.queryPlan)) > 65536) throw failure("WR_SAVED_SEARCH_PLAN_TOO_LARGE", "Saved-search query plan exceeds a production limit");
  return createSavedSearch({ ...input, id: input.id ? sourceIdValue(input.id, "savedSearch.id") : undefined, name, countyIds, bounds: validateBounds(input.bounds), alertPolicy: validateAlertPolicy(input.alertPolicy, "daily"), lastEvaluation: null, revision: 1, createdAt: input.createdAt || now, updatedAt: now });
}

function normalizeWatchlist(input, allowedCounties, now) {
  const rawIds = Array.isArray(input.propertyIds) ? input.propertyIds : [];
  if (rawIds.length > 10000) throw failure("WR_WATCHLIST_SIZE_LIMIT", "Watchlists cannot exceed 10,000 properties");
  const propertyIds = [...new Set(rawIds.map(canonicalPropertyId))];
  if (propertyIds.some((id) => !allowedCounties.has(propertyCountyId(id)))) throw failure("WR_WATCHLIST_COUNTY_SCOPE", "Watchlist contains a property outside the county allowlist");
  const name = required(input.name, "watchlist.name");
  if (name.length > 120) throw failure("WR_USER_INTELLIGENCE_NAME_TOO_LONG", "Watchlist names cannot exceed 120 characters");
  return createWatchlist({ ...input, id: input.id ? sourceIdValue(input.id, "watchlist.id") : undefined, name, propertyIds, alertPolicy: validateAlertPolicy(input.alertPolicy, "immediate"), revision: 1, createdAt: input.createdAt || now, updatedAt: now });
}

function subscriptionId(sourceType, sourceId, ownerUserId) { return `subscription:${sourceType}:${encodeURIComponent(sourceId)}:${encodeURIComponent(ownerUserId)}`; }

function syncSubscription(routingState, context, sourceType, source, now) {
  const id = subscriptionId(sourceType, source.id, context.actorUserId);
  const existing = routingState.subscriptions.find((item) => item.id === id);
  const subscription = createAlertSubscription({
    id,
    organizationId: context.organizationId,
    ownerUserId: context.actorUserId,
    sourceType,
    sourceId: source.id,
    enabled: source.alertPolicy.enabled,
    channels: [{ type: "in-app", enabled: true, endpointRef: "" }],
    policy: { cadence: source.alertPolicy.cadence, materialChangesOnly: source.alertPolicy.materialChangesOnly, minimumSeverity: "medium", categories: [], cooldownMinutes: 0 },
    revision: existing?.revision || 1,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });
  return upsertAlertSubscription(routingState, subscription, { expectedRevision: routingState.revision, expectedEntityRevision: existing?.revision, updatedAt: now });
}

function removeSubscription(routingStateInput, context, sourceType, sourceId, now) {
  const routingState = createAlertRoutingState(routingStateInput);
  const id = subscriptionId(sourceType, sourceId, context.actorUserId);
  if (!routingState.subscriptions.some((item) => item.id === id)) return routingState;
  return { ...routingState, revision: routingState.revision + 1, subscriptions: routingState.subscriptions.filter((item) => item.id !== id), updatedAt: now };
}

function loadStates(repository, context, now) {
  const validation = { now };
  const userRecord = repository.readRecord(context, "user-intelligence", context.actorUserId, validation);
  const routingRecord = repository.readRecord(context, "alert-routing", "state", validation);
  const userState = userRecord ? createUserIntelligenceState(userRecord.value) : createUserIntelligenceState({ organizationId: context.organizationId, ownerUserId: context.actorUserId, updatedAt: now });
  if (userState.organizationId && userState.organizationId !== context.organizationId) throw failure("WR_TENANT_ISOLATION_VIOLATION", "Stored user intelligence belongs to another tenant");
  if (userState.ownerUserId && userState.ownerUserId !== context.actorUserId) throw failure("WR_USER_SCOPE_VIOLATION", "Stored user intelligence belongs to another user");
  return { userRecord, routingRecord, userState: { ...userState, organizationId: context.organizationId, ownerUserId: context.actorUserId }, routingState: routingRecord ? createAlertRoutingState(routingRecord.value) : createAlertRoutingState({ updatedAt: now }), tenantRevision: repository.tenantRevision(context, validation) };
}

function operationFingerprint(context, operation, payload) { return digest({ organizationId: context.organizationId, actorUserId: context.actorUserId, operation, payload }); }

function priorReceipt(repository, context, idempotencyKey, fingerprint, now) {
  if (typeof repository.readIdempotencyReceipt !== "function") throw new TypeError("repository.readIdempotencyReceipt is required");
  const prior = repository.readIdempotencyReceipt(context, idempotencyKey, { now });
  if (!prior) return null;
  if (prior.requestFingerprint !== fingerprint) throw failure("WR_IDEMPOTENCY_CONFLICT", `Idempotency key ${idempotencyKey} was used for another user-intelligence operation`);
  return { ...prior, replayed: true };
}

function commitStates(repository, context, current, nextUserState, nextRoutingState, input, fingerprint, now) {
  const mutations = [{ namespace: "user-intelligence", key: context.actorUserId, operation: "put", value: nextUserState, expectedRecordRevision: Number(current.userRecord?.revision || 0) }];
  if (nextRoutingState) mutations.push({ namespace: "alert-routing", key: "state", operation: "put", value: nextRoutingState, expectedRecordRevision: Number(current.routingRecord?.revision || 0) });
  return repository.commitMany({ context, mutations, expectedTenantRevision: Number(input.expectedTenantRevision), idempotencyKey: required(input.idempotencyKey, "idempotencyKey"), requestFingerprint: fingerprint, occurredAt: now }, { now });
}

function verifyExpectedRevisions(current, input, includeRouting) {
  if (Number(input.expectedTenantRevision) !== current.tenantRevision) throw failure("WR_PERSISTENCE_CONFLICT", `Tenant revision conflict: expected ${input.expectedTenantRevision}, found ${current.tenantRevision}`);
  if (Number(input.expectedUserRecordRevision || 0) !== Number(current.userRecord?.revision || 0)) throw failure("WR_PERSISTENCE_CONFLICT", "User-intelligence record revision conflict");
  if (includeRouting && Number(input.expectedAlertRecordRevision || 0) !== Number(current.routingRecord?.revision || 0)) throw failure("WR_PERSISTENCE_CONFLICT", "Alert-routing record revision conflict");
  if (!Number.isInteger(Number(input.expectedStateRevision)) || Number(input.expectedStateRevision) !== current.userState.revision) throw failure("WR_REVISION_CONFLICT", `User-intelligence state revision conflict: expected ${input.expectedStateRevision}, found ${current.userState.revision}`);
}

function routingView(routingStateInput, userState, context) {
  const routingState = createAlertRoutingState(routingStateInput);
  const subscriptions = routingState.subscriptions.filter((item) => item.ownerUserId === context.actorUserId && item.organizationId === context.organizationId);
  const subscriptionIds = new Set(subscriptions.map((item) => item.id));
  return { ...routingState, subscriptions, snapshots: routingState.snapshots.filter((item) => item.organizationId === context.organizationId && item.ownerUserId === context.actorUserId), deliveryAttempts: routingState.deliveryAttempts.filter((item) => subscriptionIds.has(item.subscriptionId)) };
}

function response(operation, receipt, userState, routingState = null, details = {}) {
  return { schemaVersion: USER_INTELLIGENCE_OPERATION_RESULT_VERSION, operation, receipt, userState, routingState, ...details };
}

function sourceFreshness(sourceEvidence) {
  return (sourceEvidence || []).map((item) => String(item.freshnessStatus || "unknown"));
}

function normalizeSourceEvidence(input) {
  const sourceCountyId = required(input?.sourceCountyId, "sourceEvidence.sourceCountyId");
  const datasetId = required(input?.datasetId, "sourceEvidence.datasetId");
  const sourceVersion = required(input?.sourceVersion, "sourceEvidence.sourceVersion");
  const sourceUpdatedAt = iso(input?.sourceUpdatedAt, "sourceEvidence.sourceUpdatedAt");
  const freshnessStatus = ["current", "stale", "unknown"].includes(input?.freshnessStatus) ? input.freshnessStatus : "unknown";
  return { sourceCountyId, datasetId, sourceVersion, sourceUpdatedAt, freshnessStatus, partial: input?.partial === true };
}

function monitoringProfile(profile, expectedId, asOf) {
  const id = canonicalPropertyId(profile?.whiteRabbitPropertyId || profile?.parcel?.whiteRabbitPropertyId);
  if (id !== expectedId || profile?.schemaVersion !== "wr-property-profile-v1" || !profile?.lineage || typeof profile.lineage !== "object") throw failure("WR_PROFILE_EVIDENCE_INVALID", `Property profile evidence is invalid for ${expectedId}`);
  const evidenceAt = iso(profile.asOf || profile.generatedAt || profile.lineage.sourceUpdatedAt, "profile evidence timestamp");
  if (evidenceAt > asOf) throw failure("WR_POINT_IN_TIME_LEAKAGE", `Property profile for ${expectedId} contains future evidence`);
  const lineage = Object.fromEntries(["sourceDatasetId", "sourceCountyId", "sourceVersion", "sourceUpdatedAt", "profileSha256", "generatedFrom"].filter((key) => profile.lineage[key] !== undefined).map((key) => [key, structuredClone(profile.lineage[key])]));
  if (!lineage.sourceDatasetId && !lineage.sourceCountyId) throw failure("WR_PROFILE_EVIDENCE_INVALID", `Property profile lineage is incomplete for ${expectedId}`);
  const parcel = Object.fromEntries(["whiteRabbitPropertyId", "countyParcelId", "accountNum", "accountNumber", "gisParcelId", "ownerName", "totalValue", "landValue", "improvementValue", "zoning", "landUseCode"].filter((key) => profile.parcel?.[key] !== undefined).map((key) => [key, profile.parcel[key]]));
  parcel.whiteRabbitPropertyId = id;
  const permits = (profile.permits || []).slice(0, 500).map((permit) => ({ permitRecordId: String(permit.permitRecordId || ""), permitNumber: String(permit.permitNumber || "") })).filter((permit) => permit.permitRecordId || permit.permitNumber);
  const normalized = { schemaVersion: "wr-property-profile-v1", whiteRabbitPropertyId: id, asOf: evidenceAt, parcel, permits, lineage };
  if (Buffer.byteLength(canonicalJson(normalized)) > 131072) throw failure("WR_PROFILE_EVIDENCE_TOO_LARGE", `Monitoring profile exceeds 128 KiB for ${expectedId}`);
  return normalized;
}

function normalizedSearchPage(result) {
  const candidates = result?.candidates || result || {};
  return { status: String(candidates.status || result?.status || ""), results: Array.isArray(candidates.results) ? candidates.results : [], nextCursor: String(candidates.nextCursor || ""), sourceEvidence: Array.isArray(candidates.sourceEvidence) ? candidates.sourceEvidence : [] };
}

async function executeAllSavedSearchPages(executor, search, context, asOf, signal) {
  const ids = new Set();
  const sourceEvidence = new Map();
  const cursors = new Set();
  let cursor = "";
  let pageCount = 0;
  do {
    if (cursors.has(cursor)) throw failure("WR_SAVED_SEARCH_CURSOR_CYCLE", "Saved-search executor returned a cursor cycle");
    cursors.add(cursor);
    const page = normalizedSearchPage(await executor({ search, queryPlan: search.queryPlan, countyIds: search.countyIds, bounds: search.bounds, cursor, asOf, context, signal }));
    pageCount += 1;
    if (!["complete"].includes(page.status)) throw failure("WR_SAVED_SEARCH_EVALUATION_PARTIAL", `Saved-search page was not complete: ${page.status || "unknown"}`);
    for (const sourceInput of page.sourceEvidence) {
      const source = normalizeSourceEvidence(sourceInput);
      if (!search.countyIds.includes(source.sourceCountyId)) throw failure("WR_SAVED_SEARCH_SOURCE_SCOPE", `Source evidence is outside the saved-search county scope: ${source.sourceCountyId}`);
      const key = `${source.sourceCountyId}|${source.datasetId}`;
      const previous = sourceEvidence.get(key);
      if (previous && canonicalJson(previous) !== canonicalJson(source)) throw failure("WR_SAVED_SEARCH_SOURCE_CHANGED", `Source evidence changed during saved-search pagination: ${key}`);
      sourceEvidence.set(key, source);
    }
    for (const item of page.results) {
      const id = canonicalPropertyId(item?.parcel?.whiteRabbitPropertyId || item?.whiteRabbitPropertyId);
      if (!search.countyIds.includes(propertyCountyId(id))) throw failure("WR_SAVED_SEARCH_RESULT_SCOPE", `Saved-search result is outside the county scope: ${id}`);
      ids.add(id);
      if (ids.size > 5000) throw failure("WR_SAVED_SEARCH_RESULT_LIMIT", "Saved-search evaluation exceeded 5,000 results");
    }
    cursor = page.nextCursor;
    if (cursor && pageCount >= 20) throw failure("WR_SAVED_SEARCH_PAGE_LIMIT", "Saved-search evaluation exceeded 20 pages");
  } while (cursor);
  const evidence = [...sourceEvidence.values()];
  if (!evidence.length || sourceFreshness(evidence).some((status) => status !== "current")) throw failure("WR_SAVED_SEARCH_SOURCE_NOT_CURRENT", "Saved-search monitoring requires current, explicit source freshness evidence");
  return { propertyIds: [...ids].sort(), sourceEvidence: evidence, pageCount };
}

function eventId(seed) { return `event_${digest(seed).slice(0, 24)}`; }

export function createUserIntelligenceWorkflow({ repository, allowedCountyIds = [], releaseDecision = null, verifyReleaseDecision = null, savedSearchExecutor = null, propertyProfileProvider = null, clock = () => new Date().toISOString() } = {}) {
  if (!repository?.readRecord || !repository?.commitMany || !repository?.tenantRevision) throw new TypeError("A durable transactional repository is required");
  const counties = new Set(allowedCountyIds.map(String).filter(Boolean));
  if (!counties.size) throw new TypeError("allowedCountyIds must contain at least one county");
  const activationAuthorized = authorizedRelease(releaseDecision, verifyReleaseDecision);
  const searchExecutor = savedSearchExecutor?.schemaVersion === SAVED_SEARCH_MONITOR_EXECUTOR_VERSION && savedSearchExecutor?.activationAuthorized === true && typeof savedSearchExecutor.execute === "function" ? savedSearchExecutor.execute.bind(savedSearchExecutor) : null;
  const profileProvider = propertyProfileProvider?.schemaVersion === PROPERTY_PROFILE_MONITOR_PROVIDER_VERSION && propertyProfileProvider?.activationAuthorized === true && typeof propertyProfileProvider.getProfile === "function" ? propertyProfileProvider.getProfile.bind(propertyProfileProvider) : null;
  const ensureActive = () => { if (!activationAuthorized) throw failure("WR_USER_INTELLIGENCE_RUNTIME_INACTIVE", "Saved-search and watchlist workflow is not release-authorized"); };
  const mutationContext = (context) => { requireGrant(context, "user-intelligence:write"); assertPersistenceGrant(context, "persistence:write"); };

  async function mutate(operation, input, context, transform) {
    ensureActive(); mutationContext(context);
    const now = iso(input.occurredAt || clock(), "occurredAt");
    const fingerprint = operationFingerprint(context, operation, { ...input, idempotencyKey: undefined });
    const replay = priorReceipt(repository, context, required(input.idempotencyKey, "idempotencyKey"), fingerprint, now);
    if (replay) { const current = loadStates(repository, context, now); return response(operation, replay, current.userState, routingView(current.routingState, current.userState, context), { replayed: true }); }
    const current = loadStates(repository, context, now);
    verifyExpectedRevisions(current, input, true);
    const transformed = await transform(current, now);
    const receipt = commitStates(repository, context, current, transformed.userState, transformed.routingState, input, fingerprint, now);
    return response(operation, receipt, transformed.userState, routingView(transformed.routingState, transformed.userState, context), transformed.details);
  }

  return Object.freeze({
    schemaVersion: USER_INTELLIGENCE_WORKFLOW_VERSION,
    activationAuthorized,
    inspect(context, input = {}) {
      ensureActive(); requireGrant(context, "user-intelligence:read");
      const now = iso(input.asOf || clock(), "asOf");
      const current = loadStates(repository, context, now);
      return { schemaVersion: USER_INTELLIGENCE_OPERATION_RESULT_VERSION, operation: "inspect", userState: current.userState, routingState: routingView(current.routingState, current.userState, context), tenantRevision: current.tenantRevision, userRecordRevision: Number(current.userRecord?.revision || 0), alertRecordRevision: Number(current.routingRecord?.revision || 0) };
    },
    saveSearch(input = {}, context = {}) {
      return mutate("saved-search.upsert", input, context, (current, now) => {
        let search = normalizeSavedSearch(input.savedSearch, counties, now);
        const existing = current.userState.savedSearches.find((item) => item.id === search.id);
        if (!existing && current.userState.savedSearches.length >= 250) throw failure("WR_SAVED_SEARCH_COUNT_LIMIT", "A user cannot store more than 250 saved searches");
        if (existing) search = { ...search, lastEvaluation: existing.lastEvaluation, revision: existing.revision, createdAt: existing.createdAt };
        const userState = upsertSavedSearch(current.userState, search, { expectedRevision: input.expectedStateRevision ?? current.userState.revision, expectedEntityRevision: input.expectedEntityRevision, updatedAt: now });
        const saved = userState.savedSearches.find((item) => item.id === search.id);
        return { userState, routingState: syncSubscription(current.routingState, context, "saved-search", saved, now), details: { sourceId: saved.id } };
      });
    },
    saveWatchlist(input = {}, context = {}) {
      return mutate("watchlist.upsert", input, context, (current, now) => {
        const watchlist = normalizeWatchlist(input.watchlist, counties, now);
        const existing = current.userState.watchlists.find((item) => item.id === watchlist.id);
        if (!existing && current.userState.watchlists.length >= 250) throw failure("WR_WATCHLIST_COUNT_LIMIT", "A user cannot store more than 250 watchlists");
        const userState = upsertWatchlist(current.userState, watchlist, { expectedRevision: input.expectedStateRevision ?? current.userState.revision, expectedEntityRevision: input.expectedEntityRevision, updatedAt: now });
        const saved = userState.watchlists.find((item) => item.id === watchlist.id);
        return { userState, routingState: syncSubscription(current.routingState, context, "watchlist", saved, now), details: { sourceId: saved.id } };
      });
    },
    deleteSearch(input = {}, context = {}) {
      return mutate("saved-search.delete", input, context, (current, now) => { const sourceId = sourceIdValue(input.sourceId, "sourceId"); if (!current.userState.savedSearches.some((item) => item.id === sourceId)) throw failure("WR_SAVED_SEARCH_NOT_FOUND", `Saved search was not found: ${sourceId}`); return { userState: removeSavedSearch(current.userState, sourceId, { expectedRevision: input.expectedStateRevision ?? current.userState.revision, expectedEntityRevision: input.expectedEntityRevision, updatedAt: now }), routingState: removeSubscription(current.routingState, context, "saved-search", sourceId, now), details: { sourceId } }; });
    },
    deleteWatchlist(input = {}, context = {}) {
      return mutate("watchlist.delete", input, context, (current, now) => { const sourceId = sourceIdValue(input.sourceId, "sourceId"); if (!current.userState.watchlists.some((item) => item.id === sourceId)) throw failure("WR_WATCHLIST_NOT_FOUND", `Watchlist was not found: ${sourceId}`); return { userState: removeWatchlist(current.userState, sourceId, { expectedRevision: input.expectedStateRevision ?? current.userState.revision, expectedEntityRevision: input.expectedEntityRevision, updatedAt: now }), routingState: removeSubscription(current.routingState, context, "watchlist", sourceId, now), details: { sourceId } }; });
    },
    evaluateSavedSearch(input = {}, context = {}) {
      if (!searchExecutor) throw failure("WR_SAVED_SEARCH_EXECUTOR_NOT_AUTHORIZED", "An activation-authorized saved-search executor is required");
      return mutate("saved-search.evaluate", input, context, async (current, now) => {
        requireGrant(context, "user-intelligence:evaluate");
        const sourceId = sourceIdValue(input.sourceId, "sourceId");
        const search = current.userState.savedSearches.find((item) => item.id === sourceId);
        if (!search) throw failure("WR_SAVED_SEARCH_NOT_FOUND", `Saved search was not found: ${sourceId}`);
        const evaluation = await executeAllSavedSearchPages(searchExecutor, search, context, now, input.signal || null);
        const isBaseline = !search.lastEvaluation;
        const previousIds = new Set(search.lastEvaluation?.propertyIds || []);
        const currentIds = new Set(evaluation.propertyIds);
        const added = isBaseline ? [] : evaluation.propertyIds.filter((id) => !previousIds.has(id));
        const removed = isBaseline ? [] : [...previousIds].filter((id) => !currentIds.has(id)).sort();
        const events = [
          ...added.map((id) => ({ schemaVersion: "wr-property-change-event-v1", id: eventId(`${sourceId}|added|${id}|${now}`), eventType: "saved-search-match-added", category: "saved-search", severity: "high", whiteRabbitPropertyId: id, field: "savedSearchMembership", before: false, after: true, observedAt: now, evidence: { sourceEvidence: evaluation.sourceEvidence } })),
          ...removed.map((id) => ({ schemaVersion: "wr-property-change-event-v1", id: eventId(`${sourceId}|removed|${id}|${now}`), eventType: "saved-search-match-removed", category: "saved-search", severity: "medium", whiteRabbitPropertyId: id, field: "savedSearchMembership", before: true, after: false, observedAt: now, evidence: { sourceEvidence: evaluation.sourceEvidence } })),
        ];
        const updated = { ...search, lastEvaluation: { evaluatedAt: now, status: "complete", propertyIds: evaluation.propertyIds, resultCount: evaluation.propertyIds.length, resultSha256: digest(evaluation.propertyIds), pageCount: evaluation.pageCount, sourceEvidence: evaluation.sourceEvidence }, updatedAt: now };
        const userState = upsertSavedSearch(current.userState, updated, { expectedRevision: input.expectedStateRevision ?? current.userState.revision, expectedEntityRevision: search.revision, updatedAt: now });
        let routingState = current.routingState;
        const subscription = routingState.subscriptions.find((item) => item.id === subscriptionId("saved-search", sourceId, context.actorUserId));
        if (!subscription) throw failure("WR_ALERT_SUBSCRIPTION_NOT_FOUND", "Saved-search alert subscription is missing");
        const envelope = { ...createAlertEnvelope({ subscriptionId: subscription.id, subscriptionType: "saved-search", events, createdAt: now }), id: `alert_saved-search_${digest(`${sourceId}|${now}`).slice(0, 24)}` };
        const decision = planAlertRouting({ subscription, envelope, routingState, now });
        routingState = recordDeliveryAttempts(routingState, decision.attempts, { expectedRevision: routingState.revision, updatedAt: now });
        return { userState, routingState, details: { schemaVersion: USER_INTELLIGENCE_EVALUATION_RESULT_VERSION, sourceId, sourceType: "saved-search", baselineEstablished: isBaseline, envelope, routingDecision: decision, addedPropertyIds: added, removedPropertyIds: removed, nextAfterPropertyId: "" } };
      });
    },
    evaluateWatchlist(input = {}, context = {}) {
      if (!profileProvider) throw failure("WR_PROFILE_PROVIDER_NOT_AUTHORIZED", "An activation-authorized property profile provider is required");
      return mutate("watchlist.evaluate", input, context, async (current, now) => {
        requireGrant(context, "user-intelligence:evaluate");
        const sourceId = sourceIdValue(input.sourceId, "sourceId");
        const watchlist = current.userState.watchlists.find((item) => item.id === sourceId);
        if (!watchlist) throw failure("WR_WATCHLIST_NOT_FOUND", `Watchlist was not found: ${sourceId}`);
        const sorted = [...watchlist.propertyIds].sort();
        const after = String(input.afterPropertyId || "");
        const eligible = after ? sorted.filter((id) => id > after) : sorted;
        const pageIds = eligible.slice(0, Math.max(1, Math.min(100, Number(input.limit) || 100)));
        const nextAfterPropertyId = eligible.length > pageIds.length ? pageIds.at(-1) : "";
        let routingState = current.routingState;
        const events = [];
        for (const id of pageIds) {
          const profile = monitoringProfile(await profileProvider(id, { asOf: now, context, signal: input.signal || null }), id, now);
          const prior = routingState.snapshots.filter((item) => item.organizationId === context.organizationId && item.ownerUserId === context.actorUserId && item.sourceType === "watchlist" && item.sourceId === sourceId && item.whiteRabbitPropertyId === id).sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)))[0];
          if (prior) events.push(...detectPropertyChanges(prior.profile, profile, now).map((event) => ({ ...event, id: eventId(`${sourceId}|${event.eventType}|${id}|${event.field}|${now}`) })));
          routingState = appendPropertySnapshot(routingState, { organizationId: context.organizationId, ownerUserId: context.actorUserId, sourceType: "watchlist", sourceId, whiteRabbitPropertyId: id, profile, capturedAt: now }, { expectedRevision: routingState.revision });
        }
        const subscription = routingState.subscriptions.find((item) => item.id === subscriptionId("watchlist", sourceId, context.actorUserId));
        if (!subscription) throw failure("WR_ALERT_SUBSCRIPTION_NOT_FOUND", "Watchlist alert subscription is missing");
        const envelope = { ...createAlertEnvelope({ subscriptionId: subscription.id, subscriptionType: "watchlist", events, createdAt: now }), id: `alert_watchlist_${digest(`${sourceId}|${now}|${pageIds.join("|")}`).slice(0, 24)}` };
        const decision = planAlertRouting({ subscription, envelope, routingState, now });
        routingState = recordDeliveryAttempts(routingState, decision.attempts, { expectedRevision: routingState.revision, updatedAt: now });
        return { userState: current.userState, routingState, details: { schemaVersion: USER_INTELLIGENCE_EVALUATION_RESULT_VERSION, sourceId, sourceType: "watchlist", envelope, routingDecision: decision, evaluatedPropertyIds: pageIds, nextAfterPropertyId } };
      });
    },
  });
}

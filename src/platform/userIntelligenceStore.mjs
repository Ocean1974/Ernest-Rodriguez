export const USER_INTELLIGENCE_STATE_VERSION = "wr-user-intelligence-state-v1";
export const SAVED_SEARCH_VERSION = "wr-saved-search-v1";
export const WATCHLIST_VERSION = "wr-watchlist-v1";

function stableId(prefix, seed) {
  let hash = 2166136261;
  for (const character of String(seed)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(36)}`;
}

function iso(value, name = "timestamp") {
  const date = new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`);
  return date.toISOString();
}

function revision(value) {
  return Math.max(1, Math.trunc(Number(value) || 1));
}

function assertRevision(state, expectedRevision) {
  if (expectedRevision !== undefined && Number(expectedRevision) !== state.revision) {
    const error = new Error(`user-intelligence-state revision conflict: expected ${expectedRevision}, found ${state.revision}`);
    error.code = "WR_REVISION_CONFLICT";
    error.expectedRevision = Number(expectedRevision);
    error.actualRevision = state.revision;
    throw error;
  }
}

export function createSavedSearch(input = {}) {
  const createdAt = iso(input.createdAt);
  const name = String(input.name || "Untitled search").trim().slice(0, 120);
  const queryPlan = input.queryPlan || null;
  return {
    schemaVersion: SAVED_SEARCH_VERSION,
    id: String(input.id || stableId("search", `${name}|${queryPlan?.rawQuery || ""}|${createdAt}`)),
    name,
    queryPlan,
    countyIds: [...new Set((input.countyIds || []).map(String).filter(Boolean))],
    bounds: input.bounds || null,
    alertPolicy: { enabled: Boolean(input.alertPolicy?.enabled), cadence: input.alertPolicy?.cadence || "daily", materialChangesOnly: input.alertPolicy?.materialChangesOnly !== false },
    lastEvaluation: input.lastEvaluation ? structuredClone(input.lastEvaluation) : null,
    revision: revision(input.revision),
    createdAt,
    updatedAt: iso(input.updatedAt || createdAt),
  };
}

export function createWatchlist(input = {}) {
  const createdAt = iso(input.createdAt);
  const name = String(input.name || "Watchlist").trim().slice(0, 120);
  const propertyIds = [...new Set((input.propertyIds || []).map(String).filter((id) => /^wrp:v1:[^:]+:.+$/.test(id)))].slice(0, 10000);
  return {
    schemaVersion: WATCHLIST_VERSION,
    id: String(input.id || stableId("watchlist", `${name}|${createdAt}`)),
    name,
    propertyIds,
    alertPolicy: { enabled: Boolean(input.alertPolicy?.enabled), cadence: input.alertPolicy?.cadence || "immediate", materialChangesOnly: input.alertPolicy?.materialChangesOnly !== false },
    revision: revision(input.revision),
    createdAt,
    updatedAt: iso(input.updatedAt || createdAt),
  };
}

export function createUserIntelligenceState(input = {}) {
  return {
    schemaVersion: USER_INTELLIGENCE_STATE_VERSION,
    organizationId: String(input.organizationId || ""),
    ownerUserId: String(input.ownerUserId || ""),
    revision: revision(input.revision),
    savedSearches: (input.savedSearches || []).slice(0, 250).map(createSavedSearch),
    watchlists: (input.watchlists || []).slice(0, 250).map(createWatchlist),
    updatedAt: iso(input.updatedAt),
  };
}

export function upsertSavedSearch(state, savedSearch, options = {}) {
  const next = createUserIntelligenceState(state);
  assertRevision(next, options.expectedRevision);
  const record = createSavedSearch(savedSearch);
  const existing = next.savedSearches.find((item) => item.id === record.id);
  if (existing && options.expectedEntityRevision !== undefined && Number(options.expectedEntityRevision) !== existing.revision) {
    const error = new Error(`saved-search ${record.id} revision conflict: expected ${options.expectedEntityRevision}, found ${existing.revision}`);
    error.code = "WR_REVISION_CONFLICT";
    throw error;
  }
  const updatedAt = iso(options.updatedAt || record.updatedAt, "updatedAt");
  const updated = existing ? { ...record, createdAt: existing.createdAt, revision: existing.revision + 1, updatedAt } : { ...record, updatedAt };
  next.savedSearches = [...next.savedSearches.filter((item) => item.id !== updated.id), updated];
  next.revision += 1;
  next.updatedAt = updatedAt;
  return next;
}

export function upsertWatchlist(state, watchlist, options = {}) {
  const next = createUserIntelligenceState(state);
  assertRevision(next, options.expectedRevision);
  const record = createWatchlist(watchlist);
  const existing = next.watchlists.find((item) => item.id === record.id);
  if (existing && options.expectedEntityRevision !== undefined && Number(options.expectedEntityRevision) !== existing.revision) {
    const error = new Error(`watchlist ${record.id} revision conflict: expected ${options.expectedEntityRevision}, found ${existing.revision}`);
    error.code = "WR_REVISION_CONFLICT";
    throw error;
  }
  const updatedAt = iso(options.updatedAt || record.updatedAt, "updatedAt");
  const updated = existing ? { ...record, createdAt: existing.createdAt, revision: existing.revision + 1, updatedAt } : { ...record, updatedAt };
  next.watchlists = [...next.watchlists.filter((item) => item.id !== updated.id), updated];
  next.revision += 1;
  next.updatedAt = updatedAt;
  return next;
}

export function removeSavedSearch(state, savedSearchId, options = {}) {
  const next = createUserIntelligenceState(state);
  assertRevision(next, options.expectedRevision);
  const id = String(savedSearchId || "").trim();
  const existing = next.savedSearches.find((item) => item.id === id);
  if (!existing) return next;
  if (options.expectedEntityRevision !== undefined && Number(options.expectedEntityRevision) !== existing.revision) {
    const error = new Error(`saved-search ${id} revision conflict`); error.code = "WR_REVISION_CONFLICT"; throw error;
  }
  next.savedSearches = next.savedSearches.filter((item) => item.id !== id);
  next.revision += 1;
  next.updatedAt = iso(options.updatedAt, "updatedAt");
  return next;
}

export function removeWatchlist(state, watchlistId, options = {}) {
  const next = createUserIntelligenceState(state);
  assertRevision(next, options.expectedRevision);
  const id = String(watchlistId || "").trim();
  const existing = next.watchlists.find((item) => item.id === id);
  if (!existing) return next;
  if (options.expectedEntityRevision !== undefined && Number(options.expectedEntityRevision) !== existing.revision) {
    const error = new Error(`watchlist ${id} revision conflict`); error.code = "WR_REVISION_CONFLICT"; throw error;
  }
  next.watchlists = next.watchlists.filter((item) => item.id !== id);
  next.revision += 1;
  next.updatedAt = iso(options.updatedAt, "updatedAt");
  return next;
}

export const LISTING_VIEWS_STORAGE_KEY = "real-estate-savant:listing-views:v1";
export const LISTING_VISITOR_STORAGE_KEY = "real-estate-savant:listing-visitor:v1";

function clean(value) {
  return String(value ?? "").trim();
}

function safeUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `visitor-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function listingVisitorId(storage = globalThis.localStorage) {
  if (!storage) return safeUuid();
  const existing = clean(storage.getItem(LISTING_VISITOR_STORAGE_KEY));
  if (existing) return existing;
  const created = safeUuid();
  try { storage.setItem(LISTING_VISITOR_STORAGE_KEY, created); } catch { /* Browser storage may be unavailable. */ }
  return created;
}

export function loadListingViews(storage = globalThis.localStorage) {
  if (!storage) return [];
  try {
    const value = JSON.parse(storage.getItem(LISTING_VIEWS_STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value.filter((event) => clean(event?.listingId) && clean(event?.viewedAt)) : [];
  } catch {
    return [];
  }
}

export function saveListingViews(events, storage = globalThis.localStorage) {
  if (!storage) return false;
  try {
    storage.setItem(LISTING_VIEWS_STORAGE_KEY, JSON.stringify(events.slice(-5000)));
    return true;
  } catch {
    return false;
  }
}

export function createListingView(listing, viewerSession, options = {}) {
  const listingId = clean(listing?.id);
  const ownerMemberId = clean(listing?.ownerMemberId);
  if (!listingId || !ownerMemberId) return null;
  if (clean(viewerSession?.memberId) === ownerMemberId) return null;
  return Object.freeze({
    id: clean(options.id) || safeUuid(),
    listingId,
    listingOwnerId: ownerMemberId,
    viewerMemberId: clean(viewerSession?.memberId),
    viewerSessionId: clean(options.viewerSessionId) || safeUuid(),
    viewerDisplayName: clean(viewerSession?.displayName) || "Anonymous visitor",
    viewedAt: clean(options.now) || new Date().toISOString(),
  });
}

export function recordLocalListingView(listing, viewerSession, storage = globalThis.localStorage, options = {}) {
  const event = createListingView(listing, viewerSession, { ...options, viewerSessionId: options.viewerSessionId || listingVisitorId(storage) });
  if (!event) return { event: null, events: loadListingViews(storage) };
  const events = [...loadListingViews(storage), event];
  saveListingViews(events, storage);
  return { event, events };
}

export function summarizeListingViews(events = [], listings = []) {
  const listingIds = new Set(listings.map((listing) => clean(listing.id)).filter(Boolean));
  const relevant = events.filter((event) => listingIds.has(clean(event.listingId)));
  const byListing = {};
  for (const listing of listings) {
    const listingEvents = relevant
      .filter((event) => clean(event.listingId) === clean(listing.id))
      .sort((a, b) => clean(b.viewedAt).localeCompare(clean(a.viewedAt)));
    const visitors = new Set(listingEvents.map((event) => clean(event.viewerMemberId) || clean(event.viewerSessionId)).filter(Boolean));
    const viewerGroups = new Map();
    for (const event of listingEvents) {
      const key = clean(event.viewerMemberId) || clean(event.viewerSessionId) || event.id;
      const current = viewerGroups.get(key) || { key, label: clean(event.viewerDisplayName) || "Anonymous visitor", count: 0, lastViewedAt: "" };
      current.count += 1;
      if (clean(event.viewedAt) > current.lastViewedAt) current.lastViewedAt = clean(event.viewedAt);
      viewerGroups.set(key, current);
    }
    byListing[listing.id] = {
      totalViews: listingEvents.length,
      uniqueVisitors: visitors.size,
      lastViewedAt: listingEvents[0]?.viewedAt || "",
      recentViewers: [...viewerGroups.values()].sort((a, b) => b.lastViewedAt.localeCompare(a.lastViewedAt)).slice(0, 8),
    };
  }
  return {
    totalViews: relevant.length,
    uniqueVisitors: new Set(relevant.map((event) => clean(event.viewerMemberId) || clean(event.viewerSessionId)).filter(Boolean)).size,
    viewedListings: Object.values(byListing).filter((item) => item.totalViews > 0).length,
    byListing,
  };
}

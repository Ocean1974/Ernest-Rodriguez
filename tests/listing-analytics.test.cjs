const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

(async () => {
  const root = path.join(__dirname, "..");
  const analytics = await import(pathToFileURL(path.join(root, "src/listings/listingAnalytics.mjs")).href);
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const listing = { id: "listing-1", ownerMemberId: "owner-1", propertyName: "Rabbit Center" };
  const anonymous = analytics.recordLocalListingView(listing, null, storage, { now: "2026-09-22T12:00:00.000Z", id: "view-1" });
  assert.equal(anonymous.event.viewerDisplayName, "Anonymous visitor");
  const member = analytics.recordLocalListingView(listing, { memberId: "member-2", displayName: "Jon" }, storage, { now: "2026-09-22T13:00:00.000Z", id: "view-2", viewerSessionId: "visitor-member-2" });
  assert.equal(member.event.viewerDisplayName, "Jon");
  const own = analytics.recordLocalListingView(listing, { memberId: "owner-1", displayName: "Ernest" }, storage, { now: "2026-09-22T14:00:00.000Z" });
  assert.equal(own.event, null);
  const summary = analytics.summarizeListingViews(member.events, [listing]);
  assert.equal(summary.totalViews, 2);
  assert.equal(summary.uniqueVisitors, 2);
  assert.equal(summary.byListing[listing.id].recentViewers[0].label, "Jon");
  const migration = fs.readFileSync(path.join(root, "supabase/migrations/202609220001_listing_analytics.sql"), "utf8");
  assert.match(migration, /Listing owners read their analytics/);
  assert.match(migration, /auth\.uid\(\) = listing_owner_id/);
  assert.match(migration, /record_listing_view/);
  console.log("Listing view analytics tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });

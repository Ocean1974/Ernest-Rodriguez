const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

(async () => {
  const root = path.join(__dirname, "..");
  const listings = await import(pathToFileURL(path.join(root, "src/listings/userListings.mjs")).href);
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };

  const created = listings.createUserListing({
    propertyName: "Rabbit Creek Center",
    address: "100 Main Street",
    county: "Jefferson County",
    city: "Louisville",
    priceLabel: "$2,500,000",
    tags: "Retail, Owner listed",
    contactEmail: "owner@example.com",
    askingPrice: "2000000",
    estimatedMarketValue: "2500000",
  }, "cre", { id: "listing-1", now: "2026-09-13T12:00:00.000Z" });

  assert.equal(created.id, "listing-1");
  assert.equal(created.submissionType, "user-submitted");
  assert.equal(created.listingKind, "cre");
  assert.equal(created.sourceLabel, "Owner/agent submitted listing");
  assert.deepEqual(created.tags, ["Retail", "Owner listed"]);
  assert.equal(created.askingPrice, 2000000);
  assert.equal(created.estimatedMarketValue, 2500000);
  assert.equal(created.dealRating, "Great Deal");
  assert.equal(created.dealScore, 80);
  assert.match(created.dealRatingEquation, /discount%/);
  const owned = listings.createUserListing({ propertyName: "Owned Rabbit", address: "101 Main Street", county: "Jefferson County" }, "resi", { id: "owned-1", now: "2026-09-13T12:00:00.000Z", ownerMemberId: "member-1", ownerDisplayName: "Ernest" });
  assert.equal(owned.ownerMemberId, "member-1");
  assert.equal(owned.ownerDisplayName, "Ernest");
  assert.equal(listings.memberOwnsListing(owned, "member-1"), true);
  assert.equal(listings.memberOwnsListing(owned, "member-2"), false);
  assert.deepEqual(listings.listingsForMember([created, owned], "member-1"), [owned]);
  assert.throws(() => listings.createUserListing({ propertyName: "Missing address" }, "resi"), /required/);
  const rental = listings.createUserListing({ propertyName: "Rabbit Row Rental", address: "200 Main Street", county: "Jefferson County" }, "rentals", { id: "rental-1", now: "2026-09-13T12:00:00.000Z" });
  assert.equal(rental.status, "For Rent");
  assert.equal(rental.assetType, "Rental");
  assert.throws(() => listings.createUserListing({ propertyName: "X", address: "Y", county: "Z" }, "unsupported"), /rental pages/);

  assert.equal(listings.saveUserListings([created], storage), true);
  assert.deepEqual(listings.loadUserListings(storage), [created]);
  const updated = listings.createUserListing({ ...created, priceLabel: "$2,400,000" }, "cre", { id: created.id, now: "2026-09-14T12:00:00.000Z" });
  assert.equal(listings.upsertUserListing([created], updated).length, 1);
  assert.equal(listings.upsertUserListing([created], updated)[0].priceLabel, "$2,400,000");
  assert.deepEqual(listings.removeUserListing([created], created.id), []);

  const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
  const start = app.indexOf("function CommercialMarketplacePage");
  const end = app.indexOf("function LiveTileMapBackground", start);
  const marketplace = app.slice(start, end);
  assert(marketplace.includes('data-action="add-listing"'));
  assert(marketplace.includes("Add Listing"));
  assert(marketplace.includes("Owner submitted"));
  assert(marketplace.includes("Publish Listing"));
  assert(marketplace.includes("openEditListing"));
  assert(marketplace.includes("deleteUserListing"));
  assert(marketplace.includes("memberOwnsListing(property, memberSession?.memberId)"));
  assert(marketplace.includes('data-member-profile="true"'));
  assert(marketplace.includes('data-member-dashboard="true"'));
  assert(marketplace.includes('data-listing-analytics-summary="true"'));
  assert(marketplace.includes('data-action="view-listing"'));
  assert(marketplace.includes('data-listing-detail="true"'));
  assert(marketplace.includes("Who viewed it"));
  assert(marketplace.includes('data-action="member-profile"'));
  assert(!marketplace.includes("Sign in to List"));
  assert(!marketplace.includes("Member Login"));
  assert(marketplace.includes('["cre", "resi", "rentals"].includes(listingKind)'));
  assert(marketplace.includes('["For Rent", "Coming Soon", "Leased", "Watch"]'));
  assert(marketplace.includes('accept="image/*"'));
  assert(marketplace.includes('data-action="import-listings"'));
  assert(marketplace.includes('data-listing-csv-dropzone="true"'));
  assert(marketplace.includes("onDrop={dropListingCsv}"));
  assert(marketplace.includes('accept=".csv,text/csv"'));
  assert(marketplace.includes("Property Name, Address, County"));
  assert(marketplace.includes("calculateListingDeal(property, { nearbyDevelopments })"));
  assert(marketplace.includes("Deal score"));
  assert(marketplace.includes('data-listing-deal-preview="true"'));
  assert(marketplace.includes("Not Ready to Sell"));
  assert(marketplace.includes("How the formula works"));
  assert(marketplace.includes("Nearby development:"));
  assert(marketplace.includes("loadNearbyListingDevelopments"));
  assert(marketplace.includes("await geocodeAddress"));
  assert(app.includes('listingKind === "cre"'));
  assert(app.includes('includes("rose building")'));
  assert(app.includes('return "/images/listings/rose-building.png"'));
  assert(marketplace.includes("listingImageForProperty(property, listingConfig.heroImage, listingKind)"));
  assert(fs.existsSync(path.join(root, "public", "images", "listings", "rose-building.png")));
  console.log("CRE, residential, and rental user-listing tests passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

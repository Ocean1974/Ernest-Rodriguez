import { calculateListingDeal } from "./dealRating.mjs";

export const USER_LISTINGS_STORAGE_KEY = "real-estate-savant:user-listings:v1";
export const USER_LISTING_KINDS = new Set(["cre", "resi", "rentals"]);
export const LISTING_PUBLICATION_STATUSES = new Set(["draft", "published", "pending", "sold", "leased", "expired", "archived"]);

function clean(value) {
  return String(value ?? "").trim();
}

function cleanNumber(value) {
  const source = String(value ?? "").trim().toLowerCase();
  const number = Number(source.replace(/[$,%\s,]/g, "").replace(/[km]$/, ""));
  if (!Number.isFinite(number) || number <= 0) return null;
  if (source.endsWith("m")) return number * 1_000_000;
  if (source.endsWith("k")) return number * 1_000;
  return number;
}

export function loadUserListings(storage = globalThis.localStorage) {
  if (!storage) return [];
  try {
    const value = JSON.parse(storage.getItem(USER_LISTINGS_STORAGE_KEY) || "[]");
    return Array.isArray(value)
      ? value.filter((item) => item?.submissionType === "user-submitted" && USER_LISTING_KINDS.has(item?.listingKind))
      : [];
  } catch {
    return [];
  }
}

export function saveUserListings(listings, storage = globalThis.localStorage) {
  if (!storage) return false;
  try {
    storage.setItem(USER_LISTINGS_STORAGE_KEY, JSON.stringify(listings));
    return true;
  } catch {
    return false;
  }
}

export function createUserListing(draft, listingKind, options = {}) {
  if (!USER_LISTING_KINDS.has(listingKind)) throw new TypeError("User listings are supported on CRE, residential, and rental pages only.");
  const propertyName = clean(draft.propertyName);
  const address = clean(draft.address);
  const county = clean(draft.county);
  if (!propertyName || !address || !county) throw new TypeError("Property name, address, and county are required.");
  const now = options.now || new Date().toISOString();
  const id = options.id || `user-listing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tags = Array.isArray(draft.tags)
    ? draft.tags.map(clean).filter(Boolean)
    : clean(draft.tags).split(",").map(clean).filter(Boolean);
  const askingPrice = cleanNumber(draft.askingPrice);
  const monthlyRent = cleanNumber(draft.monthlyRent);
  const listing = {
    id,
    ownerMemberId: clean(options.ownerMemberId || draft.ownerMemberId),
    ownerDisplayName: clean(options.ownerDisplayName || draft.ownerDisplayName),
    listingKind,
    submissionType: "user-submitted",
    createdAt: clean(draft.createdAt) || now,
    updatedAt: now,
    market: clean(draft.market) || clean(draft.city) || county,
    county,
    status: clean(draft.status) || (listingKind === "rentals" ? "For Rent" : "For Sale"),
    publicationStatus: LISTING_PUBLICATION_STATUSES.has(clean(draft.publicationStatus)) ? clean(draft.publicationStatus) : "published",
    assetType: clean(draft.assetType) || (listingKind === "cre" ? "Commercial" : listingKind === "rentals" ? "Rental" : "Residential"),
    propertyName,
    address,
    city: clean(draft.city),
    state: clean(draft.state),
    sizeLabel: clean(draft.sizeLabel) || "Size not provided",
    landLabel: clean(draft.landLabel) || "Land details not provided",
    priceLabel: clean(draft.priceLabel) || (listingKind === "rentals" && monthlyRent ? `$${monthlyRent.toLocaleString("en-US")}/mo` : askingPrice ? `$${askingPrice.toLocaleString("en-US")}` : "Contact for price"),
    capRate: clean(draft.capRate) || "Contact listing owner",
    yearBuilt: clean(draft.yearBuilt) || "Not provided",
    zoning: clean(draft.zoning) || "Not provided",
    sourceLabel: "Owner/agent submitted listing",
    parcelId: clean(draft.parcelId) || "Not provided",
    coordinates: clean(draft.coordinates) || "Not provided",
    tags: tags.length ? tags : ["Owner submitted"],
    highlight: clean(draft.highlight) || "Contact the listing owner or agent for additional property information.",
    image: clean(draft.image),
    contactName: clean(draft.contactName),
    contactEmail: clean(draft.contactEmail),
    contactPhone: clean(draft.contactPhone),
    askingPrice,
    estimatedMarketValue: cleanNumber(draft.estimatedMarketValue),
    annualNoi: cleanNumber(draft.annualNoi),
    monthlyRent,
    marketMonthlyRent: cleanNumber(draft.marketMonthlyRent),
    monthlyExpenses: cleanNumber(draft.monthlyExpenses),
  };
  const dealRating = calculateListingDeal(listing);
  return {
    ...listing,
    dealRating: dealRating.label,
    dealScore: dealRating.score,
    dealRatingBasis: dealRating.basis,
    dealRatingEquation: dealRating.equation,
    dealRatedAt: now,
  };
}

export function memberOwnsListing(listing, memberId) {
  return Boolean(listing?.ownerMemberId && clean(memberId) && listing.ownerMemberId === clean(memberId));
}

export function listingsForMember(listings, memberId) {
  return listings.filter((listing) => memberOwnsListing(listing, memberId));
}

export function upsertUserListing(listings, listing) {
  const next = listings.filter((item) => item.id !== listing.id);
  return [listing, ...next];
}

export function removeUserListing(listings, listingId) {
  return listings.filter((item) => item.id !== listingId);
}

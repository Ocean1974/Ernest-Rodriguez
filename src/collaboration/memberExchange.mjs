export const MEMBER_EXCHANGE_VERSION = "wr-member-exchange-v1";

const text = (value) => String(value || "").trim();
const lower = (value) => text(value).toLowerCase();
const amount = (value) => Math.max(0, Number(value) || 0);

export function createExchangePost(input = {}) {
  const kind = input.kind === "buyer-need" ? "buyer-need" : "listing";
  const memberId = text(input.memberId);
  const memberName = text(input.memberName);
  const title = text(input.title);
  if (!memberId || !memberName || !title) throw new TypeError("Member, member name, and post title are required");
  const createdAt = new Date(input.createdAt || Date.now()).toISOString();
  return Object.freeze({
    schemaVersion: MEMBER_EXCHANGE_VERSION,
    id: text(input.id) || `exchange-${Date.parse(createdAt)}-${Math.random().toString(36).slice(2, 8)}`,
    kind, memberId, memberName, title,
    propertyType: text(input.propertyType) || "Any property type",
    market: text(input.market),
    price: amount(input.price), minPrice: amount(input.minPrice), maxPrice: amount(input.maxPrice),
    details: text(input.details), status: input.status === "closed" ? "closed" : "active", createdAt,
  });
}

function compatible(listing, need) {
  const typeMatches = lower(listing.propertyType).startsWith("any") || lower(need.propertyType).startsWith("any") || lower(listing.propertyType) === lower(need.propertyType);
  const marketMatches = !listing.market || !need.market || lower(listing.market) === lower(need.market) || lower(listing.market).includes(lower(need.market)) || lower(need.market).includes(lower(listing.market));
  const priceMatches = !listing.price || ((!need.minPrice || listing.price >= need.minPrice) && (!need.maxPrice || listing.price <= need.maxPrice));
  return typeMatches && marketMatches && priceMatches;
}

export function findMemberMatches(posts = []) {
  const active = posts.filter((post) => post.status !== "closed");
  const listings = active.filter((post) => post.kind === "listing");
  const needs = active.filter((post) => post.kind === "buyer-need");
  return listings.flatMap((listing) => needs.filter((need) => need.memberId !== listing.memberId && compatible(listing, need)).map((need) => ({
    id: `match:${listing.id}:${need.id}`,
    listingId: listing.id,
    buyerNeedId: need.id,
    listing,
    buyerNeed: need,
  })));
}

export function createMemberMessage(input = {}) {
  const threadId = text(input.threadId);
  const authorMemberId = text(input.authorMemberId);
  const authorName = text(input.authorName);
  const body = text(input.body);
  if (!threadId || !authorMemberId || !authorName || !body) throw new TypeError("Thread, author, and message are required");
  const createdAt = new Date(input.createdAt || Date.now()).toISOString();
  return Object.freeze({ schemaVersion: MEMBER_EXCHANGE_VERSION, id: text(input.id) || `message-${Date.parse(createdAt)}-${Math.random().toString(36).slice(2, 8)}`, threadId, authorMemberId, authorName, body, createdAt });
}

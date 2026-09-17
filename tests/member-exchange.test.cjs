const assert = require("node:assert/strict");

(async () => {
  const exchange = await import("../src/collaboration/memberExchange.mjs");
  const listing = exchange.createExchangePost({ id: "listing-1", kind: "listing", memberId: "member-a", memberName: "Avery", title: "Louisville apartments", propertyType: "Multifamily", market: "Jefferson County, KY", price: 1200000, createdAt: "2026-09-14T12:00:00Z" });
  const need = exchange.createExchangePost({ id: "need-1", kind: "buyer-need", memberId: "member-b", memberName: "Blake", title: "Buyer seeking apartments", propertyType: "Multifamily", market: "Jefferson County, KY", minPrice: 900000, maxPrice: 1500000, createdAt: "2026-09-14T12:01:00Z" });
  const wrongMarket = exchange.createExchangePost({ id: "need-2", kind: "buyer-need", memberId: "member-c", memberName: "Casey", title: "Dallas buyer", propertyType: "Multifamily", market: "Dallas County, TX", createdAt: "2026-09-14T12:02:00Z" });
  const matches = exchange.findMemberMatches([listing, need, wrongMarket]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].listingId, "listing-1");
  assert.equal(matches[0].buyerNeedId, "need-1");
  const message = exchange.createMemberMessage({ id: "message-1", threadId: matches[0].id, authorMemberId: "member-a", authorName: "Avery", body: "Let’s discuss the buyer fit.", createdAt: "2026-09-14T12:03:00Z" });
  assert.equal(message.threadId, matches[0].id);
  assert.throws(() => exchange.createMemberMessage({ threadId: matches[0].id }), /required/);
  console.log("White Rabbit member exchange matching and messaging tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });

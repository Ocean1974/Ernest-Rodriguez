const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

(async () => {
  const rating = await import(pathToFileURL(path.join(__dirname, "../src/listings/dealRating.mjs")).href);
  const great = rating.calculateListingDeal({ askingPrice: 800000, estimatedMarketValue: 1000000 });
  const good = rating.calculateListingDeal({ askingPrice: 900000, estimatedMarketValue: 1000000 });
  const fair = rating.calculateListingDeal({ askingPrice: 1000000, estimatedMarketValue: 1000000 });
  const noDeal = rating.calculateListingDeal({ askingPrice: 1100000, estimatedMarketValue: 1000000 });
  const rental = rating.calculateListingDeal({ monthlyRent: 1800, marketMonthlyRent: 2400 });
  const yieldAdjusted = rating.calculateListingDeal({ askingPrice: 1000000, estimatedMarketValue: 1000000, annualNoi: 100000 });
  const limited = rating.calculateListingDeal({});

  assert.deepEqual([great.label, good.label, fair.label, noDeal.label], ["Great Deal", "Good Deal", "Fair Deal", "Not Ready to Sell"]);
  assert.deepEqual([great.score, good.score, fair.score, noDeal.score], [80, 65, 50, 35]);
  assert.equal(rental.label, "Great Deal");
  assert.equal(rental.score, 88);
  assert.equal(yieldAdjusted.score, 62);
  assert.equal(limited.label, "Fair Deal");
  assert.equal(limited.score, 50);
  assert.equal(limited.hasPricingEvidence, false);
  assert.match(limited.basis, /Limited pricing data/);
  assert.match(great.equation, /1.5 × discount%/);
  assert.match(great.equation, /nearby development impact/);
  assert.deepEqual(rating.parseListingCoordinates("32.80, -96.80"), [-96.8, 32.8]);
  const nearbyMajor = { coordinates: [-96.8, 32.8], scale: "major", evidenceStrength: "verified-construction", impact: "positive", title: "Major mixed-use project" };
  const developmentAdjusted = rating.calculateListingDeal({ coordinates: "32.80, -96.80" }, { nearbyDevelopments: [nearbyMajor] });
  assert.equal(developmentAdjusted.development.adjustment, 15);
  assert.equal(developmentAdjusted.score, 65);
  assert.equal(developmentAdjusted.label, "Good Deal");
  assert.equal(rating.calculateNearbyDevelopmentImpact("32.80, -96.80", [nearbyMajor, { ...nearbyMajor, title: "Second major project" }]).adjustment, 20, "nearby development must cap at 20 points");
  assert.equal(rating.calculateNearbyDevelopmentImpact("32.80, -96.80", [{ ...nearbyMajor, coordinates: [-96.79, 32.8] }]).adjustment, 0, "developments beyond half a mile must not affect the score");
  const edgeImpact = rating.calculateNearbyDevelopmentImpact("32.80, -96.80", [{ ...nearbyMajor, coordinates: [-96.793, 32.8] }]);
  assert(edgeImpact.adjustment > 0 && edgeImpact.adjustment < 15, "development influence must decline within the outer few-block radius");
  assert.equal(rating.calculateListingDeal({ askingPrice: 1, estimatedMarketValue: 1000000 }).score, 95, "discount contribution must cap at 45 points");
  assert.equal(rating.calculateListingDeal({ askingPrice: 1, estimatedMarketValue: 1000000, annualNoi: 100000 }).score, 100, "combined scores must cap at 100");
  assert.equal(rating.calculateListingDeal({ askingPrice: 1000000, estimatedMarketValue: 1 }).score, 5, "discount penalty must be capped");
  console.log("Listing deal-rating equation tests passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (...parts) => JSON.parse(fs.readFileSync(path.join(root, ...parts), "utf8"));
const index = read("public", "data", "savant-tools", "market-index.json");

assert.strictEqual(index.schemaVersion, "wr-savant-market-index-v1");
assert.match(index.rankingContract, /Each city has an independent candidate pool/i);
assert.deepStrictEqual(index.markets.slice(0, 4).map((market) => market.id), ["dallas-tx", "houston-tx", "austin-tx", "san-antonio-tx"]);
assert(index.markets.every((market) => market.stateCode && market.stateName), "Every Savant market must publish state metadata for state-first navigation");
assert.deepStrictEqual([...new Set(index.markets.map((market) => market.stateCode))], ["TX"]);
const collinMarketIds = ["plano-tx", "mckinney-tx", "frisco-tx", "allen-tx", "wylie-tx", "princeton-tx", "anna-tx", "prosper-tx", "murphy-tx", "richardson-collin-tx", "dallas-collin-tx"];
assert.deepStrictEqual(index.markets.filter((market) => market.sourceCountyId === "collin-county-tx").map((market) => market.id), collinMarketIds);

for (const market of index.markets) {
  const radar = read("public", "data", "savant-tools", ...market.radar.split("/"));
  assert.strictEqual(radar.marketId, market.id);
  assert.strictEqual(radar.sourceCountyId, market.sourceCountyId);
  assert(radar.topCandidates.length > 0, `${market.name} must publish candidates`);
  assert.strictEqual(radar.schemaVersion, "wr-savant-development-path-radar-v4");
  assert.strictEqual(radar.eligibilityPolicy.version, "private-prospect-v1");
  assert.strictEqual(radar.pathOfGrowthPolicy.version, "surrounding-development-v1");
  assert.strictEqual(radar.pathOfGrowthPolicy.radiusMiles, 3);
  assert(radar.topCandidates.every((candidate) => candidate.reasonCodes.includes("private-owner-prospect")), `${market.name} must publish only screened private-owner prospects`);
  assert.strictEqual(radar.topCandidates[0].rank, 1, `${market.name} ranking must restart at one`);
  assert(radar.topCandidates.length <= 100, `${market.name} must publish no more than 100 candidates`);
  assert.strictEqual(radar.topCandidates[0].score, 100, `${market.name} scores must begin at 100`);
  assert.strictEqual(radar.topCandidates.at(-1).score, 1, `${market.name} scores must end at 1`);
  for (let index = 1; index < radar.topCandidates.length; index += 1) {
    assert(radar.topCandidates[index - 1].score > radar.topCandidates[index].score, `${market.name} scores must strictly descend`);
    assert.strictEqual(radar.topCandidates[index].rank, index + 1, `${market.name} ranks must be contiguous`);
    assert(Number.isFinite(radar.topCandidates[index].evidenceScore), `${market.name} must preserve its evidence score`);
    assert(Number.isFinite(radar.topCandidates[index].pathOfGrowth.score), `${market.name} must publish a Path of Growth score`);
    assert(radar.topCandidates[index].pathOfGrowth.score >= 0 && radar.topCandidates[index].pathOfGrowth.score <= 100, `${market.name} Path of Growth scores must be bounded`);
  }
  assert(radar.marketDemandContext, `${market.name} must publish aggregate place demand context`);
  assert.equal(radar.marketDemandContext.geographyLevel, "place");
  assert.equal(radar.marketDemandContext.parcelAttribution, false);
  assert.equal(radar.marketDemandContext.scoringImpact, "context-only-no-parcel-points");
  assert.match(radar.marketDemandContext.indexSemantics, /not a forecast/i);
}
assert(index.markets.filter((market) => {
  const radar = read("public", "data", "savant-tools", ...market.radar.split("/"));
  return radar.topCandidates.some((candidate) => candidate.reasonCodes.includes("path-of-growth"));
}).length >= 10, "Markets with recent surrounding-development coverage must surface Path of Growth candidates");

const dallas = read("public", "data", "savant-tools", "markets", "dallas-tx", "development-path-radar.json");
assert.strictEqual(dallas.sourceCountyId, "dallas-county-dcad");
assert.strictEqual(dallas.sourceParcelFeatureCount, 696601);
assert.strictEqual(dallas.analyzedCandidateCount, 696601);
assert.strictEqual(dallas.topCandidates.length, 100);
assert(dallas.topCandidates.every((candidate) => candidate.whiteRabbitPropertyId.startsWith("wrp:v1:dallas-county-dcad:")), "Dallas candidates must use Dallas County canonical property ids");
assert(dallas.topCandidates.every((candidate) => !candidate.factorIds.includes("current-development-activity")), "Dallas must not reward active development on the target parcel");
assert(dallas.topCandidates.every((candidate) => candidate.sourceTrail.includes("public/data/parcels/manifest.json")), "Dallas must identify the full parcel service as its source");
assert.match(dallas.coverageDisclosure, /full Dallas County DCAD service/i);

const houston = read("public", "data", "savant-tools", "markets", "houston-tx", "development-path-radar.json");
assert.strictEqual(houston.sourceParcelFeatureCount, 1535522);
assert.match(houston.listingCoverage, /not yet complete/i);
assert(houston.topCandidates.every((candidate) => !candidate.factorIds.includes("current-plat-activity")), "Houston must not reward active development on the target parcel");

const austin = read("public", "data", "savant-tools", "markets", "austin-tx", "development-path-radar.json");
assert.strictEqual(austin.sourceCountyId, "travis-county-tx");
assert.strictEqual(austin.sourceParcelFeatureCount, 386682);
assert.match(austin.coverageDisclosure, /City of Austin source footprints/i);
assert.match(austin.listingCoverage, /not yet complete/i);
assert(austin.topCandidates.every((candidate) => !candidate.factorIds.includes("current-permit-activity")), "Austin must not reward active development on the target parcel");
assert(austin.topCandidates.every((candidate) => candidate.whiteRabbitPropertyId.startsWith("wrp:v1:travis-county-tx:")), "Austin candidates must use Travis County canonical property ids");

const sanAntonio = read("public", "data", "savant-tools", "markets", "san-antonio-tx", "development-path-radar.json");
assert.strictEqual(sanAntonio.sourceCountyId, "bexar-county-tx");
assert.strictEqual(sanAntonio.sourceParcelFeatureCount, 710770);
assert.match(sanAntonio.coverageDisclosure, /City of San Antonio source footprints/i);
assert.match(sanAntonio.listingCoverage, /not yet complete/i);
assert(sanAntonio.topCandidates.every((candidate) => !candidate.factorIds.includes("current-permit-activity")), "San Antonio must not reward active development on the target parcel");
assert(sanAntonio.topCandidates.every((candidate) => candidate.whiteRabbitPropertyId.startsWith("wrp:v1:bexar-county-tx:")), "San Antonio candidates must use Bexar County canonical property ids");

for (const marketId of collinMarketIds) {
  const market = read("public", "data", "savant-tools", "markets", marketId, "development-path-radar.json");
  assert.strictEqual(market.sourceCountyId, "collin-county-tx");
  assert(market.sourceParcelFeatureCount > 0, `${market.marketName} must have a city-local Collin parcel pool`);
  assert(market.topCandidates.every((candidate) => !candidate.factorIds.includes("current-permit-activity")), `${market.marketName} must not reward active permits on the target parcel`);
  assert(market.topCandidates.every((candidate) => candidate.whiteRabbitPropertyId.startsWith("wrp:v1:collin-county-tx:")), `${market.marketName} candidates must use Collin canonical property ids`);
}

console.log("Savant city-specific rankings, including 11 Collin County markets, passed.");

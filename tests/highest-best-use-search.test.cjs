const assert = require("node:assert/strict");

(async () => {
  const { parseHighestBestUseSearch, rankParcelsForHighestBestUse } = await import("../src/search/highestBestUseSearch.mjs");

  assert.equal(parseHighestBestUseSearch("10300 Sanden Dr"), null);
  const parcelIntent = parseHighestBestUseSearch("HBU for 10300 Sanden Dr");
  assert.equal(parcelIntent.mode, "parcel-analysis");
  assert.equal(parcelIntent.locationQuery.toLowerCase(), "10300 sanden dr");

  const rankedIntent = parseHighestBestUseSearch("find the best multifamily sites");
  assert.equal(rankedIntent.mode, "viewport-ranking");
  assert.equal(rankedIntent.useId, "multifamily");
  assert.equal(rankedIntent.locationQuery, "");

  const mixedUseIntent = parseHighestBestUseSearch("highest and best use mixed-use at 1610 S Ervay St");
  assert.equal(mixedUseIntent.useId, "mixed-use");
  assert.equal(mixedUseIntent.locationQuery.toLowerCase(), "1610 s ervay st");

  const parcels = [
    { accountNum: "A", address: "1 Main", landAreaSqFt: 50000, totalValue: 1000000 },
    { accountNum: "B", address: "2 Main", landAreaSqFt: 100000, totalValue: 1000000 },
    { accountNum: "C", address: "3 Main", landAreaSqFt: "", totalValue: 100000 },
  ];
  const ranked = rankParcelsForHighestBestUse(parcels, "industrial", { limit: 10 });
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].accountNum, "B");
  assert.equal(ranked[0].highestBestUseSearch.rank, 1);
  assert.equal(ranked[0].highestBestUseSearch.scenarioId, "industrial");
  assert.equal(ranked[1].highestBestUseSearch.rank, 2);

  console.log("White Rabbit highest-and-best-use search tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

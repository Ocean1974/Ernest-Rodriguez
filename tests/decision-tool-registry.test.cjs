const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, "../src/features/decisionToolRegistry.mjs")).href;
  const { buildParcelDecisionToolCatalog, createDecisionToolLaunchRequest } = await import(moduleUrl);

  const gated = buildParcelDecisionToolCatalog({});
  assert.equal(gated.length, 19, "The parcel workspace must expose all nineteen registered decision-tool entries");
  assert.deepEqual(gated.filter((tool) => tool.ready).map((tool) => tool.id), ["feasibility", "underwriting", "opportunity-briefs", "property-timeline"], "Evidence-backed local decision tools must be available without opening production gates");
  assert.deepEqual(gated.find((tool) => tool.id === "saved-intelligence").blockedBy, ["savedSearches", "watchlists"]);
  assert.deepEqual(gated.find((tool) => tool.id === "development-digital-twin").blockedBy, ["development3dAnalysis", "developmentMassing", "photorealistic3dContext"]);
  assert.deepEqual(gated.find((tool) => tool.id === "valuation-comparables").blockedBy, ["marketComparables", "licensedComparables", "comparableAdjustments"]);
  assert.deepEqual(gated.find((tool) => tool.id === "climate-insurance").blockedBy, ["climateRiskModels", "insuranceCostEstimates", "resilienceScenarios"]);
  assert.deepEqual(gated.find((tool) => tool.id === "title-debt-history").blockedBy, ["transactionHistory", "mortgageHistory", "documentEvidenceExtraction"]);

  const enabled = buildParcelDecisionToolCatalog({ underwriting: true });
  const underwriting = enabled.find((tool) => tool.id === "underwriting");
  assert.equal(underwriting.ready, true);
  assert.equal(underwriting.status, "Active");
  assert.equal(enabled.find((tool) => tool.id === "analyst").ready, false, "One tool gate must not activate another tool");

  assert.throws(
    () => createDecisionToolLaunchRequest(gated.find((tool) => tool.id === "saved-intelligence"), { accountNum: "123" }),
    (error) => error.code === "WR_DECISION_TOOL_GATED",
  );
  assert.deepEqual(createDecisionToolLaunchRequest(underwriting, { countyParcelId: "dallas:123", sourceCountyId: "dallas-county-tx" }), {
    schemaVersion: "wr-decision-tool-launch-v1",
    toolId: "underwriting",
    capabilityId: "scenario-underwriting",
    action: "open-scenario-underwriting",
    parcelId: "dallas:123",
    sourceCountyId: "dallas-county-tx",
  });

  console.log("White Rabbit decision-tool registry tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

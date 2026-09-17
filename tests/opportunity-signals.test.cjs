const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const { buildOpportunitySignals } = await import("../src/intelligence/opportunitySignals.mjs");
  const signal = buildOpportunitySignals({
    observedAt: "2026-08-13T12:00:00.000Z",
    parcel: { whiteRabbitPropertyId: "wrp:v1:dallas-county-dcad:A1", ownerName: "ALPHA LAND LLC", landAreaSize: 8, landAreaUnit: "ACRE", landValue: 1000000, improvementValue: 100000, yearBuilt: 1970, ownershipTenureYears: 15, dataLineage: { contractVersion: "wr-lineage-v1" } },
    permits: [],
    development: { signalCount: 2, signalTypes: ["site_work"], latestActivityDate: "2026-05-01" },
  });
  assert.equal(signal.schemaVersion, "wr-opportunity-signal-v1");
  assert(signal.score >= 70);
  assert.equal(signal.tier, "high");
  assert(signal.factors.every((factor) => factor.evidence && factor.sourceFields.length));
  assert(signal.explanation.length === signal.factors.length);
  assert(signal.scoringRule.includes("every point"));
  assert(signal.factors.find((factor) => factor.id === "development-momentum")?.evidence.activityAgeDays >= 0);
  const staleDevelopment = buildOpportunitySignals({
    observedAt: "2026-08-13T12:00:00.000Z",
    parcel: { whiteRabbitPropertyId: "wrp:v1:dallas-county-dcad:A3" },
    development: { signalCount: 99, signalTypes: ["historic"], latestActivityDate: "2019-01-16" },
  });
  assert(!staleDevelopment.factors.some((factor) => factor.id === "development-momentum"), "Development activity older than two years must not boost a current opportunity score");
  assert(staleDevelopment.scoringRule.includes("730 days"));
  const missingPermitEvidence = buildOpportunitySignals({ parcel: { whiteRabbitPropertyId: "wrp:v1:dallas-county-dcad:A2" } });
  assert(missingPermitEvidence.missingEvidence.includes("permits"));
  assert(missingPermitEvidence.missingEvidence.includes("landValue"), "Missing numeric opportunity evidence must remain missing rather than becoming zero");
  assert(!missingPermitEvidence.factors.some((factor) => factor.id === "no-linked-permits"));
  require("./dallas-building-characteristics.test.cjs");
  require("./dallas-parcel-opportunity-intelligence.test.cjs");
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "opportunity-signal.schema.json"), "utf8"));
  assert.equal(schema.properties.schemaVersion.const, "wr-opportunity-signal-v1");
  console.log("White Rabbit explainable opportunity signal tests passed.");
  require("./opportunity-decision-workflow.test.cjs");
})().catch((error) => { console.error(error); process.exit(1); });

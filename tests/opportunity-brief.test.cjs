const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const { buildOpportunityBrief } = await import("../src/briefs/opportunityBrief.mjs");
  const { calculateUnderwriting } = await import("../src/underwriting/underwritingEngine.mjs");
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "opportunity-brief.schema.json"), "utf8"));
  assert.equal(schema.properties.schemaVersion.const, "wr-opportunity-brief-v1");
  const generatedAt = "2026-08-13T12:00:00.000Z";
  const profile = {
    schemaVersion: "wr-property-profile-v1",
    whiteRabbitPropertyId: "wrp:v1:dallas-county-dcad:123",
    sourceCountyId: "dallas-county-dcad",
    accountNum: "123",
    parcel: { accountNum: "123", siteAddress: "100 Main St", ownerName: "Rabbit LLC", landAreaSqFt: 43560, totalValue: 900000, dataLineage: { sourceDatasetId: "dcad-2026", sourceAsOf: "2026-01-01" } },
    intelligence: { zoning: { code: "MU-2", sourceDatasetId: "dallas-zoning" } },
    evidence: { layerStatus: { permits: "not-found" }, permitCount: 0, errors: [] },
  };
  const underwriting = calculateUnderwriting({ purchasePrice: 1000000, grossPotentialRentAnnual: 150000, exitCapRatePct: 7 }, { generatedAt });
  const brief = buildOpportunityBrief({ profile, opportunitySignals: { missingEvidence: ["ownershipTenureYears"] }, underwriting, generatedAt });
  assert.equal(brief.schemaVersion, "wr-opportunity-brief-v1");
  assert.equal(brief.status, "partial");
  assert.equal(brief.whiteRabbitPropertyId, profile.whiteRabbitPropertyId);
  assert.equal(brief.exportModel.title, "100 Main St");
  assert.equal(brief.sections.find((section) => section.id === "activity").facts[0].value, 0, "verified zero permits must remain an observed zero");
  const tenure = brief.sections.find((section) => section.id === "ownership").facts.find((item) => item.id === "ownership-tenure");
  assert.equal(tenure.status, "unknown");
  assert.equal(tenure.source, "");
  assert(brief.evidenceSummary.unknownFacts > 0);
  assert(brief.warnings.some((warning) => warning.includes("ownershipTenureYears")));

  const empty = buildOpportunityBrief({ generatedAt });
  assert.equal(empty.status, "insufficient-evidence");
  assert(empty.sections.flatMap((section) => section.facts).every((item) => item.status === "unknown"));
  console.log("White Rabbit opportunity brief tests passed.");
  require("./acquisition-handoff-workflow.test.cjs");
})().catch((error) => { console.error(error); process.exit(1); });

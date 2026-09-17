const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (value) => JSON.parse(fs.readFileSync(path.join(root, value), "utf8"));
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

(async () => {
  const coverage = await import("../src/operations/countyJurisdictionCoverage.mjs");
  const input = read("data/county-adapters/tarrant/jurisdiction-source-registry.json");
  const universe = coverage.createCountyJurisdictionUniverse({
    countyId: input.countyId,
    countyFips: input.countyFips,
    sourceUrl: input.jurisdictionSourceUrl,
    sourceObservedAt: input.sourceObservedAt,
    jurisdictions: [
      ...input.municipalities.map((name) => ({ id: slug(name), name, type: "incorporated-area" })),
      { id: "unincorporated-tarrant", name: "Unincorporated Tarrant County", type: "unincorporated" },
    ],
  });
  const evidence = input.sources.map(coverage.createCountyLayerSourceEvidence);
  const layers = ["zoning", "permits", "floodplain", "development", "demand"];
  const plans = layers.map((layer) => coverage.createCountyLayerCoveragePlan({
    universe,
    layer,
    evidence: evidence.filter((item) => item.layer === layer),
    boundaryEvidenceRef: input.boundaryEvidenceRef,
    boundaryEvidenceSha256: input.boundaryEvidenceSha256,
  }));
  const report = coverage.createCountyLayerCoverageReport({ universe, plans, generatedAt: new Date().toISOString() });
  const output = { universe, evidence, report };
  const directory = path.join(root, "output", "tarrant", "jurisdiction-coverage");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "tarrant-jurisdiction-coverage.json"), `${JSON.stringify(output, null, 2)}\n`);
  const lines = [
    "# Tarrant Jurisdiction Intelligence Coverage",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Planning universe: ${report.jurisdictionCount} scopes (41 incorporated areas plus unincorporated Tarrant County).`,
    "",
    "This is a source-discovery and readiness artifact only. It does not authorize capture, parcel joins, UI visibility, or county activation.",
    "",
    "## Layer gates",
    "",
    "| Layer | Discovered sources | Capture-authorized sources | Covered scopes | Uncovered scopes | Status |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
    ...plans.map((plan) => {
      const discovered = evidence.filter((item) => item.layer === plan.layer);
      return `| ${plan.layer} | ${discovered.length} | ${discovered.filter((item) => item.captureAuthorized).length} | ${plan.coveredJurisdictionIds.length} | ${plan.uncoveredJurisdictionIds.length} | ${plan.status} |`;
    }),
    "",
    "## Verified discovery boundaries",
    "",
    "- Fort Worth zoning is a Fort Worth municipal source, not a Tarrant countywide zoning source.",
    "- Fort Worth permits are a Fort Worth municipal source, not a Tarrant countywide permit source.",
    "- FEMA NFHL is the authoritative flood-hazard candidate; a bounded Tarrant extract, metadata capture, and reuse-rights evidence are still required.",
    "- No source is capture-authorized until evidence explicitly proves store, derive, and query rights.",
    "- No layer can certify until current jurisdiction boundaries are captured and hashed.",
    "",
    "## Next evidence",
    "",
    "1. Capture a current official Tarrant incorporated/unincorporated boundary universe, including ETJ treatment, with an immutable hash.",
    "2. Obtain and record reuse terms for Fort Worth GIS and FEMA data before snapshots or derived parcel indexes are built.",
    "3. Discover official zoning and permit sources for the other 40 incorporated areas; record explicit unavailable cases.",
    "4. Query and count a bounded Tarrant NFHL extract, then test parcel intersection and centroid classifications with unmatched/ambiguous counts.",
    "5. Keep all county intelligence feature gates default-off until every coverage claim and spatial join passes.",
  ];
  fs.writeFileSync(path.join(directory, "tarrant-jurisdiction-coverage.md"), `${lines.join("\n")}\n`);
  console.log(JSON.stringify({ jurisdictionCount: report.jurisdictionCount, discoveredSourceCount: evidence.length, certifiedLayerCount: plans.filter((item) => item.status === "certified").length, reportSha256: report.reportSha256 }, null, 2));
})().catch((error) => { console.error(error); process.exit(1); });

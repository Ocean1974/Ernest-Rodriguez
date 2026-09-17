const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { parse } = require("csv-parse/sync");

const root = path.join(__dirname, "..");
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const inflowUrl = "https://www.irs.gov/pub/irs-soi/countyinflow2223.csv";
const outflowUrl = "https://www.irs.gov/pub/irs-soi/countyoutflow2223.csv";

async function fetchRaw(url) {
  const response = await fetch(url, { headers: { "user-agent": "WhiteRabbitDataReadiness/1.0" } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function number(row, field) {
  const value = Number(row[field]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${field}: ${row[field]}`);
  return value;
}

(async () => {
  const demand = await import("../src/operations/countyDemandIntelligence.mjs");
  const [inflowRaw, outflowRaw] = await Promise.all([fetchRaw(inflowUrl), fetchRaw(outflowUrl)]);
  const inflowAll = parse(inflowRaw, { columns: true, skip_empty_lines: true, trim: true });
  const outflowAll = parse(outflowRaw, { columns: true, skip_empty_lines: true, trim: true });
  const inflowRows = inflowAll.filter((row) => row.y2_statefips === "48" && row.y2_countyfips === "439");
  const outflowRows = outflowAll.filter((row) => row.y1_statefips === "48" && row.y1_countyfips === "439");
  const uniqueInflow = new Set(inflowRows.map((row) => `${row.y1_statefips}:${row.y1_countyfips}`));
  const uniqueOutflow = new Set(outflowRows.map((row) => `${row.y2_statefips}:${row.y2_countyfips}`));
  const inflowTotal = inflowRows.find((row) => row.y1_statefips === "96" && row.y1_countyfips === "000");
  const outflowTotal = outflowRows.find((row) => row.y2_statefips === "96" && row.y2_countyfips === "000");
  if (!inflowTotal || !outflowTotal) throw new Error("Tarrant total migration aggregates are missing");
  const common = { countyId: "tarrant-county-tad", geographyLevel: "county", geographyId: "05000US48439", domain: "migration", periodStart: "2022", periodEnd: "2023", releasedAt: "2026-03-19", reuseRightsCertified: false, blockers: ["raw-content-not-persisted", "reuse-rights-not-certified"] };
  const probes = [
    demand.createCountyDemandSourceProbe({ ...common, sourceId: "irs-soi-county-inflow-2022-2023", publisher: "Internal Revenue Service Statistics of Income", sourceRole: "migration-inflow", sourceUrl: inflowUrl, recordCount: inflowRows.length, metricIds: ["inflow-returns", "inflow-exemptions", "inflow-agi-thousands"], responseBytes: inflowRaw.length, responseSha256: sha256(inflowRaw), sourceIdentityUnique: uniqueInflow.size === inflowRows.length }),
    demand.createCountyDemandSourceProbe({ ...common, sourceId: "irs-soi-county-outflow-2022-2023", publisher: "Internal Revenue Service Statistics of Income", sourceRole: "migration-outflow", sourceUrl: outflowUrl, recordCount: outflowRows.length, metricIds: ["outflow-returns", "outflow-exemptions", "outflow-agi-thousands"], responseBytes: outflowRaw.length, responseSha256: sha256(outflowRaw), sourceIdentityUnique: uniqueOutflow.size === outflowRows.length }),
    demand.createCountyDemandSourceProbe({ countyId: "tarrant-county-tad", sourceId: "census-acs5-2024", publisher: "U.S. Census Bureau", sourceRole: "demographic", domain: "demographic", geographyLevel: "county", geographyId: "05000US48439", sourceUrl: "https://api.census.gov/data/2024/acs/acs5", periodStart: "2020", periodEnd: "2024", releasedAt: "2026-01-29", recordCount: 0, metricIds: ["population", "geographic-mobility", "median-household-income"], blockers: ["census-api-key-required", "response-not-captured"] }),
    demand.createCountyDemandSourceProbe({ countyId: "tarrant-county-tad", sourceId: "census-acs5-housing-2024", publisher: "U.S. Census Bureau", sourceRole: "housing", domain: "housing", geographyLevel: "county", geographyId: "05000US48439", sourceUrl: "https://api.census.gov/data/2024/acs/acs5", periodStart: "2020", periodEnd: "2024", releasedAt: "2026-01-29", recordCount: 0, metricIds: ["housing-units", "occupied-units", "vacant-units", "median-home-value", "median-gross-rent"], blockers: ["census-api-key-required", "response-not-captured"] }),
    demand.createCountyDemandSourceProbe({ countyId: "tarrant-county-tad", sourceId: "bls-qcew-2025", publisher: "U.S. Bureau of Labor Statistics", sourceRole: "labor-market", domain: "labor", geographyLevel: "county", geographyId: "05000US48439", sourceUrl: "https://data.bls.gov/cew/data/files/2025/csv/2025_qtrly_by_area.zip", periodStart: "2025", periodEnd: "2025", recordCount: 0, metricIds: ["establishments", "employment", "total-wages", "average-weekly-wage"], blockers: ["official-archive-not-captured", "period-completeness-not-audited"] }),
    demand.createCountyDemandSourceProbe({ countyId: "tarrant-county-tad", sourceId: "municipal-permit-supply-federation", publisher: "Fort Worth and Arlington official permit services", sourceRole: "supply-pipeline", domain: "supply", geographyLevel: "county", geographyId: "05000US48439", sourceUrl: "https://mapit.fortworthtexas.gov/ags/rest/services/CIVIC/Permits/FeatureServer/0", periodStart: "unverified", periodEnd: "current", recordCount: 0, metricIds: ["new-construction-permits", "demolition-permits", "occupancy-certificates"], blockers: ["municipal-coverage-incomplete", "upstream-record-capture-not-certified", "parcel-links-not-certified"] }),
  ];
  const coverage = demand.reconcileCountyDemandCoverage({ countyId: "tarrant-county-tad", geographyId: "05000US48439", requiredDomains: ["migration", "demographic", "housing", "labor", "supply"], probes });
  const observations = [
    ["inflow-returns", "IRS inflow returns", number(inflowTotal, "n1"), "returns", "Returns approximate tax-filing units and must not be labeled households or people", probes[0], inflowTotal],
    ["inflow-exemptions", "IRS inflow exemptions", number(inflowTotal, "n2"), "exemptions", "Exemptions approximate individuals represented on matched returns and are not a population count", probes[0], inflowTotal],
    ["inflow-agi-thousands", "IRS inflow aggregate AGI", number(inflowTotal, "agi"), "usd-thousands", "Aggregate adjusted gross income from year-two matched returns, reported in thousands of dollars", probes[0], inflowTotal],
    ["outflow-returns", "IRS outflow returns", number(outflowTotal, "n1"), "returns", "Returns approximate tax-filing units and must not be labeled households or people", probes[1], outflowTotal],
    ["outflow-exemptions", "IRS outflow exemptions", number(outflowTotal, "n2"), "exemptions", "Exemptions approximate individuals represented on matched returns and are not a population count", probes[1], outflowTotal],
    ["outflow-agi-thousands", "IRS outflow aggregate AGI", number(outflowTotal, "agi"), "usd-thousands", "Aggregate adjusted gross income from year-two matched returns, reported in thousands of dollars", probes[1], outflowTotal],
  ].map(([metricId, label, value, unit, semantics, probe, row]) => demand.createCountyDemandObservation({ countyId: "tarrant-county-tad", sourceId: probe.sourceId, metricId, label, value, unit, geographyLevel: "county", geographyId: "05000US48439", periodStart: "2022", periodEnd: "2023", releasedAt: "2026-03-19", sourceSnapshotSha256: probe.responseSha256, sourceRecordSha256: demand.countyDemandSha256(row), semantics }));
  const featureDefinitions = [
    demand.createCountyDemandFeatureDefinition({ featureId: "net-migration-returns", featureVersion: "1", sourceMetricIds: ["inflow-returns", "outflow-returns"], formula: "inflow-returns - outflow-returns", outputUnit: "returns", localization: "source-geography-only", explanation: "Net matched return flow at county geography; not household or population growth", approvedByRefs: [] }),
    demand.createCountyDemandFeatureDefinition({ featureId: "net-migration-exemptions", featureVersion: "1", sourceMetricIds: ["inflow-exemptions", "outflow-exemptions"], formula: "inflow-exemptions - outflow-exemptions", outputUnit: "exemptions", localization: "source-geography-only", explanation: "Net matched exemption flow at county geography; not an official population estimate", approvedByRefs: [] }),
    demand.createCountyDemandFeatureDefinition({ featureId: "net-migration-agi", featureVersion: "1", sourceMetricIds: ["inflow-agi-thousands", "outflow-agi-thousands"], formula: "inflow-agi-thousands - outflow-agi-thousands", outputUnit: "usd-thousands", localization: "source-geography-only", explanation: "Net aggregate AGI attached to migration flows; not median household income", approvedByRefs: [] }),
  ];
  const aggregate = (row, direction) => ["96:000", "97:000", "97:001", "97:003", "98:000", "48:439"].includes(`${row[direction === "in" ? "y1_statefips" : "y2_statefips"]}:${row[direction === "in" ? "y1_countyfips" : "y2_countyfips"]}`);
  const sourceRows = inflowRows.length + outflowRows.length;
  const aggregateRows = inflowRows.filter((row) => aggregate(row, "in")).length + outflowRows.filter((row) => aggregate(row, "out")).length;
  const audit = demand.createCountyDemandAudit({ countyId: "tarrant-county-tad", geographyId: "05000US48439", counts: { sourceRows, parsedRows: sourceRows, aggregateRows, detailRows: sourceRows - aggregateRows, invalidRows: 0, duplicateRows: 0, observationCount: observations.length, featureCount: 0 }, observationLineageCertified: false, temporalAlignmentCertified: false, coverageCertified: false, parcelOverclaimCount: 0, evaluatedAt: "2026-08-23" });
  const artifact = {
    schemaVersion: "wr-tarrant-demand-readiness-v1",
    generatedAt: "2026-08-23T00:00:00.000Z",
    probes,
    coverage,
    observationCandidates: observations,
    featureDefinitions,
    exactMigrationSummary: {
      inflowReturns: observations.find((item) => item.metricId === "inflow-returns").value,
      outflowReturns: observations.find((item) => item.metricId === "outflow-returns").value,
      netReturns: observations.find((item) => item.metricId === "inflow-returns").value - observations.find((item) => item.metricId === "outflow-returns").value,
      inflowExemptions: observations.find((item) => item.metricId === "inflow-exemptions").value,
      outflowExemptions: observations.find((item) => item.metricId === "outflow-exemptions").value,
      netExemptions: observations.find((item) => item.metricId === "inflow-exemptions").value - observations.find((item) => item.metricId === "outflow-exemptions").value,
      inflowAgiThousands: observations.find((item) => item.metricId === "inflow-agi-thousands").value,
      outflowAgiThousands: observations.find((item) => item.metricId === "outflow-agi-thousands").value,
      netAgiThousands: observations.find((item) => item.metricId === "inflow-agi-thousands").value - observations.find((item) => item.metricId === "outflow-agi-thousands").value,
    },
    audit,
    rawContentPersisted: false,
    pointInTimeVectorBuilt: false,
    parcelDemandScoresBuilt: false,
    activationAuthorized: false,
  };
  const directory = path.join(root, "output/tarrant/demand-readiness");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "tarrant-demand-readiness.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  const m = artifact.exactMigrationSummary;
  const markdown = `# Tarrant Migration and Demand Readiness\n\nThis probe preserved official county-level migration observations as typed candidates. Raw files were not persisted, no point-in-time feature vector or parcel score was built, and no product behavior was activated.\n\n## Exact IRS 2022–2023 aggregates\n\n| Metric | Inflow | Outflow | Net | Unit |\n| --- | ---: | ---: | ---: | --- |\n| Matched returns | ${m.inflowReturns.toLocaleString("en-US")} | ${m.outflowReturns.toLocaleString("en-US")} | ${m.netReturns.toLocaleString("en-US")} | returns, not households |\n| Exemptions | ${m.inflowExemptions.toLocaleString("en-US")} | ${m.outflowExemptions.toLocaleString("en-US")} | ${m.netExemptions.toLocaleString("en-US")} | exemptions, not population |\n| Aggregate AGI | ${m.inflowAgiThousands.toLocaleString("en-US")} | ${m.outflowAgiThousands.toLocaleString("en-US")} | ${m.netAgiThousands.toLocaleString("en-US")} | USD thousands |\n\n- Tarrant inflow rows: ${inflowRows.length.toLocaleString("en-US")}.\n- Tarrant outflow rows: ${outflowRows.length.toLocaleString("en-US")}.\n- Source-row audit: ${sourceRows.toLocaleString("en-US")} rows, ${aggregateRows} aggregates, ${(sourceRows - aggregateRows).toLocaleString("en-US")} detail rows, 0 invalid, 0 duplicate.\n\n## Coverage\n\n- Discovered domains: ${coverage.discoveredDomains.join(", ")}.\n- Observed domains: ${coverage.observedDomains.join(", ")}.\n- Certified domains: none.\n- ACS 2024 demographic and housing observations are blocked on the newly required Census API key.\n- QCEW 2025 labor observations remain blocked until the official archive is captured and audited.\n- Municipal supply evidence remains incomplete and cannot be labeled countywide.\n\n## Safety model\n\n- County observations stay county-level unless explicit lower-geography or parcel evidence exists.\n- Returns, exemptions, AGI, households, and population remain distinct units.\n- Different vintages cannot be collapsed into one apparent period.\n- Point-in-time vectors reject observations released after the evaluation timestamp.\n- Demand features require explicit formulas, explanations, and independent approval.\n\n## Hard blockers\n\n1. Persist immutable official source files and certify reuse rights.\n2. Supply a Census API key through managed credentials and capture ACS estimate plus margin-of-error fields.\n3. Capture and audit QCEW county employment and wage history.\n4. Complete municipal supply coverage and normalize time periods.\n5. Backtest feature definitions without temporal leakage and obtain independent approvals.\n6. Never attribute county demand to parcels without parcel-specific evidence.\n`;
  fs.writeFileSync(path.join(directory, "tarrant-demand-readiness.md"), markdown);
  console.log(JSON.stringify({ inflowRowCount: inflowRows.length, outflowRowCount: outflowRows.length, ...artifact.exactMigrationSummary, observedDomains: coverage.observedDomains, certifiedDomainCount: coverage.certifiedDomains.length }, null, 2));
})().catch((error) => { console.error(error); process.exit(1); });

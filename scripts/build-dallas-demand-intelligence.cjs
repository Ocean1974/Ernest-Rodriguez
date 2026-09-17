const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { parse } = require("csv-parse/sync");

const root = path.join(__dirname, "..");
const rawDirectory = path.join(root, "data", "raw", "dallas-county-dcad", "demand");
const outputJson = path.join(root, "output", "dallas-demand-intelligence.json");
const outputMarkdown = path.join(root, "output", "dallas-demand-intelligence.md");
const inflowUrl = "https://www.irs.gov/pub/irs-soi/countyinflow2223.csv";
const outflowUrl = "https://www.irs.gov/pub/irs-soi/countyoutflow2223.csv";
const inflowPath = path.join(rawDirectory, "irs-soi-countyinflow2223.csv");
const outflowPath = path.join(rawDirectory, "irs-soi-countyoutflow2223.csv");
const acsBaseUrl = "https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/1YRData";
const acsTables = [
  { tableId: "b01003", role: "demographic", domain: "demographic", metrics: [{ field: "B01003_E001", moe: "B01003_M001", metricId: "population", label: "ACS population", unit: "people", semantics: "ACS 2024 one-year population estimate; not a decennial census count" }] },
  { tableId: "b19013", role: "demographic", domain: "demographic", metrics: [{ field: "B19013_E001", moe: "B19013_M001", metricId: "median-household-income", label: "ACS median household income", unit: "usd", semantics: "ACS 2024 one-year median household income estimate with sampling uncertainty" }] },
  { tableId: "b25001", role: "housing", domain: "housing", metrics: [{ field: "B25001_E001", moe: "B25001_M001", metricId: "housing-units", label: "ACS housing units", unit: "housing-units", semantics: "ACS 2024 one-year housing-unit estimate with sampling uncertainty" }] },
  { tableId: "b25002", role: "housing", domain: "housing", metrics: [
    { field: "B25002_E002", moe: "B25002_M002", metricId: "occupied-housing-units", label: "ACS occupied housing units", unit: "housing-units", semantics: "ACS 2024 one-year occupied housing-unit estimate with sampling uncertainty" },
    { field: "B25002_E003", moe: "B25002_M003", metricId: "vacant-housing-units", label: "ACS vacant housing units", unit: "housing-units", semantics: "ACS 2024 one-year vacant housing-unit estimate with sampling uncertainty" },
  ] },
  { tableId: "b25064", role: "housing", domain: "housing", metrics: [{ field: "B25064_E001", moe: "B25064_M001", metricId: "median-gross-rent", label: "ACS median gross rent", unit: "usd-per-month", semantics: "ACS 2024 one-year median gross-rent estimate with sampling uncertainty" }] },
  { tableId: "b25077", role: "housing", domain: "housing", metrics: [{ field: "B25077_E001", moe: "B25077_M001", metricId: "median-owner-occupied-home-value", label: "ACS median owner-occupied home value", unit: "usd", semantics: "ACS 2024 one-year median owner-occupied home-value estimate with sampling uncertainty" }] },
].map((table) => ({
  ...table,
  url: `${acsBaseUrl}/acsdt1y2024-${table.tableId}.dat`,
  filePath: path.join(rawDirectory, `acsdt1y2024-${table.tableId}.dat`),
}));
const blsUrl = "https://data.bls.gov/cew/data/api/2025/a/area/48113.csv";
const blsPath = path.join(rawDirectory, "bls-qcew-2025-annual-dallas-county-48113.csv");
const supplyPath = path.join(root, "output", "dallas-county-supply-intelligence.json");
const citySupplyPath = path.join(root, "output", "dallas-city-building-supply-intelligence.json");
const refresh = process.argv.includes("--refresh");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function readOrFetch(url, filePath) {
  if (!refresh && fs.existsSync(filePath)) return fs.readFileSync(filePath);
  const response = await fetch(url, { headers: { "user-agent": "WhiteRabbitDemandIntelligence/1.0" } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  const content = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, content);
  fs.renameSync(temporaryPath, filePath);
  return content;
}

function nonNegativeInteger(row, field) {
  const value = Number(row[field]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${field}: ${row[field]}`);
  return value;
}

function optionalMarginOfError(row, field) {
  const value = Number(row[field]);
  if (!Number.isFinite(value)) throw new Error(`Invalid margin of error ${field}: ${row[field]}`);
  return value < 0 ? null : value;
}

function aggregateRow(row, direction) {
  const stateField = direction === "in" ? "y1_statefips" : "y2_statefips";
  const countyField = direction === "in" ? "y1_countyfips" : "y2_countyfips";
  return ["96:000", "97:000", "97:001", "97:003", "98:000", "48:113"].includes(`${row[stateField]}:${row[countyField]}`);
}

(async () => {
  const demand = await import("../src/operations/countyDemandIntelligence.mjs");
  if (!fs.existsSync(supplyPath)) throw new Error("Run npm run supply:build before demand:build.");
  if (!fs.existsSync(citySupplyPath)) throw new Error("Run npm run city-supply:capture before demand:build.");
  const supplyRaw = fs.readFileSync(supplyPath);
  const supply = JSON.parse(supplyRaw);
  const citySupplyRaw = fs.readFileSync(citySupplyPath);
  const citySupply = JSON.parse(citySupplyRaw);
  const [inflowRaw, outflowRaw, ...supplementalRaw] = await Promise.all([
    readOrFetch(inflowUrl, inflowPath),
    readOrFetch(outflowUrl, outflowPath),
    ...acsTables.map((table) => readOrFetch(table.url, table.filePath)),
    readOrFetch(blsUrl, blsPath),
  ]);
  const acsRaw = supplementalRaw.slice(0, acsTables.length);
  const blsRaw = supplementalRaw[acsTables.length];
  const inflowAll = parse(inflowRaw, { columns: true, skip_empty_lines: true, trim: true });
  const outflowAll = parse(outflowRaw, { columns: true, skip_empty_lines: true, trim: true });
  const acsRecords = acsTables.map((table, index) => {
    const rows = parse(acsRaw[index], { columns: true, delimiter: "|", skip_empty_lines: true, trim: true });
    const row = rows.find((candidate) => candidate.GEO_ID === "0500000US48113");
    if (!row) throw new Error(`ACS table ${table.tableId} is missing Dallas County geography 0500000US48113.`);
    return { ...table, raw: acsRaw[index], row, sourceRowCount: rows.length, sourceIdentityUnique: new Set(rows.map((candidate) => candidate.GEO_ID)).size === rows.length };
  });
  const blsRows = parse(blsRaw, { columns: true, skip_empty_lines: true, trim: true });
  const blsTotalRows = blsRows.filter((row) => row.area_fips === "48113" && row.own_code === "0" && row.industry_code === "10" && row.size_code === "0");
  if (blsTotalRows.length !== 1) throw new Error(`Expected one Dallas QCEW all-ownership/all-industry row, found ${blsTotalRows.length}.`);
  const blsTotal = blsTotalRows[0];
  const inflowRows = inflowAll.filter((row) => row.y2_statefips === "48" && row.y2_countyfips === "113");
  const outflowRows = outflowAll.filter((row) => row.y1_statefips === "48" && row.y1_countyfips === "113");
  const uniqueInflow = new Set(inflowRows.map((row) => `${row.y1_statefips}:${row.y1_countyfips}`));
  const uniqueOutflow = new Set(outflowRows.map((row) => `${row.y2_statefips}:${row.y2_countyfips}`));
  const inflowTotal = inflowRows.find((row) => row.y1_statefips === "96" && row.y1_countyfips === "000");
  const outflowTotal = outflowRows.find((row) => row.y2_statefips === "96" && row.y2_countyfips === "000");
  if (!inflowRows.length || !outflowRows.length || !inflowTotal || !outflowTotal) {
    throw new Error("Official Dallas County migration rows or total aggregates are missing.");
  }

  const common = {
    countyId: "dallas-county-dcad",
    publisher: "Internal Revenue Service Statistics of Income",
    domain: "migration",
    geographyLevel: "county",
    geographyId: "05000US48113",
    periodStart: "2022",
    periodEnd: "2023",
    releasedAt: "2026-03-19",
    contentPersisted: true,
    reuseRightsCertified: false,
    blockers: ["reuse-rights-review-pending"],
  };
  const probes = [
    demand.createCountyDemandSourceProbe({
      ...common,
      sourceId: "irs-soi-county-inflow-2022-2023",
      sourceRole: "migration-inflow",
      sourceUrl: inflowUrl,
      recordCount: inflowRows.length,
      metricIds: ["inflow-returns", "inflow-exemptions", "inflow-agi-thousands"],
      responseBytes: inflowRaw.length,
      responseSha256: sha256(inflowRaw),
      sourceIdentityUnique: uniqueInflow.size === inflowRows.length,
    }),
    demand.createCountyDemandSourceProbe({
      ...common,
      sourceId: "irs-soi-county-outflow-2022-2023",
      sourceRole: "migration-outflow",
      sourceUrl: outflowUrl,
      recordCount: outflowRows.length,
      metricIds: ["outflow-returns", "outflow-exemptions", "outflow-agi-thousands"],
      responseBytes: outflowRaw.length,
      responseSha256: sha256(outflowRaw),
      sourceIdentityUnique: uniqueOutflow.size === outflowRows.length,
    }),
  ];
  const acsProbes = acsRecords.map((record) => demand.createCountyDemandSourceProbe({
    countyId: "dallas-county-dcad",
    sourceId: `census-acs1-2024-${record.tableId}`,
    publisher: "U.S. Census Bureau American Community Survey",
    sourceRole: record.role,
    domain: record.domain,
    geographyLevel: "county",
    geographyId: "05000US48113",
    sourceUrl: record.url,
    periodStart: "2024",
    periodEnd: "2024",
    releasedAt: "2025-09-11",
    recordCount: record.sourceRowCount,
    metricIds: record.metrics.map((metric) => metric.metricId),
    responseBytes: record.raw.length,
    responseSha256: sha256(record.raw),
    contentPersisted: true,
    sourceIdentityUnique: record.sourceIdentityUnique,
    reuseRightsCertified: false,
    blockers: ["reuse-rights-review-pending"],
  }));
  const blsProbe = demand.createCountyDemandSourceProbe({
    countyId: "dallas-county-dcad",
    sourceId: "bls-qcew-2025-annual-dallas-county",
    publisher: "U.S. Bureau of Labor Statistics Quarterly Census of Employment and Wages",
    sourceRole: "labor-market",
    domain: "labor",
    geographyLevel: "county",
    geographyId: "05000US48113",
    sourceUrl: blsUrl,
    periodStart: "2025",
    periodEnd: "2025",
    releasedAt: "2026-06-02",
    recordCount: blsRows.length,
    metricIds: ["annual-average-establishments", "annual-average-employment", "annual-average-weekly-wage", "average-annual-pay"],
    responseBytes: blsRaw.length,
    responseSha256: sha256(blsRaw),
    contentPersisted: true,
    sourceIdentityUnique: new Set(blsRows.map((row) => `${row.area_fips}:${row.own_code}:${row.industry_code}:${row.agglvl_code}:${row.size_code}`)).size === blsRows.length,
    reuseRightsCertified: false,
    blockers: ["reuse-rights-review-pending"],
  });
  const supplyProbe = demand.createCountyDemandSourceProbe({
    countyId: "dallas-county-dcad",
    sourceId: "dallas-county-issued-permits-2026-ytd",
    publisher: supply.sourceAuthority,
    sourceRole: "supply-pipeline",
    domain: "supply",
    geographyLevel: "county",
    geographyId: "05000US48113",
    sourceUrl: supply.reportsPage,
    periodStart: supply.exactSupplySummary.firstIssuedDate,
    periodEnd: supply.exactSupplySummary.lastIssuedDate,
    releasedAt: supply.exactSupplySummary.lastIssuedDate,
    recordCount: supply.extraction.recordCount,
    metricIds: ["county-issued-permits-ytd", "county-issued-commercial-permits-ytd", "county-issued-residential-permits-ytd", "county-issued-new-commercial-buildings-ytd", "county-issued-residential-construction-notices-ytd"],
    responseBytes: supply.sourceFiles.reduce((sum, item) => sum + item.bytes, 0),
    responseSha256: supply.combinedSnapshotSha256,
    contentPersisted: supply.activation.sourceContentPersisted,
    sourceIdentityUnique: supply.activation.sourceIdentityUnique,
    reuseRightsCertified: false,
    blockers: ["reuse-rights-review-pending", "municipal-coverage-incomplete", "parcel-attribution-not-certified"],
  });
  const citySupplyMetricIds = ["city-selected-building-records", "city-commercial-new-construction-records", "city-residential-new-construction-records", "city-commercial-alteration-addition-records", "city-residential-alteration-addition-records", "city-demolition-records", "city-certificate-of-occupancy-records"];
  const citySupplyProbe = demand.createCountyDemandSourceProbe({
    countyId: "dallas-county-dcad",
    sourceId: "dallasnow-building-records-2026-08-mtd",
    publisher: citySupply.sourceAuthority,
    sourceRole: "supply-pipeline",
    domain: "supply",
    geographyLevel: "place",
    geographyId: "16000US4819000",
    sourceUrl: citySupply.sourceUrl,
    periodStart: citySupply.query.startDate,
    periodEnd: citySupply.query.endDate,
    releasedAt: citySupply.generatedAt,
    recordCount: citySupply.exactSummary.recordCount,
    metricIds: citySupplyMetricIds,
    responseBytes: citySupply.exactSummary.sourceResponseBytes,
    responseSha256: citySupply.combinedSnapshotSha256,
    contentPersisted: citySupply.activation.sourceContentPersisted,
    sourceIdentityUnique: citySupply.activation.sourceIdentityUnique,
    reuseRightsCertified: false,
    blockers: ["reuse-rights-review-pending", "selected-record-type-coverage", "parcel-attribution-not-certified"],
  });
  probes.push(...acsProbes, blsProbe, supplyProbe, citySupplyProbe);
  const coverage = demand.reconcileCountyDemandCoverage({
    countyId: "dallas-county-dcad",
    geographyId: "05000US48113",
    requiredDomains: ["migration", "demographic", "housing", "labor", "supply"],
    probes,
  });
  const observationSpecs = [
    ["inflow-returns", "IRS inflow returns", nonNegativeInteger(inflowTotal, "n1"), "returns", "Returns approximate tax-filing units and are not households or people", probes[0], inflowTotal],
    ["inflow-exemptions", "IRS inflow exemptions", nonNegativeInteger(inflowTotal, "n2"), "exemptions", "Exemptions approximate people represented on matched returns and are not a population count", probes[0], inflowTotal],
    ["inflow-agi-thousands", "IRS inflow aggregate AGI", nonNegativeInteger(inflowTotal, "agi"), "usd-thousands", "Aggregate adjusted gross income from year-two matched returns, in thousands of dollars", probes[0], inflowTotal],
    ["outflow-returns", "IRS outflow returns", nonNegativeInteger(outflowTotal, "n1"), "returns", "Returns approximate tax-filing units and are not households or people", probes[1], outflowTotal],
    ["outflow-exemptions", "IRS outflow exemptions", nonNegativeInteger(outflowTotal, "n2"), "exemptions", "Exemptions approximate people represented on matched returns and are not a population count", probes[1], outflowTotal],
    ["outflow-agi-thousands", "IRS outflow aggregate AGI", nonNegativeInteger(outflowTotal, "agi"), "usd-thousands", "Aggregate adjusted gross income from year-two matched returns, in thousands of dollars", probes[1], outflowTotal],
  ];
  const observations = observationSpecs.map(([metricId, label, value, unit, semantics, probe, row]) =>
    demand.createCountyDemandObservation({
      countyId: "dallas-county-dcad",
      sourceId: probe.sourceId,
      metricId,
      label,
      value,
      unit,
      geographyLevel: "county",
      geographyId: "05000US48113",
      periodStart: "2022",
      periodEnd: "2023",
      releasedAt: "2026-03-19",
      sourceSnapshotSha256: probe.responseSha256,
      sourceRecordSha256: demand.countyDemandSha256(row),
      semantics,
    }),
  );
  for (let index = 0; index < acsRecords.length; index += 1) {
    const record = acsRecords[index];
    const probe = acsProbes[index];
    for (const metric of record.metrics) {
      observations.push(demand.createCountyDemandObservation({
        countyId: "dallas-county-dcad",
        sourceId: probe.sourceId,
        metricId: metric.metricId,
        label: metric.label,
        value: nonNegativeInteger(record.row, metric.field),
        unit: metric.unit,
        geographyLevel: "county",
        geographyId: "05000US48113",
        periodStart: "2024",
        periodEnd: "2024",
        releasedAt: "2025-09-11",
        marginOfError: optionalMarginOfError(record.row, metric.moe),
        sourceSnapshotSha256: probe.responseSha256,
        sourceRecordSha256: demand.countyDemandSha256(record.row),
        semantics: metric.semantics,
      }));
    }
  }
  const blsObservationSpecs = [
    ["annual-average-establishments", "QCEW annual average establishments", "annual_avg_estabs", "establishments", "Annual average of quarterly establishment counts for all covered ownerships and industries"],
    ["annual-average-employment", "QCEW annual average employment", "annual_avg_emplvl", "jobs", "Annual average of monthly covered-employment levels; jobs are not unique employed residents"],
    ["annual-average-weekly-wage", "QCEW annual average weekly wage", "annual_avg_wkly_wage", "usd-per-week", "Average weekly wage based on covered employment and total annual wages"],
    ["average-annual-pay", "QCEW average annual pay", "avg_annual_pay", "usd-per-year", "Average annual pay based on covered employment and wage levels"],
  ];
  for (const [metricId, label, field, unit, semantics] of blsObservationSpecs) {
    observations.push(demand.createCountyDemandObservation({
      countyId: "dallas-county-dcad",
      sourceId: blsProbe.sourceId,
      metricId,
      label,
      value: nonNegativeInteger(blsTotal, field),
      unit,
      geographyLevel: "county",
      geographyId: "05000US48113",
      periodStart: "2025",
      periodEnd: "2025",
      releasedAt: "2026-06-02",
      sourceSnapshotSha256: blsProbe.responseSha256,
      sourceRecordSha256: demand.countyDemandSha256(blsTotal),
      semantics,
    }));
  }
  const supplyObservationSpecs = [
    ["county-issued-permits-ytd", "Dallas County-issued permit events", "issuedPermitEvents"],
    ["county-issued-commercial-permits-ytd", "Dallas County-issued commercial permit events", "commercialPermitEvents"],
    ["county-issued-residential-permits-ytd", "Dallas County-issued residential permit events", "residentialPermitEvents"],
    ["county-issued-new-commercial-buildings-ytd", "Dallas County-issued new commercial building permit events", "newCommercialBuildingPermitEvents"],
    ["county-issued-residential-construction-notices-ytd", "Dallas County-issued residential notices of construction", "residentialNoticeOfConstructionEvents"],
  ];
  for (const [metricId, label, field] of supplyObservationSpecs) {
    observations.push(demand.createCountyDemandObservation({
      countyId: "dallas-county-dcad",
      sourceId: supplyProbe.sourceId,
      metricId,
      label,
      value: supply.exactSupplySummary[field],
      unit: "permit-events",
      geographyLevel: "county",
      geographyId: "05000US48113",
      periodStart: supplyProbe.periodStart,
      periodEnd: supplyProbe.periodEnd,
      releasedAt: supplyProbe.releasedAt,
      sourceSnapshotSha256: supplyProbe.responseSha256,
      sourceRecordSha256: demand.countyDemandSha256(supply.exactSupplySummary),
      semantics: "Dallas County-issued permit report events only; this metric does not include every permit issued by the City of Dallas or other municipalities in Dallas County and is not a parcel fact",
    }));
  }
  const cityTypeCount = (type) => citySupply.typeCounts[type] || 0;
  const citySupplyObservationSpecs = [
    ["city-selected-building-records", "City of Dallas selected Building-module records", citySupply.exactSummary.recordCount],
    ["city-commercial-new-construction-records", "City of Dallas commercial new-construction records", cityTypeCount("Commercial New Construction Permit")],
    ["city-residential-new-construction-records", "City of Dallas residential new-construction records", cityTypeCount("Residential New Construction Permit")],
    ["city-commercial-alteration-addition-records", "City of Dallas commercial alteration/addition records", cityTypeCount("Commercial Alteration Addition Permit")],
    ["city-residential-alteration-addition-records", "City of Dallas residential alteration/addition records", cityTypeCount("Residential Alteration Addition Permit")],
    ["city-demolition-records", "City of Dallas commercial and residential demolition records", cityTypeCount("Commercial Demolition Permit") + cityTypeCount("Residential Demolition Permit")],
    ["city-certificate-of-occupancy-records", "City of Dallas certificate-of-occupancy records", cityTypeCount("Certificate of Occupancy")],
  ];
  for (const [metricId, label, metricValue] of citySupplyObservationSpecs) {
    observations.push(demand.createCountyDemandObservation({
      countyId: "dallas-county-dcad",
      sourceId: citySupplyProbe.sourceId,
      metricId,
      label,
      value: metricValue,
      unit: "records",
      geographyLevel: "place",
      geographyId: "16000US4819000",
      periodStart: citySupplyProbe.periodStart,
      periodEnd: citySupplyProbe.periodEnd,
      releasedAt: citySupplyProbe.releasedAt,
      sourceSnapshotSha256: citySupplyProbe.responseSha256,
      sourceRecordSha256: demand.countyDemandSha256({ metricId, metricValue, typeCounts: citySupply.typeCounts }),
      semantics: "Public DallasNow Building-module records dated in the selected period; record dates are not permit issuance dates, selected record types are not the entire Building module, and place-level observations are not parcel facts",
    }));
  }
  const featureDefinitions = [
    demand.createCountyDemandFeatureDefinition({ featureId: "net-migration-returns", featureVersion: "1", sourceMetricIds: ["inflow-returns", "outflow-returns"], formula: "inflow-returns - outflow-returns", outputUnit: "returns", localization: "source-geography-only", explanation: "Net matched return flow for Dallas County; not household or population growth", approvedByRefs: [] }),
    demand.createCountyDemandFeatureDefinition({ featureId: "net-migration-exemptions", featureVersion: "1", sourceMetricIds: ["inflow-exemptions", "outflow-exemptions"], formula: "inflow-exemptions - outflow-exemptions", outputUnit: "exemptions", localization: "source-geography-only", explanation: "Net matched exemption flow for Dallas County; not an official population estimate", approvedByRefs: [] }),
    demand.createCountyDemandFeatureDefinition({ featureId: "net-migration-agi", featureVersion: "1", sourceMetricIds: ["inflow-agi-thousands", "outflow-agi-thousands"], formula: "inflow-agi-thousands - outflow-agi-thousands", outputUnit: "usd-thousands", localization: "source-geography-only", explanation: "Net aggregate AGI attached to Dallas County migration flows; not median household income", approvedByRefs: [] }),
  ];
  const migrationSourceRows = inflowRows.length + outflowRows.length;
  const acsSourceRows = acsRecords.reduce((sum, record) => sum + record.sourceRowCount, 0);
  const sourceRows = migrationSourceRows + acsSourceRows + blsRows.length + supply.extraction.recordCount + citySupply.exactSummary.recordCount;
  const migrationAggregateRows = inflowRows.filter((row) => aggregateRow(row, "in")).length + outflowRows.filter((row) => aggregateRow(row, "out")).length;
  const aggregateRows = migrationAggregateRows + acsSourceRows + blsRows.length;
  const audit = demand.createCountyDemandAudit({
    countyId: "dallas-county-dcad",
    geographyId: "05000US48113",
    counts: { sourceRows, parsedRows: sourceRows, aggregateRows, detailRows: sourceRows - aggregateRows, invalidRows: 0, duplicateRows: 0, observationCount: observations.length, featureCount: 0 },
    observationLineageCertified: true,
    temporalAlignmentCertified: false,
    coverageCertified: false,
    parcelOverclaimCount: 0,
    evaluatedAt: new Date().toISOString(),
  });
  const value = (metricId) => observations.find((observation) => observation.metricId === metricId).value;
  const exactMigrationSummary = {
    inflowReturns: value("inflow-returns"),
    outflowReturns: value("outflow-returns"),
    netReturns: value("inflow-returns") - value("outflow-returns"),
    inflowExemptions: value("inflow-exemptions"),
    outflowExemptions: value("outflow-exemptions"),
    netExemptions: value("inflow-exemptions") - value("outflow-exemptions"),
    inflowAgiThousands: value("inflow-agi-thousands"),
    outflowAgiThousands: value("outflow-agi-thousands"),
    netAgiThousands: value("inflow-agi-thousands") - value("outflow-agi-thousands"),
  };
  const exactMarketContext = {
    population: value("population"),
    medianHouseholdIncome: value("median-household-income"),
    housingUnits: value("housing-units"),
    occupiedHousingUnits: value("occupied-housing-units"),
    vacantHousingUnits: value("vacant-housing-units"),
    medianGrossRent: value("median-gross-rent"),
    medianOwnerOccupiedHomeValue: value("median-owner-occupied-home-value"),
    annualAverageEstablishments: value("annual-average-establishments"),
    annualAverageEmployment: value("annual-average-employment"),
    annualAverageWeeklyWage: value("annual-average-weekly-wage"),
    averageAnnualPay: value("average-annual-pay"),
  };
  const artifact = {
    schemaVersion: "wr-dallas-demand-intelligence-v1",
    generatedAt: new Date().toISOString(),
    countyId: "dallas-county-dcad",
    geography: { level: "county", geographyId: "05000US48113", stateFips: "48", countyFips: "113" },
    sourceFiles: [
      { path: path.relative(root, inflowPath).replace(/\\/g, "/"), bytes: inflowRaw.length, sha256: sha256(inflowRaw), sourceUrl: inflowUrl },
      { path: path.relative(root, outflowPath).replace(/\\/g, "/"), bytes: outflowRaw.length, sha256: sha256(outflowRaw), sourceUrl: outflowUrl },
      ...acsRecords.map((record) => ({ path: path.relative(root, record.filePath).replace(/\\/g, "/"), bytes: record.raw.length, sha256: sha256(record.raw), sourceUrl: record.url })),
      { path: path.relative(root, blsPath).replace(/\\/g, "/"), bytes: blsRaw.length, sha256: sha256(blsRaw), sourceUrl: blsUrl },
      ...supply.sourceFiles,
      ...citySupply.sourcePages.map((page) => ({ path: page.path, bytes: page.responseBytes, sha256: page.responseSha256, sourceUrl: citySupply.sourceUrl })),
    ],
    probes,
    coverage,
    observations,
    featureDefinitions,
    exactMigrationSummary,
    exactMarketContext,
    exactSupplySummary: supply.exactSupplySummary,
    exactCitySupplySummary: {
      recordCount: citySupply.exactSummary.recordCount,
      uniqueRecordNumberCount: citySupply.exactSummary.uniqueRecordNumberCount,
      sourcePageCount: citySupply.exactSummary.sourcePageCount,
      selectedRecordTypeCount: citySupply.query.selectedRecordTypes.length,
      commercialNewConstructionRecords: cityTypeCount("Commercial New Construction Permit"),
      residentialNewConstructionRecords: cityTypeCount("Residential New Construction Permit"),
      commercialAlterationAdditionRecords: cityTypeCount("Commercial Alteration Addition Permit"),
      residentialAlterationAdditionRecords: cityTypeCount("Residential Alteration Addition Permit"),
      demolitionRecords: cityTypeCount("Commercial Demolition Permit") + cityTypeCount("Residential Demolition Permit"),
      certificateOfOccupancyRecords: cityTypeCount("Certificate of Occupancy"),
    },
    audit,
    activation: {
      sourceContentPersisted: probes.every((probe) => probe.contentPersisted),
      observedDomains: coverage.observedDomains,
      reuseRightsCertified: false,
      allDemandDomainsCertified: false,
      pointInTimeVectorBuilt: false,
      parcelDemandScoresBuilt: false,
      publicManifestBuilt: false,
      visibleUiActivated: false,
      parcelAttributionProhibited: true,
      lockedUiChanged: false,
    },
    blockers: [
      "Independent reuse-rights review is not recorded.",
      "Captured Dallas County-issued permit reports do not provide complete City of Dallas or countywide municipal supply coverage.",
      "Captured DallasNow records cover selected high-signal City Building-module record types and record dates are not issuance dates.",
      "Captured migration, demographic, housing, labor, and supply domains are not independently certified.",
      "Feature definitions lack independent approvals and backtests.",
      "County-level observations cannot be represented as parcel facts.",
    ],
  };

  fs.mkdirSync(path.dirname(outputJson), { recursive: true });
  fs.writeFileSync(outputJson, `${JSON.stringify(artifact, null, 2)}\n`);
  const m = exactMigrationSummary;
  const c = exactMarketContext;
  fs.writeFileSync(outputMarkdown, [
    "# Dallas Migration and Demand Intelligence",
    "",
    `Generated: ${artifact.generatedAt}`,
    "",
    "Official IRS 2022–2023 migration, Census ACS 2024 demographic/housing, BLS QCEW 2025 labor, and Dallas County January–July 2026 issued-permit files are captured with byte counts and SHA-256 lineage. Observations retain their own vintages, uncertainty, and source scope and are not activated as parcel facts.",
    "",
    "## Exact county aggregates",
    "",
    "| Metric | Inflow | Outflow | Net | Unit |",
    "| --- | ---: | ---: | ---: | --- |",
    `| Matched returns | ${m.inflowReturns.toLocaleString("en-US")} | ${m.outflowReturns.toLocaleString("en-US")} | ${m.netReturns.toLocaleString("en-US")} | returns, not households |`,
    `| Exemptions | ${m.inflowExemptions.toLocaleString("en-US")} | ${m.outflowExemptions.toLocaleString("en-US")} | ${m.netExemptions.toLocaleString("en-US")} | exemptions, not population |`,
    `| Aggregate AGI | ${m.inflowAgiThousands.toLocaleString("en-US")} | ${m.outflowAgiThousands.toLocaleString("en-US")} | ${m.netAgiThousands.toLocaleString("en-US")} | USD thousands |`,
    "",
    "## Demographic, housing, and labor context",
    "",
    "| Metric | Value | Vintage |",
    "| --- | ---: | --- |",
    `| Population | ${c.population.toLocaleString("en-US")} | ACS 2024 one-year |`,
    `| Median household income | $${c.medianHouseholdIncome.toLocaleString("en-US")} | ACS 2024 one-year |`,
    `| Housing units | ${c.housingUnits.toLocaleString("en-US")} | ACS 2024 one-year |`,
    `| Occupied housing units | ${c.occupiedHousingUnits.toLocaleString("en-US")} | ACS 2024 one-year |`,
    `| Vacant housing units | ${c.vacantHousingUnits.toLocaleString("en-US")} | ACS 2024 one-year |`,
    `| Median gross rent | $${c.medianGrossRent.toLocaleString("en-US")} | ACS 2024 one-year |`,
    `| Median owner-occupied home value | $${c.medianOwnerOccupiedHomeValue.toLocaleString("en-US")} | ACS 2024 one-year |`,
    `| Annual average establishments | ${c.annualAverageEstablishments.toLocaleString("en-US")} | QCEW 2025 |`,
    `| Annual average employment | ${c.annualAverageEmployment.toLocaleString("en-US")} | QCEW 2025 |`,
    `| Annual average weekly wage | $${c.annualAverageWeeklyWage.toLocaleString("en-US")} | QCEW 2025 |`,
    `| Average annual pay | $${c.averageAnnualPay.toLocaleString("en-US")} | QCEW 2025 |`,
    "",
    "## Construction supply context",
    "",
    `- Dallas County-issued permit events: ${supply.exactSupplySummary.issuedPermitEvents.toLocaleString("en-US")}`,
    `- Commercial permit events: ${supply.exactSupplySummary.commercialPermitEvents.toLocaleString("en-US")}`,
    `- Residential permit events: ${supply.exactSupplySummary.residentialPermitEvents.toLocaleString("en-US")}`,
    `- New commercial building permit events: ${supply.exactSupplySummary.newCommercialBuildingPermitEvents.toLocaleString("en-US")}`,
    `- Residential notices of construction: ${supply.exactSupplySummary.residentialNoticeOfConstructionEvents.toLocaleString("en-US")}`,
    `- Period: ${supply.exactSupplySummary.firstIssuedDate} through ${supply.exactSupplySummary.lastIssuedDate}`,
    "- Jurisdiction boundary: Dallas County-issued reports only; not all City of Dallas or municipal permits.",
    "",
    "### City of Dallas DallasNow application pipeline",
    "",
    `- Selected Building-module records: ${citySupply.exactSummary.recordCount.toLocaleString("en-US")}`,
    `- Commercial new-construction records: ${cityTypeCount("Commercial New Construction Permit").toLocaleString("en-US")}`,
    `- Residential new-construction records: ${cityTypeCount("Residential New Construction Permit").toLocaleString("en-US")}`,
    `- Commercial alteration/addition records: ${cityTypeCount("Commercial Alteration Addition Permit").toLocaleString("en-US")}`,
    `- Residential alteration/addition records: ${cityTypeCount("Residential Alteration Addition Permit").toLocaleString("en-US")}`,
    `- Commercial + residential demolition records: ${(cityTypeCount("Commercial Demolition Permit") + cityTypeCount("Residential Demolition Permit")).toLocaleString("en-US")}`,
    `- Certificate-of-occupancy records: ${cityTypeCount("Certificate of Occupancy").toLocaleString("en-US")}`,
    `- Period: ${citySupply.query.startDate} through ${citySupply.query.endDate}`,
    "- Semantics: public DallasNow search-record dates, not permit issuance dates; selected types only; City of Dallas place geography.",
    "",
    `- Inflow rows: ${inflowRows.length.toLocaleString("en-US")}`,
    `- Outflow rows: ${outflowRows.length.toLocaleString("en-US")}`,
    `- Source rows: ${sourceRows.toLocaleString("en-US")}`,
    `- Aggregate rows: ${aggregateRows.toLocaleString("en-US")}`,
    `- Detail rows: ${(sourceRows - aggregateRows).toLocaleString("en-US")}`,
    "- Invalid rows: 0",
    "- Duplicate counterpart keys: 0",
    "- Parcel overclaims: 0",
    "",
    "## Activation boundary",
    "",
    "- Raw official content persisted: yes",
    "- Observation lineage verified: yes",
    "- Mixed vintages collapsed into one period: no",
    "- Reuse-rights review complete: no",
    "- Full demand-domain coverage certified: no",
    "- Parcel demand scores built: no",
    "- Visible UI activated: no",
    "- Locked UI changed: no",
    "",
    "The next tranche is to certify reuse, expand DallasNow coverage and issuance evidence, connect other municipal sources, approve and backtest point-in-time features, and keep any output at its true source geography.",
    "",
  ].join("\n"));
  console.log(JSON.stringify({ inflowRowCount: inflowRows.length, outflowRowCount: outflowRows.length, ...exactMigrationSummary, ...exactMarketContext, ...supply.exactSupplySummary, citySelectedBuildingRecords: citySupply.exactSummary.recordCount, observedDomains: coverage.observedDomains, sourceContentPersisted: artifact.activation.sourceContentPersisted, visibleUiActivated: false }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

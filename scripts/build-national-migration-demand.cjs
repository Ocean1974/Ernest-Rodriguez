const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const { parse } = require("csv-parse/sync");

const root = path.resolve(__dirname, "..");
const rawRoot = path.join(root, "data", "raw", "national-migration-demand");
const publicRoot = path.join(root, "public", "data", "national", "migration-demand");
const countyPublicRoot = path.join(root, "public", "data", "counties");
const outputRoot = path.join(root, "output", "national-migration-demand");
const universeFile = path.join(root, "data", "national-county-intelligence", "us-county-universe.json");
const refresh = process.argv.includes("--refresh");
const acsBase = "https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData";
const gazetteerBase = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer";

const tables = [
  { id: "b01003", fields: ["B01003_E001", "B01003_M001"] },
  { id: "b07003", fields: ["B07003_E001", "B07003_M001", "B07003_E004", "B07003_M004", "B07003_E007", "B07003_M007", "B07003_E010", "B07003_M010", "B07003_E013", "B07003_M013", "B07003_E016", "B07003_M016"] },
  { id: "b19013", fields: ["B19013_E001", "B19013_M001"] },
  { id: "b25001", fields: ["B25001_E001", "B25001_M001"] },
  { id: "b25002", fields: ["B25002_E002", "B25002_M002", "B25002_E003", "B25002_M003"] },
  { id: "b25064", fields: ["B25064_E001", "B25064_M001"] },
  { id: "b25077", fields: ["B25077_E001", "B25077_M001"] },
].map((table) => ({ ...table, url: `${acsBase}/acsdt5y2024-${table.id}.dat`, file: path.join(rawRoot, `acsdt5y2024-${table.id}.dat`) }));

const irsSources = [
  { id: "irs-soi-county-inflow-2022-2023", role: "inflow", url: "https://www.irs.gov/pub/irs-soi/countyinflow2223.csv", file: path.join(rawRoot, "irs-soi-countyinflow2223.csv"), fallback: path.join(root, "data", "raw", "dallas-county-dcad", "demand", "irs-soi-countyinflow2223.csv") },
  { id: "irs-soi-county-outflow-2022-2023", role: "outflow", url: "https://www.irs.gov/pub/irs-soi/countyoutflow2223.csv", file: path.join(rawRoot, "irs-soi-countyoutflow2223.csv"), fallback: path.join(root, "data", "raw", "dallas-county-dcad", "demand", "irs-soi-countyoutflow2223.csv") },
];

function assertWorkspace(target) {
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Path escapes workspace: ${resolved}`);
}
function ensureDir(dir) { assertWorkspace(dir); fs.mkdirSync(dir, { recursive: true }); }
function writeJson(file, value, pretty = false) {
  assertWorkspace(file); ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
  fs.renameSync(temporary, file);
}
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > -100000000 ? number : null;
}
function ratio(numerator, denominator) { return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0 ? numerator / denominator : null; }
function round(value, digits = 4) { return Number.isFinite(value) ? Number(value.toFixed(digits)) : null; }

async function capture(source) {
  ensureDir(path.dirname(source.file));
  if (!refresh && fs.existsSync(source.file)) return fs.readFileSync(source.file);
  if (!refresh && source.fallback && fs.existsSync(source.fallback)) {
    fs.copyFileSync(source.fallback, source.file);
    return fs.readFileSync(source.file);
  }
  const response = await fetch(source.url, { signal: AbortSignal.timeout(900000), headers: { "user-agent": "RealEstateSavantNationalDemand/1.0" } });
  if (!response.ok || !response.body) throw new Error(`${source.url} returned HTTP ${response.status}`);
  const temporary = `${source.file}.${process.pid}.tmp`;
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary));
  fs.renameSync(temporary, source.file);
  return fs.readFileSync(source.file);
}

function geography(row) {
  const geoId = String(row.GEO_ID || "");
  if (/^0500000US\d{5}$/.test(geoId)) { const id = geoId.slice(-5); return { level: "county", id, stateFips: id.slice(0, 2) }; }
  if (/^1600000US\d{7}$/.test(geoId)) { const id = geoId.slice(-7); return { level: "place", id, stateFips: id.slice(0, 2) }; }
  return null;
}

function parseTables(rawById) {
  const records = new Map();
  for (const table of tables) {
    const rows = parse(rawById.get(table.id), { columns: true, delimiter: "|", skip_empty_lines: true, relax_column_count: true, trim: true });
    for (const row of rows) {
      const geo = geography(row);
      if (!geo) continue;
      const key = `${geo.level}:${geo.id}`;
      const record = records.get(key) || { geographyLevel: geo.level, geographyId: geo.id, stateFips: geo.stateFips, name: String(row.NAME || "").trim(), values: {} };
      if (!record.name) record.name = String(row.NAME || "").trim();
      for (const field of table.fields) record.values[field] = numeric(row[field]);
      records.set(key, record);
    }
  }
  return records;
}

function totalMigrationRow(row, role) {
  const stateField = role === "inflow" ? "y1_statefips" : "y2_statefips";
  const countyField = role === "inflow" ? "y1_countyfips" : "y2_countyfips";
  return row[stateField] === "96" && row[countyField] === "000";
}

function parseIrs(raw, role) {
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true });
  const result = new Map();
  for (const row of rows) {
    if (!totalMigrationRow(row, role)) continue;
    const state = row[role === "inflow" ? "y2_statefips" : "y1_statefips"];
    const county = row[role === "inflow" ? "y2_countyfips" : "y1_countyfips"];
    if (!/^\d{2}$/.test(state) || !/^\d{3}$/.test(county)) continue;
    result.set(`${state}${county}`, { returns: numeric(row.n1), exemptions: numeric(row.n2), agiThousands: numeric(row.agi) });
  }
  return result;
}

function baseRecord(record, irsInflow, irsOutflow) {
  const v = record.values;
  const mobilityPopulation = v.B07003_E001;
  const sameHouse = v.B07003_E004;
  const movedWithinCounty = v.B07003_E007;
  const movedDifferentCountySameState = v.B07003_E010;
  const movedDifferentState = v.B07003_E013;
  const movedFromAbroad = v.B07003_E016;
  const externalInMovers = [movedDifferentCountySameState, movedDifferentState, movedFromAbroad].every(Number.isFinite)
    ? movedDifferentCountySameState + movedDifferentState + movedFromAbroad : null;
  const totalMovers = Number.isFinite(mobilityPopulation) && Number.isFinite(sameHouse) ? mobilityPopulation - sameHouse : null;
  const housingUnits = v.B25001_E001;
  const occupiedHousingUnits = v.B25002_E002;
  const vacantHousingUnits = v.B25002_E003;
  const inflow = record.geographyLevel === "county" ? irsInflow.get(record.geographyId) : null;
  const outflow = record.geographyLevel === "county" ? irsOutflow.get(record.geographyId) : null;
  const net = (field) => Number.isFinite(inflow?.[field]) && Number.isFinite(outflow?.[field]) ? inflow[field] - outflow[field] : null;
  return {
    schemaVersion: "wr-national-migration-demand-geography-v1",
    geographyLevel: record.geographyLevel,
    geographyId: record.geographyId,
    stateFips: record.stateFips,
    name: record.name,
    periods: { acs: "2020-2024 ACS 5-year", irsMigration: inflow && outflow ? "2022-2023 IRS SOI" : null },
    metrics: {
      population: v.B01003_E001,
      mobilityPopulation,
      sameHouse,
      totalMovers,
      movedWithinCounty,
      movedDifferentCountySameState,
      movedDifferentState,
      movedFromAbroad,
      externalInMovers,
      recentMoverRate: round(ratio(totalMovers, mobilityPopulation)),
      externalInMoverRate: round(ratio(externalInMovers, mobilityPopulation)),
      medianHouseholdIncome: v.B19013_E001,
      housingUnits,
      occupiedHousingUnits,
      vacantHousingUnits,
      occupancyRate: round(ratio(occupiedHousingUnits, housingUnits)),
      vacancyRate: round(ratio(vacantHousingUnits, housingUnits)),
      medianGrossRent: v.B25064_E001,
      medianOwnerOccupiedHomeValue: v.B25077_E001,
      irsInflowReturns: inflow?.returns ?? null,
      irsOutflowReturns: outflow?.returns ?? null,
      irsNetReturns: net("returns"),
      irsInflowExemptions: inflow?.exemptions ?? null,
      irsOutflowExemptions: outflow?.exemptions ?? null,
      irsNetExemptions: net("exemptions"),
      irsInflowAgiThousands: inflow?.agiThousands ?? null,
      irsOutflowAgiThousands: outflow?.agiThousands ?? null,
      irsNetAgiThousands: net("agiThousands"),
    },
    marginsOfError: {
      population: v.B01003_M001, mobilityPopulation: v.B07003_M001, sameHouse: v.B07003_M004,
      movedWithinCounty: v.B07003_M007, movedDifferentCountySameState: v.B07003_M010,
      movedDifferentState: v.B07003_M013, movedFromAbroad: v.B07003_M016,
      medianHouseholdIncome: v.B19013_M001, housingUnits: v.B25001_M001,
      occupiedHousingUnits: v.B25002_M002, vacantHousingUnits: v.B25002_M003,
      medianGrossRent: v.B25064_M001, medianOwnerOccupiedHomeValue: v.B25077_M001,
    },
    sourceScope: "Aggregate geography context only; never an individual-person, household, owner, or parcel fact.",
  };
}

function percentileRanks(records, accessor) {
  const values = records.map(accessor).filter(Number.isFinite).sort((a, b) => a - b);
  return (value) => {
    if (!Number.isFinite(value) || !values.length) return null;
    let low = 0; let high = values.length;
    while (low < high) { const middle = (low + high) >> 1; if (values[middle] <= value) low = middle + 1; else high = middle; }
    return values.length === 1 ? 50 : Math.round(((low - 1) / (values.length - 1)) * 100);
  };
}

function applyIndexes(records) {
  const accessors = {
    externalMobility: (record) => record.metrics.externalInMoverRate,
    occupancy: (record) => record.metrics.occupancyRate,
    income: (record) => record.metrics.medianHouseholdIncome,
    rent: (record) => record.metrics.medianGrossRent,
    value: (record) => record.metrics.medianOwnerOccupiedHomeValue,
    population: (record) => record.metrics.population,
  };
  const ranks = Object.fromEntries(Object.entries(accessors).map(([key, accessor]) => [key, percentileRanks(records, accessor)]));
  for (const record of records) {
    const components = Object.fromEntries(Object.entries(accessors).map(([key, accessor]) => [key, ranks[key](accessor(record))]));
    const weighted = [["externalMobility", 0.35], ["occupancy", 0.25], ["income", 0.15], ["rent", 0.10], ["value", 0.10], ["population", 0.05]];
    const available = weighted.filter(([key]) => Number.isFinite(components[key]));
    const weight = available.reduce((sum, item) => sum + item[1], 0);
    record.marketDemandIndex = weight ? Math.round(available.reduce((sum, [key, factor]) => sum + components[key] * factor, 0) / weight) : null;
    record.indexComponents = components;
    const netReturns = record.metrics.irsNetReturns; const netExemptions = record.metrics.irsNetExemptions;
    record.migrationSignal = Number.isFinite(netReturns) && Number.isFinite(netExemptions)
      ? netReturns > 0 && netExemptions > 0 ? "net-inflow" : netReturns < 0 && netExemptions < 0 ? "net-outflow" : "mixed-flow"
      : "acs-mobility-only";
    record.indexSemantics = "Descriptive geography-relative index, not a forecast, investment recommendation, or parcel score.";
  }
}

function adapterIdByFips(universe) {
  const result = new Map();
  const adaptersRoot = path.join(root, "data", "county-adapters");
  for (const entry of fs.readdirSync(adaptersRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(adaptersRoot, entry.name, "adapter.json");
    if (!fs.existsSync(file)) continue;
    try { const adapter = JSON.parse(fs.readFileSync(file, "utf8")); if (/^\d{5}$/.test(String(adapter.fips || ""))) result.set(String(adapter.fips), adapter.id || adapter.countyId || entry.name); } catch {}
  }
  for (const county of universe.counties) if (!result.has(county.fips)) result.set(county.fips, county.countyId);
  return result;
}

function writeStateShards(records, kind) {
  const groups = new Map();
  for (const record of records) { if (!groups.has(record.stateFips)) groups.set(record.stateFips, []); groups.get(record.stateFips).push(record); }
  const files = {};
  for (const [stateFips, values] of groups) {
    values.sort((a, b) => a.geographyId.localeCompare(b.geographyId));
    const relative = `${kind}/${stateFips}.json`;
    writeJson(path.join(publicRoot, relative), { schemaVersion: `wr-national-migration-demand-${kind}-shard-v1`, geographyLevel: kind === "counties" ? "county" : "place", stateFips, recordCount: values.length, records: values });
    files[stateFips] = { file: relative, count: values.length };
  }
  return files;
}

async function main() {
  ensureDir(rawRoot); ensureDir(publicRoot); ensureDir(outputRoot);
  const universe = JSON.parse(fs.readFileSync(universeFile, "utf8"));
  console.log("Capturing seven official Census ACS 2024 5-year national tables...");
  const [...acsRaw] = await Promise.all(tables.map(capture));
  const gazetteerSources = [...new Set(universe.counties.map((county) => county.stateFips))].filter((stateFips) => Number(stateFips) <= 56 || stateFips === "72").sort().map((stateFips) => ({ id: `census-2024-place-gazetteer-${stateFips}`, url: `${gazetteerBase}/2024_gaz_place_${stateFips}.txt`, file: path.join(rawRoot, `2024_gaz_place_${stateFips}.txt`) }));
  const gazetteerRaw = new Array(gazetteerSources.length); let gazetteerCursor = 0;
  const gazetteerWorker = async () => { while (gazetteerCursor < gazetteerSources.length) { const index = gazetteerCursor++; gazetteerRaw[index] = await capture(gazetteerSources[index]); } };
  await Promise.all(Array.from({ length: 8 }, gazetteerWorker));
  console.log("Loading official IRS 2022-2023 county migration aggregates...");
  const irsRaw = await Promise.all(irsSources.map(capture));
  console.log("Building county and Census-place contexts...");
  const rawById = new Map(tables.map((table, index) => [table.id, acsRaw[index]]));
  const geographyRecords = parseTables(rawById);
  const irsInflow = parseIrs(irsRaw[0], "inflow");
  const irsOutflow = parseIrs(irsRaw[1], "outflow");
  const countyNames = new Map(universe.counties.map((county) => [county.fips, `${county.countyName}, ${county.state}`]));
  const placeNames = new Map();
  for (const raw of gazetteerRaw) {
    const gazetteerRows = parse(raw, { columns: (header) => header.map((value) => value.trim()), delimiter: "\t", skip_empty_lines: true, relax_column_count: true, trim: true });
    for (const row of gazetteerRows) { const id = String(row.GEOID || "").trim(); if (/^\d{7}$/.test(id)) placeNames.set(id, String(row.NAME || "").trim()); }
  }
  const counties = []; const places = [];
  for (const record of geographyRecords.values()) record.name = record.geographyLevel === "county" ? countyNames.get(record.geographyId) || record.geographyId : placeNames.get(record.geographyId) || record.geographyId;
  for (const record of geographyRecords.values()) (record.geographyLevel === "county" ? counties : places).push(baseRecord(record, irsInflow, irsOutflow));
  applyIndexes(counties); applyIndexes(places);
  const countyFiles = writeStateShards(counties, "counties");
  const placeFiles = writeStateShards(places, "places");
  const adapters = adapterIdByFips(universe);
  const countyByFips = new Map(counties.map((record) => [record.geographyId, record]));
  const coverageIndex = { schemaVersion: "wr-national-migration-demand-coverage-index-v1", generatedAt: new Date().toISOString(), counties: {}, places: {} };
  for (const record of counties) {
    const countyId = adapters.get(record.geographyId) || "";
    coverageIndex.counties[record.geographyId] = { countyId, status: "ready-aggregate-geography-context", stateFips: record.stateFips, stateFile: countyFiles[record.stateFips].file, marketDemandIndex: record.marketDemandIndex, migrationSignal: record.migrationSignal, hasIrsMigration: Number.isFinite(record.metrics.irsNetReturns) };
    if (!countyId) continue;
    writeJson(path.join(countyPublicRoot, countyId, "demand", "manifest.json"), {
      schemaVersion: "wr-county-migration-demand-manifest-v1", generatedAt: coverageIndex.generatedAt, countyId,
      countyFips: record.geographyId, status: "ready-aggregate-geography-context", geographyLevel: "county",
      recordSource: `/data/national/migration-demand/${countyFiles[record.stateFips].file}`,
      marketDemandIndex: record.marketDemandIndex, migrationSignal: record.migrationSignal,
      parcelAttribution: false, parcelJoinCount: 0,
      disclosure: record.sourceScope,
    }, true);
  }
  for (const county of universe.counties) {
    if (coverageIndex.counties[county.fips]) continue;
    const countyId = adapters.get(county.fips) || county.countyId;
    coverageIndex.counties[county.fips] = { countyId, status: "source-gap-no-2024-acs-county-record", stateFips: county.stateFips, stateFile: countyFiles[county.stateFips]?.file || null, marketDemandIndex: null, migrationSignal: "source-gap", hasIrsMigration: false };
    writeJson(path.join(countyPublicRoot, countyId, "demand", "manifest.json"), {
      schemaVersion: "wr-county-migration-demand-manifest-v1", generatedAt: coverageIndex.generatedAt, countyId,
      countyFips: county.fips, status: "source-gap-no-2024-acs-county-record", geographyLevel: "county",
      recordSource: null, marketDemandIndex: null, migrationSignal: "source-gap",
      parcelAttribution: false, parcelJoinCount: 0,
      disclosure: "No matching 2024 ACS county record was available for this project-universe county equivalent; no value was inferred or copied from another geography.",
    }, true);
  }
  for (const record of places) coverageIndex.places[record.geographyId] = { stateFips: record.stateFips, stateFile: placeFiles[record.stateFips].file, marketDemandIndex: record.marketDemandIndex, migrationSignal: record.migrationSignal };
  writeJson(path.join(publicRoot, "coverage-index.json"), coverageIndex);
  const snapshots = [
    ...tables.map((table, index) => ({ sourceId: `census-acs5-2024-${table.id}`, publisher: "U.S. Census Bureau American Community Survey", url: table.url, period: "2020-2024", bytes: acsRaw[index].length, sha256: sha256(acsRaw[index]) })),
    { sourceId: "census-2024-place-gazetteers", publisher: "U.S. Census Bureau", url: `${gazetteerBase}/`, period: "2024", fileCount: gazetteerRaw.length, bytes: gazetteerRaw.reduce((sum, raw) => sum + raw.length, 0), sha256: sha256(Buffer.concat(gazetteerRaw)) },
    ...irsSources.map((source, index) => ({ sourceId: source.id, publisher: "Internal Revenue Service Statistics of Income", url: source.url, period: "2022-2023", bytes: irsRaw[index].length, sha256: sha256(irsRaw[index]), rightsReview: "independent-reuse-review-pending" })),
  ];
  const matchedUniverseCount = universe.counties.filter((county) => countyByFips.has(county.fips)).length;
  const manifest = {
    schemaVersion: "wr-national-migration-demand-manifest-v1", generatedAt: coverageIndex.generatedAt,
    status: "ready-aggregate-geography-context-production-display-gated", acsVintage: "2024 ACS 5-year (2020-2024)", irsVintage: "2022-2023",
    countyRecordCount: counties.length, censusUniverseCountyCount: universe.countyEquivalentCount, matchedCensusUniverseCountyCount: matchedUniverseCount,
    projectUniverseCoverageIndexCount: universe.countyEquivalentCount, projectUniverseSourceGapCount: universe.countyEquivalentCount - matchedUniverseCount,
    placeRecordCount: places.length, countyStateShards: countyFiles, placeStateShards: placeFiles,
    coverageIndex: "coverage-index.json", sources: snapshots,
    semantics: ["Aggregate county/place context only", "No individual-person data", "No parcel attribution", "ACS mobility is current-residence mobility, not net migration", "IRS returns are not households", "IRS exemptions are not official population", "Mixed vintages remain labeled separately"],
    scoring: { index: "marketDemandIndex", range: "0-100 geography-relative percentile composite", favorableWeights: { externalMobility: 0.35, occupancy: 0.25, income: 0.15, rent: 0.10, value: 0.10, population: 0.05 }, disclaimer: "Descriptive context only; not a forecast, recommendation, or parcel score." },
  };
  writeJson(path.join(publicRoot, "manifest.json"), manifest, true);
  const report = { ...manifest, countyStateShards: Object.keys(countyFiles).length, placeStateShards: Object.keys(placeFiles).length, sources: snapshots.map(({ sourceId, bytes, sha256: digest }) => ({ sourceId, bytes, sha256: digest })) };
  writeJson(path.join(outputRoot, "national-migration-demand-report.json"), report, true);
  fs.writeFileSync(path.join(outputRoot, "national-migration-demand-report.md"), `# National Migration and Demand Context\n\n- ACS county records: ${counties.length.toLocaleString()}\n- Census county universe matches: ${matchedUniverseCount.toLocaleString()} / ${universe.countyEquivalentCount.toLocaleString()}\n- Census place records: ${places.length.toLocaleString()}\n- Counties with IRS inflow/outflow aggregates: ${counties.filter((record) => Number.isFinite(record.metrics.irsNetReturns)).length.toLocaleString()}\n- Parcel attribution: prohibited (0 joins)\n\nThis layer supplies aggregate county and Census-place context. It is not a parcel score or a forecast.\n`);
  console.log(JSON.stringify({ countyRecordCount: counties.length, matchedUniverseCount, placeRecordCount: places.length, irsCountyCount: counties.filter((record) => Number.isFinite(record.metrics.irsNetReturns)).length }, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });

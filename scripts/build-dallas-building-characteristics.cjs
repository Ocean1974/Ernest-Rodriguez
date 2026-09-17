const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse");

const root = path.join(__dirname, "..");
const sourceDir = path.join(root, "data", "extracted", "DCAD2026_CURRENT");
const publicRoot = path.join(root, "public", "data", "building-characteristics");
const shardDir = path.join(publicRoot, "records");
const manifestFile = path.join(publicRoot, "manifest.json");
const reportJsonFile = path.join(root, "output", "dallas-building-characteristics-report.json");
const reportMarkdownFile = path.join(root, "output", "dallas-building-characteristics-report.md");
const MAX_RECORDS_PER_PAGE = 2000;
const SHARD_KEY_LENGTH = 2;
const SOURCE_COUNTY_ID = "dallas-county-dcad";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function text(value) {
  return String(value || "").trim();
}

function number(value) {
  const parsed = Number.parseFloat(String(value || "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function constructionYear(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed >= 1800 && parsed <= 2026 ? parsed : null;
}

function recordFor(map, accountNum) {
  if (!map.has(accountNum)) {
    map.set(accountNum, {
      accountNum,
      buildingRecordCount: 0,
      residentialRecordCount: 0,
      commercialRecordCount: 0,
      oldestYearBuilt: null,
      newestYearBuilt: null,
      distinctYears: new Set(),
      grossBuildingArea: 0,
      grossBuildingAreaRecordCount: 0,
      residentialUnits: 0,
      residentialUnitRecordCount: 0,
      qualityLabels: new Set(),
      conditionLabels: new Set(),
    });
  }
  return map.get(accountNum);
}

function updateAggregate(record, sourceType, year, area, units, quality, condition) {
  record.buildingRecordCount += 1;
  if (sourceType === "residential") record.residentialRecordCount += 1;
  if (sourceType === "commercial") record.commercialRecordCount += 1;
  if (year !== null) {
    record.distinctYears.add(year);
    record.oldestYearBuilt = record.oldestYearBuilt === null ? year : Math.min(record.oldestYearBuilt, year);
    record.newestYearBuilt = record.newestYearBuilt === null ? year : Math.max(record.newestYearBuilt, year);
  }
  if (area !== null && area >= 0) {
    record.grossBuildingArea += area;
    record.grossBuildingAreaRecordCount += 1;
  }
  if (units !== null && units >= 0) {
    record.residentialUnits += units;
    record.residentialUnitRecordCount += 1;
  }
  if (quality) record.qualityLabels.add(quality);
  if (condition) record.conditionLabels.add(condition);
}

async function processSource(config, aggregates) {
  const file = path.join(sourceDir, config.file);
  if (!fs.existsSync(file)) throw new Error(`Missing DCAD building source: ${file}`);
  const hash = crypto.createHash("sha256");
  const identities = new Set();
  const stats = { sourceType: config.sourceType, file: path.relative(root, file).replace(/\\/g, "/"), rowCount: 0, validIdentityCount: 0, validAccountCount: 0, validYearCount: 0, missingIdentityCount: 0, missingAccountCount: 0, duplicateIdentityCount: 0 };
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(file);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    const parser = parse({ columns: true, bom: true, skip_empty_lines: true, relax_column_count: true });
    parser.on("data", (row) => {
      stats.rowCount += 1;
      const identity = text(row.TAX_OBJ_ID);
      const accountNum = text(row.ACCOUNT_NUM).toUpperCase();
      if (!identity) {
        stats.missingIdentityCount += 1;
        return;
      }
      if (identities.has(identity)) {
        stats.duplicateIdentityCount += 1;
        return;
      }
      identities.add(identity);
      stats.validIdentityCount += 1;
      if (!accountNum) {
        stats.missingAccountCount += 1;
        return;
      }
      stats.validAccountCount += 1;
      const year = constructionYear(config.year(row));
      if (year !== null) stats.validYearCount += 1;
      const aggregate = recordFor(aggregates, accountNum);
      updateAggregate(aggregate, config.sourceType, year, number(config.area(row)), number(config.units(row)), text(config.quality(row)), text(config.condition(row)));
    });
    parser.on("error", reject);
    parser.on("end", resolve);
    input.pipe(parser);
  });
  stats.bytes = fs.statSync(file).size;
  stats.sha256 = hash.digest("hex");
  stats.identityUnique = stats.duplicateIdentityCount === 0;
  if (!stats.identityUnique) throw new Error(`${config.file} contains ${stats.duplicateIdentityCount} duplicate TAX_OBJ_ID values; aggregation stopped.`);
  return stats;
}

function finalized(record) {
  return {
    accountNum: record.accountNum,
    conservativeYearBuilt: record.newestYearBuilt,
    oldestYearBuilt: record.oldestYearBuilt,
    newestYearBuilt: record.newestYearBuilt,
    distinctYearCount: record.distinctYears.size,
    buildingRecordCount: record.buildingRecordCount,
    residentialRecordCount: record.residentialRecordCount,
    commercialRecordCount: record.commercialRecordCount,
    grossBuildingArea: record.grossBuildingAreaRecordCount ? record.grossBuildingArea : null,
    grossBuildingAreaRecordCount: record.grossBuildingAreaRecordCount,
    residentialUnits: record.residentialUnitRecordCount ? record.residentialUnits : null,
    residentialUnitRecordCount: record.residentialUnitRecordCount,
    qualityLabels: [...record.qualityLabels].sort(),
    conditionLabels: [...record.conditionLabels].sort(),
  };
}

async function main() {
  const aggregates = new Map();
  const sources = [];
  sources.push(await processSource({
    file: "RES_DETAIL.CSV",
    sourceType: "residential",
    year: (row) => row.YR_BUILT,
    area: (row) => row.TOT_MAIN_SF || row.TOT_LIVING_AREA_SF,
    units: (row) => row.NUM_UNITS,
    quality: (row) => row.CDU_RATING_DESC,
    condition: () => "",
  }, aggregates));
  sources.push(await processSource({
    file: "COM_DETAIL.CSV",
    sourceType: "commercial",
    year: (row) => row.YEAR_BUILT,
    area: (row) => row.GROSS_BLDG_AREA,
    units: (row) => row.NUM_UNITS,
    quality: (row) => row.PROPERTY_QUAL_DESC,
    condition: (row) => row.PROPERTY_COND_DESC,
  }, aggregates));

  const records = [...aggregates.values()].map(finalized).sort((a, b) => a.accountNum.localeCompare(b.accountNum));
  const groups = new Map();
  for (const record of records) {
    const key = record.accountNum.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, SHARD_KEY_LENGTH) || "__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  fs.mkdirSync(shardDir, { recursive: true });
  for (const file of fs.readdirSync(shardDir)) fs.rmSync(path.join(shardDir, file), { force: true });
  const shards = {};
  let pageCount = 0;
  let maximumPageBytes = 0;
  for (const [key, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const pages = [];
    for (let offset = 0; offset < group.length; offset += MAX_RECORDS_PER_PAGE) {
      const name = `${key}-${String(pages.length).padStart(4, "0")}.json`;
      const payload = `${JSON.stringify({ schemaVersion: "wr-dcad-building-characteristics-page-v1", sourceCountyId: SOURCE_COUNTY_ID, records: group.slice(offset, offset + MAX_RECORDS_PER_PAGE) })}\n`;
      fs.writeFileSync(path.join(shardDir, name), payload);
      const bytes = Buffer.byteLength(payload);
      pages.push({ file: `records/${name}`, count: Math.min(MAX_RECORDS_PER_PAGE, group.length - offset), bytes, sha256: sha256(payload) });
      pageCount += 1;
      maximumPageBytes = Math.max(maximumPageBytes, bytes);
    }
    shards[key] = { count: group.length, pages };
  }

  const generatedAt = new Date().toISOString();
  const exactSummary = {
    sourceRowCount: sources.reduce((sum, source) => sum + source.rowCount, 0),
    validSourceIdentityCount: sources.reduce((sum, source) => sum + source.validIdentityCount, 0),
    duplicateSourceIdentityCount: sources.reduce((sum, source) => sum + source.duplicateIdentityCount, 0),
    uniqueAccountCount: records.length,
    accountWithYearCount: records.filter((record) => record.conservativeYearBuilt !== null).length,
    accountWithoutYearCount: records.filter((record) => record.conservativeYearBuilt === null).length,
    multiBuildingAccountCount: records.filter((record) => record.buildingRecordCount > 1).length,
    multiYearAccountCount: records.filter((record) => record.distinctYearCount > 1).length,
    residentialAccountCount: records.filter((record) => record.residentialRecordCount > 0).length,
    commercialAccountCount: records.filter((record) => record.commercialRecordCount > 0).length,
    mixedSourceAccountCount: records.filter((record) => record.residentialRecordCount > 0 && record.commercialRecordCount > 0).length,
    shardKeyCount: groups.size,
    pageCount,
    maximumPageBytes,
  };
  if (exactSummary.accountWithYearCount + exactSummary.accountWithoutYearCount !== exactSummary.uniqueAccountCount) throw new Error("Building-characteristics year partition failed.");

  const manifest = {
    schemaVersion: "wr-dcad-building-characteristics-service-v1",
    generatedAt,
    sourceCountyId: SOURCE_COUNTY_ID,
    sourceVersion: "DCAD2026_CURRENT",
    status: "verified-staged-default-off",
    keyField: "ACCOUNT_NUM",
    sourceIdentityField: "TAX_OBJ_ID",
    conservativeYearBuiltRule: "Use the newest valid construction year across all residential and commercial building records for an account; an older-improvements factor therefore requires every recorded building year to be 1980 or earlier.",
    validYearRange: { minimum: 1800, maximum: 2026 },
    shardKeyLength: SHARD_KEY_LENGTH,
    maximumRecordsPerPage: MAX_RECORDS_PER_PAGE,
    maximumPageBytes,
    recordCount: records.length,
    pageCount,
    sources,
    exactSummary,
    shards,
    activation: { defaultVisible: false, publicRuntimeActivated: false, pageDesignChanged: false, earthImageryChanged: false },
    runtimePolicy: "Load only the account-prefix pages required for selected parcels; never load every building-characteristics page in the browser.",
  };
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(reportJsonFile, `${JSON.stringify({ ...manifest, shards: undefined }, null, 2)}\n`);
  fs.writeFileSync(reportMarkdownFile, [
    "# Dallas DCAD Building Characteristics",
    "",
    `Generated: ${generatedAt}`,
    "",
    `- Source rows: ${exactSummary.sourceRowCount.toLocaleString("en-US")}`,
    `- Unique accounts: ${exactSummary.uniqueAccountCount.toLocaleString("en-US")}`,
    `- Accounts with a valid construction year: ${exactSummary.accountWithYearCount.toLocaleString("en-US")}`,
    `- Accounts without a valid construction year: ${exactSummary.accountWithoutYearCount.toLocaleString("en-US")}`,
    `- Multi-building accounts: ${exactSummary.multiBuildingAccountCount.toLocaleString("en-US")}`,
    `- Multi-year accounts: ${exactSummary.multiYearAccountCount.toLocaleString("en-US")}`,
    `- Runtime pages: ${pageCount.toLocaleString("en-US")}`,
    `- Largest page: ${maximumPageBytes.toLocaleString("en-US")} bytes`,
    "",
    "Construction-year scoring uses the newest valid year for each account. This is conservative: the older-improvements factor can apply only when every recorded building is from 1980 or earlier.",
    "",
    "The service is staged and default-off; it does not change the approved White Rabbit UI.",
    "",
  ].join("\n"));
  console.log(`Wrote ${manifestFile}`);
  console.log(`Wrote ${reportJsonFile}`);
  console.log(`Wrote ${reportMarkdownFile}`);
  console.log(JSON.stringify({ sources, exactSummary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

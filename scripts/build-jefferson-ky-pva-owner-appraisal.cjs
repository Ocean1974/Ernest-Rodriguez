const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

const root = path.join(__dirname, "..");
const adapterPath = path.join(root, "data", "county-adapters", "louisville", "adapter.json");
const manifestPath = path.join(root, "data", "county-adapters", "louisville", "pva-owner-appraisal-source-manifest.json");
const outputDir = path.join(root, "output", "jefferson-ky");

const adapter = readJson(adapterPath);
const manifest = readJson(manifestPath);

const sourceArg = process.argv.find((arg) => arg.startsWith("--source="));
const sourceOverride = sourceArg ? sourceArg.slice("--source=".length) : "";

const INDEX_FIELDS = [
  "sourceRow",
  "parcelId",
  "lrsn",
  "pin",
  "accountNum",
  "gisParcelId",
  "address",
  "propertyAddress",
  "city",
  "propertyZip",
  "propertyName",
  "ownerName",
  "ownerName2",
  "businessName",
  "ownerMailingAddress",
  "ownerMailingAddress2",
  "ownerCity",
  "ownerState",
  "ownerZip",
  "ownerCountry",
  "ownerPhone",
  "ownerEmail",
  "landValue",
  "improvementValue",
  "totalValue",
  "landAreaSize",
  "landAreaUnit",
  "landAreaSqFt",
  "buildingClass",
  "landUseCode",
  "landUseDescription",
  "yearBuilt",
  "grossBuildingArea",
  "quality",
  "condition",
  "neighborhood",
  "deedBook",
  "deedPage",
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function compact(value) {
  return String(value ?? "").trim();
}

function normalizeHeader(value) {
  return compact(value).replace(/^\uFEFF/, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeJoinValue(value) {
  return compact(value).replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function outputPath(key) {
  const relative = manifest.output_files[key];
  if (!relative) throw new Error(`Missing output file manifest key: ${key}`);
  return path.join(root, relative);
}

function sourceFileCandidates() {
  const files = [];
  if (sourceOverride) files.push(path.isAbsolute(sourceOverride) ? sourceOverride : path.join(root, sourceOverride));
  for (const value of Object.values(manifest.input_files || {})) {
    if (value) files.push(path.join(root, value));
  }
  return files;
}

function resolveSourceFile() {
  return sourceFileCandidates().find((file) => fs.existsSync(file)) || null;
}

function sniffDelimiter(text, file) {
  const sample = text.slice(0, 8192);
  const commaCount = (sample.match(/,/g) || []).length;
  const tabCount = (sample.match(/\t/g) || []).length;
  if (/\.txt$/i.test(file) && tabCount >= commaCount) return "\t";
  return tabCount > commaCount * 1.5 ? "\t" : ",";
}

function readDelimitedRows(file) {
  const text = fs.readFileSync(file, "utf8");
  const delimiter = sniffDelimiter(text, file);
  return {
    delimiter,
    rows: parse(text, {
      bom: true,
      columns: true,
      delimiter,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    }),
  };
}

function headerIndex(rows) {
  const headers = Object.keys(rows[0] || {}).map((name) => name.replace(/^\uFEFF/, ""));
  const byNormalized = new Map();
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (normalized && !byNormalized.has(normalized)) byNormalized.set(normalized, header);
  }
  return { headers, byNormalized };
}

function resolveMappedFields(rows) {
  const index = headerIndex(rows);
  const mapped = {};
  for (const [targetField, aliases] of Object.entries(manifest.field_aliases || {})) {
    const aliasList = [targetField, ...(aliases || [])];
    const sourceField = aliasList.map(normalizeHeader).map((alias) => index.byNormalized.get(alias)).find(Boolean) || "";
    if (sourceField) mapped[targetField] = sourceField;
  }
  return {
    headers: index.headers,
    mapped,
  };
}

function valueFor(row, mapped, targetField) {
  const sourceField = mapped[targetField];
  return sourceField ? compact(row[sourceField]) : "";
}

function firstNonEmpty(...values) {
  return values.map(compact).find(Boolean) || "";
}

function recordFromRow(row, rowIndex, mapped) {
  const parcelId = valueFor(row, mapped, "parcelId");
  const lrsn = valueFor(row, mapped, "lrsn");
  const pin = valueFor(row, mapped, "pin");
  const address = valueFor(row, mapped, "address");
  const city = valueFor(row, mapped, "city") || "Louisville";
  const ownerName = valueFor(row, mapped, "ownerName");
  const businessName = valueFor(row, mapped, "businessName");
  const landAreaSize = valueFor(row, mapped, "landAreaSize");
  const landAreaSqFt = valueFor(row, mapped, "landAreaSqFt");
  const buildingClass = valueFor(row, mapped, "buildingClass");
  const landUseDescription = valueFor(row, mapped, "landUseDescription");
  const propertyName = firstNonEmpty(address, businessName, ownerName, parcelId ? `PVA Parcel ${parcelId}` : "");

  return {
    sourceRow: rowIndex + 2,
    parcelId,
    lrsn,
    pin,
    accountNum: parcelId,
    gisParcelId: lrsn,
    address,
    propertyAddress: address,
    city,
    propertyZip: valueFor(row, mapped, "propertyZip"),
    propertyName,
    ownerName,
    ownerName2: valueFor(row, mapped, "ownerName2"),
    businessName,
    ownerMailingAddress: valueFor(row, mapped, "ownerMailingAddress"),
    ownerMailingAddress2: valueFor(row, mapped, "ownerMailingAddress2"),
    ownerCity: valueFor(row, mapped, "ownerCity"),
    ownerState: valueFor(row, mapped, "ownerState"),
    ownerZip: valueFor(row, mapped, "ownerZip"),
    ownerCountry: valueFor(row, mapped, "ownerCountry"),
    ownerPhone: valueFor(row, mapped, "ownerPhone"),
    ownerEmail: valueFor(row, mapped, "ownerEmail"),
    landValue: valueFor(row, mapped, "landValue"),
    improvementValue: valueFor(row, mapped, "improvementValue"),
    totalValue: valueFor(row, mapped, "totalValue"),
    landAreaSize,
    landAreaUnit: landAreaSize ? "acres" : landAreaSqFt ? "square feet" : "",
    landAreaSqFt,
    buildingClass,
    landUseCode: valueFor(row, mapped, "landUseCode"),
    landUseDescription,
    yearBuilt: valueFor(row, mapped, "yearBuilt"),
    grossBuildingArea: valueFor(row, mapped, "grossBuildingArea"),
    quality: valueFor(row, mapped, "quality"),
    condition: valueFor(row, mapped, "condition"),
    neighborhood: valueFor(row, mapped, "neighborhood"),
    deedBook: valueFor(row, mapped, "deedBook"),
    deedPage: valueFor(row, mapped, "deedPage"),
  };
}

function duplicateSummary(records, field) {
  const counts = new Map();
  for (const record of records) {
    const key = normalizeJoinValue(record[field]);
    if (!key) continue;
    if (!counts.has(key)) counts.set(key, { value: record[field], count: 0 });
    counts.get(key).count += 1;
  }
  const groups = [...counts.values()].filter((item) => item.count > 1);
  return {
    field,
    uniqueValueCount: counts.size,
    duplicateGroupCount: groups.length,
    duplicateRecordCount: groups.reduce((sum, item) => sum + item.count, 0),
    sampleDuplicateValues: groups.slice(0, 10),
  };
}

function packedRecords(records) {
  return records.map((record) => INDEX_FIELDS.map((field) => record[field] ?? ""));
}

function mappedFieldPairs(mapped) {
  return Object.keys(manifest.field_aliases || {})
    .sort()
    .map((targetField) => ({
      targetField,
      sourceField: mapped[targetField] || "",
      status: mapped[targetField] ? "mapped" : "missing",
    }));
}

function writeSourceNeededOutputs() {
  const generatedAt = new Date().toISOString();
  const sourceCandidates = sourceFileCandidates().map((file) => path.relative(root, file).replace(/\\/g, "/"));
  const index = {
    generatedAt,
    county_id: adapter.id,
    status: "source-needed",
    source_name: manifest.source_name,
    sourceCandidates,
    fields: INDEX_FIELDS,
    records: [],
    counts: {
      sourceRows: 0,
      indexedRows: 0,
      missingJoinKeyRows: 0,
      duplicatePARCELIDGroups: 0,
      duplicateLRSNGroups: 0,
    },
    joinStrategy: manifest.join_strategy,
  };
  writeJson(outputPath("owner_appraisal_index"), index);

  const report = {
    generatedAt,
    county_id: adapter.id,
    status: "source-needed",
    source_name: manifest.source_name,
    official_sources: manifest.official_sources,
    sourceCandidates,
    nextRequiredInput: manifest.input_files.preferred_csv,
    counts: index.counts,
    mappedFields: [],
    joinStrategy: manifest.join_strategy,
    notes: manifest.official_source_notes,
  };
  writeJson(outputPath("owner_appraisal_report_json"), report);
  writeMarkdownReports(report);
  return report;
}

function writeMarkdownReports(report) {
  const mdFile = outputPath("owner_appraisal_report_md");
  const joinReportFile = outputPath("join_key_report");
  const mappedLines = (report.mappedFields || []).length
    ? report.mappedFields.map((field) => `| ${field.status} | ${field.targetField} | ${field.sourceField || "n/a"} |`)
    : ["| source-needed | n/a | n/a |"];
  const lines = [
    "# Jefferson County KY PVA Owner/Appraisal Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `- Status: ${report.status}`,
    `- Source: ${report.source_name}`,
    `- Source file: ${report.sourceFile || report.nextRequiredInput || "not present"}`,
    `- Source rows: ${report.counts.sourceRows}`,
    `- Indexed rows: ${report.counts.indexedRows}`,
    `- Missing join key rows: ${report.counts.missingJoinKeyRows}`,
    `- Duplicate PARCELID groups: ${report.counts.duplicatePARCELIDGroups}`,
    `- Duplicate LRSN groups: ${report.counts.duplicateLRSNGroups}`,
    "",
    "## Mapped Fields",
    "",
    "| Status | Universal field | Source field |",
    "| --- | --- | --- |",
    ...mappedLines,
    "",
    "## Notes",
    "",
    ...(report.notes || []).map((note) => `- ${note}`),
    "",
    "No page design files are changed by this report.",
    "",
  ];
  fs.writeFileSync(mdFile, lines.join("\n"));

  const joinLines = [
    "# Jefferson County KY PVA Join Key Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `- Status: ${report.status}`,
    `- Primary join: PVA PARCELID -> LOJIC PARCELID -> White Rabbit accountNum`,
    `- Secondary join: PVA LRSN -> LOJIC LRSN -> White Rabbit gisParcelId`,
    `- Fallback candidate: PIN, only if present and verified in the PVA export`,
    `- Source file: ${report.sourceFile || report.nextRequiredInput || "not present"}`,
    "",
    "## Counts",
    "",
    `- Source rows: ${report.counts.sourceRows}`,
    `- Indexed rows: ${report.counts.indexedRows}`,
    `- Missing join key rows: ${report.counts.missingJoinKeyRows}`,
    `- Duplicate PARCELID groups: ${report.counts.duplicatePARCELIDGroups}`,
    `- Duplicate LRSN groups: ${report.counts.duplicateLRSNGroups}`,
    "",
    "## Decision",
    "",
    report.status === "ready"
      ? "The PVA export has parcel join keys and is ready to be consumed by the Jefferson County universal parcel build."
      : "The join hook is ready, but the official PVA owner/appraisal export must be added before DCAD-level owner/value fields can populate Louisville parcels.",
    "",
  ];
  fs.writeFileSync(joinReportFile, joinLines.join("\n"));
}

function buildFromSource(sourceFile) {
  const generatedAt = new Date().toISOString();
  const { rows, delimiter } = readDelimitedRows(sourceFile);
  const { headers, mapped } = resolveMappedFields(rows);
  const records = rows.map((row, index) => recordFromRow(row, index, mapped));
  const indexedRows = records.filter((record) => normalizeJoinValue(record.parcelId) || normalizeJoinValue(record.lrsn));
  const missingJoinKeyRows = records.length - indexedRows.length;
  const parcelIdDuplicates = duplicateSummary(indexedRows, "parcelId");
  const lrsnDuplicates = duplicateSummary(indexedRows, "lrsn");
  const relativeSource = path.relative(root, sourceFile).replace(/\\/g, "/");
  const status = mapped.parcelId || mapped.lrsn ? "ready" : "blocked-missing-join-field";

  const index = {
    generatedAt,
    county_id: adapter.id,
    status,
    source_name: manifest.source_name,
    sourceFile: relativeSource,
    delimiter,
    fields: INDEX_FIELDS,
    records: packedRecords(indexedRows),
    joinStrategy: manifest.join_strategy,
    mappedFields: mappedFieldPairs(mapped),
    counts: {
      sourceRows: rows.length,
      indexedRows: indexedRows.length,
      missingJoinKeyRows,
      duplicatePARCELIDGroups: parcelIdDuplicates.duplicateGroupCount,
      duplicateLRSNGroups: lrsnDuplicates.duplicateGroupCount,
    },
  };
  writeJson(outputPath("owner_appraisal_index"), index);

  const report = {
    generatedAt,
    county_id: adapter.id,
    status,
    source_name: manifest.source_name,
    sourceFile: relativeSource,
    headers,
    delimiter,
    counts: index.counts,
    duplicates: {
      PARCELID: parcelIdDuplicates,
      LRSN: lrsnDuplicates,
    },
    mappedFields: index.mappedFields,
    joinStrategy: manifest.join_strategy,
    notes: manifest.official_source_notes,
  };
  writeJson(outputPath("owner_appraisal_report_json"), report);
  writeMarkdownReports(report);
  return report;
}

function main() {
  ensureDir(outputDir);
  const sourceFile = resolveSourceFile();
  const report = sourceFile ? buildFromSource(sourceFile) : writeSourceNeededOutputs();
  console.log(`Jefferson County PVA owner/appraisal status: ${report.status}`);
  console.log(`Wrote ${path.relative(root, outputPath("owner_appraisal_index"))}`);
  console.log(`Wrote ${path.relative(root, outputPath("owner_appraisal_report_json"))}`);
  console.log(`Wrote ${path.relative(root, outputPath("owner_appraisal_report_md"))}`);
  console.log(`Wrote ${path.relative(root, outputPath("join_key_report"))}`);
}

main();

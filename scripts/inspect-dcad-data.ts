const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const dataDir = path.join(root, "data");
const extractedDir = path.join(dataDir, "extracted");
const outputDir = path.join(root, "output");

const sources = {
  parcelGeom: {
    zip: path.join(dataDir, "PARCEL_GEOM.zip"),
    out: path.join(extractedDir, "parcel_geom"),
    base: "PARCEL_GEOM",
  },
  dcad: {
    zip: path.join(dataDir, "DCAD2026_CURRENT.ZIP"),
    out: path.join(extractedDir, "dcad_current"),
  },
  blkid: {
    zip: path.join(dataDir, "BLKID (1).zip"),
    out: path.join(extractedDir, "blkid"),
    base: "BLKID",
  },
  parcelDimension: {
    zip: path.join(dataDir, "ParcelDimension (1).zip"),
    out: path.join(extractedDir, "parcel_dimension"),
    base: "ParcelDimension",
  },
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function extractZip(zipFile, destination) {
  ensureDir(destination);
  const existing = fs.readdirSync(destination);
  if (existing.length > 0) return;

  const escapedZip = zipFile.replace(/'/g, "''");
  const escapedDest = destination.replace(/'/g, "''");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${escapedZip}' -DestinationPath '${escapedDest}' -Force`],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error(`Failed to extract ${zipFile}`);
}

function walk(dir, matches = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, matches);
    else matches.push(fullPath);
  }
  return matches;
}

function findFile(dir, predicate) {
  return walk(dir).find((file) => predicate(path.basename(file), file));
}

function parseDbf(dbfFile, sampleLimit = 10) {
  const buffer = fs.readFileSync(dbfFile);
  const rowCount = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  const fields = [];

  for (let offset = 32; offset < headerLength && buffer[offset] !== 0x0d; offset += 32) {
    const rawName = buffer.subarray(offset, offset + 11).toString("latin1").replace(/\0/g, "").trim();
    if (!rawName) continue;
    fields.push({
      name: rawName,
      type: buffer.subarray(offset + 11, offset + 12).toString("latin1"),
      length: buffer[offset + 16],
      decimalCount: buffer[offset + 17],
      offset: fields.reduce((sum, field) => sum + field.length, 1),
    });
  }

  const sampleRecords = [];
  for (let row = 0; row < rowCount && sampleRecords.length < sampleLimit; row += 1) {
    const recordOffset = headerLength + row * recordLength;
    if (buffer[recordOffset] === 0x2a) continue;
    const record = {};
    for (const field of fields) {
      const start = recordOffset + field.offset;
      const value = buffer.subarray(start, start + field.length).toString("latin1").trim();
      record[field.name] = value;
    }
    sampleRecords.push(record);
  }

  return { rowCount, fields, sampleRecords };
}

function countShpRecords(shpFile) {
  const fd = fs.openSync(shpFile, "r");
  const header = Buffer.alloc(100);
  fs.readSync(fd, header, 0, header.length, 0);
  const fileLengthBytes = header.readInt32BE(24) * 2;
  let offset = 100;
  let count = 0;
  const recordHeader = Buffer.alloc(8);

  while (offset + 8 <= fileLengthBytes) {
    fs.readSync(fd, recordHeader, 0, 8, offset);
    const contentLengthBytes = recordHeader.readInt32BE(4) * 2;
    if (contentLengthBytes <= 0) break;
    count += 1;
    offset += 8 + contentLengthBytes;
  }

  fs.closeSync(fd);
  return count;
}

function inspectShapefile(folder, base, sampleLimit = 10) {
  const shp = findFile(folder, (name) => name.toLowerCase() === `${base.toLowerCase()}.shp`);
  const dbf = findFile(folder, (name) => name.toLowerCase() === `${base.toLowerCase()}.dbf`);
  const prj = findFile(folder, (name) => name.toLowerCase() === `${base.toLowerCase()}.prj`);
  if (!shp || !dbf) throw new Error(`Missing shapefile components for ${base}`);
  const dbfInfo = parseDbf(dbf, sampleLimit);
  return {
    shp,
    dbf,
    prj,
    featureCount: countShpRecords(shp),
    dbfRowCount: dbfInfo.rowCount,
    fields: dbfInfo.fields,
    sampleRecords: dbfInfo.sampleRecords,
    coordinateReferenceSystem: prj ? fs.readFileSync(prj, "utf8").trim() : "Missing .prj file",
  };
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

function inspectCsv(csvFile) {
  const text = fs.readFileSync(csvFile, "utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const fields = lines.length ? parseCsvLine(lines[0].replace(/^\uFEFF/, "")) : [];
  const sampleRecords = lines.slice(1, 6).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(fields.map((field, index) => [field, values[index] ?? ""]));
  });
  return {
    filename: path.basename(csvFile),
    rowCount: Math.max(0, lines.length - 1),
    fields,
    sampleRecords,
    joinFieldCandidates: fields.filter((field) => /ACCOUNT|GIS|PARCEL|ACCT|PROP|BLK|BLOCK/i.test(field)),
  };
}

function keySetFromCsv(csvFile, keyField, limit = Infinity) {
  const text = fs.readFileSync(csvFile, "utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (!lines.length) return new Set();
  const fields = parseCsvLine(lines[0].replace(/^\uFEFF/, ""));
  const index = fields.indexOf(keyField);
  const keys = new Set();
  if (index < 0) return keys;
  for (let i = 1; i < lines.length && keys.size < limit; i += 1) {
    const value = parseCsvLine(lines[i])[index];
    if (value) keys.add(value.trim());
  }
  return keys;
}

function possibleJoinFields(fields) {
  return fields.map((field) => field.name).filter((name) => /ACCOUNT|GIS|PARCEL|ACCT|PROP|BLK|BLOCK/i.test(name));
}

function markdownTable(rows) {
  const lines = ["| File | Rows | Join candidates |", "| --- | ---: | --- |"];
  for (const row of rows) {
    lines.push(`| ${row.filename} | ${row.rowCount} | ${row.joinFieldCandidates.join(", ") || "None found"} |`);
  }
  return lines.join("\n");
}

function writeReport(report) {
  const outFile = path.join(outputDir, "full-parcel-access-report.md");
  const parcelFields = report.parcel.fields.map((field) => `${field.name} (${field.type}, ${field.length})`).join(", ");
  const blkFields = report.blkid.fields.map((field) => `${field.name} (${field.type}, ${field.length})`).join(", ");
  const dimFields = report.parcelDimension.fields.map((field) => `${field.name} (${field.type}, ${field.length})`).join(", ");
  const csvSections = report.csvs
    .map(
      (csv) => `### ${csv.filename}

- Row count: ${csv.rowCount}
- Fields: ${csv.fields.join(", ")}
- Join-key candidates: ${csv.joinFieldCandidates.join(", ") || "None found"}
- Sample 5 records:

\`\`\`json
${JSON.stringify(csv.sampleRecords, null, 2)}
\`\`\``,
    )
    .join("\n\n");

  const content = `# Full DCAD Parcel Access Report

Generated: ${new Date().toISOString()}

## Summary

- Total parcel geometry count: ${report.parcel.featureCount}
- PARCEL_GEOM DBF row count: ${report.parcel.dbfRowCount}
- Total DCAD account rows: ${report.accountRows}
- Total appraisal rows: ${report.appraisalRows}
- Total land rows: ${report.landRows}
- Total commercial detail rows: ${report.commercialRows}
- BLKID feature count: ${report.blkid.featureCount}
- ParcelDimension feature count: ${report.parcelDimension.featureCount}
- Matched sample parcel to DCAD account: ${report.matchSample.matchedAccount ? "Yes" : "No"}
- Matched sample parcel to DCAD appraisal: ${report.matchSample.matchedAppraisal ? "Yes" : "No"}

## PARCEL_GEOM

- Shapefile: ${path.relative(root, report.parcel.shp)}
- Feature count: ${report.parcel.featureCount}
- Fields: ${parcelFields}
- Coordinate reference system:

\`\`\`text
${report.parcel.coordinateReferenceSystem}
\`\`\`

- Identified parcel/account/GIS ID field: \`Acct\`
- Sample 10 records:

\`\`\`json
${JSON.stringify(report.parcel.sampleRecords, null, 2)}
\`\`\`

## DCAD CSV Files

${markdownTable(report.csvs)}

${csvSections}

## BLKID

- Feature count: ${report.blkid.featureCount}
- Fields: ${blkFields}
- Possible direct join fields: ${report.blkidJoinCandidates.join(", ") || "None found"}
- Join note: BLKID exposes \`TEXT\` label geometry but no inspected parcel/account key, so joining to parcels is spatial/nearest-feature, not a direct key join.

## ParcelDimension

- Feature count: ${report.parcelDimension.featureCount}
- Fields: ${dimFields}
- Possible direct join fields: ${report.dimensionJoinCandidates.join(", ") || "None found"}
- Join note: ParcelDimension exposes \`TEXT\` measurement geometry but no inspected parcel/account key, so joining to parcels is spatial/nearest-feature, not a direct key join.

## Exact Join-Key Candidates

- Primary parcel to DCAD join: \`PARCEL_GEOM.Acct -> ACCOUNT_INFO.ACCOUNT_NUM\`
- Appraisal join: \`PARCEL_GEOM.Acct -> ACCOUNT_APPRL_YEAR.ACCOUNT_NUM\`
- Land join: \`PARCEL_GEOM.Acct -> LAND.ACCOUNT_NUM\`
- Commercial detail join: \`PARCEL_GEOM.Acct -> COM_DETAIL.ACCOUNT_NUM\`
- Secondary / fallback: \`PARCEL_GEOM.Acct -> DCAD GIS_PARCEL_ID\` where present in DCAD CSVs.

## Join Coverage

- All parcel geometries can be attempted against DCAD appraisal data using \`Acct -> ACCOUNT_NUM\`.
- Existing full output joined appraisal data for ${report.manifestJoinedAppraisalCount} of ${report.manifestFeatureCount} parcels.
- Not every parcel has appraisal/account rows in the joined output; missing count from the existing joined output is ${report.manifestFeatureCount - report.manifestJoinedAppraisalCount}.

## Missing Or Uncertain Fields

- BLKID has no direct parcel/account/GIS key in the inspected DBF schema.
- ParcelDimension has no direct parcel/account/GIS key in the inspected DBF schema.
- Frontage/depth/perimeter are inferred from ParcelDimension measurement geometry/text, not direct named DBF fields.
`;

  fs.writeFileSync(outFile, content, "utf8");
  return outFile;
}

function writeSchemaReports(report) {
  const schema = {
    generatedAt: new Date().toISOString(),
    sources: [
      {
        filename: "PARCEL_GEOM.shp/.dbf",
        fileType: "Shapefile",
        rowCount: report.parcel.featureCount,
        fields: report.parcel.fields.map((field) => field.name),
        fieldDetails: report.parcel.fields,
        sampleRecords: report.parcel.sampleRecords,
        coordinateReferenceSystem: report.parcel.coordinateReferenceSystem,
      },
      {
        filename: "BLKID.shp/.dbf",
        fileType: "Shapefile",
        rowCount: report.blkid.featureCount,
        fields: report.blkid.fields.map((field) => field.name),
        fieldDetails: report.blkid.fields,
        sampleRecords: report.blkid.sampleRecords,
        coordinateReferenceSystem: report.blkid.coordinateReferenceSystem,
      },
      {
        filename: "ParcelDimension.shp/.dbf",
        fileType: "Shapefile",
        rowCount: report.parcelDimension.featureCount,
        fields: report.parcelDimension.fields.map((field) => field.name),
        fieldDetails: report.parcelDimension.fields,
        sampleRecords: report.parcelDimension.sampleRecords,
        coordinateReferenceSystem: report.parcelDimension.coordinateReferenceSystem,
      },
      ...report.csvs.map((csv) => ({
        filename: csv.filename,
        fileType: "CSV",
        rowCount: csv.rowCount,
        fields: csv.fields,
        sampleRecords: csv.sampleRecords,
        joinFieldCandidates: csv.joinFieldCandidates,
      })),
    ],
  };

  const md = [`# White Rabbit Schema Report`, ``, `Generated: ${schema.generatedAt}`, ``];
  for (const source of schema.sources) {
    md.push(`## ${source.filename}`);
    md.push(``);
    md.push(`- File type: ${source.fileType}`);
    md.push(`- Row count: ${source.rowCount}`);
    if (source.coordinateReferenceSystem) md.push(`- Coordinate reference system: ${source.coordinateReferenceSystem}`);
    md.push(`- Fields: ${source.fields.join(", ")}`);
    if (source.joinFieldCandidates) md.push(`- Join-field candidates: ${source.joinFieldCandidates.join(", ") || "None found"}`);
    md.push(``);
    md.push(`Sample records:`);
    md.push(``);
    md.push("```json");
    md.push(JSON.stringify(source.sampleRecords, null, 2));
    md.push("```");
    md.push(``);
  }

  fs.writeFileSync(path.join(outputDir, "schema-report.json"), JSON.stringify(schema, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(outputDir, "schema-report.md"), md.join("\n"), "utf8");
}

function writeJoinKeyReport(report) {
  const content = `# White Rabbit Join Key Report

## Exact Join-Key Candidates

- PARCEL_GEOM uses field \`Acct\`.
- ACCOUNT_INFO.CSV uses \`ACCOUNT_NUM\` and includes \`GIS_PARCEL_ID\`.
- ACCOUNT_APPRL_YEAR.CSV uses \`ACCOUNT_NUM\` and includes \`GIS_PARCEL_ID\`.
- LAND.CSV uses \`ACCOUNT_NUM\`.
- COM_DETAIL.CSV uses \`ACCOUNT_NUM\`.

Best primary join:

\`\`\`text
PARCEL_GEOM.Acct -> DCAD ACCOUNT_NUM
\`\`\`

Specific table joins:

\`\`\`text
PARCEL_GEOM.Acct -> ACCOUNT_INFO.ACCOUNT_NUM
PARCEL_GEOM.Acct -> ACCOUNT_APPRL_YEAR.ACCOUNT_NUM
PARCEL_GEOM.Acct -> LAND.ACCOUNT_NUM
PARCEL_GEOM.Acct -> COM_DETAIL.ACCOUNT_NUM
\`\`\`

Secondary / fallback join:

\`\`\`text
PARCEL_GEOM.Acct -> DCAD GIS_PARCEL_ID
\`\`\`

## BLKID

BLKID fields: ${report.blkid.fields.map((field) => `\`${field.name}\``).join(", ")}

BLKID has a \`TEXT\` label field and geometry. It does not expose parcel account IDs in the inspected schema, so joins are spatial/nearest-label joins, not direct key joins.

## ParcelDimension

ParcelDimension fields: ${report.parcelDimension.fields.map((field) => `\`${field.name}\``).join(", ")}

ParcelDimension has a \`TEXT\` measurement field and geometry. It does not expose parcel account IDs in the inspected schema, so joins are spatial/nearest-feature joins, not direct key joins.

## Inspection Proof

- Sample parcel account: \`${report.matchSample.parcelAccount || "none"}\`
- Matched ACCOUNT_INFO: ${report.matchSample.matchedAccount ? "Yes" : "No"}
- Matched ACCOUNT_APPRL_YEAR: ${report.matchSample.matchedAppraisal ? "Yes" : "No"}

## Missing Or Uncertain Fields

- BLKID has no direct account, parcel, or GIS ID field in the inspected DBF schema.
- ParcelDimension has no direct account, parcel, or GIS ID field in the inspected DBF schema.
`;

  fs.writeFileSync(path.join(outputDir, "join-key-report.md"), content, "utf8");
}

function main() {
  ensureDir(extractedDir);
  ensureDir(outputDir);

  for (const source of Object.values(sources)) {
    if (!fs.existsSync(source.zip)) throw new Error(`Missing source ZIP: ${path.relative(root, source.zip)}`);
    extractZip(source.zip, source.out);
  }

  const parcel = inspectShapefile(sources.parcelGeom.out, sources.parcelGeom.base, 10);
  const blkid = inspectShapefile(sources.blkid.out, sources.blkid.base, 5);
  const parcelDimension = inspectShapefile(sources.parcelDimension.out, sources.parcelDimension.base, 5);

  const csvFiles = walk(sources.dcad.out)
    .filter((file) => file.toLowerCase().endsWith(".csv"))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  const csvs = csvFiles.map(inspectCsv);

  const account = csvs.find((csv) => csv.filename.toUpperCase() === "ACCOUNT_INFO.CSV");
  const appraisal = csvs.find((csv) => csv.filename.toUpperCase() === "ACCOUNT_APPRL_YEAR.CSV");
  const land = csvs.find((csv) => csv.filename.toUpperCase() === "LAND.CSV");
  const commercial = csvs.find((csv) => csv.filename.toUpperCase() === "COM_DETAIL.CSV");
  const accountFile = csvFiles.find((file) => path.basename(file).toUpperCase() === "ACCOUNT_INFO.CSV");
  const appraisalFile = csvFiles.find((file) => path.basename(file).toUpperCase() === "ACCOUNT_APPRL_YEAR.CSV");
  const accountKeys = accountFile ? keySetFromCsv(accountFile, "ACCOUNT_NUM") : new Set();
  const appraisalKeys = appraisalFile ? keySetFromCsv(appraisalFile, "ACCOUNT_NUM") : new Set();
  const parcelAccount = parcel.sampleRecords.find((record) => record.Acct)?.Acct;

  const manifestFile = path.join(outputDir, "white-rabbit-dallas-parcels-manifest.json");
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : {};
  const report = {
    parcel,
    blkid,
    parcelDimension,
    csvs,
    accountRows: account?.rowCount ?? 0,
    appraisalRows: appraisal?.rowCount ?? 0,
    landRows: land?.rowCount ?? 0,
    commercialRows: commercial?.rowCount ?? 0,
    blkidJoinCandidates: possibleJoinFields(blkid.fields),
    dimensionJoinCandidates: possibleJoinFields(parcelDimension.fields),
    matchSample: {
      parcelAccount,
      matchedAccount: parcelAccount ? accountKeys.has(parcelAccount) : false,
      matchedAppraisal: parcelAccount ? appraisalKeys.has(parcelAccount) : false,
    },
    manifestFeatureCount: manifest.featureCount ?? parcel.featureCount,
    manifestJoinedAppraisalCount: manifest.joinedAppraisalCount ?? 0,
  };

  const reportFile = writeReport(report);
  writeSchemaReports(report);
  writeJoinKeyReport(report);
  fs.writeFileSync(path.join(outputDir, "parcel-count.txt"), `${parcel.featureCount}\n`, "utf8");
  console.log(`Full parcel access report written to ${path.relative(root, reportFile)}`);
  console.log(`Parcel geometry count: ${parcel.featureCount}`);
  console.log(`DCAD account rows: ${report.accountRows}`);
  console.log(`DCAD appraisal rows: ${report.appraisalRows}`);
  console.log(`DCAD land rows: ${report.landRows}`);
  console.log(`DCAD commercial detail rows: ${report.commercialRows}`);
  console.log(`BLKID features: ${blkid.featureCount}`);
  console.log(`ParcelDimension features: ${parcelDimension.featureCount}`);
  console.log(`Sample parcel ${parcelAccount || "(none)"} matched account: ${report.matchSample.matchedAccount}`);
  console.log(`Sample parcel ${parcelAccount || "(none)"} matched appraisal: ${report.matchSample.matchedAppraisal}`);
}

main();

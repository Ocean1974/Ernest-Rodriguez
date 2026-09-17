const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse");
const shapefile = require("shapefile");
const proj4 = require("proj4");

const root = path.join(__dirname, "..");
const outputDir = path.join(root, "output");
const extractedDir = path.join(root, "data", "extracted");
const statePlane =
  "+proj=lcc +lat_1=32.13333333333333 +lat_2=33.96666666666667 +lat_0=31.66666666666667 +lon_0=-98.5 +x_0=600000 +y_0=2000000 +datum=NAD83 +units=us-ft +no_defs";

const sources = [
  { name: "PARCEL_GEOM", type: "shapefile", folder: "PARCEL_GEOM", base: "PARCEL_GEOM" },
  { name: "BLKID", type: "shapefile", folder: "BLKID", base: "BLKID" },
  { name: "ParcelDimension", type: "shapefile", folder: "ParcelDimension", base: "ParcelDimension" },
  { name: "ACCOUNT_INFO.CSV", type: "csv", file: path.join(extractedDir, "DCAD2026_CURRENT", "ACCOUNT_INFO.CSV") },
  { name: "ACCOUNT_APPRL_YEAR.CSV", type: "csv", file: path.join(extractedDir, "DCAD2026_CURRENT", "ACCOUNT_APPRL_YEAR.CSV") },
  { name: "COM_DETAIL.CSV", type: "csv", file: path.join(extractedDir, "DCAD2026_CURRENT", "COM_DETAIL.CSV") },
  { name: "LAND.CSV", type: "csv", file: path.join(extractedDir, "DCAD2026_CURRENT", "LAND.CSV") },
];

function transformCoordinates(coordinates) {
  if (!Array.isArray(coordinates)) return coordinates;
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") return proj4(statePlane, "WGS84", coordinates);
  return coordinates.map(transformCoordinates);
}

function csvSchema(file) {
  return new Promise((resolve, reject) => {
    let fields = [];
    let count = 0;
    const sample = [];
    fs.createReadStream(file)
      .pipe(parse({ columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }))
      .on("headers", (headers) => {
        fields = headers;
      })
      .on("data", (row) => {
        if (!fields.length) fields = Object.keys(row);
        if (sample.length < 5) sample.push(row);
        count += 1;
      })
      .on("error", reject)
      .on("end", () => resolve({ filename: path.basename(file), fileType: "CSV", rowCount: count, fields, sampleRecords: sample }));
  });
}

async function shapefileSchema(folder, base) {
  const shp = path.join(extractedDir, folder, `${base}.shp`);
  const dbf = path.join(extractedDir, folder, `${base}.dbf`);
  const source = await shapefile.open(shp, dbf);
  let rowCount = 0;
  let fields = [];
  const sampleRecords = [];
  while (true) {
    const next = await source.read();
    if (next.done) break;
    if (!fields.length) fields = Object.keys(next.value.properties || {});
    if (sampleRecords.length < 5) sampleRecords.push(next.value.properties || {});
    rowCount += 1;
  }
  return { filename: `${base}.shp/.dbf`, fileType: "Shapefile", rowCount, fields, sampleRecords };
}

async function writeGeoJsonFromShapefile(folder, base, outName, propertyMapper = (properties) => properties) {
  const shp = path.join(extractedDir, folder, `${base}.shp`);
  const dbf = path.join(extractedDir, folder, `${base}.dbf`);
  const out = path.join(outputDir, outName);
  const source = await shapefile.open(shp, dbf);
  const stream = fs.createWriteStream(out, { encoding: "utf8" });
  let count = 0;
  stream.write('{"type":"FeatureCollection","features":[\n');
  while (true) {
    const next = await source.read();
    if (next.done) break;
    const feature = {
      type: "Feature",
      properties: propertyMapper(next.value.properties || {}),
      geometry: { ...next.value.geometry, coordinates: transformCoordinates(next.value.geometry.coordinates) },
    };
    if (count > 0) stream.write(",\n");
    stream.write(JSON.stringify(feature));
    count += 1;
    if (count % 100000 === 0) console.log(`${outName}: ${count.toLocaleString()} features`);
  }
  stream.write("\n]}\n");
  await new Promise((resolve) => stream.end(resolve));
  return { out, count };
}

function writeReports(schemaItems) {
  const schemaReport = {
    generatedAt: new Date().toISOString(),
    sources: schemaItems,
  };
  fs.writeFileSync(path.join(outputDir, "schema-report.json"), JSON.stringify(schemaReport, null, 2));

  const md = [
    "# White Rabbit Schema Report",
    "",
    `Generated: ${schemaReport.generatedAt}`,
    "",
    ...schemaItems.flatMap((item) => [
      `## ${item.filename}`,
      "",
      `- File type: ${item.fileType}`,
      `- Row count: ${item.rowCount}`,
      `- Fields: ${item.fields.join(", ") || "none detected"}`,
      "",
      "Sample records:",
      "",
      "```json",
      JSON.stringify(item.sampleRecords, null, 2),
      "```",
      "",
    ]),
  ].join("\n");
  fs.writeFileSync(path.join(outputDir, "schema-report.md"), md);

  const joinReport = `# White Rabbit Join Key Report

## Confirmed / Best Join Keys

- PARCEL_GEOM uses field \`Acct\`.
- DCAD ACCOUNT_INFO.CSV uses \`ACCOUNT_NUM\` and includes \`GIS_PARCEL_ID\`.
- DCAD ACCOUNT_APPRL_YEAR.CSV uses \`ACCOUNT_NUM\` and includes \`GIS_PARCEL_ID\`.
- DCAD LAND.CSV uses \`ACCOUNT_NUM\`.

Best primary join:

\`\`\`text
PARCEL_GEOM.Acct -> DCAD ACCOUNT_NUM
\`\`\`

Secondary / fallback join:

\`\`\`text
PARCEL_GEOM.Acct -> DCAD GIS_PARCEL_ID
\`\`\`

## BLKID

BLKID has a \`TEXT\` label field and polygon geometry. It does not expose parcel account IDs in the inspected schema, so joins are spatial/nearest-label joins, not direct key joins.

## ParcelDimension

ParcelDimension has a \`TEXT\` measurement field and geometry. It does not expose parcel account IDs in the inspected schema, so joins are spatial/nearest-label joins, not direct key joins.

## Uncertainty

BLKID and ParcelDimension joins are spatial/nearest-feature joins because no direct account, parcel, or GIS ID field was present in the inspected DBF schemas.
`;
  fs.writeFileSync(path.join(outputDir, "join-key-report.md"), joinReport);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const schemaItems = [];
  for (const source of sources) {
    console.log(`Inspecting ${source.name}`);
    if (source.type === "csv") schemaItems.push(await csvSchema(source.file));
    else schemaItems.push(await shapefileSchema(source.folder, source.base));
  }
  writeReports(schemaItems);

  if (!fs.existsSync(path.join(outputDir, "parcel_geom.geojson"))) {
    await writeGeoJsonFromShapefile("PARCEL_GEOM", "PARCEL_GEOM", "parcel_geom.geojson");
  }
  if (!fs.existsSync(path.join(outputDir, "blkid.geojson"))) {
    await writeGeoJsonFromShapefile("BLKID", "BLKID", "blkid.geojson");
  }
  if (!fs.existsSync(path.join(outputDir, "parcel_dimension.geojson"))) {
    await writeGeoJsonFromShapefile("ParcelDimension", "ParcelDimension", "parcel_dimension.geojson");
  }

  const vectorDir = path.join(outputDir, "vector-tiles");
  fs.mkdirSync(vectorDir, { recursive: true });
  fs.writeFileSync(
    path.join(vectorDir, "README.md"),
    "# Vector Tile Output\n\nThe joined GeoJSON is large. Tippecanoe/PMTiles is not bundled in this Windows workspace, so this folder records the production vector-tile target. Use `output/white-rabbit-dallas-parcels.geojson` as input to Tippecanoe or PMTiles in deployment.\n",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

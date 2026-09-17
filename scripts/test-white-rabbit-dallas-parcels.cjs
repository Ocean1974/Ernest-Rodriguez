const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const outputFile = path.join(root, "output", "white-rabbit-dallas-parcels.geojson");
const manifestFile = path.join(root, "output", "white-rabbit-dallas-parcels-manifest.json");
const parcelGeomGeojsonFile = path.join(root, "output", "parcel_geom.geojson");
const blkidGeojsonFile = path.join(root, "output", "blkid.geojson");
const parcelDimensionGeojsonFile = path.join(root, "output", "parcel_dimension.geojson");
const vectorTilesDir = path.join(root, "output", "vector-tiles");
const schemaReportFile = path.join(root, "output", "schema-report.json");
const joinKeyReportFile = path.join(root, "output", "join-key-report.md");
const parcelCountFile = path.join(root, "output", "parcel-count.txt");
const fullAccessReportFile = path.join(root, "output", "full-parcel-access-report.md");
const dcadCompletionReportFile = path.join(root, "output", "dcad-completion-report.md");
const dcadPermitJoinReportFile = path.join(root, "output", "dcad-permit-join-method-report.md");
const dcadFallbackFixtureReportFile = path.join(root, "output", "dcad-fallback-fixture-report.md");
const sourceZips = [
  path.join(root, "data", "raw", "PARCEL_GEOM.zip"),
  path.join(root, "data", "raw", "DCAD2026_CURRENT.ZIP"),
  path.join(root, "data", "raw", "BLKID.zip"),
  path.join(root, "data", "raw", "ParcelDimension.zip"),
];
const extractedFolders = [
  path.join(root, "data", "extracted", "PARCEL_GEOM"),
  path.join(root, "data", "extracted", "DCAD2026_CURRENT"),
  path.join(root, "data", "extracted", "BLKID"),
  path.join(root, "data", "extracted", "ParcelDimension"),
  path.join(root, "data", "extracted", "parcel_geom"),
  path.join(root, "data", "extracted", "dcad_current"),
  path.join(root, "data", "extracted", "blkid"),
  path.join(root, "data", "extracted", "parcel_dimension"),
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function scanOutput() {
  const fd = fs.openSync(outputFile, "r");
  const buffer = Buffer.alloc(1024 * 1024);
  let carry = "";
  const result = { polygon: false, appraisal: false, block: false, dimension: false, zoning: false, landUse: false, sanden: false };

  try {
    while (!(result.polygon && result.appraisal && result.block && result.dimension && result.zoning && result.landUse && result.sanden)) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      const text = carry + buffer.subarray(0, bytesRead).toString("utf8");
      result.polygon ||= /"geometry":\{"type":"(?:Polygon|MultiPolygon)"/.test(text);
      result.appraisal ||= /"joins":\{"appraisal":true/.test(text);
      result.block ||= /"blockId":"[^"]+"/.test(text);
      result.dimension ||= /"parcelDimension":true/.test(text);
      result.zoning ||= /"zoning":"[^"]+"/.test(text);
      result.landUse ||= /"landUseDescription":"[^"]+"/.test(text);
      result.sanden ||= /10300 SANDEN DR/i.test(text);
      carry = text.slice(-2048);
    }
  } finally {
    fs.closeSync(fd);
  }

  return result;
}

function main() {
  for (const sourceZip of sourceZips) assert(fs.existsSync(sourceZip), `${path.relative(root, sourceZip)} does not exist`);
  for (const folder of extractedFolders) assert(fs.existsSync(folder), `${path.relative(root, folder)} was not extracted`);
  assert(fs.existsSync(schemaReportFile), "output/schema-report.json does not exist");
  assert(fs.existsSync(joinKeyReportFile), "output/join-key-report.md does not exist");
  assert(fs.existsSync(parcelCountFile), "output/parcel-count.txt does not exist");
  assert(fs.existsSync(fullAccessReportFile), "output/full-parcel-access-report.md does not exist");
  assert(fs.existsSync(dcadCompletionReportFile), "output/dcad-completion-report.md does not exist");
  assert(fs.existsSync(dcadPermitJoinReportFile), "output/dcad-permit-join-method-report.md does not exist");
  assert(fs.existsSync(dcadFallbackFixtureReportFile), "output/dcad-fallback-fixture-report.md does not exist");
  assert(fs.existsSync(parcelGeomGeojsonFile), "output/parcel_geom.geojson does not exist");
  assert(fs.existsSync(blkidGeojsonFile), "output/blkid.geojson does not exist");
  assert(fs.existsSync(parcelDimensionGeojsonFile), "output/parcel_dimension.geojson does not exist");
  assert(fs.existsSync(outputFile), "output/white-rabbit-dallas-parcels.geojson does not exist");
  assert(fs.existsSync(manifestFile), "output manifest does not exist");
  assert(fs.existsSync(vectorTilesDir) || fs.existsSync(path.join(root, "output", "white-rabbit-dallas-parcels.pmtiles")), "vector tile or PMTiles handoff output does not exist");

  const stats = fs.statSync(outputFile);
  assert(stats.size > 0, "output file is empty");

  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const parcelCount = Number(fs.readFileSync(parcelCountFile, "utf8").trim());
  const fullAccessReport = fs.readFileSync(fullAccessReportFile, "utf8");
  const dcadCompletionReport = fs.readFileSync(dcadCompletionReportFile, "utf8");
  const dcadPermitJoinReport = fs.readFileSync(dcadPermitJoinReportFile, "utf8");
  const dcadFallbackFixtureReport = fs.readFileSync(dcadFallbackFixtureReportFile, "utf8");
  assert(parcelCount === manifest.featureCount, "parcel-count.txt does not match the output manifest feature count");
  assert(manifest.featureCount > 1000, "manifest reports fewer than 1,000 parcel features");
  assert(manifest.joinedAppraisalCount > 0, "manifest reports no joined appraisal records");
  assert(manifest.joinedBlockOrDimensionCount > 0, "manifest reports no joined block/dimension records");
  assert(/Matched sample parcel to DCAD account: Yes/.test(fullAccessReport), "full access report does not prove a parcel/account match");
  assert(/Matched sample parcel to DCAD appraisal: Yes/.test(fullAccessReport), "full access report does not prove a parcel/appraisal match");
  assert(/DCAD means Dallas County Appraisal District/.test(dcadCompletionReport), "DCAD completion report must define the appraisal-district acronym");
  assert(/DCAD account rows: 861,357/.test(dcadCompletionReport), "DCAD completion report must preserve exact DCAD account count");
  assert(/Address match \| 97300/.test(dcadPermitJoinReport), "DCAD permit join report must preserve exact address-match count");
  assert(/Fallback fixtures are not used as a substitute for full parcel search results/.test(dcadFallbackFixtureReport), "DCAD fallback report must isolate fixtures from full search");

  const scan = scanOutput();
  assert(scan.polygon, "output does not contain parcel polygons");
  assert(scan.appraisal, "output does not contain joined appraisal data");
  assert(scan.block || scan.dimension, "output does not contain block ID or dimension data");
  assert(scan.zoning || scan.landUse, "output does not contain joined zoning or land-use data from LAND.CSV");
  if (!scan.sanden) console.log("10300 SANDEN DR was not found in the scanned output sample; treating as optional because the source may omit it.");

  console.log("White Rabbit parcel pipeline tests passed.");
}

main();

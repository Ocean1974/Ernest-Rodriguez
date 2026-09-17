const fs = require("fs");
const path = require("path");
const { buildDevelopmentSignal, classifyDevelopmentSignal } = require("../scripts/development-intel-utils.cjs");

const root = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const newConstruction = classifyDevelopmentSignal({
  permitType: "Building (BU) Multi Family New Construction",
  description: "New construction",
});
assert(newConstruction.signalType === "new_construction", "New construction permits should be classified as development signals");

const demolition = classifyDevelopmentSignal({
  permitType: "Demolition Permit Commercial",
});
assert(demolition.signalType === "demolition", "Demolition permits should be classified as site-prep development signals");

const signal = buildDevelopmentSignal({
  permitRecordId: "e7gq-4sah-test",
  sourceDataset: "e7gq-4sah",
  sourceName: "Dallas OpenData Building Permits",
  sourceUrl: "https://www.dallasopendata.com/resource/e7gq-4sah.json",
  permitNumber: "TEST-1",
  permitType: "Building (BU) Commercial New Construction",
  issueDate: "2026-01-15",
  address: "100 MAIN ST",
  parcelAccountNum: "000001",
  parcelGisId: "000001",
  joinMethod: "address_match",
  latitude: 32.77,
  longitude: -96.79,
});
assert(signal.parcelId === "000001", "Development signal should preserve parcel ID");
assert(signal.provenance.some((item) => item.field === "parcelId"), "Development signal should track parcel provenance");

const requiredFiles = [
  "output/development-intelligence.json",
  "output/development-intelligence-report.md",
  "output/upcoming-development-parcels.geojson",
  "output/unmatched-development-signals.csv",
  "public/data/developments/parcel-development-index.json",
];
for (const relative of requiredFiles) {
  const file = path.join(root, relative);
  assert(fs.existsSync(file), `Missing development intelligence output: ${relative}`);
  assert(fs.statSync(file).size > 0, `Development intelligence output is empty: ${relative}`);
}

const report = fs.readFileSync(path.join(root, "output", "development-intelligence-report.md"), "utf8");
assert(report.includes("Does not redesign or change any frontend page"), "Development report must document that no pages were redesigned");
assert(report.includes("Development signals linked to parcel IDs"), "Development report must include linked signal counts");

const payload = readJson(path.join(root, "output", "development-intelligence.json"));
assert(payload.developmentSignalCount > 0, "Development intelligence should include at least one linked signal");
assert(payload.parcelCountWithSignals > 0, "Development intelligence should include parcel-linked signals");
assert(payload.signalTypeCounts.new_construction > 0, "Development intelligence should include new construction signals");
assert(JSON.stringify(payload.dallasNowStaging) === JSON.stringify({
  sourceRecordCount: 1746,
  certifiedExactLinkCount: 1227,
  classifiedExactSignalCount: 777,
  ambiguousRecordCount: 70,
  unmatchedRecordCount: 400,
  invalidRecordCount: 49,
  independentReuseRightsCertified: false,
  visibleUiActivated: false,
  sourceDateSemantics: "dallasnow-search-record-date-not-permit-issuance-date",
}), "DallasNow staging counts and activation gates should remain exact");
assert(payload.stagedSignals.dallasNowBuilding.length === 777, "Only classified, exact-linked DallasNow records should be staged");
assert(payload.stagedSignals.dallasNowBuilding.every((signal) => signal.parcelId && signal.source.dataset === "dallasnow-building"), "Every staged DallasNow signal must retain an exact parcel identity and source identity");
assert(payload.stagedSignals.dallasNowBuilding.every((signal) => signal.source.dateSemantics === "dallasnow-search-record-date-not-permit-issuance-date" && !signal.source.issueDate), "DallasNow record dates must never be represented as permit issuance dates");
assert(!payload.signals.some((signal) => signal.source.dataset === "dallasnow-building"), "The DallasNow feed must stay outside runtime signals until its rights and activation gates pass");
assert(!payload.sourceDatasets.includes("dallasnow-building"), "A staged source must not appear in the active runtime source list");

const geojson = readJson(path.join(root, "output", "upcoming-development-parcels.geojson"));
assert(geojson.type === "FeatureCollection", "Development parcel output should be GeoJSON");
assert(geojson.features.length > 0, "Development parcel GeoJSON should include features");

const parcelIndex = readJson(path.join(root, "public", "data", "developments", "parcel-development-index.json"));
assert(parcelIndex.parcelCount === payload.parcelCountWithSignals, "Development parcel index should cover every parcel with linked signals");
assert(parcelIndex.records.some((record) => record.parcelId && record.signalCount > 0), "Development parcel index should expose parcel IDs and signal counts");
assert(parcelIndex.records.some((record) => record.parcelPropertyName && record.parcelAddress), "Development parcel index should expose searchable project/property names and addresses");

console.log("White Rabbit development intelligence tests passed.");

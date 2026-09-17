const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const capture = readJson("data/raw/angelina-county-tx/official-2026-09-11/capture-manifest.json");
const source = readJson("data/county-adapters/angelina-county-tx/angelina-county-tx-source-manifest.json");
const adapter = readJson("data/county-adapters/angelina-county-tx/adapter.json");

assert(capture.archives.length === 5, "Angelina capture must preserve five official archives");
assert(capture.archives.every((archive) => fs.existsSync(path.join(root, "data/raw/angelina-county-tx/official-2026-09-11", archive.file))), "Every captured archive must exist");
assert(capture.counts.parcelGeometryFeatures === 60935, "Angelina parcel count must stay exact");
assert(capture.counts.parcelGeometryMissing === 0, "Angelina missing geometry count must stay exact");
assert(capture.counts.appraisalInfoRows === 70427, "Angelina appraisal row count must stay exact");
assert(capture.identity.propId.distinct === 54423, "Angelina distinct parcel property ID count must stay exact");
assert(capture.identity.propId.duplicateExcess === 6512, "Angelina duplicate parcel feature count must stay explicit");
assert(capture.appraisalJoin.matchedFeatures === 59655, "Angelina matched feature count must stay exact");
assert(capture.appraisalJoin.unmatchedFeatures === 1280, "Angelina unmatched feature count must stay exact");
assert(capture.activationAuthorized === false, "Angelina capture must not authorize activation");
assert(source.completion_impact === "official-snapshot-captured-schema-and-join-audited", "Angelina source status must reflect capture and inspection");
assert(adapter.status === "pilot", "Angelina must remain a pilot");
assert(adapter.verifiedCounts.parcelGeometryFeatures === 60935, "Angelina adapter must preserve the captured feature count");

console.log("White Rabbit Angelina County source capture tests passed.");

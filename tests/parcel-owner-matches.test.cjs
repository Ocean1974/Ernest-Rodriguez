const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const outputFile = path.join(root, "output", "parcel-owner-matches.json");
const reportFile = path.join(root, "output", "parcel-owner-match-report.md");
const adapterFile = path.join(root, "data", "county-adapters", "dallas", "adapter.json");

assert(fs.existsSync(outputFile), "Missing parcel owner match JSON output");
assert(fs.existsSync(reportFile), "Missing parcel owner match report");

const report = fs.readFileSync(reportFile, "utf8");
const adapter = readJson(adapterFile);
assert(adapter.ownerEnrichment.officialJoinKey === "PARCEL_GEOM.Acct -> DCAD ACCOUNT_INFO.ACCOUNT_NUM", "Dallas owner join key must live in the county adapter");
assert(adapter.ownerEnrichment.fields.ownerPhone === "ACCOUNT_INFO.PHONE_NUM", "Dallas owner phone field mapping must live in the county adapter");
assert(report.includes("PARCEL_GEOM.Acct -> DCAD ACCOUNT_INFO.ACCOUNT_NUM"), "Owner match report must document the official parcel-to-owner join key");
assert(report.includes("Permit contacts promoted to owner contacts: 0"), "Owner match report must confirm permit contacts were not promoted to owner contacts");
assert(report.includes("No official email field was identified"), "Owner match report must document official email field status");
assert(report.includes("County adapter"), "Owner match report must document the county adapter source");

const fd = fs.openSync(outputFile, "r");
const buffer = Buffer.alloc(120000);
const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
fs.closeSync(fd);
const payloadStart = buffer.subarray(0, bytesRead).toString("utf8");
assert(payloadStart.includes('"officialPropertyRecord"'), "Owner match output must include official property-record fields");
assert(payloadStart.includes('"sourceCountyId"'), "Owner match output must include county-aware owner source id");
assert(payloadStart.includes('"countyParcelId"'), "Owner match output must include county-aware parcel id");
assert(payloadStart.includes('"ownerPhone"'), "Owner match output must include official owner phone slot");
assert(payloadStart.includes('"ownerEmail"'), "Owner match output must include official owner email slot");
assert(payloadStart.includes('"permitContractorPromotedToOwner":false'), "Owner match output must guard against contractor promotion");

const manifest = readJson(path.join(root, "public", "data", "parcels", "manifest.json"));
assert(report.includes(`Source parcels: ${manifest.featureCount}`), "Owner match report must cover all parcel records");

console.log("White Rabbit parcel owner match tests passed.");

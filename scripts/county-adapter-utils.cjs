const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function resolveCountyAdapter(county = process.env.WR_COUNTY || "dallas") {
  const adapterFile = path.join(root, "data", "county-adapters", county, "adapter.json");
  if (!fs.existsSync(adapterFile)) throw new Error(`Missing county adapter: ${path.relative(root, adapterFile)}`);
  const adapter = readJson(adapterFile);
  return {
    county,
    adapter,
    adapterFile,
  };
}

function ownerEnrichmentConfig(adapter) {
  const config = adapter.ownerEnrichment || {};
  const appraisalSource = adapter.appraisalDistrictName || adapter.countyName || adapter.id;
  const fields = {
    parcelId: "accountNum/accountNumber",
    gisParcelId: "gisParcelId",
    ownerName: "ownerName/propertyName",
    ownerName2: "ownerName2",
    businessName: "businessName",
    ownerMailingAddress: "ownerMailingAddress",
    ownerMailingAddress2: "ownerMailingAddress2",
    ownerCity: "ownerCity",
    ownerState: "ownerState",
    ownerZip: "ownerZip",
    ownerCountry: "ownerCountry",
    ownerPhone: "ownerPhone",
    ownerEmail: "ownerEmail",
    ...(config.fields || {}),
  };
  return {
    sourceCountyId: adapter.id,
    countyName: adapter.countyName,
    appraisalDistrictName: adapter.appraisalDistrictName,
    sourceLabel: config.sourceLabel || `${appraisalSource} parcel owner records`,
    propertyRecordSource: config.propertyRecordSource || `${appraisalSource} fields already joined into public parcel chunks`,
    officialJoinKey: config.officialJoinKey || adapter.joinKeys?.primaryParcelAccount || "county parcel account -> appraisal account",
    noOfficialEmailFieldNote: config.noOfficialEmailFieldNote || "No official owner email field was identified in the inspected appraisal source schema.",
    fields,
  };
}

module.exports = {
  ownerEnrichmentConfig,
  resolveCountyAdapter,
};

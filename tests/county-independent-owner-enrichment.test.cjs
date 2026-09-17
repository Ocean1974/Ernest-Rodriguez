const fs = require("fs");
const path = require("path");

const { ownerEnrichmentConfig, resolveCountyAdapter } = require("../scripts/county-adapter-utils.cjs");

const root = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const { adapter } = resolveCountyAdapter("dallas");
const ownerConfig = ownerEnrichmentConfig(adapter);
const ownerBuilder = fs.readFileSync(path.join(root, "scripts", "build-parcel-owner-matches.cjs"), "utf8");
const contactBuilder = fs.readFileSync(path.join(root, "scripts", "build-contact-enrichment.cjs"), "utf8");
const contactUtils = fs.readFileSync(path.join(root, "scripts", "contact-enrichment-utils.cjs"), "utf8");

assert(ownerConfig.sourceCountyId === "dallas-county-dcad", "Owner enrichment config should expose the Dallas county id");
assert(ownerConfig.officialJoinKey === "PARCEL_GEOM.Acct -> DCAD ACCOUNT_INFO.ACCOUNT_NUM", "Owner enrichment config should preserve Dallas owner join key");
assert(ownerConfig.fields.ownerName.includes("ACCOUNT_INFO"), "Owner enrichment config should expose Dallas owner field mappings");

const sampleConfig = ownerEnrichmentConfig({
  id: "next-county-cad",
  countyName: "Next County",
  appraisalDistrictName: "Next County Appraisal District",
  joinKeys: { primaryParcelAccount: "PARCEL.PIN -> OWNER.ACCOUNT" },
  ownerEnrichment: {
    sourceLabel: "Next County OWNER export",
    fields: {
      parcelId: "PARCEL.PIN",
      ownerName: "OWNER.NAME",
      ownerPhone: "OWNER.PHONE",
    },
  },
});
assert(sampleConfig.sourceCountyId === "next-county-cad", "Owner enrichment config should work for non-Dallas counties");
assert(sampleConfig.sourceLabel === "Next County OWNER export", "Owner enrichment source label should come from the county adapter");
assert(sampleConfig.fields.ownerPhone === "OWNER.PHONE", "Owner enrichment field mappings should be county supplied");

assert(ownerBuilder.includes("ownerEnrichmentConfig(adapter)"), "Owner match builder must read owner config from the county adapter");
assert(!ownerBuilder.includes("Dallas County Appraisal District ACCOUNT_INFO.CSV joined through PARCEL_GEOM.Acct -> ACCOUNT_NUM"), "Owner match builder should not hardcode the Dallas owner source sentence");
assert(contactBuilder.includes("ownerEnrichmentConfig(adapter)"), "Contact enrichment builder must read owner config from the county adapter");
assert(contactUtils.includes("buildContactRecord(parcel, suppression, options = {})"), "Contact enrichment utility must accept county owner options");
assert(contactUtils.includes("ownerConfig.fields"), "Contact enrichment utility must use county owner field mappings");

console.log("White Rabbit county-independent owner enrichment tests passed.");

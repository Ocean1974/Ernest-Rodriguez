const fs = require("fs");
const path = require("path");
const {
  buildContactRecord,
  classifyOwner,
  prepareSuppression,
} = require("../scripts/contact-enrichment-utils.cjs");
const { ownerEnrichmentConfig } = require("../scripts/county-adapter-utils.cjs");

const root = path.join(__dirname, "..");
const dallasAdapter = JSON.parse(fs.readFileSync(path.join(root, "data", "county-adapters", "dallas", "adapter.json"), "utf8"));
const dallasOwnerConfig = ownerEnrichmentConfig(dallasAdapter);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const businessParcel = {
  accountNum: "000001",
  gisParcelId: "000001",
  address: "100 MAIN ST",
  ownerName: "WHITE RABBIT HOLDINGS LLC",
  ownerMailingAddress: "100 OFFICE DR",
  ownerCity: "DALLAS",
  ownerState: "TX",
  ownerZip: "75201",
  ownerPhone: "214-555-0100",
};

const privateParcel = {
  accountNum: "000002",
  gisParcelId: "000002",
  address: "200 MAIN ST",
  ownerName: "DOE JANE",
  ownerMailingAddress: "200 HOME DR",
};

assert(classifyOwner(businessParcel).category === "business_entity_candidate", "LLC owner should be classified as a business/entity candidate");
assert(classifyOwner(privateParcel).category === "private_individual_candidate", "Personal owner should be classified as a private individual candidate");

const noSuppression = prepareSuppression({});
const businessRecord = buildContactRecord(businessParcel, noSuppression, { ownerConfig: dallasOwnerConfig });
assert(businessRecord.contacts.businessEntity, "Business/entity candidate should export a business contact record");
assert(businessRecord.contacts.businessEntity.mailingAddress === "100 OFFICE DR", "Business contact should include mailing address");
assert(businessRecord.contacts.permitParties.excludedFromOwnerContact === true, "Permit parties must remain separate from owner contacts");
assert(businessRecord.provenance.some((item) => item.field === "ownerPhone" && item.sourceField.includes("PHONE_NUM")), "Owner phone provenance should point to DCAD PHONE_NUM");

const genericOwnerConfig = ownerEnrichmentConfig({
  id: "sample-county-cad",
  countyName: "Sample County",
  appraisalDistrictName: "Sample County Appraisal District",
  joinKeys: { primaryParcelAccount: "GEOM.PIN -> CAD.OWNER_ID" },
  ownerEnrichment: {
    sourceLabel: "Sample CAD OWNER table",
    fields: {
      ownerName: "OWNER_FULL_NAME",
      ownerPhone: "OWNER_PHONE",
    },
  },
});
const genericRecord = buildContactRecord({ ...businessParcel, sourceCountyId: "sample-county-cad" }, noSuppression, { ownerConfig: genericOwnerConfig });
assert(genericRecord.sourceCountyId === "sample-county-cad", "Contact enrichment should preserve non-Dallas county IDs");
assert(genericRecord.provenance.some((item) => item.source === "Sample CAD OWNER table" && item.sourceField === "OWNER_PHONE"), "Contact enrichment should use county adapter owner field mappings");

const privateRecord = buildContactRecord(privateParcel, noSuppression);
assert(!privateRecord.contacts.businessEntity, "Private individual candidate must not export a business contact record");
assert(privateRecord.contacts.privateIndividual.excluded === true, "Private individual candidate should be explicitly excluded");

const suppression = prepareSuppression({ suppressAccounts: ["000001"] });
const suppressedRecord = buildContactRecord(businessParcel, suppression);
assert(suppressedRecord.suppression.suppressed === true, "Suppression list should suppress matching account");
assert(!suppressedRecord.contacts.businessEntity, "Suppressed records must not export business contacts");

const outputFile = path.join(root, "output", "parcel-contact-enrichment.json");
const reportFile = path.join(root, "output", "parcel-contact-enrichment-report.md");
assert(fs.existsSync(outputFile), "Missing parcel contact enrichment JSON output");
assert(fs.existsSync(reportFile), "Missing parcel contact enrichment report");

const report = fs.readFileSync(reportFile, "utf8");
assert(report.includes("Permit contacts promoted to owner contacts: 0"), "Report must confirm permit contacts were not promoted to owner contacts");
assert(report.includes("Supports opt-out/suppression"), "Report must document suppression support");
assert(report.includes("county adapter"), "Report must document county-adapter owner enrichment scope");

console.log("White Rabbit contact enrichment tests passed.");

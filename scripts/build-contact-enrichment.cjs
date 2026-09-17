const fs = require("fs");
const path = require("path");
const { buildContactRecord, prepareSuppression } = require("./contact-enrichment-utils.cjs");
const { ownerEnrichmentConfig, resolveCountyAdapter } = require("./county-adapter-utils.cjs");

const root = path.join(__dirname, "..");
const parcelManifestFile = path.join(root, "public", "data", "parcels", "manifest.json");
const parcelServiceDir = path.join(root, "public", "data", "parcels");
const suppressionFile = path.join(root, "data", "contact-suppression-list.json");
const outputDir = path.join(root, "output");
const outputJsonFile = path.join(outputDir, "parcel-contact-enrichment.json");
const outputReportFile = path.join(outputDir, "parcel-contact-enrichment-report.md");
const suppressedCsvFile = path.join(outputDir, "parcel-contact-suppressed.csv");
const privateExcludedCsvFile = path.join(outputDir, "parcel-contact-private-excluded.csv");
const { adapter } = resolveCountyAdapter();
const ownerConfig = ownerEnrichmentConfig(adapter);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function appendCsvRows(file, rows) {
  if (!rows.length) return;
  fs.appendFileSync(file, rows.map((row) => row.map(csvEscape).join(",")).join("\n") + "\n");
}

function initCsv(file, headers) {
  fs.writeFileSync(file, headers.map(csvEscape).join(",") + "\n");
}

function countProvenanceValue(record, field) {
  return record.provenance.some((item) => item.field === field && item.valuePresent);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const manifest = readJson(parcelManifestFile);
  const suppression = prepareSuppression(readJson(suppressionFile));
  const summary = {
    generatedAt: new Date().toISOString(),
    source: "public/data/parcels",
    sourceCountyId: ownerConfig.sourceCountyId,
    countyName: ownerConfig.countyName,
    sourceFeatureCount: manifest.featureCount,
    recordsWritten: 0,
    businessEntityCandidates: 0,
    privateIndividualCandidates: 0,
    unclassified: 0,
    unknown: 0,
    suppressed: 0,
    exportedBusinessMailingContacts: 0,
    ownerPhonesPresentFromDcad: 0,
    ownerEmailsPresentFromDcad: 0,
    permitContactsPromotedToOwner: 0,
  };

  initCsv(suppressedCsvFile, ["accountNum", "ownerName", "propertyAddress", "matchedRules"]);
  initCsv(privateExcludedCsvFile, ["accountNum", "ownerName", "propertyAddress", "reason"]);

  const out = fs.createWriteStream(outputJsonFile, { encoding: "utf8" });
  out.write('{"generatedAt":"' + summary.generatedAt + '","source":"public/data/parcels","records":[\n');
  let first = true;

  for (const chunk of manifest.chunks) {
    const payload = readJson(path.join(parcelServiceDir, chunk.file));
    const suppressedRows = [];
    const privateRows = [];
    for (const parcel of payload.parcels || []) {
      const record = buildContactRecord(parcel, suppression, { ownerConfig });
      if (!first) out.write(",\n");
      out.write(JSON.stringify(record));
      first = false;
      summary.recordsWritten += 1;
      if (record.ownerClassification.category === "business_entity_candidate") summary.businessEntityCandidates += 1;
      else if (record.ownerClassification.category === "private_individual_candidate") summary.privateIndividualCandidates += 1;
      else if (record.ownerClassification.category === "unknown") summary.unknown += 1;
      else summary.unclassified += 1;
      if (record.suppression.suppressed) {
        summary.suppressed += 1;
        suppressedRows.push([record.accountNum, record.ownerName, record.propertyAddress, record.suppression.matchedRules.join("|")]);
      }
      if (record.contacts.businessEntity?.mailingAddress) summary.exportedBusinessMailingContacts += 1;
      if (countProvenanceValue(record, "ownerPhone")) summary.ownerPhonesPresentFromDcad += 1;
      if (countProvenanceValue(record, "ownerEmail")) summary.ownerEmailsPresentFromDcad += 1;
      if (record.contacts.privateIndividual?.excluded) {
        privateRows.push([record.accountNum, record.ownerName, record.propertyAddress, record.contacts.privateIndividual.reason]);
      }
    }
    appendCsvRows(suppressedCsvFile, suppressedRows);
    appendCsvRows(privateExcludedCsvFile, privateRows);
  }

  out.write("\n],\"summary\":" + JSON.stringify(summary) + "}\n");
  await new Promise((resolve) => out.end(resolve));

  const report = [
    "# Parcel Contact Enrichment Report",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "## Scope",
    "",
    `- Uses county adapter \`${ownerConfig.sourceCountyId}\` and parcel records from \`public/data/parcels\`.`,
    `- Owner source: ${ownerConfig.propertyRecordSource}.`,
    "- Separates business/entity candidates from private individual candidates.",
    "- Tracks field-level provenance for owner name, mailing address, phone, classification, and suppression.",
    "- Supports opt-out/suppression through `data/contact-suppression-list.json`.",
    "- Does not promote permit contractors/applicants into property-owner contact fields.",
    "- Does not scrape private social profiles or export private-individual contact records.",
    "",
    "## Counts",
    "",
    `- Source parcels: ${summary.sourceFeatureCount}`,
    `- Enrichment records written: ${summary.recordsWritten}`,
    `- Business/entity candidates: ${summary.businessEntityCandidates}`,
    `- Private individual candidates: ${summary.privateIndividualCandidates}`,
    `- Unclassified owners: ${summary.unclassified}`,
    `- Unknown owners: ${summary.unknown}`,
    `- Suppressed records: ${summary.suppressed}`,
    `- Exported business/entity mailing contacts: ${summary.exportedBusinessMailingContacts}`,
    `- Official owner phone values present: ${summary.ownerPhonesPresentFromDcad}`,
    `- Official owner email values present: ${summary.ownerEmailsPresentFromDcad}`,
    `- Permit contacts promoted to owner contacts: ${summary.permitContactsPromotedToOwner}`,
    "",
    "## Outputs",
    "",
    "- `output/parcel-contact-enrichment.json`",
    "- `output/parcel-contact-enrichment-report.md`",
    "- `output/parcel-contact-suppressed.csv`",
    "- `output/parcel-contact-private-excluded.csv`",
    "",
    "## Compliance Notes",
    "",
    "- Business/entity contact eligibility is rule-based and conservative.",
    "- Private individual candidates are represented only as excluded records with reason codes.",
    "- Registered-agent, SOS, broker, website, and public professional profile enrichment should be added as separate source-specific stages with their own provenance and suppression checks.",
  ].join("\n");
  fs.writeFileSync(outputReportFile, report);
  console.log(`Wrote ${outputJsonFile}`);
  console.log(`Wrote ${outputReportFile}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

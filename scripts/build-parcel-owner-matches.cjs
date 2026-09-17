const fs = require("fs");
const path = require("path");
const { ownerEnrichmentConfig, resolveCountyAdapter } = require("./county-adapter-utils.cjs");

const root = path.join(__dirname, "..");
const parcelServiceDir = path.join(root, "public", "data", "parcels");
const manifestFile = path.join(parcelServiceDir, "manifest.json");
const outputDir = path.join(root, "output");
const outputJsonFile = path.join(outputDir, "parcel-owner-matches.json");
const outputReportFile = path.join(outputDir, "parcel-owner-match-report.md");
const { adapter } = resolveCountyAdapter();
const ownerConfig = ownerEnrichmentConfig(adapter);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function clean(value) {
  return String(value ?? "").trim();
}

function officialOwnerRecord(parcel) {
  const ownerPhone = clean(parcel.ownerPhone);
  const ownerEmail = clean(parcel.ownerEmail);
  const parcelId = clean(parcel.countyParcelId || parcel.accountNum || parcel.accountNumber);
  return {
    sourceCountyId: clean(parcel.sourceCountyId || ownerConfig.sourceCountyId),
    parcelId,
    countyParcelId: parcelId,
    accountNum: clean(parcel.accountNum || parcel.accountNumber),
    gisParcelId: clean(parcel.gisParcelId),
    propertyAddress: clean(parcel.address || parcel.propertyAddress),
    officialPropertyRecord: {
      source: `${ownerConfig.sourceLabel} joined through ${ownerConfig.officialJoinKey}`,
      ownerName: clean(parcel.ownerName || parcel.propertyName),
      ownerName2: clean(parcel.ownerName2),
      businessName: clean(parcel.businessName),
      ownerMailingAddress: clean(parcel.ownerMailingAddress),
      ownerMailingAddress2: clean(parcel.ownerMailingAddress2),
      ownerCity: clean(parcel.ownerCity),
      ownerState: clean(parcel.ownerState),
      ownerZip: clean(parcel.ownerZip),
      ownerCountry: clean(parcel.ownerCountry),
      ownerPhone,
      ownerEmail,
    },
    contactAvailability: {
      hasOfficialOwnerPhone: ownerPhone.length > 0,
      hasOfficialOwnerEmail: ownerEmail.length > 0,
    },
    provenance: [
      { field: "parcelId", sourceField: ownerConfig.fields.parcelId },
      { field: "gisParcelId", sourceField: ownerConfig.fields.gisParcelId },
      { field: "ownerName", sourceField: ownerConfig.fields.ownerName },
      { field: "ownerName2", sourceField: ownerConfig.fields.ownerName2 },
      { field: "businessName", sourceField: ownerConfig.fields.businessName },
      { field: "ownerMailingAddress", sourceField: ownerConfig.fields.ownerMailingAddress },
      { field: "ownerMailingAddress2", sourceField: ownerConfig.fields.ownerMailingAddress2 },
      { field: "ownerCity", sourceField: ownerConfig.fields.ownerCity },
      { field: "ownerState", sourceField: ownerConfig.fields.ownerState },
      { field: "ownerZip", sourceField: ownerConfig.fields.ownerZip },
      { field: "ownerPhone", sourceField: ownerConfig.fields.ownerPhone },
      { field: "ownerEmail", sourceField: ownerConfig.fields.ownerEmail },
    ],
    safeguards: {
      permitContractorPromotedToOwner: false,
      pageRedesignRequired: false,
    },
  };
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const manifest = readJson(manifestFile);
  const summary = {
    generatedAt: new Date().toISOString(),
    source: "public/data/parcels",
    sourceCountyId: ownerConfig.sourceCountyId,
    countyName: ownerConfig.countyName,
    officialJoinKey: ownerConfig.officialJoinKey,
    sourceParcelCount: manifest.featureCount,
    recordsWritten: 0,
    ownerNameMatched: 0,
    mailingAddressMatched: 0,
    officialOwnerPhoneMatched: 0,
    officialOwnerEmailMatched: 0,
    permitContactsPromotedToOwner: 0,
  };

  const out = fs.createWriteStream(outputJsonFile, { encoding: "utf8" });
  out.write('{"generatedAt":"' + summary.generatedAt + '","joinKey":"' + summary.officialJoinKey + '","records":[\n');
  let first = true;

  for (const chunk of manifest.chunks) {
    const payload = readJson(path.join(parcelServiceDir, chunk.file));
    for (const parcel of payload.parcels || []) {
      const record = officialOwnerRecord(parcel);
      if (!first) out.write(",\n");
      out.write(JSON.stringify(record));
      first = false;
      summary.recordsWritten += 1;
      if (record.officialPropertyRecord.ownerName) summary.ownerNameMatched += 1;
      if (record.officialPropertyRecord.ownerMailingAddress) summary.mailingAddressMatched += 1;
      if (record.contactAvailability.hasOfficialOwnerPhone) summary.officialOwnerPhoneMatched += 1;
      if (record.contactAvailability.hasOfficialOwnerEmail) summary.officialOwnerEmailMatched += 1;
    }
  }

  out.write("\n],\"summary\":" + JSON.stringify(summary) + "}\n");
  await new Promise((resolve) => out.end(resolve));

  const report = [
    "# Parcel Owner Match Report",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "## Official Join",
    "",
    `- Join key: \`${summary.officialJoinKey}\``,
    `- County adapter: \`${ownerConfig.sourceCountyId}\``,
    `- Property-record source: ${ownerConfig.propertyRecordSource}.`,
    "- Permit contractors/applicants are not used as parcel-owner contacts.",
    "- No page redesign is required or performed by this pipeline.",
    "",
    "## Counts",
    "",
    `- Source parcels: ${summary.sourceParcelCount}`,
    `- Owner match records written: ${summary.recordsWritten}`,
    `- Owner names matched: ${summary.ownerNameMatched}`,
    `- Owner mailing addresses matched: ${summary.mailingAddressMatched}`,
    `- Official owner phone numbers found: ${summary.officialOwnerPhoneMatched}`,
    `- Official owner email addresses found: ${summary.officialOwnerEmailMatched}`,
    `- Permit contacts promoted to owner contacts: ${summary.permitContactsPromotedToOwner}`,
    "",
    "## Outputs",
    "",
    "- `output/parcel-owner-matches.json`",
    "- `output/parcel-owner-match-report.md`",
    "",
    "## Email Field Status",
    "",
    `${ownerConfig.noOfficialEmailFieldNote} This pipeline only fills owner email when an official owner email field is present upstream.`,
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

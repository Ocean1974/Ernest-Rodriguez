const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const rawDirectory = path.join(root, "data", "raw", "dallas-county-dcad", "demand", "supply");
const extractionPath = path.join(rawDirectory, "dallas-county-issued-permits-2026-ytd.extracted.json");
const outputJson = path.join(root, "output", "dallas-county-supply-intelligence.json");
const outputMarkdown = path.join(root, "output", "dallas-county-supply-intelligence.md");
const reportsPage = "https://www.dallascounty.org/departments/duas/permit-reports.php";
const sourceUrls = {
  "2026-01.pdf": "https://www.dallascounty.org/Assets/uploads/docs/duas/permit-reports/2026/January-2026.pdf",
  "2026-02.pdf": "https://www.dallascounty.org/Assets/uploads/docs/duas/permit-reports/2026/February.pdf",
  "2026-03.pdf": "https://www.dallascounty.org/Assets/uploads/docs/duas/permit-reports/2026/Monthly-Issued-Permits-March.pdf",
  "2026-04.pdf": "https://www.dallascounty.org/Assets/uploads/docs/duas/permit-reports/2026/April-2026.pdf",
  "2026-05.pdf": "https://www.dallascounty.org/Assets/uploads/docs/duas/permit-reports/2026/may-permits.pdf",
  "2026-06.pdf": "https://www.dallascounty.org/Assets/uploads/docs/duas/permit-reports/2026/June-permits.pdf",
  "2026-07.pdf": "https://www.dallascounty.org/Assets/uploads/docs/duas/permit-reports/2026/July.pdf",
};

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function countBy(records, key) {
  return Object.fromEntries([...records.reduce((counts, record) => counts.set(record[key], (counts.get(record[key]) || 0) + 1), new Map())].sort(([a], [b]) => a.localeCompare(b)));
}

const extractionRaw = fs.readFileSync(extractionPath);
const extraction = JSON.parse(extractionRaw);
if (extraction.sourceFileCount !== 7 || extraction.recordCount !== 191) throw new Error("Expected seven official 2026 reports and 191 permit events.");
if (extraction.rejectedRowCount !== 0 || extraction.duplicatePermitEventCount !== 0) throw new Error("Permit extraction has rejected or duplicate event rows.");

const records = extraction.records;
const dates = records.map((record) => record.issuedDate).sort();
const monthlyCounts = Object.fromEntries([...records.reduce((counts, record) => {
  const month = record.issuedDate.slice(0, 7);
  return counts.set(month, (counts.get(month) || 0) + 1);
}, new Map())]);
const exactSupplySummary = {
  issuedPermitEvents: records.length,
  commercialPermitEvents: records.filter((record) => record.classification === "commercial").length,
  residentialPermitEvents: records.filter((record) => record.classification === "residential").length,
  unclassifiedPermitEvents: records.filter((record) => record.classification === "unclassified").length,
  newCommercialBuildingPermitEvents: records.filter((record) => record.permitType === "New Building (C)").length,
  residentialNoticeOfConstructionEvents: records.filter((record) => record.permitType === "Notice Of Construction (R)").length,
  firstIssuedDate: dates[0],
  lastIssuedDate: dates.at(-1),
};
const reportFiles = extraction.reports.map((report) => ({
  path: path.relative(root, path.join(rawDirectory, report.sourceFile)).replace(/\\/g, "/"),
  sourceUrl: sourceUrls[report.sourceFile],
  bytes: report.bytes,
  sha256: report.sha256,
  pageCount: report.pageCount,
  recordCount: report.records.length,
}));
const combinedSnapshotSha256 = sha256(reportFiles.map((report) => `${report.path}:${report.sha256}`).join("\n"));
const artifact = {
  schemaVersion: "wr-dallas-county-supply-intelligence-v1",
  generatedAt: new Date().toISOString(),
  countyId: "dallas-county-dcad",
  sourceAuthority: "Dallas County Unincorporated Area Services",
  sourceScope: "Dallas County-issued permits reported for January through July 2026",
  reportsPage,
  jurisdictionBoundary: {
    geographyLevel: "county",
    geographyId: "05000US48113",
    coverage: "county-administered-permit-service-subset",
    includesAllMunicipalPermits: false,
    semantics: "These are permits issued through Dallas County reports. They do not represent all permits issued by the City of Dallas or other municipalities in Dallas County.",
  },
  sourceFiles: reportFiles,
  combinedSnapshotSha256,
  extraction: {
    path: path.relative(root, extractionPath).replace(/\\/g, "/"),
    bytes: extractionRaw.length,
    sha256: sha256(extractionRaw),
    sourceFileCount: extraction.sourceFileCount,
    recordCount: extraction.recordCount,
    uniquePermitNumberCount: extraction.uniquePermitNumberCount,
    duplicatePermitNumberCount: extraction.duplicatePermitNumberCount,
    uniquePermitEventCount: extraction.uniquePermitEventCount,
    duplicatePermitEventCount: extraction.duplicatePermitEventCount,
    rejectedRowCount: extraction.rejectedRowCount,
  },
  exactSupplySummary,
  monthlyCounts,
  classificationCounts: countBy(records, "classification"),
  permitTypeCounts: countBy(records, "permitType"),
  records,
  activation: {
    sourceContentPersisted: true,
    sourceIdentityUnique: extraction.duplicatePermitEventCount === 0,
    reuseRightsCertified: false,
    municipalCoverageComplete: false,
    parcelAttributionBuilt: false,
    visibleUiActivated: false,
    lockedUiChanged: false,
  },
  blockers: [
    "Independent reuse-rights review is not recorded.",
    "Coverage is limited to Dallas County-issued permit reports and is not a countywide census of city-issued permits.",
    "No address normalization or parcel-spatial join has been certified for these records.",
  ],
};

fs.mkdirSync(path.dirname(outputJson), { recursive: true });
fs.writeFileSync(outputJson, `${JSON.stringify(artifact, null, 2)}\n`);
fs.writeFileSync(outputMarkdown, [
  "# Dallas County Supply Intelligence",
  "",
  `Generated: ${artifact.generatedAt}`,
  "",
  "## Scope",
  "",
  artifact.jurisdictionBoundary.semantics,
  "",
  "## Exact 2026 year-to-date capture",
  "",
  `- Period: ${exactSupplySummary.firstIssuedDate} through ${exactSupplySummary.lastIssuedDate}`,
  `- Official monthly PDF reports: ${reportFiles.length}`,
  `- Issued permit events: ${exactSupplySummary.issuedPermitEvents}`,
  `- Commercial: ${exactSupplySummary.commercialPermitEvents}`,
  `- Residential: ${exactSupplySummary.residentialPermitEvents}`,
  `- Unclassified: ${exactSupplySummary.unclassifiedPermitEvents}`,
  `- New commercial building: ${exactSupplySummary.newCommercialBuildingPermitEvents}`,
  `- Residential notice of construction: ${exactSupplySummary.residentialNoticeOfConstructionEvents}`,
  `- Unique permit events (permit number + issued date): ${extraction.uniquePermitEventCount}`,
  `- Duplicate permit events: ${extraction.duplicatePermitEventCount}`,
  `- Rejected table rows: ${extraction.rejectedRowCount}`,
  "",
  "## Monthly counts",
  "",
  ...Object.entries(monthlyCounts).map(([month, count]) => `- ${month}: ${count}`),
  "",
  "## Activation",
  "",
  "Source content is persisted and auditable. Rights review, complete municipal coverage, and certified parcel attribution remain blocked. No visible UI behavior changed.",
  "",
].join("\n"));

console.log(JSON.stringify({ ...exactSupplySummary, monthlyCounts, combinedSnapshotSha256 }, null, 2));

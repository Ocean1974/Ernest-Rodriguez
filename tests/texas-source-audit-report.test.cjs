const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

const packageJson = readJson("package.json");
const texasQueue = readJson("output/texas-county-verification-queue/texas-county-verification-queue.json");

assert(packageJson.scripts["county:texas-source-audit"] === "node scripts/build-texas-source-audit-report.cjs", "Package scripts must expose the Texas source audit report");

execFileSync("node", ["scripts/build-texas-source-audit-report.cjs"], { cwd: root, stdio: "pipe" });

const report = readJson("output/texas-source-audit/tx-batch-001-source-audit.json");
const reportMd = fs.readFileSync(path.join(root, "output", "texas-source-audit", "tx-batch-001-source-audit.md"), "utf8");
const aggregateReport = readJson("output/texas-source-audit/texas-source-audit.json");
const aggregateReportMd = fs.readFileSync(path.join(root, "output", "texas-source-audit", "texas-source-audit.md"), "utf8");

assert(report.version === "wr-tx-batch-001-official-portals-v1", "Source audit must use a stable version");
assert(report.summary.countyCount === 25, "Initial source audit must cover the full first active batch");
assert(report.summary.privateNotOfficial === 5, "Source audit must count private/non-official candidates separately");
assert(report.summary.promotedToCoreComplete === 0, "Portal discovery alone must not promote a county to core-complete");
assert(report.summary.dcadParityReady === 0, "Portal discovery alone must not make a county DCAD-parity ready");
assert(report.dcadParityRule.includes("Official portal discovery does not make a Texas county DCAD-like"), "Source audit must publish the DCAD parity rule");
assert(report.counties.every((county) => county.state === "TX"), "Source audit must stay in Texas");
const allowedDiscoveryImpacts = new Set([
  "source-discovery-started",
  "official-bulk-sources-found-inspection-needed",
  "official-snapshot-captured-schema-and-join-audited",
]);
assert(report.counties.every((county) => allowedDiscoveryImpacts.has(county.completionImpact)), "Initial audit may record source discovery or official bulk sources awaiting inspection");
const angelina = report.counties.find((county) => county.countyId === "angelina-county-tx");
assert(angelina?.completionImpact === "official-snapshot-captured-schema-and-join-audited", "Angelina must preserve its captured official snapshot status");
assert(angelina?.officialPortals.some((portal) => portal.sourceType === "official-bulk-download-index"), "Angelina must preserve its official bulk-download index");
assert(angelina?.remainingBlockers.includes("unique stable geometry-feature key or multipart consolidation rule not proven"), "Angelina capture must preserve its unresolved feature identity blocker");
assert(report.counties.every((county) => county.safeVisibleActivation === "do-not-activate"), "Initial Texas source audit counties must not be visibly activated");
assert(report.counties.every((county) => county.dcadParityStatus === "source-discovery-started-not-dcad-parity"), "Initial Texas source audit counties must stay below DCAD parity");
assert(report.counties.every((county) => county.countyId === "angelina-county-tx" || county.remainingBlockers.includes("exact parcel count not verified")), "Every uncaptured audited county must document missing exact counts");
assert(report.counties.every((county) => county.countyId === "angelina-county-tx" || county.remainingBlockers.includes("exact geometry-to-appraisal join key not verified")), "Every uncaptured audited county must document missing exact join keys");
assert(report.counties.every((county) => county.dcadParityBlockers.includes("owner/appraisal parcel window join not built")), "Each audited county must document missing owner/appraisal parcel-window joins");
assert(report.counties.every((county) => county.dcadParityBlockers.includes("ParcelDimension-equivalent source not verified")), "Each audited county must document missing ParcelDimension-equivalent sources");
assert(report.counties.every((county) => county.dcadParityBlockers.includes("viewport chunks not built")), "Each audited county must document missing viewport chunks");
assert(report.counties.every((county) => county.dcadParityBlockers.includes("search shards not built")), "Each audited county must document missing search shards");
assert(report.counties.every((county) => county.dcadParityBlockers.includes("county QA reports not generated")), "Each audited county must document missing QA reports");
assert(report.counties.some((county) => county.countyId === "archer-county-tx"), "Source audit must include Archer County");
assert(report.counties.some((county) => county.countyId === "armstrong-county-tx"), "Source audit must include Armstrong County");
assert(report.counties.some((county) => county.countyId === "atascosa-county-tx"), "Source audit must include Atascosa County");
assert(report.counties.some((county) => county.countyId === "austin-county-tx"), "Source audit must include Austin County");
assert(report.counties.some((county) => county.countyId === "bailey-county-tx"), "Source audit must include Bailey County");
assert(report.counties.some((county) => county.countyId === "bandera-county-tx"), "Source audit must include Bandera County");
assert(report.counties.some((county) => county.countyId === "bastrop-county-tx"), "Source audit must include Bastrop County");
assert(report.counties.some((county) => county.countyId === "baylor-county-tx"), "Source audit must include Baylor County");
assert(report.counties.some((county) => county.countyId === "bee-county-tx"), "Source audit must include Bee County");
assert(report.counties.some((county) => county.countyId === "bell-county-tx"), "Source audit must include Bell County");
assert(report.counties.some((county) => county.countyId === "bexar-county-tx"), "Source audit must include Bexar County");
assert(report.counties.some((county) => county.countyId === "blanco-county-tx"), "Source audit must include Blanco County");
assert(report.counties.some((county) => county.countyId === "borden-county-tx"), "Source audit must include Borden County");
assert(report.counties.some((county) => county.countyId === "bosque-county-tx"), "Source audit must include Bosque County");
assert(report.counties.some((county) => county.countyId === "bowie-county-tx"), "Source audit must include Bowie County");
assert(report.counties.some((county) => county.countyId === "brazoria-county-tx"), "Source audit must include Brazoria County");
assert(report.counties.some((county) => county.countyId === "brazos-county-tx"), "Source audit must include Brazos County");
assert(report.counties.some((county) => county.countyId === "brewster-county-tx"), "Source audit must include Brewster County");
assert(report.counties.some((county) => county.countyId === "briscoe-county-tx"), "Source audit must include Briscoe County");
assert(report.counties.some((county) => county.countyId === "brooks-county-tx"), "Source audit must include Brooks County");
assert(report.counties.some((county) => county.countyId === "brown-county-tx"), "Source audit must include Brown County");
assert(report.counties.every((county) => county.officialPortals.every((portal) => portal.url.startsWith("https://"))), "Audited source portals must keep HTTPS provenance URLs");
const privateCandidates = report.counties.filter((county) => county.officialPortals.some((portal) => portal.verificationStatus === "private-not-official"));
assert(privateCandidates.length === 5, "Source audit must preserve non-official private search candidates separately");
assert(privateCandidates.every((county) => county.remainingBlockers.includes("official appraisal district site not verified")), "Private search candidates must keep official-site verification blocked");
assert(reportMd.includes("Texas Batch 001 Source Audit"), "Source audit markdown must exist");
assert(reportMd.includes("Private/non-official candidates: 5"), "Source audit markdown must show private/non-official candidate count");
assert(reportMd.includes("DCAD parity ready: 0"), "Source audit markdown must show no DCAD parity-ready counties");
assert(reportMd.includes("do-not-activate"), "Source audit markdown must keep audited counties inactive");

assert(aggregateReport.version === "wr-texas-source-audit-v1", "Aggregate Texas source audit must use a stable version");
assert(aggregateReport.summary.batchCount >= 11, "Aggregate Texas source audit must include all discovered batch audit files");
assert(aggregateReport.summary.countyCount === texasQueue.summary.texasRemaining, "Aggregate Texas source audit must cover every non-Dallas Texas queue county");
assert(aggregateReport.summary.sourceQueueNotYetAudited > 0, "Aggregate Texas source audit must keep not-yet-audited queue counties visible");
assert(aggregateReport.summary.dcadParityReady === 0, "Aggregate Texas source audit must not promote discovered counties to DCAD parity");
assert(aggregateReport.counties.some((county) => county.countyId === "coryell-county-tx"), "Aggregate Texas source audit must include completed batch 002 through Coryell");
assert(aggregateReport.counties.some((county) => county.countyId === "ector-county-tx" && county.officialPortals.some((portal) => portal.sourceType === "downloads-and-reports")), "Aggregate Texas source audit must preserve Ector downloads/report parcel lead");
assert(aggregateReport.counties.some((county) => county.countyId === "el-paso-county-tx" && county.remainingBlockers.some((blocker) => blocker.includes("account number candidate join key"))), "Aggregate Texas source audit must preserve El Paso account-number candidate-key blocker");
assert(aggregateReport.counties.some((county) => county.countyId === "fisher-county-tx"), "Aggregate Texas source audit must include seeded batch 003 through Fisher");
assert(aggregateReport.counties.some((county) => county.countyId === "fort-bend-county-tx" && county.officialPortals.some((portal) => portal.sourceType === "gis-data-and-open-data-hub")), "Aggregate Texas source audit must preserve Fort Bend GIS/open-data hub lead");
assert(aggregateReport.counties.some((county) => county.countyId === "galveston-county-tx" && county.officialPortals.some((portal) => portal.sourceType === "interactive-map")), "Aggregate Texas source audit must preserve Galveston GIS map lead");
assert(aggregateReport.counties.some((county) => county.countyId === "grayson-county-tx" && county.officialPortals.some((portal) => portal.sourceType === "interactive-map")), "Aggregate Texas source audit must preserve Grayson GIS map lead");
assert(aggregateReport.counties.some((county) => county.countyId === "guadalupe-county-tx" && county.officialPortals.some((portal) => portal.sourceType === "interactive-map")), "Aggregate Texas source audit must preserve Guadalupe GIS map lead");
assert(aggregateReport.counties.some((county) => county.countyId === "hays-county-tx" && county.officialPortals.some((portal) => portal.sourceType === "property-data-downloads")), "Aggregate Texas source audit must preserve Hays property-data download lead");
assert(aggregateReport.counties.some((county) => county.countyId === "johnson-county-tx" && county.officialPortals.some((portal) => portal.sourceType === "appraisal-data-downloads")), "Aggregate Texas source audit must preserve Johnson appraisal-data download lead");
assert(aggregateReport.counties.some((county) => county.countyId === "kaufman-county-tx" && county.officialPortals.some((portal) => portal.sourceType === "downloads-and-appraisal-export")), "Aggregate Texas source audit must preserve Kaufman bulk/export parcel leads");
assert(aggregateReport.counties.some((county) => county.countyId === "llano-county-tx" && county.officialPortals.some((portal) => portal.sourceType === "gis-data-lead")), "Aggregate Texas source audit must preserve Llano GIS data lead");
assert(aggregateReport.counties.some((county) => county.countyId === "lamar-county-tx" && county.officialPortals.some((portal) => portal.sourceType === "public-information-and-reports")), "Aggregate Texas source audit must preserve Lamar public-information/report lead");
assert(aggregateReport.counties.some((county) => county.countyId === "liberty-county-tx" && county.officialPortals.some((portal) => portal.sourceType === "interactive-map")), "Aggregate Texas source audit must preserve Liberty GIS map lead");
assert(aggregateReport.counties.some((county) => county.countyId === "lubbock-county-tx" && county.officialPortals.some((portal) => portal.sourceType === "interactive-map")), "Aggregate Texas source audit must preserve Lubbock GIS map lead");
assert(aggregateReport.counties.some((county) => county.countyId === "medina-county-tx" && county.officialPortals.some((portal) => portal.sourceType === "interactive-map")), "Aggregate Texas source audit must preserve Medina GIS map lead");
assert(aggregateReport.counties.some((county) => county.countyId === "midland-county-tx" && county.officialPortals.some((portal) => portal.sourceType === "mapping-gis-lead")), "Aggregate Texas source audit must preserve Midland mapping/GIS lead");
assert(aggregateReport.counties.some((county) => county.countyId === "nueces-county-tx" && county.officialPortals.some((portal) => portal.sourceType === "downloads-and-reports")), "Aggregate Texas source audit must preserve Nueces downloads/report parcel lead");
assert(aggregateReport.counties.some((county) => county.countyId === "randall-county-tx" && county.officialPortals.some((portal) => portal.url === "https://www.prad.org/")), "Aggregate Texas source audit must preserve Potter-Randall public portal lead");
assert(aggregateReport.counties.some((county) => county.countyId === "tarrant-county-tx" && county.officialPortals.some((portal) => portal.verificationStatus === "official-site-candidate-fetch-blocked")), "Aggregate Texas source audit must preserve Tarrant as fetch-blocked rather than verified");
assert(aggregateReport.counties.some((county) => county.countyId === "travis-county-tx" && county.officialPortals.some((portal) => portal.sourceType === "data-public-information-lead")), "Aggregate Texas source audit must preserve Travis data/public-information lead");
assert(aggregateReport.counties.some((county) => county.countyId === "williamson-county-tx" && county.officialPortals.some((portal) => portal.sourceType === "data-portal")), "Aggregate Texas source audit must preserve Williamson data portal lead");
assert(aggregateReport.counties.some((county) => county.countyId === "williamson-county-tx" && county.remainingBlockers.some((blocker) => blocker.includes("ACCOUNT and PROPERTY ID"))), "Aggregate Texas source audit must preserve Williamson ACCOUNT/PROPERTY ID candidate-key blocker");
assert(aggregateReport.counties.some((county) => county.countyId === "zavala-county-tx" && county.completionImpact === "source-discovery-started"), "Aggregate Texas source audit must carry final batch counties through Zavala");
assert(aggregateReport.counties.every((county) => county.safeVisibleActivation === "do-not-activate"), "Aggregate Texas source audit counties must stay inactive before DCAD parity");
assert(aggregateReportMd.includes("Texas Source Audit"), "Aggregate Texas source audit markdown must exist");
assert(aggregateReportMd.includes("DCAD parity ready: 0"), "Aggregate Texas source audit markdown must show no DCAD parity-ready counties");

console.log("White Rabbit Texas source audit report tests passed.");

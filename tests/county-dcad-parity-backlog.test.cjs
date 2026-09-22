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
const scriptSource = fs.readFileSync(path.join(root, "scripts", "build-county-dcad-parity-backlog.cjs"), "utf8");

assert(packageJson.scripts["county:dcad-parity"] === "node scripts/build-county-dcad-parity-backlog.cjs", "Package scripts must expose the DCAD parity backlog builder");
assert(scriptSource.includes("Do not redesign White Rabbit pages"), "Parity backlog builder must preserve the locked UI constraint");
assert(scriptSource.includes("wr-county-dcad-parity-backlog-v1"), "Parity backlog must use a stable version");
assert(scriptSource.includes("texas-county-verification-queue"), "Parity backlog must include the full Texas county queue");
assert(scriptSource.includes("mergeTexasQueueIntoGate"), "Parity backlog must merge Texas queue counties into DCAD parity tracking");
assert(scriptSource.includes("Every non-Dallas Texas county remains do-not-activate"), "Parity backlog must keep non-Dallas Texas counties inactive until DCAD parity is complete");

execFileSync("node", ["scripts/build-county-connection-gate.cjs"], { cwd: root, stdio: "pipe" });
execFileSync("node", ["scripts/build-county-dcad-parity-backlog.cjs"], { cwd: root, stdio: "pipe" });

const report = readJson("output/county-dcad-parity-backlog.json");
const reportMd = fs.readFileSync(path.join(root, "output", "county-dcad-parity-backlog.md"), "utf8");

function county(countyId) {
  const record = report.counties.find((item) => item.countyId === countyId);
  assert(record, `Missing parity backlog record for ${countyId}`);
  return record;
}

assert(report.version === "wr-county-dcad-parity-backlog-v1", "Parity backlog version changed unexpectedly");
assert(report.summary.countyCount >= 25, "Parity backlog must cover all queued counties");
assert(report.summary.countyCount >= 254, "Parity backlog must cover all Texas counties plus non-Texas active examples");
assert(report.summary.mapSearchReadyCount >= 5, "Parity backlog must include the current map/search-ready counties");
assert(report.summary.incompleteCountyCount >= 20, "Parity backlog must keep non-DCAD parity gaps visible");
assert(report.uiConstraint.includes("Do not redesign"), "Parity backlog must keep the no-redesign rule visible");
assert(report.texasRolloutRule.includes("Every non-Dallas Texas county"), "Parity backlog must publish the Texas rollout rule");
assert(report.texasRolloutRule.includes("do-not-activate"), "Texas rollout rule must keep incomplete counties inactive");

const dallas = county("dallas-county-dcad");
assert(dallas.activationStage === "production-active", "Dallas must remain the active model county");
assert(dallas.dcadLikeWindowReady === true, "Dallas must remain DCAD-like window ready");
assert(dallas.nextMilestone === "hold-dcad-model", "Dallas should be held as the model county");

const harris = county("harris-county-tx");
assert(harris.mapSearchReady === true, "Harris must stay map/search ready");
assert(harris.parcelService.featureCount === 1535522, "Harris built parcel count must stay locked");
assert(harris.parcelService.chunkCount === 1345, "Harris chunk count must stay locked");
assert(harris.parcelService.searchShardCount === 1210, "Harris search shard count must stay locked");
assert(harris.activationStage === "map-search-pilot-active", "Harris must remain explicitly scoped to the active map/search pilot tier");
assert(harris.nextMilestone === "activation-review", "Harris should advance to activation review after reaching all 14 DCAD-like groups");
assert(harris.missingGroups.length === 0 && harris.parityScore.readyGroups === 14, "Harris must preserve its verified 14-of-14 intelligence-group readiness");

const jefferson = county("jefferson-ky");
assert(jefferson.nextMilestone === "join-owner-appraisal-window", "Jefferson next work should be PVA owner/appraisal joining");

const tarrant = county("tarrant-county-tad");
assert(tarrant.nextMilestone === "activation-review", "Tarrant should advance to activation review after aggregate migration-demand coverage completes all 14 groups");
assert(tarrant.mapSearchReady === true, "Tarrant should be map/search pilot ready after the full parcel service build");
assert(tarrant.missingMapSearchGroups.length === 0, "Tarrant must have no remaining map/search field-group gaps");
assert(tarrant.parcelService.featureCount === 758633, "Tarrant parity report must preserve the exact full parcel count");
assert(tarrant.parityScore.readyGroups === 14, "Tarrant parity report must preserve 14 ready intelligence groups");
assert(tarrant.parityScore.percent === 100, "Tarrant parity report must preserve the verified 100 percent score");
assert(tarrant.missingGroups.length === 0, "Tarrant must have no remaining DCAD-like intelligence group gaps");
assert(!tarrant.missingGroups.includes("zoning") && !tarrant.missingGroups.includes("floodplain") && !tarrant.missingGroups.includes("permits-certificates") && !tarrant.missingGroups.includes("development-signals"), "Tarrant's built pilot intelligence groups must not regress into the missing list");

const collin = county("collin-county-tx");
assert(collin.nextMilestone === "join-owner-appraisal-window", "Collin should keep the current-refresh owner/appraisal window gated until the rebuilt service is certified");
assert(collin.mapSearchReady === true, "Collin should be map/search pilot ready after the full parcel service build");
assert(collin.missingMapSearchGroups.length === 0, "Collin must have no remaining map/search field-group gaps");
assert(collin.parcelService.featureCount === 441278, "Collin parity report must preserve the exact current-refresh service record count");

const denton = county("denton-county-tx");
assert(denton.nextMilestone === "close-intelligence-layers", "Denton should advance to intelligence-layer closure after its full parcel service");
assert(denton.mapSearchReady === true, "Denton should be map/search pilot ready after the full parcel service build");
assert(denton.missingMapSearchGroups.length === 0, "Denton must have no remaining map/search field-group gaps");
assert(denton.parcelService.featureCount === 384684, "Denton parity report must preserve the exact full parcel count");

const anderson = county("anderson-county-tx");
assert(anderson.nextMilestone === "build-full-parcel-service", "Texas queue counties should enter the DCAD parity backlog as full-service build work");
assert(anderson.missingDcadWindowGroups.includes("owner-contact"), "Texas queue county owner/appraisal gaps must stay visible");
assert(anderson.missingDcadWindowGroups.includes("parcel-dimensions"), "Texas queue county ParcelDimension-equivalent gaps must stay visible");
assert(anderson.safeVisibleActivation === "do-not-activate", "Texas queue shells must not be activated before DCAD parity is built");

assert(reportMd.includes("# County DCAD Parity Backlog"), "Parity markdown report must be generated");
assert(reportMd.includes("Harris County"), "Parity markdown should list Harris County");
assert(reportMd.includes("Do not redesign"), "Parity markdown must preserve the UI constraint");
assert(reportMd.includes("Every non-Dallas Texas county remains do-not-activate"), "Parity markdown must publish the Texas rollout rule");

console.log("White Rabbit county DCAD parity backlog tests passed.");

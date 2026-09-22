const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

const report = readJson("output/county-connection-gate.json");
const reportMd = fs.readFileSync(path.join(root, "output", "county-connection-gate.md"), "utf8");
const scriptSource = fs.readFileSync(path.join(root, "scripts", "build-county-connection-gate.cjs"), "utf8");
const sampleServiceScriptSource = fs.readFileSync(path.join(root, "scripts", "build-county-parcel-sample-service.cjs"), "utf8");
const sourceVerifiedServiceScriptSource = fs.readFileSync(path.join(root, "scripts", "build-source-verified-county-parcel-service.cjs"), "utf8");
const packageJson = readJson("package.json");
const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const parcelLoaderSource = fs.readFileSync(path.join(root, "src", "map", "loadParcels.ts"), "utf8");

function county(countyId) {
  const record = report.counties.find((item) => item.countyId === countyId);
  assert(record, `Missing county gate record for ${countyId}`);
  return record;
}

assert(report.version === "wr-county-connection-gate-v1", "County connection gate must use a stable version");
assert(report.uiConstraint.includes("Do not redesign"), "County connection gate must preserve the no-redesign rule");
assert(report.gateRules.some((rule) => rule.includes("owner/appraisal")), "Gate must require official owner/appraisal joins before DCAD-like windows");
assert(report.gateRules.some((rule) => rule.includes("Sample parcel services")), "Gate must distinguish sample services from production activation");
assert(report.summary.totalCounties >= 20, "Gate must cover the active examples and national priority queue");

const dallas = county("dallas-county-dcad");
assert(dallas.activationStage === "production-active", "Dallas must remain the production active model");
assert(dallas.mapSearchReady === true, "Dallas map/search must remain ready");
assert(dallas.dcadLikeWindowReady === true, "Dallas DCAD-like parcel window must remain ready");
assert(dallas.parcelService.featureCount === 696601, "Dallas gate must preserve exact parcel feature count");
assert(dallas.parcelService.searchShardCount === 1224, "Dallas gate must preserve exact search shard count");
assert(!dallas.missingDcadLikeGroups.includes("owner-contact"), "Dallas owner contact should remain ready");
assert(!dallas.missingDcadLikeGroups.includes("migration-demand"), "Dallas should consume the national aggregate migration-demand context");
assert(dallas.migrationDemandContext?.countyFips === "48113", "Dallas demand context must use county FIPS 48113");
assert(dallas.migrationDemandContext?.parcelAttribution === false, "Dallas county demand context must never be labeled a parcel fact");
assert(dallas.nextBuildSteps.some((step) => step.includes("reuse-rights")), "Dallas demand next steps must preserve the independent rights-review gate");
assert(dallas.nextBuildSteps.some((step) => step.includes("do not attribute county observations to parcels")), "Dallas demand next steps must prohibit county-to-parcel overclaiming");

const jefferson = county("jefferson-ky");
assert(jefferson.activationStage === "map-search-pilot-ready", "Jefferson should be map/search ready but not DCAD-window complete");
assert(jefferson.mapSearchReady === true, "Jefferson full parcel viewport/search service must be ready");
assert(jefferson.dcadLikeWindowReady === false, "Jefferson must not be marked DCAD-like until PVA owner/appraisal is joined");
assert(jefferson.parcelService.sourceVerifiedFeatureCount === 284553, "Jefferson gate must lock the current verified parcel count");
assert(jefferson.parcelService.featureCount === 284552, "Jefferson gate must lock the current emitted polygon count");
assert(jefferson.parcelService.searchShardCount === 104, "Jefferson gate must lock search shard count");
assert(jefferson.layerReadiness.zoning === "ready", "Jefferson zoning parcel index should be ready");
assert(jefferson.layerReadiness.floodplain === "ready", "Jefferson floodplain parcel index should be ready");
assert(jefferson.missingDcadLikeGroups.includes("owner-contact"), "Jefferson owner contact must remain source-needed");
assert(jefferson.missingDcadLikeGroups.includes("appraisal-values"), "Jefferson appraisal values must remain source-needed");
assert(jefferson.readyDcadLikeGroups.includes("permits-certificates"), "Jefferson active permits must be parcel-index ready while CO remains source-needed");
assert(jefferson.readyDcadLikeGroups.includes("development-signals"), "Jefferson parcel development summaries must be ready");
assert(jefferson.safeVisibleActivation === "pilot-map-search-only", "Jefferson should only be safe for pilot map/search activation");

const harris = county("harris-county-tx");
assert(harris.activationStage === "map-search-pilot-active", "Harris map/search pilot should be active while DCAD-window intelligence remains incomplete");
assert(harris.parcelService.manifestPresent === true, "Harris full parcel chunks must exist");
assert(harris.parcelService.mode === "full", "Harris parcel service must be a full build");
assert(harris.parcelService.activationStatus === "full-build-needs-qc-before-app-activation", "Harris full build must stay QC-gated");
assert(harris.parcelService.featureCount === 1535522, "Harris full service must lock the built parcel count");
assert(harris.parcelService.sourceVerifiedFeatureCount === 1535525, "Harris gate must preserve verified source count");
assert(harris.parcelService.searchShardCount === 1210, "Harris full service search shard count must be locked");
assert(harris.parcelService.chunkCount === 1345, "Harris full service chunk count must be locked");
assert(harris.sourceCounts.missingGeometry === 3, "Harris gate must preserve missing geometry count");
assert(harris.parcelService.skipped === 3, "Harris gate must reconcile all three geometryless source records");
assert(harris.mapSearchReady === true, "Harris full parcel viewport/search service must be ready");
assert(harris.safeVisibleActivation === "active-map-search-pilot", "Harris should be visibly authorized only at the map/search pilot tier");
assert(harris.dcadLikeWindowReady === true, "Harris must have all 14 intelligence groups after the historical permit layer is joined");
assert(harris.layerReadiness.zoning === "ready", "Harris Houston development-control parcel index should be ready");
assert(harris.layerReadiness.floodplain === "ready", "Harris floodplain parcel index should be ready");
assert(harris.layerReadiness.developmentSignals === "ready", "Harris current plat development signals should be ready");
assert(!harris.missingDcadLikeGroups.includes("zoning"), "Harris verified Houston development controls must not remain missing");
assert(!harris.missingDcadLikeGroups.includes("floodplain"), "Harris verified floodplain layer must not remain missing");
assert(!harris.missingDcadLikeGroups.includes("development-signals"), "Harris verified plat signals must not remain missing");
assert(harris.readyDcadLikeGroups.includes("permits-certificates"), "Harris historical Houston permits must be parcel-index ready");
assert(!harris.missingDcadLikeGroups.includes("permits-certificates"), "Harris permit intelligence must not remain source-needed after the verified build");
assert(harris.sourceCounts.permitRowsJoined === 6574, "Harris gate must lock the exact unique-address permit join count");

const maricopa = county("maricopa-county-az");
assert(maricopa.activationStage === "map-search-pilot-ready", "Maricopa should be map/search ready but not DCAD-window complete");
assert(maricopa.parcelService.manifestPresent === true, "Maricopa full parcel chunks must exist");
assert(maricopa.parcelService.mode === "full", "Maricopa parcel service must be a full build");
assert(maricopa.parcelService.activationStatus === "full-build-needs-qc-before-app-activation", "Maricopa full build must stay QC-gated");
assert(maricopa.parcelService.featureCount === 1758443, "Maricopa full service must lock the built parcel count");
assert(maricopa.parcelService.searchShardCount === 1117, "Maricopa full service search shard count must be locked");
assert(maricopa.parcelService.chunkCount === 943, "Maricopa full service chunk count must be locked");
assert(maricopa.sourceCounts.verifiedParcelCount === 1758244, "Maricopa gate must preserve verified parcel count");
assert(maricopa.missingDcadLikeGroups.includes("permits-certificates"), "Maricopa permits/CO must remain source-needed");
assert(maricopa.mapSearchReady === true, "Maricopa full parcel viewport/search service must be ready");
assert(maricopa.dcadLikeWindowReady === false, "Maricopa must not be marked DCAD-like until optional intelligence layers are joined");
assert(maricopa.safeVisibleActivation === "pilot-map-search-only", "Maricopa should only be safe for pilot map/search activation");

const king = county("king-county-wa");
assert(king.activationStage === "map-search-pilot-ready", "King County should be map/search ready but not DCAD-window complete");
assert(king.parcelService.manifestPresent === true, "King County full parcel chunks must exist");
assert(king.parcelService.mode === "full", "King County parcel service must be a full build");
assert(king.parcelService.activationStatus === "full-build-needs-qc-before-app-activation", "King County full build must stay QC-gated");
assert(king.parcelService.featureCount === 636076, "King County full service must lock the built parcel count");
assert(king.parcelService.searchShardCount === 614, "King County full service search shard count must be locked");
assert(king.parcelService.chunkCount === 1603, "King County full service chunk count must be locked");
assert(king.sourceCounts.verifiedParcelCount === 638648, "King gate must preserve verified parcel count");
assert(king.sourceCounts.duplicatePrimaryParcelId === 2581, "King gate must preserve duplicate PIN count");
assert(king.missingDcadLikeGroups.includes("owner-contact"), "King owner contact must remain source-needed");
assert(king.mapSearchReady === true, "King County full parcel viewport/search service must be ready");
assert(king.dcadLikeWindowReady === false, "King County must not be marked DCAD-like until optional intelligence layers are joined");
assert(king.safeVisibleActivation === "pilot-map-search-only", "King County should only be safe for pilot map/search activation");

const tarrant = county("tarrant-county-tad");
assert(tarrant.activationStage === "map-search-pilot-ready", "Tarrant full parcel service should be map/search pilot ready");
assert(tarrant.mapSearchReady === true, "Tarrant full viewport/search service must be ready");
assert(tarrant.dcadLikeWindowReady === true, "Tarrant must be DCAD-like window ready after the verified zoning, floodplain, permit, and development pilot build");
assert(tarrant.missingDcadLikeGroups.length === 0, "Tarrant must have all 14 intelligence groups after national aggregate demand context is connected");
assert(tarrant.layerReadiness.migrationDemand === "ready", "Tarrant aggregate migration-demand context must be ready");
assert(tarrant.migrationDemandContext?.parcelAttribution === false, "Tarrant demand context must remain aggregate and non-parcel");
assert(tarrant.parcelService.featureCount === 758633, "Tarrant full service must lock the official parcel count");
assert(tarrant.parcelService.chunkCount === 1608, "Tarrant viewport chunk count must be locked");
assert(tarrant.parcelService.searchShardCount === 1111, "Tarrant search shard count must be locked");
assert(tarrant.safeVisibleActivation === "pilot-map-search-only", "Tarrant must remain pilot-only until remaining gates pass");
assert(tarrant.adapterStatus === "pilot", "Tarrant must not be promoted to an active production adapter by the intelligence pilot");

const collin = county("collin-county-tx");
assert(collin.activationStage === "map-search-pilot-ready", "Collin full parcel service should be map/search pilot ready");
assert(collin.mapSearchReady === true, "Collin full viewport/search service must be ready");
assert(collin.dcadLikeWindowReady === false, "Collin must remain below DCAD parity until intelligence layers are complete");
assert(collin.parcelService.sourceVerifiedFeatureCount === 441278, "Collin gate must preserve the official current-refresh record count");
assert(collin.parcelService.featureCount === 441278, "Collin gate must lock the current-refresh service record count, including search-only geometry quarantines");
assert(collin.parcelService.chunkCount === 1606, "Collin viewport chunk count must be locked");
assert(collin.parcelService.searchShardCount === 1168, "Collin search shard count must be locked");
assert(collin.sourceCounts.missingGeometry === 1, "Collin current-refresh null-geometry count must remain visible");
assert(collin.safeVisibleActivation === "pilot-map-search-only", "Collin must remain pilot-only until remaining gates pass");

const denton = county("denton-county-tx");
assert(denton.activationStage === "map-search-pilot-ready", "Denton full parcel service should be map/search pilot ready");
assert(denton.mapSearchReady === true, "Denton full viewport/search service must be ready");
assert(denton.dcadLikeWindowReady === false, "Denton must remain below DCAD parity until intelligence layers are complete");
assert(denton.parcelService.sourceVerifiedFeatureCount === 384684, "Denton gate must preserve the official source count");
assert(denton.parcelService.featureCount === 384684, "Denton gate must lock the full emitted parcel count");
assert(denton.parcelService.chunkCount === 1400, "Denton viewport chunk count must be locked");
assert(denton.parcelService.searchShardCount === 1051, "Denton search shard count must be locked");
assert(denton.safeVisibleActivation === "pilot-map-search-only", "Denton must remain pilot-only until remaining gates pass");

assert(packageJson.scripts["county:connection-gate"] === "node scripts/build-county-connection-gate.cjs", "Package scripts must expose county connection gate builder");
assert(packageJson.scripts["county:sample-service"] === "node scripts/build-county-parcel-sample-service.cjs --county=all", "Package scripts must expose the reusable county sample service builder");
assert(packageJson.scripts["maricopa:service:sample"] === "node scripts/build-source-verified-county-parcel-service.cjs --county=maricopa-county-az --sample=25", "Package scripts must expose Maricopa sample service build");
assert(packageJson.scripts["maricopa:service:full"] === "node scripts/build-source-verified-county-parcel-service.cjs --county=maricopa-county-az --full", "Package scripts must expose Maricopa full service build");
assert(packageJson.scripts["king:service:sample"] === "node scripts/build-source-verified-county-parcel-service.cjs --county=king-county-wa --sample=25", "Package scripts must expose King sample service build");
assert(packageJson.scripts["king:service:full"] === "node scripts/build-source-verified-county-parcel-service.cjs --county=king-county-wa --full", "Package scripts must expose King full service build");
assert(packageJson.scripts["tarrant:service:sample"] === "node scripts/build-source-verified-county-parcel-service.cjs --county=tarrant-county-tad --sample=500", "Package scripts must expose Tarrant sample service build");
assert(packageJson.scripts["tarrant:service:full"] === "node scripts/build-source-verified-county-parcel-service.cjs --county=tarrant-county-tad --full", "Package scripts must expose Tarrant full service build");
assert(packageJson.scripts["collin:service:sample"] === "node scripts/build-source-verified-county-parcel-service.cjs --county=collin-county-tx --sample=500", "Package scripts must expose Collin sample service build");
assert(packageJson.scripts["collin:service:full"] === "node scripts/build-source-verified-county-parcel-service.cjs --county=collin-county-tx --full", "Package scripts must expose Collin full service build");
assert(packageJson.scripts["denton:service:sample"] === "node scripts/build-source-verified-county-parcel-service.cjs --county=denton-county-tx --sample=500", "Package scripts must expose Denton sample service build");
assert(packageJson.scripts["denton:service:full"] === "node scripts/build-source-verified-county-parcel-service.cjs --county=denton-county-tx --full", "Package scripts must expose Denton full service build");
assert(scriptSource.includes("fullParcelServiceReady"), "Gate builder must test full service readiness");
assert(scriptSource.includes("ownerJoinedToPublicService"), "Gate builder must test owner/appraisal joins");
assert(sampleServiceScriptSource.includes("pilot-sample-not-for-production-activation"), "Sample service builder must mark sample services as non-production");
assert(sampleServiceScriptSource.includes("Do not redesign any White Rabbit pages"), "Sample service builder must preserve the no-redesign rule");
assert(sourceVerifiedServiceScriptSource.includes("full-build-needs-qc-before-app-activation"), "Source-verified builder must keep full builds behind QC");
assert(sourceVerifiedServiceScriptSource.includes("Do not redesign any White Rabbit pages"), "Source-verified builder must preserve the no-redesign rule");
assert(sourceVerifiedServiceScriptSource.includes("FULL_BUILD_SEARCH_SHARD_RECORD_LIMIT"), "Source-verified builder must split oversized full-build search shards");
assert(parcelLoaderSource.includes("string | string[]"), "Parcel loader must support split search shard files");
assert(parcelLoaderSource.includes('"harris-county-tx": ["Harris County", "Houston"'), "Parcel search text must include Harris/Houston county labels");
assert(parcelLoaderSource.includes('"maricopa-county-az": ["Maricopa County", "Phoenix"'), "Parcel search text must include Maricopa/Phoenix county labels");
assert(parcelLoaderSource.includes('"king-county-wa": ["King County", "Seattle"'), "Parcel search text must include King/Seattle county labels");
assert(reportMd.includes("# County Connection Gate"), "Markdown gate report must be generated");
assert(!appSource.includes("county-connection-gate"), "County gate report must not redesign or wire visible pages");

console.log("White Rabbit county connection gate tests passed.");

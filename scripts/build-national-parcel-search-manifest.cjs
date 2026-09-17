const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const routes = JSON.parse(fs.readFileSync(path.join(root, "data", "national-parcel-search-routes.json"), "utf8"));
const gate = JSON.parse(fs.readFileSync(path.join(root, "output", "county-connection-gate.json"), "utf8"));
const outputDir = path.join(root, "public", "data", "national");

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
function publicPathFromRoot(dataRoot) { return path.join(root, "public", dataRoot.replace(/^\//, ""), "manifest.json"); }

function main() {
  const gateByCounty = new Map(gate.counties.map((county) => [county.countyId, county]));
  const counties = routes.routes.map((route) => {
    const countyGate = gateByCounty.get(route.countyId);
    const adapter = readJson(path.join(root, route.adapterPath));
    const manifestPath = publicPathFromRoot(route.dataRoot);
    const parcelManifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : null;
    const searchReady = Boolean(countyGate?.mapSearchReady && parcelManifest?.featureCount && parcelManifest?.searchIndexCount);
    return {
      countyFips: route.countyFips,
      countyId: route.countyId,
      datasetId: route.datasetId,
      countyName: adapter.countyName,
      state: adapter.state || (route.countyFips.startsWith("21") ? "KY" : route.countyFips.startsWith("48") ? "TX" : route.countyFips.startsWith("04") ? "AZ" : route.countyFips.startsWith("53") ? "WA" : ""),
      dataRoot: route.dataRoot,
      universalParcelSchema: { version: adapter.universalParcelSchema?.version || "wr-universal-parcel-v1" },
      map: adapter.map,
      featureCount: Number(parcelManifest?.featureCount || 0),
      searchIndexCount: Number(parcelManifest?.searchIndexCount || 0),
      searchShardCount: Object.keys(parcelManifest?.searchIndexShards?.files || {}).length,
      searchReady,
      accessMode: countyGate?.safeVisibleActivation === "active-model" ? "production" : searchReady && countyGate?.safeVisibleActivation === "pilot-map-search-only" ? "verified-map-search-pilot" : "blocked",
      dcadLikeWindowReady: countyGate?.dcadLikeWindowReady === true,
    };
  });
  const connected = counties.filter((county) => county.searchReady && county.accessMode !== "blocked");
  const report = {
    schemaVersion: "wr-national-parcel-search-manifest-v1",
    generatedAt: new Date().toISOString(),
    routingKey: routes.routingKey,
    countyUniverseCount: 3235,
    connectedCountyCount: connected.length,
    connectedStateCount: new Set(connected.map((county) => county.state)).size,
    exactConnectedParcelCount: connected.reduce((sum, county) => sum + county.featureCount, 0),
    exactConnectedSearchRecordCount: connected.reduce((sum, county) => sum + county.searchIndexCount, 0),
    unsupportedCountyBehavior: "return county-not-connected; never substitute a nearby county or fabricate a parcel",
    uiConstraint: "Use the existing search bar and parcel view; do not redesign the White Rabbit frontend.",
    counties,
  };
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "parcel-search-manifest.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.mkdirSync(path.join(root, "output", "national-parcel-search"), { recursive: true });
  fs.writeFileSync(path.join(root, "output", "national-parcel-search", "manifest.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "output", "national-parcel-search", "report.md"), [
    "# National Parcel Search Routing",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `- Connected counties: ${report.connectedCountyCount}`,
    `- Connected states: ${report.connectedStateCount}`,
    `- Connected parcel records: ${report.exactConnectedParcelCount.toLocaleString("en-US")}`,
    `- Connected search records: ${report.exactConnectedSearchRecordCount.toLocaleString("en-US")}`,
    "",
    "| County | State | FIPS | Access | Parcels | Search shards |",
    "| --- | --- | --- | --- | ---: | ---: |",
    ...connected.map((county) => `| ${county.countyName} | ${county.state} | ${county.countyFips} | ${county.accessMode} | ${county.featureCount.toLocaleString("en-US")} | ${county.searchShardCount} |`),
    "",
    "Addresses outside connected counties remain geocodable but return an explicit county-not-connected result until that county passes its parcel-search gates.",
    "",
  ].join("\n"));
  console.log(JSON.stringify({ connectedCountyCount: report.connectedCountyCount, connectedStateCount: report.connectedStateCount, exactConnectedParcelCount: report.exactConnectedParcelCount }, null, 2));
}

main();

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const sourceUrl = "https://www2.census.gov/geo/docs/reference/codes/files/national_county.txt";
const dataDir = path.join(root, "data", "national-county-intelligence");
const outputDir = path.join(root, "output", "national-county-intelligence");
const dataFile = path.join(dataDir, "us-county-universe.json");
const outputJson = path.join(outputDir, "us-county-universe-report.json");
const outputMd = path.join(outputDir, "us-county-universe-report.md");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function writeText(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, value);
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function adapterPathFor(countyId) {
  const adapterPath = path.join(root, "data", "county-adapters", countyId, "adapter.json");
  return fs.existsSync(adapterPath) ? `data/county-adapters/${countyId}/adapter.json` : "";
}

function parseCountyLine(line) {
  const [state, stateFp, countyFp, countyName, classFp] = line.split(",");
  if (!state || !stateFp || !countyFp || !countyName) return null;
  const countyId = `${slugify(countyName)}-${state.toLowerCase()}`;
  return {
    countyId,
    state,
    stateFips: stateFp,
    countyFips: countyFp,
    fips: `${stateFp}${countyFp}`,
    countyName,
    classFp: classFp || "",
    adapterPath: adapterPathFor(countyId),
    status: adapterPathFor(countyId) ? "adapter-shell-created" : "source-discovery-needed",
  };
}

async function fetchSource() {
  const response = await fetch(sourceUrl);
  const text = await response.text();
  if (!response.ok) throw new Error(`Unable to fetch Census county universe ${response.status}: ${text.slice(0, 500)}`);
  return text;
}

async function main() {
  const generatedAt = new Date().toISOString();
  const sourceText = await fetchSource();
  const counties = sourceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCountyLine)
    .filter(Boolean)
    .sort((a, b) => a.fips.localeCompare(b.fips));
  const stateCounts = counties.reduce((counts, county) => {
    counts[county.state] = (counts[county.state] || 0) + 1;
    return counts;
  }, {});
  const withAdapters = counties.filter((county) => county.adapterPath);
  const universe = {
    generatedAt,
    sourceUrl,
    sourceName: "U.S. Census Bureau national county code file",
    coverageGoal: "All United States counties and county-equivalent jurisdictions from the official Census national county code file",
    countyEquivalentCount: counties.length,
    stateCount: Object.keys(stateCounts).length,
    stateCounts,
    adapterShellCount: withAdapters.length,
    sourceDiscoveryNeededCount: counties.length - withAdapters.length,
    dcadRequiredFieldGroups: [
      "parcel-geometry",
      "parcel-ids",
      "owner-appraisal",
      "viewport-search",
      "qa",
    ],
    dcadOptionalFieldGroups: [
      "parcel-dimensions",
      "block-grid",
      "zoning",
      "floodplain",
      "permits-co",
      "development-signals",
      "migration-demand",
    ],
    counties,
    uiConstraint: "No White Rabbit pages are redesigned or activated by this national county-universe build.",
  };

  writeJson(dataFile, universe);
  writeJson(outputJson, {
    generatedAt,
    sourceUrl,
    countyEquivalentCount: universe.countyEquivalentCount,
    stateCount: universe.stateCount,
    adapterShellCount: universe.adapterShellCount,
    sourceDiscoveryNeededCount: universe.sourceDiscoveryNeededCount,
    firstCounty: counties[0],
    lastCounty: counties[counties.length - 1],
    uiConstraint: universe.uiConstraint,
  });
  writeText(
    outputMd,
    [
      "# U.S. County Universe Report",
      "",
      `Generated: ${generatedAt}`,
      "",
      `- Source: ${sourceUrl}`,
      `- County/county-equivalent records: ${universe.countyEquivalentCount}`,
      `- States/areas represented: ${universe.stateCount}`,
      `- Adapter shells already present: ${universe.adapterShellCount}`,
      `- Source discovery still needed: ${universe.sourceDiscoveryNeededCount}`,
      "",
      "## DCAD Activation Standard",
      "",
      ...universe.dcadRequiredFieldGroups.map((group) => `- Required: ${group}`),
      ...universe.dcadOptionalFieldGroups.map((group) => `- Optional/enrichment: ${group}`),
      "",
      "No page files were changed by this county-universe build.",
      "",
    ].join("\n"),
  );
  console.log(`Wrote ${path.relative(root, dataFile)}`);
  console.log(`Wrote ${path.relative(root, outputJson)}`);
  console.log(`Wrote ${path.relative(root, outputMd)}`);
  console.log(JSON.stringify({ countyEquivalentCount: universe.countyEquivalentCount, adapterShellCount: universe.adapterShellCount }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const registryPath = path.join(root, "data", "kentucky-county-source-registry.json");
const auditPath = path.join(root, "output", "kentucky-source-audit", "kentucky-source-audit.json");
const outputJson = path.join(root, "output", "kentucky-source-audit", "kentucky-ingestion-waves.json");
const outputMarkdown = path.join(root, "output", "kentucky-source-audit", "kentucky-ingestion-waves.md");

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

function main() {
  const registry = readJson(registryPath);
  const audit = readJson(auditPath);
  const seededIds = new Set(registry.sources.map((source) => source.countyId));
  const seeded = audit.counties.filter((county) => seededIds.has(county.countyId));
  const remaining = audit.counties.filter((county) => !seededIds.has(county.countyId));
  if (seeded.length !== registry.sources.length) throw new Error("Kentucky verified registry does not reconcile to the 120-county audit");

  const sizes = [seeded.length, seeded.length * 2, seeded.length * 4, seeded.length * 8];
  const waves = [{ wave: 1, targetCountyCount: seeded.length, purpose: "verified-source-probe", counties: seeded }];
  let offset = 0;
  for (let index = 1; offset < remaining.length; index += 1) {
    const requested = sizes[index] || remaining.length - offset;
    const counties = remaining.slice(offset, offset + requested);
    waves.push({ wave: index + 1, targetCountyCount: counties.length, purpose: "source-discovery-and-probe", counties });
    offset += counties.length;
  }

  const report = {
    schemaVersion: "wr-kentucky-ingestion-waves-v1",
    generatedAt: new Date().toISOString(),
    strategy: "Double county scope per wave while capping network concurrency at four requests.",
    maxNetworkConcurrency: 4,
    totalCounties: audit.counties.length,
    verifiedSeedCounties: seeded.length,
    stages: [
      "official-source-discovery",
      "metadata-count-schema-probe",
      "store-derive-query-rights-evidence",
      "resumable-content-addressed-capture",
      "duplicate-safe-identity-audit",
      "universal-schema-normalization",
      "viewport-and-search-build",
      "county-specific-activation-review"
    ],
    waves: waves.map((wave) => ({
      wave: wave.wave,
      targetCountyCount: wave.targetCountyCount,
      purpose: wave.purpose,
      countyIds: wave.counties.map((county) => county.countyId),
      counties: wave.counties.map((county) => county.countyName),
    })),
    productionActivationAuthorized: false,
    uiChanged: false,
  };
  writeJson(outputJson, report);
  fs.writeFileSync(outputMarkdown, [
    "# Kentucky Parcel Ingestion Waves",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    report.strategy,
    "",
    `- Kentucky counties: ${report.totalCounties}`,
    `- Verified first-wave sources: ${report.verifiedSeedCounties}`,
    `- Maximum live network concurrency: ${report.maxNetworkConcurrency}`,
    "",
    "| Wave | Counties | Purpose |",
    "| ---: | ---: | --- |",
    ...report.waves.map((wave) => `| ${wave.wave} | ${wave.targetCountyCount} | ${wave.purpose} |`),
    "",
    "Each county advances independently through source, rights, capture, identity, normalization, build, and activation gates. Failure in one county does not stop the rest of its wave.",
    "",
  ].join("\n"));
  console.log(JSON.stringify({ totalCounties: report.totalCounties, waves: report.waves.map((wave) => wave.targetCountyCount) }, null, 2));
}

main();

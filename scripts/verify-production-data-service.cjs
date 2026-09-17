const fs = require("fs");
const path = require("path");

function option(name, fallback = "") {
  const equals = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (equals) return equals.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

(async () => {
  const root = path.join(__dirname, "..");
  const outputDirectory = path.resolve(option("output-dir", path.join(root, "output")));
  const baseUrl = option("base-url");
  const allowHttpLocalhost = process.argv.includes("--allow-http-localhost");
  if (!baseUrl) throw new Error("--base-url is required");
  const preflight = await import("../src/operations/productionDataPreflight.mjs");
  const report = await preflight.runProductionDataServicePreflight({ baseUrl, allowHttpLocalhost });
  fs.mkdirSync(outputDirectory, { recursive: true });
  const jsonPath = path.join(outputDirectory, "production-data-service-preflight.json");
  const markdownPath = path.join(outputDirectory, "production-data-service-preflight.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, [
    "# White Rabbit Production Data Service Preflight",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `- Status: ${report.status}`,
    `- Base URL: ${report.baseUrl}`,
    `- Endpoints passed: ${report.passedEndpointCount}/${report.endpointCount}`,
    `- Data service ready: ${report.dataServiceReady ? "yes" : "no"}`,
    "- Production activation authorized: no",
    "- Locked UI changed: no",
    "",
    "| Dataset | Status | Bytes | Cache-Control |",
    "| --- | --- | ---: | --- |",
    ...report.results.map((result) => `| ${result.id} | ${result.status} | ${result.observed?.bodyBytes || 0} | ${result.observed?.cacheControl || ""} |`),
    "",
    `Release boundary: ${report.releaseBoundary}`,
    "",
  ].join("\n"));
  console.log(`Production data service preflight: ${report.status} (${report.passedEndpointCount}/${report.endpointCount})`);
  if (report.status !== "passed") process.exitCode = 1;
})().catch((error) => { console.error(error); process.exit(1); });

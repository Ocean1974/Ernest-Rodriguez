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
  const baseUrl = option("base-url");
  if (!baseUrl) throw new Error("--base-url is required");
  const outputDirectory = path.resolve(option("output-dir", path.join(root, "output")));
  const pilot = await import("../src/operations/dallasPilotPreflight.mjs");
  const report = await pilot.runDallasPilotPreflight({
    baseUrl,
    allowHttpLocalhost: process.argv.includes("--allow-http-localhost"),
    maxResponseMs: Number(option("max-response-ms", "2000")),
  });
  const compactResponses = {
    manifest: report.responses.manifest && { ...report.responses.manifest, payload: undefined },
    searchShards: report.responses.searchShards.map((response) => ({ ...response, payload: undefined })),
    viewportChunk: report.responses.viewportChunk && { ...report.responses.viewportChunk, payload: undefined },
  };
  const persisted = { ...report, responses: compactResponses };
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "dallas-pilot-readiness.json"), `${JSON.stringify(persisted, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, "dallas-pilot-readiness.md"), [
    "# White Rabbit Dallas Pilot Readiness",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `- Status: ${report.status}`,
    `- Local pilot ready: ${report.localPilotReady ? "yes" : "no"}`,
    "- Production activation authorized: no",
    `- Parcel features: ${report.counts.featureCount.toLocaleString("en-US")}`,
    `- Appraisal joins: ${report.counts.joinedAppraisalCount.toLocaleString("en-US")}`,
    `- Viewport chunks: ${report.counts.chunkCount.toLocaleString("en-US")}`,
    `- Search shards: ${report.counts.searchShardCount.toLocaleString("en-US")}`,
    `- Verified search: ${report.query}`,
    `- Hydrated account: ${report.expectedAccount}`,
    `- Matching viewport records: ${report.counts.matchingChunkRecordCount}`,
    "- Locked UI changed: no",
    "",
    "| Check | Passed |",
    "| --- | --- |",
    ...Object.entries(report.checks).map(([name, passed]) => `| ${name} | ${passed ? "yes" : "no"} |`),
    "",
    report.releaseBoundary,
    "",
  ].join("\n"));
  console.log(`Dallas pilot preflight: ${report.status}`);
  if (!report.localPilotReady) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exit(1); });

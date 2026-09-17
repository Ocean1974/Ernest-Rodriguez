const { inspectDallasPermits } = require("./permit-pipeline-utils.cjs");

try {
  const reports = inspectDallasPermits();
  console.log(`Wrote permit schema report for ${reports.length} source(s).`);
} catch (error) {
  console.error(error);
  process.exit(1);
}

const { normalizeDallasPermits } = require("./permit-pipeline-utils.cjs");

try {
  const permits = normalizeDallasPermits();
  console.log(`Normalized ${permits.length} Dallas permit rows.`);
} catch (error) {
  console.error(error);
  process.exit(1);
}

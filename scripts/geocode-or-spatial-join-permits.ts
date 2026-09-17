const { joinPermitsToParcels } = require("./permit-pipeline-utils.cjs");

try {
  const { report } = joinPermitsToParcels();
  console.log(`Joined ${report.totalPermitsJoinedToParcels} permit rows to parcels.`);
} catch (error) {
  console.error(error);
  process.exit(1);
}

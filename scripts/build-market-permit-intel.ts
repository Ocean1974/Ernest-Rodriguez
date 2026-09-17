const {
  inspectDallasPermits,
  normalizeDallasPermits,
  joinPermitsToParcels,
  buildPermitOutput,
  normalizeLouisvillePermits,
  buildMarketPermitIntelOutput,
} = require("./permit-pipeline-utils.cjs");

try {
  inspectDallasPermits();
  normalizeDallasPermits();
  joinPermitsToParcels();
  buildPermitOutput();
  normalizeLouisvillePermits();
  const manifest = buildMarketPermitIntelOutput();
  console.log(
    `Built market permit intel for ${manifest.permitCount} records across ${Object.keys(manifest.marketCounts).join(", ")}.`,
  );
} catch (error) {
  console.error(error);
  process.exit(1);
}

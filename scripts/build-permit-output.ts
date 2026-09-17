const {
  inspectDallasPermits,
  normalizeDallasPermits,
  joinPermitsToParcels,
  buildPermitOutput,
} = require("./permit-pipeline-utils.cjs");

try {
  inspectDallasPermits();
  normalizeDallasPermits();
  joinPermitsToParcels();
  const manifest = buildPermitOutput();
  console.log(`Built Dallas permit service with ${manifest.permitCount} permits in ${manifest.chunkCount} chunk(s).`);
} catch (error) {
  console.error(error);
  process.exit(1);
}

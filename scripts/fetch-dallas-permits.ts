const { fetchDallasPermits } = require("./permit-pipeline-utils.cjs");

fetchDallasPermits()
  .then((sources) => {
    console.log(`Fetched ${sources.reduce((sum, source) => sum + source.fetchedRows, 0)} Dallas permit rows.`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

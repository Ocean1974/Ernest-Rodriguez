const { fetchMarketPermitIntel } = require("./permit-pipeline-utils.cjs");

fetchMarketPermitIntel()
  .then((sources) => {
    console.log(`Fetched ${sources.reduce((sum, source) => sum + source.fetchedRows, 0)} Dallas and Louisville permit rows.`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

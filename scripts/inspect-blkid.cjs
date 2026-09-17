const path = require("path");
const shapefile = require("shapefile");

async function main() {
  const shpPath = path.join(__dirname, "..", "data", "extracted", "BLKID", "BLKID.shp");
  const dbfPath = path.join(__dirname, "..", "data", "extracted", "BLKID", "BLKID.dbf");
  const source = await shapefile.open(shpPath, dbfPath);
  const samples = [];
  for (let index = 0; index < 8; index += 1) {
    const next = await source.read();
    if (next.done) break;
    samples.push({
      properties: next.value.properties,
      geometryType: next.value.geometry?.type,
    });
  }
  console.log(JSON.stringify(samples, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

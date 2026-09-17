const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  PRODUCTION_DATA_DELIVERY_SCHEMA,
  createProductionDataDeliveryManifest,
  inventoryDirectory,
  verifyProductionBuildBoundary,
} = require("../scripts/production-data-delivery-utils.cjs");

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "wr-data-delivery-"));
try {
  const source = path.join(fixture, "source");
  const output = path.join(fixture, "dist");
  fs.mkdirSync(path.join(source, "parcels"), { recursive: true });
  fs.mkdirSync(path.join(output, "assets"), { recursive: true });
  fs.writeFileSync(path.join(source, "parcels", "manifest.json"), "{}\n");
  fs.writeFileSync(path.join(source, "parcels", "chunk-0001.json"), "[1,2,3]\n");
  fs.writeFileSync(path.join(output, "index.html"), "<!doctype html>\n");

  const inventory = inventoryDirectory(source);
  assert.equal(inventory.fileCount, 2);
  assert.equal(inventory.bytes, 11);
  assert.match(inventory.inventorySha256, /^[a-f0-9]{64}$/);

  const manifest = createProductionDataDeliveryManifest({ generatedAt: "2026-08-24T12:00:00.000Z", sourceInventory: inventory });
  assert.equal(manifest.schemaVersion, PRODUCTION_DATA_DELIVERY_SCHEMA);
  assert.equal(manifest.bundleBoundary.publicDataBundled, false);
  assert.equal(manifest.bundleBoundary.externalDataMountRequired, true);
  assert.equal(manifest.bundleBoundary.runtimeRoutePrefix, "/data/");
  assert.equal(manifest.runtimeContract.delivery, "viewport-bounded-json-or-verified-pmtiles");
  assert.equal(manifest.lockedUiContract.landingPageChanged, false);
  assert.equal(verifyProductionBuildBoundary(output), true);

  fs.mkdirSync(path.join(output, "data"));
  assert.throws(() => verifyProductionBuildBoundary(output), /must not bundle county-scale data/);
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

const root = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const productionBuild = fs.readFileSync(path.join(root, "scripts", "build-production-app.cjs"), "utf8");
assert.equal(packageJson.scripts.build, "node scripts/build-production-app.cjs");
assert.equal(packageJson.scripts["build:with-data"], "vite build");
assert(productionBuild.includes('WR_SKIP_PUBLIC_COPY: "1"'));
assert(productionBuild.includes("verifyProductionBuildBoundary"));

console.log("White Rabbit bounded production data-delivery build tests passed.");

require("./production-bundle-boundary.test.cjs");

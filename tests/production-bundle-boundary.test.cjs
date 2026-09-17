const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  PRODUCTION_BUNDLE_BOUNDARY_SCHEMA,
  inspectProductionBundleBoundary,
} = require("../scripts/production-bundle-boundary-utils.cjs");

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "wr-bundle-boundary-"));
try {
  const assets = path.join(fixture, "assets");
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(fixture, "index.html"), '<script type="module" src="/assets/index-a.js"></script><link rel="stylesheet" href="/assets/index-a.css">');
  fs.writeFileSync(path.join(assets, "index-a.js"), "app");
  fs.writeFileSync(path.join(assets, "index-a.css"), "css");
  fs.writeFileSync(path.join(assets, "maps-a.js"), "map");
  fs.writeFileSync(path.join(assets, "maps-a.css"), "map-css");
  fs.writeFileSync(path.join(assets, "three-a.js"), "three");
  fs.writeFileSync(path.join(assets, "LiveMapGlobe-a.js"), "globe");

  const report = inspectProductionBundleBoundary(fixture);
  assert.equal(report.schemaVersion, PRODUCTION_BUNDLE_BOUNDARY_SCHEMA);
  assert.equal(report.status, "verified");
  assert.equal(report.landing.assetBytes, 6);
  assert.equal(report.landing.heavyMapEngineReferences.length, 0);
  assert.equal(report.contract.mapLibreJavaScriptDeferred, true);
  assert.equal(report.contract.mapLibreStylesDeferred, true);
  assert.equal(report.contract.threeJsDeferred, true);

  fs.writeFileSync(path.join(fixture, "index.html"), '<script type="module" src="/assets/index-a.js"></script><link rel="modulepreload" href="/assets/maps-a.js">');
  assert.throws(() => inspectProductionBundleBoundary(fixture), /must not preload heavy map engines/);
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

const root = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const firstLines = appSource.split(/\r?\n/).slice(0, 20).join("\n");
assert(!firstLines.includes('import "maplibre-gl/dist/maplibre-gl.css"'));
assert(appSource.includes('import("maplibre-gl")'));
assert(appSource.includes('import("maplibre-gl/dist/maplibre-gl.css")'));

console.log("White Rabbit production map-engine bundle-boundary tests passed.");

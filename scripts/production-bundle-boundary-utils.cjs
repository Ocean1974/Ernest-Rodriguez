const fs = require("fs");
const path = require("path");

const PRODUCTION_BUNDLE_BOUNDARY_SCHEMA = "white-rabbit-production-bundle-boundary/v1";
const DEFERRED_ENGINE_PREFIXES = ["maps-", "three-", "LiveMapGlobe-"];

function inspectProductionBundleBoundary(outputRoot) {
  const htmlPath = path.join(outputRoot, "index.html");
  if (!fs.existsSync(htmlPath)) throw new Error("Production bundle boundary requires dist/index.html.");

  const html = fs.readFileSync(htmlPath, "utf8");
  const landingReferences = Array.from(html.matchAll(/(?:src|href)="([^"]+)"/g), (match) => match[1]);
  const landingAssets = landingReferences
    .filter((reference) => reference.startsWith("/assets/"))
    .map((reference) => {
      const relativePath = reference.replace(/^\//, "");
      const absolutePath = path.join(outputRoot, ...relativePath.split("/"));
      return { path: reference, bytes: fs.existsSync(absolutePath) ? fs.statSync(absolutePath).size : 0 };
    });
  const assetNames = fs.readdirSync(path.join(outputRoot, "assets"));
  const deferredAssets = assetNames.filter((name) => DEFERRED_ENGINE_PREFIXES.some((prefix) => name.startsWith(prefix)));
  const accidentalLandingEngines = landingReferences.filter((reference) => {
    const name = path.posix.basename(reference);
    return DEFERRED_ENGINE_PREFIXES.some((prefix) => name.startsWith(prefix));
  });

  if (accidentalLandingEngines.length) {
    throw new Error(`Landing page must not preload heavy map engines: ${accidentalLandingEngines.join(", ")}`);
  }
  for (const requiredPrefix of DEFERRED_ENGINE_PREFIXES) {
    if (!deferredAssets.some((name) => name.startsWith(requiredPrefix))) {
      throw new Error(`Production bundle is missing deferred engine asset prefix ${requiredPrefix}.`);
    }
  }
  if (!deferredAssets.some((name) => name.startsWith("maps-") && name.endsWith(".js"))) {
    throw new Error("Production bundle is missing the deferred MapLibre JavaScript asset.");
  }
  if (!deferredAssets.some((name) => name.startsWith("maps-") && name.endsWith(".css"))) {
    throw new Error("Production bundle is missing the deferred MapLibre stylesheet asset.");
  }

  return {
    schemaVersion: PRODUCTION_BUNDLE_BOUNDARY_SCHEMA,
    generatedAt: new Date().toISOString(),
    status: "verified",
    landing: {
      references: landingReferences,
      assets: landingAssets,
      assetBytes: landingAssets.reduce((sum, asset) => sum + asset.bytes, 0),
      heavyMapEngineReferences: [],
    },
    deferredMapAssets: deferredAssets.map((name) => ({
      path: `/assets/${name}`,
      bytes: fs.statSync(path.join(outputRoot, "assets", name)).size,
    })),
    contract: {
      activationBoundary: "existing-enter-map-flow",
      mapLibreJavaScriptDeferred: true,
      mapLibreStylesDeferred: true,
      threeJsDeferred: true,
      landingPageRedesigned: false,
    },
  };
}

module.exports = {
  DEFERRED_ENGINE_PREFIXES,
  PRODUCTION_BUNDLE_BOUNDARY_SCHEMA,
  inspectProductionBundleBoundary,
};

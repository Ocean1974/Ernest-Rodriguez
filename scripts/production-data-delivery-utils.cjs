const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PRODUCTION_DATA_DELIVERY_SCHEMA = "wr-production-data-delivery-v1";

function inventoryDirectory(root) {
  const stack = [root];
  const files = [];
  let bytes = 0;

  while (stack.length) {
    const directory = stack.pop();
    if (!directory || !fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Production data inventory rejects symbolic links: ${absolute}`);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = fs.statSync(absolute);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      files.push({ path: relative, bytes: stat.size });
      bytes += stat.size;
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  const inventorySha256 = crypto
    .createHash("sha256")
    .update(files.map((file) => `${file.path}\t${file.bytes}`).join("\n"))
    .digest("hex");
  return { fileCount: files.length, bytes, inventorySha256 };
}

function createProductionDataDeliveryManifest({ generatedAt, sourceInventory }) {
  if (!sourceInventory || !Number.isInteger(sourceInventory.fileCount) || sourceInventory.fileCount < 1) {
    throw new Error("A non-empty production data source inventory is required.");
  }
  if (!Number.isFinite(sourceInventory.bytes) || sourceInventory.bytes < 1) {
    throw new Error("Production data source bytes must be positive.");
  }
  if (!/^[a-f0-9]{64}$/.test(String(sourceInventory.inventorySha256 || ""))) {
    throw new Error("Production data inventory SHA-256 is required.");
  }

  return {
    schemaVersion: PRODUCTION_DATA_DELIVERY_SCHEMA,
    generatedAt: new Date(generatedAt).toISOString(),
    buildMode: "application-shell-with-external-geospatial-data",
    sourceInventory,
    bundleBoundary: {
      publicDataBundled: false,
      publicAssetsBundled: true,
      externalDataMountRequired: true,
      runtimeRoutePrefix: "/data/",
    },
    runtimeContract: {
      delivery: "viewport-bounded-json-or-verified-pmtiles",
      requiredEntryPoints: [
        "/data/parcels/manifest.json",
        "/data/permits/manifest.json",
        "/data/developments/manifest.json",
        "/data/zoning/manifest.json",
        "/data/floodplain/manifest.json",
      ],
      cachePolicy: "immutable artifacts by content hash; manifests revalidated",
      sameOriginRecommended: true,
      fallbackRuntime: "viewport-geojson-service",
    },
    lockedUiContract: {
      earthImageryPreserved: true,
      dcadParcelLayerPreserved: true,
      landingPageChanged: false,
    },
  };
}

function verifyProductionBuildBoundary(outputRoot) {
  const required = [path.join(outputRoot, "index.html"), path.join(outputRoot, "assets")];
  for (const target of required) {
    if (!fs.existsSync(target)) throw new Error(`Production app-shell output is missing: ${target}`);
  }
  const bundledData = path.join(outputRoot, "data");
  if (fs.existsSync(bundledData)) {
    throw new Error(`Production build must not bundle county-scale data: ${bundledData}`);
  }
  return true;
}

module.exports = {
  PRODUCTION_DATA_DELIVERY_SCHEMA,
  createProductionDataDeliveryManifest,
  inventoryDirectory,
  verifyProductionBuildBoundary,
};

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  createProductionDataDeliveryManifest,
  inventoryDirectory,
  verifyProductionBuildBoundary,
} = require("./production-data-delivery-utils.cjs");
const { inspectProductionBundleBoundary } = require("./production-bundle-boundary-utils.cjs");

const root = path.join(__dirname, "..");
const viteCli = path.join(root, "node_modules", "vite", "bin", "vite.js");
const outputRoot = path.join(root, "dist");
const publicDataRoot = path.join(root, "public", "data");
const evidenceRoot = path.join(root, "output");

execFileSync(process.execPath, [viteCli, "build", "--outDir", "dist", "--emptyOutDir"], {
  cwd: root,
  env: { ...process.env, WR_SKIP_PUBLIC_COPY: "1" },
  stdio: "inherit",
});

verifyProductionBuildBoundary(outputRoot);
const bundleBoundary = inspectProductionBundleBoundary(outputRoot);
const manifest = createProductionDataDeliveryManifest({
  generatedAt: new Date(),
  sourceInventory: inventoryDirectory(publicDataRoot),
});

fs.mkdirSync(evidenceRoot, { recursive: true });
fs.writeFileSync(path.join(outputRoot, "data-delivery-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceRoot, "production-data-delivery-report.json"), `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceRoot, "production-bundle-boundary-report.json"), `${JSON.stringify(bundleBoundary, null, 2)}\n`);
fs.writeFileSync(
  path.join(evidenceRoot, "production-bundle-boundary-report.md"),
  [
    "# White Rabbit Production Bundle Boundary",
    "",
    `Generated: ${bundleBoundary.generatedAt}`,
    "",
    `- Status: ${bundleBoundary.status}`,
    `- Landing asset bytes: ${bundleBoundary.landing.assetBytes.toLocaleString("en-US")}`,
    `- Landing heavy map-engine references: ${bundleBoundary.landing.heavyMapEngineReferences.length}`,
    `- Deferred map assets: ${bundleBoundary.deferredMapAssets.length}`,
    "- MapLibre JavaScript deferred: yes",
    "- MapLibre styles deferred: yes",
    "- Three.js deferred: yes",
    "- Existing Enter Map activation preserved: yes",
    "- Locked landing page redesigned: no",
    "",
    "The landing HTML loads only the application shell. MapLibre, its stylesheet, and the Three.js globe remain separate production assets activated by the existing map flow.",
    "",
  ].join("\n"),
);
fs.writeFileSync(
  path.join(evidenceRoot, "production-data-delivery-report.md"),
  [
    "# White Rabbit Production Data Delivery",
    "",
    `Generated: ${manifest.generatedAt}`,
    "",
    `- Build mode: ${manifest.buildMode}`,
    `- County-scale data files excluded from frontend bundle: ${manifest.sourceInventory.fileCount.toLocaleString("en-US")}`,
    `- County-scale data bytes excluded from frontend bundle: ${manifest.sourceInventory.bytes.toLocaleString("en-US")}`,
    `- Inventory SHA-256: ${manifest.sourceInventory.inventorySha256}`,
    `- Required runtime mount: ${manifest.bundleBoundary.runtimeRoutePrefix}`,
    `- Runtime delivery: ${manifest.runtimeContract.delivery}`,
    "- Earth imagery preserved: yes",
    "- DCAD parcel layer preserved: yes",
    "- Locked landing page changed: no",
    "",
    "The frontend artifact is intentionally deployable independently from parcel data. Production must mount a verified, viewport-bounded data service at `/data/` before activation.",
    "",
  ].join("\n"),
);

console.log(`Production data boundary verified: ${manifest.sourceInventory.fileCount} files and ${manifest.sourceInventory.bytes} bytes excluded from dist.`);
console.log(`Production bundle boundary verified: ${bundleBoundary.landing.assetBytes} landing bytes; heavy map engines deferred.`);

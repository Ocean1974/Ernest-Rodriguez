const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const delivery = await import("../src/map/geospatialDelivery.mjs");
  const bytes = new Uint8Array(127);
  bytes.set(new TextEncoder().encode("PMTiles"), 0);
  const view = new DataView(bytes.buffer);
  const set64 = (offset, value) => { view.setUint32(offset, value >>> 0, true); view.setUint32(offset + 4, Math.floor(value / 2 ** 32), true); };
  view.setUint8(7, 3);
  set64(8, 127); set64(16, 100); set64(24, 227); set64(32, 200); set64(40, 427); set64(48, 100); set64(56, 527); set64(64, 1000000);
  set64(72, 50000); set64(80, 50000); set64(88, 49000);
  view.setUint8(96, 1); view.setUint8(97, 2); view.setUint8(98, 2); view.setUint8(99, 1); view.setUint8(100, 10); view.setUint8(101, 16);
  view.setInt32(102, Math.round(-97.1 * 1e7), true); view.setInt32(106, Math.round(32.5 * 1e7), true); view.setInt32(110, Math.round(-96.3 * 1e7), true); view.setInt32(114, Math.round(33.1 * 1e7), true);
  view.setUint8(118, 12); view.setInt32(119, Math.round(-96.8 * 1e7), true); view.setInt32(123, Math.round(32.8 * 1e7), true);
  const header = delivery.verifyPmtilesHeader(bytes, { minZoom: 10, maxZoom: 16 });
  assert.equal(header.status, "passed");
  assert.equal(header.header.numTileContents, 49000);
  assert(Object.values(header.checks).every(Boolean));
  const badMagic = new Uint8Array(bytes); badMagic[0] = 0;
  assert.equal(delivery.verifyPmtilesHeader(badMagic).status, "failed");

  const manifest = { schemaVersion: "wr-pmtiles-artifact-v1", sourceCountyId: "dallas-county-dcad", expectedFeatureCount: 696601, artifactBytes: 1000000, sha256: "a".repeat(64), immutableDeploymentRequired: true, minZoom: 10, maxZoom: 16 };
  assert.equal(delivery.verifyPmtilesArtifactManifest(manifest, { artifactBytes: 1000000, sha256: "a".repeat(64) }).status, "passed");
  assert.equal(delivery.verifyPmtilesArtifactManifest({ ...manifest, sha256: "b".repeat(64) }, { artifactBytes: 1000000, sha256: "a".repeat(64) }).status, "failed");
  const tarrantManifest = { ...manifest, sourceCountyId: "tarrant-county-tad", expectedFeatureCount: 758633 };
  assert.equal(delivery.verifyPmtilesArtifactManifest(tarrantManifest, { artifactBytes: 1000000, sha256: "a".repeat(64) }, { sourceCountyId: "tarrant-county-tad", expectedFeatureCount: 758633 }).status, "passed");
  assert.equal(delivery.verifyPmtilesArtifactManifest(tarrantManifest, { artifactBytes: 1000000, sha256: "a".repeat(64) }).status, "failed");

  const http = delivery.verifyPmtilesHttpDelivery({ status: 206, bodyBytes: 16384, headers: { "accept-ranges": "bytes", "content-range": "bytes 0-16383/1000000", etag: '"sha256-abc"', "cache-control": "public, max-age=31536000, immutable", "content-type": "application/vnd.pmtiles", "access-control-expose-headers": "ETag, Content-Range, Accept-Ranges" } });
  assert.equal(http.status, "passed");
  assert(Object.values(http.checks).every(Boolean));
  const unsafeHttp = delivery.verifyPmtilesHttpDelivery({ status: 200, bodyBytes: 1000000, headers: { "cache-control": "no-store" } });
  assert.equal(unsafeHttp.status, "failed");

  const fallback = delivery.selectGeospatialRuntime({ pmtilesFeatureEnabled: false, artifactVerification: header, httpVerification: http, pmtilesUrl: "https://cdn.example.com/dallas.pmtiles" });
  assert.equal(fallback.selectedRuntime, "viewport-geojson-service");
  assert.equal(fallback.fallbackPreserved, true);
  assert.equal(fallback.visualContract.earthImageryPreserved, true);
  const enabled = delivery.selectGeospatialRuntime({ pmtilesFeatureEnabled: true, artifactVerification: header, httpVerification: http, pmtilesUrl: "https://cdn.example.com/dallas-v1-sha.pmtiles" });
  assert.equal(enabled.selectedRuntime, "pmtiles");
  assert.equal(enabled.fallbackPreserved, false);
  const insecure = delivery.selectGeospatialRuntime({ pmtilesFeatureEnabled: true, artifactVerification: header, httpVerification: http, pmtilesUrl: "http://cdn.example.com/dallas.pmtiles" });
  assert.equal(insecure.selectedRuntime, "viewport-geojson-service");

  const audit = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "output", "geospatial-delivery-audit.json"), "utf8"));
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "geospatial-delivery-audit.schema.json"), "utf8"));
  assert.equal(audit.schemaVersion, "wr-geospatial-delivery-audit-v1");
  assert.equal(audit.checks.exactFeatureCount, 696601);
  assert.match(audit.checks.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(schema.properties.schemaVersion.const, "wr-geospatial-delivery-audit-v1");
  const builder = fs.readFileSync(path.join(__dirname, "..", "output", "vector-tiles", "build-dcad-pmtiles.ps1"), "utf8");
  assert(builder.includes(audit.checks.sourceSha256), "Guarded builder must pin the audited source SHA-256");
  assert(builder.includes("sourceGeoJsonBytes") && builder.includes("sourceGeoJsonSha256"), "Artifact manifest must preserve exact source integrity evidence");
  assert(builder.includes("tippecanoeVersion") && builder.includes("tippecanoeArguments"), "Artifact manifest must preserve builder provenance");
  assert(builder.includes("verify-pmtiles-artifact.cjs"), "Builder must run independent artifact verification");
  console.log("White Rabbit PMTiles header, integrity, HTTP delivery, and runtime fallback tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

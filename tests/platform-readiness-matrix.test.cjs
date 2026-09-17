const assert = require("assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

(async () => {
  const root = path.join(__dirname, "..");
  const readiness = await import("../src/operations/platformReadiness.mjs");
  const registry = JSON.parse(fs.readFileSync(path.join(root, "data", "platform-capability-registry.json"), "utf8"));
  const gateSource = fs.readFileSync(path.join(root, "src", "data", "platformFeatureGates.ts"), "utf8");
  const featureGateStates = Object.fromEntries([...gateSource.matchAll(/^\s+([A-Za-z][A-Za-z0-9]*):\s*(true|false),$/gm)].map((match) => [match[1], match[2] === "true"]));
  const references = [...new Set(registry.capabilities.flatMap((capability) => capability.foundationEvidence))];
  const evidenceInventory = Object.fromEntries(references.map((reference) => {
    const absolute = path.join(root, reference);
    const exists = fs.existsSync(absolute);
    return [reference, exists ? { exists, bytes: fs.statSync(absolute).size, sha256: crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex") } : { exists }];
  }));
  const matrix = readiness.createPlatformReadinessMatrix({ registry, featureGateStates, evidenceInventory, generatedAt: "2026-08-14T14:00:00.000Z", releaseDecisionVerifications: [], observedFacts: { pmtilesArtifactPresent: false, priorityCountiesBlocked: 10, priorityCountiesUnknownFreshness: 10 } });
  assert.equal(matrix.schemaVersion, "wr-platform-readiness-matrix-v1");
  assert.equal(matrix.capabilities.length, 10);
  assert.deepEqual(matrix.capabilities.map((item) => item.stage), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(matrix.summary.activationAuthorizedCount, 0);
  assert.equal(matrix.summary.enabledFeatureGateCount, 0);
  assert.equal(matrix.summary.unsafeConfigurationCount, 0);
  assert.equal(matrix.summary.externalBlockedCount, 10);
  assert(matrix.capabilities.every((item) => item.status === "foundation-complete-external-blockers"));
  assert(matrix.capabilities.every((item) => item.externalBlockers.length > 0));
  assert.equal(matrix.capabilities.find((item) => item.stage === 1).featureGates.find((item) => item.gate === "pmtilesRuntime").enabled, false);
  assert(matrix.capabilities.find((item) => item.stage === 10).externalBlockers.some((blocker) => blocker.includes("10 priority counties")));

  const unsafe = readiness.createPlatformReadinessMatrix({ registry, featureGateStates: { ...featureGateStates, pmtilesRuntime: true }, evidenceInventory, generatedAt: "2026-08-14T14:00:00.000Z", releaseDecisionVerifications: [] });
  assert.equal(unsafe.capabilities[0].status, "unsafe-configuration");
  assert.equal(unsafe.summary.unsafeConfigurationCount, 1);
  const missing = readiness.createPlatformReadinessMatrix({ registry, featureGateStates, evidenceInventory: { ...evidenceInventory, "output/platform-growth-tranche-16-report.json": { exists: false } }, generatedAt: "2026-08-14T14:00:00.000Z" });
  assert.equal(missing.capabilities.find((item) => item.stage === 5).status, "foundation-incomplete");
  assert.throws(() => readiness.createPlatformReadinessMatrix({ registry: { ...registry, capabilities: registry.capabilities.slice(0, 9) }, featureGateStates, evidenceInventory, generatedAt: "2026-08-14T14:00:00.000Z" }), /10 roadmap stages/);

  const schema = JSON.parse(fs.readFileSync(path.join(root, "data", "schemas", "platform-readiness-matrix.schema.json"), "utf8"));
  assert.equal(schema.properties.schemaVersion.const, "wr-platform-readiness-matrix-v1");
  console.log("White Rabbit 10-stage fail-closed platform readiness matrix tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

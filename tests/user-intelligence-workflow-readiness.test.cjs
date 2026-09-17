const assert = require("assert");
const fs = require("fs");
const path = require("path");

(() => {
  const root = path.join(__dirname, "..");
  const report = JSON.parse(fs.readFileSync(path.join(root, "output", "user-intelligence-workflow-readiness.json"), "utf8"));
  const schema = JSON.parse(fs.readFileSync(path.join(root, "data", "schemas", "user-intelligence-workflow-readiness.schema.json"), "utf8"));
  assert.equal(report.schemaVersion, schema.properties.schemaVersion.const);
  assert(schema.required.every((field) => schema.properties[field]));
  assert.equal(report.status, "foundation-ready-release-blocked");
  assert(report.checks.every((item) => item.passed));
  assert.deepEqual(report.durableWorkflow.atomicNamespaces, ["user-intelligence", "alert-routing"]);
  assert.equal(report.durableWorkflow.canonicalPropertyJoinKey, "whiteRabbitPropertyId");
  assert.equal(report.durableWorkflow.idempotentReplay, true);
  assert.equal(report.durableWorkflow.ownerScopedSnapshots, true);
  assert.equal(report.alertBoundary.inAppOnly, true);
  assert.equal(report.alertBoundary.externalProviderContacted, false);
  assert.equal(report.activation.productionReleaseDecisionPresent, false);
  assert.equal(report.activation.visibleUiActivated, false);
  assert.equal(report.activation.lockedWebsiteDesignChanged, false);
  assert.equal(report.certificationScenario.replayPreservedTenantRevision, true);
  assert(report.releaseBlockers.length >= 4);
  console.log("White Rabbit user-intelligence workflow readiness artifact tests passed.");
})();

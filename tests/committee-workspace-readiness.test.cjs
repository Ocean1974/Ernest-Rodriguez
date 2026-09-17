const assert = require("assert");
const fs = require("fs");
const path = require("path");

(() => {
  const root = path.join(__dirname, "..");
  const report = JSON.parse(fs.readFileSync(path.join(root, "output", "committee-workspace-readiness.json"), "utf8"));
  const schema = JSON.parse(fs.readFileSync(path.join(root, "data", "schemas", "committee-workspace-readiness.schema.json"), "utf8"));
  assert.equal(report.schemaVersion, schema.properties.schemaVersion.const);
  assert(schema.required.every((field) => schema.properties[field]));
  assert.equal(report.status, "foundation-ready-release-blocked");
  assert(report.checks.every((item) => item.passed));
  assert.deepEqual(report.durableWorkspace.atomicNamespaces, ["committee-workspace", "collaboration", "deal-room", "diligence"]);
  assert.equal(report.durableWorkspace.canonicalPropertyJoinKey, "whiteRabbitPropertyId");
  assert.equal(report.approvalBoundary.distinctAuthorReviewerApproverRequired, true);
  assert.equal(report.approvalBoundary.staleApprovalRejected, true);
  assert.equal(report.documentBoundary.verifiedCleanMalwareScanRequired, true);
  assert.equal(report.documentBoundary.externalSharesCreated, 0);
  assert.equal(report.diligenceBoundary.minimumTaskCount, 3);
  assert.equal(report.diligenceBoundary.completedTasksCreated, 0);
  assert.equal(report.certificationScenario.atomicMutationCount, 4);
  assert.equal(report.certificationScenario.exactReplayPreservedRevision, true);
  assert.equal(report.activation.productionReleaseDecisionPresent, false);
  assert.equal(report.activation.visibleUiActivated, false);
  assert.equal(report.activation.lockedWebsiteDesignChanged, false);
  assert(report.releaseBlockers.length >= 4);
  console.log("White Rabbit committee workspace readiness artifact tests passed.");
})();

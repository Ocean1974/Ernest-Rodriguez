const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const report = JSON.parse(fs.readFileSync(path.join(root, "output", "source-freshness-audit.json"), "utf8"));
const markdown = fs.readFileSync(path.join(root, "output", "source-freshness-audit.md"), "utf8");
const source = fs.readFileSync(path.join(root, "scripts", "build-source-freshness-audit.cjs"), "utf8");

assert.equal(report.schemaVersion, "wr-source-freshness-audit-v1");
assert.equal(report.pageDesignChanged, false);
assert(report.summary.adapterCount === 3235, "Freshness audit must cover all U.S. county adapter scaffolds");
assert(report.summary.manifestsPresent > 0, "Freshness audit must inspect connected service manifests");
assert(report.summary.unknown > 0, "Missing upstream dates must remain explicitly unknown");
assert(report.rule.includes("not treated as upstream source update time"));
assert(markdown.includes("Page design changed: no"));
assert(source.includes("freshnessStatus(sourceUpdatedAt, serviceGeneratedAt"), "Audit must evaluate source timestamps against the policy");
console.log("White Rabbit source freshness audit tests passed.");

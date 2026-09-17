const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8").replace(/^\uFEFF/, ""));

function main() {
  const plan = readJson("data/platform-program-plan.json");
  const capabilityRegistry = readJson("data/platform-capability-registry.json");
  const readiness = readJson("output/platform-readiness-matrix.json");
  const coverage = readJson("output/national-county-intelligence/national-coverage-manifest.json");
  const sourceAudit = readJson("data/county-source-audits/tx-priority-tranche-001-official-sources.json");
  const readinessById = new Map(readiness.capabilities.map((item) => [item.capabilityId, item]));
  const coverageById = new Map(coverage.counties.map((county) => [county.countyId, county]));
  const auditById = new Map(sourceAudit.counties.map((county) => [county.countyId, county]));

  const featureChecklist = plan.featurePriorities.map((capabilityId, index) => {
    const capability = capabilityRegistry.capabilities.find((item) => item.capabilityId === capabilityId);
    if (!capability) throw new Error(`Unknown feature capability ${capabilityId}`);
    const state = readinessById.get(capabilityId);
    return {
      sequence: index + 1,
      capabilityId,
      name: capability.name,
      status: state?.status || "readiness-missing",
      foundationEvidenceComplete: (state?.missingFoundationEvidence || []).length === 0,
      activationAuthorized: state?.activationAuthorized === true,
      enabledFeatureGateCount: (state?.enabledFeatureGates || []).length,
      externalBlockers: state?.externalBlockers || capability.externalBlockers || [],
      nextGate: capability.requiredReleaseEvidence?.[0] || "release-evidence-needed",
    };
  });

  const countyChecklist = plan.immediateCountyTranche.map((countyId, index) => {
    const county = coverageById.get(countyId);
    const audit = auditById.get(countyId);
    if (!county || !audit) throw new Error(`Missing coverage or source-audit evidence for ${countyId}`);
    return {
      sequence: index + 1,
      countyId,
      countyName: county.countyName,
      state: county.state,
      fips: county.fips,
      coverageStage: county.stage,
      discoveryStatus: audit.discoveryStatus,
      observedParcelCount: audit.observedParcelCount,
      observedCountCertified: audit.observedCountCertified === true,
      gates: {
        scaffoldPresent: Boolean(county.adapterPath),
        officialSourcesIdentified: audit.sources.length > 0,
        rightsVerified: audit.rightsVerified === true,
        joinKeysVerified: audit.joinKeysVerified === true,
        exactCountCertified: audit.observedCountCertified === true,
        normalized: false,
        searchBuilt: false,
        viewportBuilt: false,
        enrichmentsVerified: false,
        qaPassed: false,
        live: county.stage === "live",
      },
      nextActions: audit.nextActions,
    };
  });

  const integrationMatrix = plan.integrationMatrix.map((item) => ({
    ...item,
    capabilityStatus: readinessById.get(item.capabilityId)?.status || "readiness-missing",
    activationAuthorized: readinessById.get(item.capabilityId)?.activationAuthorized === true,
    immediateCountyCoverage: countyChecklist.map((county) => ({ countyId: county.countyId, ready: county.gates.live })),
  }));

  const manifest = {
    schemaVersion: "wr-master-program-manifest-v1",
    generatedAt: new Date().toISOString(),
    objective: plan.objective,
    releaseRule: plan.releaseRule,
    summary: {
      featureCapabilityCount: featureChecklist.length,
      featureCapabilitiesLive: featureChecklist.filter((item) => item.activationAuthorized).length,
      nationalCountyEquivalentCount: coverage.summary.countyEquivalentCount,
      nationalStateAreaCount: coverage.summary.stateAreaCount,
      priorityCountyCount: coverage.summary.priorityCountyCount,
      immediateCountyCount: countyChecklist.length,
      immediateCountiesWithSourcesIdentified: countyChecklist.filter((item) => item.gates.officialSourcesIdentified).length,
      immediateCountiesRightsVerified: countyChecklist.filter((item) => item.gates.rightsVerified).length,
      immediateCountiesLive: countyChecklist.filter((item) => item.gates.live).length,
    },
    workstreams: plan.workstreams,
    featureChecklist,
    countyChecklist,
    integrationMatrix,
    sourceAudit: "data/county-source-audits/tx-priority-tranche-001-official-sources.json",
    nationalCoverage: "output/national-county-intelligence/national-coverage-manifest.json",
    platformReadiness: "output/platform-readiness-matrix.json",
    visibleUiChanged: false,
  };

  const outputDirectory = path.join(root, "output", "program");
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "master-program-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const lines = [
    "# White Rabbit Master Program Checklist",
    "",
    `Generated: ${manifest.generatedAt}`,
    "",
    `- Feature capabilities: ${manifest.summary.featureCapabilityCount} (${manifest.summary.featureCapabilitiesLive} release-authorized)` ,
    `- Nationwide county-equivalents: ${manifest.summary.nationalCountyEquivalentCount}`,
    `- States/areas: ${manifest.summary.nationalStateAreaCount}`,
    `- Immediate counties: ${manifest.summary.immediateCountyCount}`,
    `- Immediate counties with official sources identified: ${manifest.summary.immediateCountiesWithSourcesIdentified}`,
    `- Immediate counties with rights verified: ${manifest.summary.immediateCountiesRightsVerified}`,
    "",
    "## Feature checklist",
    "",
    "| # | Capability | Status | Release authorized | Next gate |",
    "| ---: | --- | --- | --- | --- |",
    ...featureChecklist.map((item) => `| ${item.sequence} | ${item.name} | ${item.status} | ${item.activationAuthorized ? "yes" : "no"} | ${item.nextGate} |`),
    "",
    "## Immediate county checklist",
    "",
    "| # | County | Stage | Sources identified | Rights | Join keys | Count certified | QA | Live |",
    "| ---: | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...countyChecklist.map((item) => `| ${item.sequence} | ${item.countyName}, ${item.state} | ${item.coverageStage} | ${item.gates.officialSourcesIdentified ? "yes" : "no"} | ${item.gates.rightsVerified ? "yes" : "no"} | ${item.gates.joinKeysVerified ? "yes" : "no"} | ${item.gates.exactCountCertified ? "yes" : "no"} | ${item.gates.qaPassed ? "yes" : "no"} | ${item.gates.live ? "yes" : "no"} |`),
    "",
    "## Release rule",
    "",
    manifest.releaseRule,
    "",
  ];
  fs.writeFileSync(path.join(outputDirectory, "master-program-manifest.md"), lines.join("\n"));
  console.log(JSON.stringify(manifest.summary, null, 2));
}

main();

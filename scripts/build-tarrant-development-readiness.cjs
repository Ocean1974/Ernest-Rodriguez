const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

(async () => {
  const development = await import("../src/operations/countyDevelopmentIntelligence.mjs");
  const permits = readJson("output/tarrant/permit-readiness/tarrant-permit-readiness.json");
  const zoning = readJson("output/tarrant/zoning-readiness/tarrant-zoning-readiness.json");
  const registry = readJson("data/county-adapters/tarrant/jurisdiction-source-registry.json");
  const permitIds = ["fort-worth-accela-permits", "arlington-issued-permits-three-year"];
  const zoningIds = ["fort-worth-zoning-cases", "arlington-zoning-cases-three-year"];
  const inputs = [
    ...permitIds.map((id) => {
      const probe = permits.probes.find((item) => item.sourceId === id);
      if (!probe) throw new Error(`Missing permit probe ${id}`);
      return { probe, feedRole: "permit-event", upstreamContractVersion: probe.schemaVersion, upstreamProbeSha256: probe.probeSha256 };
    }),
    ...zoningIds.map((id) => {
      const probe = zoning.probes.find((item) => item.sourceId === id);
      if (!probe) throw new Error(`Missing zoning probe ${id}`);
      return { probe, feedRole: "zoning-case", upstreamContractVersion: probe.schemaVersion, upstreamProbeSha256: probe.probeSha256 };
    }),
  ];
  const bindings = inputs.map(({ probe, ...upstream }) => development.createCountyDevelopmentFeedBinding({
    countyId: "tarrant-county-tad",
    sourceId: probe.sourceId,
    publisher: probe.publisher,
    feedRole: upstream.feedRole,
    jurisdictionIds: probe.jurisdictionIds,
    temporalCoverage: probe.temporalCoverage,
    upstreamContractVersion: upstream.upstreamContractVersion,
    upstreamProbeSha256: upstream.upstreamProbeSha256,
    candidateRecordCount: probe.featureCount,
    upstreamCaptureCertified: false,
    upstreamNormalizationCertified: false,
    jurisdictionBoundaryCertified: false,
    reuseRightsCertified: false,
  }));
  const universe = [...registry.municipalities.map(slug), "unincorporated-tarrant"];
  const coverage = development.reconcileCountyDevelopmentCoverage({ countyId: "tarrant-county-tad", jurisdictionUniverseIds: universe, bindings });
  const classificationRules = [
    development.createCountyDevelopmentClassificationRule({ ruleId: "permit-new-construction", ruleVersion: "1", feedRole: "permit-event", signalType: "new-construction", lifecycleStage: "construction", conditions: [{ field: "permitCategory", operator: "equals", value: "new-construction" }], exclusions: [{ field: "status", operator: "in", value: ["void", "cancelled", "withdrawn"] }], officialDefinitionRef: "artifact://tarrant/permit-taxonomy", approvedByRefs: [] }),
    development.createCountyDevelopmentClassificationRule({ ruleId: "permit-demolition", ruleVersion: "1", feedRole: "permit-event", signalType: "demolition", lifecycleStage: "site-prep", conditions: [{ field: "permitCategory", operator: "equals", value: "demolition" }], exclusions: [{ field: "status", operator: "in", value: ["void", "cancelled"] }], officialDefinitionRef: "artifact://tarrant/permit-taxonomy", approvedByRefs: [] }),
    development.createCountyDevelopmentClassificationRule({ ruleId: "certificate-of-occupancy", ruleVersion: "1", feedRole: "permit-event", signalType: "occupancy", lifecycleStage: "completion", conditions: [{ field: "permitCategory", operator: "equals", value: "certificate-of-occupancy" }], exclusions: [], officialDefinitionRef: "artifact://tarrant/permit-taxonomy", approvedByRefs: [] }),
    development.createCountyDevelopmentClassificationRule({ ruleId: "zoning-case-entitlement", ruleVersion: "1", feedRole: "zoning-case", signalType: "entitlement-activity", lifecycleStage: "entitlement", conditions: [{ field: "caseId", operator: "exists", value: true }], exclusions: [{ field: "status", operator: "in", value: ["withdrawn", "denied"] }], officialDefinitionRef: "artifact://tarrant/zoning-case-taxonomy", approvedByRefs: [] }),
  ];
  const audit = development.createCountyDevelopmentSignalAudit({
    countyId: "tarrant-county-tad",
    jurisdictionId: "countywide-readiness-only",
    counts: { candidateRecords: coverage.candidateRecordCount, normalizedEvents: 0, ineligibleRecords: coverage.candidateRecordCount, duplicateRecords: 0, invalidRecords: 0, linkedEvents: 0, unmatchedEvents: 0, ambiguousEvents: 0, conflictEvents: 0, emittedSignals: 0, suppressedLinkedEvents: 0 },
    sourceCaptureCertified: false,
    classificationRulesCertified: false,
    parcelLinksCertified: false,
    lineageCertified: false,
    evaluatedAt: inputs.map(({ probe }) => probe.observedAt).sort().at(-1),
  });
  const indexManifestCandidate = development.createCountyDevelopmentIndexManifest({ countyId: "tarrant-county-tad", parcelManifestSha256: "", signalAuditSha256: audit.auditSha256, parcelCount: 0, signalCount: 0, signalAuditCertified: false, eventLineageCertified: false, coverageCertified: false, approvalRefs: [] });
  const artifact = {
    schemaVersion: "wr-tarrant-development-readiness-v1",
    generatedAt: audit.evaluatedAt,
    bindings,
    coverage,
    classificationRules,
    signalAudit: audit,
    indexManifestCandidate,
    recordsCaptured: false,
    eventsNormalized: false,
    parcelLinksBuilt: false,
    lifecycleAggregatesBuilt: false,
    signalsEmitted: false,
    activationAuthorized: false,
  };
  const directory = path.join(root, "output/tarrant/development-readiness");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "tarrant-development-readiness.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  const rows = bindings.map((binding) => `| ${binding.sourceId} | ${binding.feedRole} | ${binding.candidateRecordCount.toLocaleString("en-US")} | ${binding.status} |`).join("\n");
  const markdown = `# Tarrant Development Intelligence Readiness\n\nThis is an evidence-only federation. Candidate source records are not development signals. No records were captured, no parcel links or lifecycle aggregates were built, and no user-visible data was activated.\n\n## Exact upstream candidates\n\n| Source | Role | Candidate records | Status |\n| --- | --- | ---: | --- |\n${rows}\n\n- Candidate records: **${coverage.candidateRecordCount.toLocaleString("en-US")}**.\n- Normalized development events: **0**.\n- Emitted parcel development signals: **0**.\n- Discovered jurisdictions: ${coverage.discoveredJurisdictionIds.join(", ")}.\n- Certified jurisdictions: **0**.\n- Uncovered or uncertified scopes: **${coverage.uncoveredOrUncertifiedJurisdictionIds.length}**.\n\n## Safety model\n\n- Permit records require explicit, approved classification; a permit is not automatically a development project.\n- Zoning cases prove entitlement activity only and never prove construction.\n- Every signal must retain source snapshot, source record, classification rule, parcel-link, and evidence references.\n- Candidate, normalized, linked, ambiguous, conflicting, suppressed, and emitted counts reconcile through an exact audit.\n- The four initial rules remain draft until independently approved.\n\n## Hard blockers\n\n1. Capture licensed immutable upstream permit and zoning-case records.\n2. Certify source identity, normalization, jurisdiction boundaries, and parcel bridges.\n3. Independently approve explicit classification and exclusion rules.\n4. Deduplicate cross-feed events and publish exact lifecycle and link partitions.\n5. Build the parcel index only after signal audit, coverage, lineage, and approvals pass.\n`;
  fs.writeFileSync(path.join(directory, "tarrant-development-readiness.md"), markdown);
  console.log(JSON.stringify({ candidateRecordCount: coverage.candidateRecordCount, discoveredJurisdictionCount: coverage.discoveredJurisdictionIds.length, certifiedJurisdictionCount: coverage.certifiedJurisdictionIds.length, uncoveredOrUncertifiedCount: coverage.uncoveredOrUncertifiedJurisdictionIds.length, emittedSignalCount: 0 }, null, 2));
})().catch((error) => { console.error(error); process.exit(1); });

const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const demand = await import("../src/operations/countyDemandIntelligence.mjs");
  const sha = demand.countyDemandSha256;
  const probe = demand.createCountyDemandSourceProbe({ countyId: "test", sourceId: "irs", publisher: "IRS", sourceRole: "migration-inflow", domain: "migration", geographyLevel: "county", geographyId: "05000US00001", sourceUrl: "https://official.example/inflow.csv", periodStart: "2022", periodEnd: "2023", releasedAt: "2026-03-19", recordCount: 10, metricIds: ["returns"], responseBytes: 100, responseSha256: sha("raw"), sourceIdentityUnique: true, blockers: ["rights"] });
  assert.equal(probe.status, "metadata-only");
  assert.equal(probe.contentPersisted, false);
  const unpersistedOtherwiseReady = demand.createCountyDemandSourceProbe({ countyId: "test", sourceId: "unpersisted", publisher: "IRS", sourceRole: "migration-inflow", domain: "migration", geographyLevel: "county", geographyId: "05000US00001", sourceUrl: "https://official.example/inflow.csv", periodStart: "2022", periodEnd: "2023", releasedAt: "2026-03-19", recordCount: 10, metricIds: ["returns"], responseBytes: 100, responseSha256: sha("raw"), sourceIdentityUnique: true, reuseRightsCertified: true });
  assert.equal(unpersistedOtherwiseReady.status, "metadata-only");
  const persistedCertified = demand.createCountyDemandSourceProbe({ ...unpersistedOtherwiseReady, sourceId: "persisted", contentPersisted: true });
  assert.equal(persistedCertified.status, "certification-ready");
  assert.throws(() => demand.createCountyDemandSourceProbe({ ...probe, sourceRole: "social-media" }), /Unsupported/);
  const blocked = demand.createCountyDemandSourceProbe({ countyId: "test", sourceId: "acs", publisher: "Census", sourceRole: "demographic", domain: "demographic", geographyLevel: "county", geographyId: "05000US00001", sourceUrl: "https://official.example/acs", periodStart: "2020", periodEnd: "2024", recordCount: 0, metricIds: ["population"], blockers: ["api-key"] });
  assert.equal(blocked.metadataReady, true);
  const coverage = demand.reconcileCountyDemandCoverage({ countyId: "test", geographyId: "05000US00001", requiredDomains: ["migration", "demographic", "housing"], probes: [probe, blocked] });
  assert.deepEqual(coverage.discoveredDomains, ["demographic", "migration"]);
  assert.deepEqual(coverage.observedDomains, ["migration"]);
  assert.equal(coverage.certifiedDomains.length, 0);
  assert(coverage.rules.includes("county-observation-never-labeled-parcel-fact"));
  const observation = demand.createCountyDemandObservation({ countyId: "test", sourceId: "irs", metricId: "returns", label: "Returns", value: 10, unit: "returns", geographyLevel: "county", geographyId: "05000US00001", periodStart: "2022", periodEnd: "2023", releasedAt: "2026-03-19", sourceSnapshotSha256: sha("snapshot"), sourceRecordSha256: sha("record"), semantics: "Returns are not people" });
  assert.equal(observation.value, 10);
  assert.throws(() => demand.createCountyDemandObservation({ ...observation, value: Number.NaN }), /finite/);
  const definition = demand.createCountyDemandFeatureDefinition({ featureId: "net-flow", featureVersion: "1", sourceMetricIds: ["in", "out"], formula: "in-out", outputUnit: "returns", localization: "source-geography-only", explanation: "County net flow", approvedByRefs: [] });
  assert.equal(definition.status, "draft");
  assert.throws(() => demand.createCountyDemandFeatureDefinition({ ...definition, localization: "parcel-attribution", parcelEvidenceRefs: [] }), /parcel-specific evidence/);
  const futureVector = demand.createCountyDemandPointInTimeVector({ countyId: "test", geographyId: "05000US00001", asOf: "2026-01-01", observations: [observation], sourceCertificationPassed: true, definitionApprovalPassed: true });
  assert.equal(futureVector.status, "rejected");
  assert.equal(futureVector.futureObservationCount, 1);
  const goodVector = demand.createCountyDemandPointInTimeVector({ countyId: "test", geographyId: "05000US00001", asOf: "2026-04-01", observations: [observation], sourceCertificationPassed: true, definitionApprovalPassed: true });
  assert.equal(goodVector.status, "certified");
  const audit = demand.createCountyDemandAudit({ countyId: "test", geographyId: "05000US00001", counts: { sourceRows: 10, parsedRows: 10, aggregateRows: 2, detailRows: 8, invalidRows: 0, duplicateRows: 0, observationCount: 2, featureCount: 1 }, observationLineageCertified: true, temporalAlignmentCertified: true, coverageCertified: true, parcelOverclaimCount: 0, evaluatedAt: "2026-08-23" });
  assert.equal(audit.status, "certified");
  const rejected = demand.createCountyDemandAudit({ countyId: "test", geographyId: "05000US00001", counts: { sourceRows: 10, parsedRows: 10, aggregateRows: 2, detailRows: 8, invalidRows: 0, duplicateRows: 0, observationCount: 2, featureCount: 1 }, observationLineageCertified: true, temporalAlignmentCertified: true, coverageCertified: true, parcelOverclaimCount: 1, evaluatedAt: "2026-08-23" });
  assert.equal(rejected.status, "rejected");
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/schemas/county-demand-intelligence.schema.json"), "utf8"));
  assert.equal(schema.$defs.vector.properties.schemaVersion.const, demand.COUNTY_DEMAND_POINT_IN_TIME_VECTOR_VERSION);
  const gates = fs.readFileSync(path.join(__dirname, "../src/data/platformFeatureGates.ts"), "utf8");
  for (const gate of ["countyDemandSourceFederation", "countyDemandObservationCapture", "countyDemandTemporalAlignment", "countyDemandFeatureCertification", "countyParcelDemandAttribution"]) assert(gates.includes(`${gate}: false`));
  const dallas = JSON.parse(fs.readFileSync(path.join(__dirname, "../output/dallas-demand-intelligence.json"), "utf8"));
  assert.equal(dallas.schemaVersion, "wr-dallas-demand-intelligence-v1");
  assert.deepEqual(dallas.geography, { level: "county", geographyId: "05000US48113", stateFips: "48", countyFips: "113" });
  assert.equal(dallas.sourceFiles.length, 209);
  assert.deepEqual(dallas.sourceFiles.slice(0, 2).map(({ bytes, sha256 }) => ({ bytes, sha256 })), [
    { bytes: 4571970, sha256: "813ba2ef550c6a598a5121ccf98edcc79f61f1af69eb495bf44cd830b1586745" },
    { bytes: 4584439, sha256: "364dba518f0db092515ccde03dda987815f6e54bcc8859640001e9185d4c106e" },
  ]);
  assert.deepEqual(dallas.sourceFiles.slice(2, 9).map(({ bytes, sha256 }) => ({ bytes, sha256 })), [
    { bytes: 240811, sha256: "3f04d8c2ad77dab54085f014b795c33c19463eede4539e110247bb329d1025fd" },
    { bytes: 224344, sha256: "f78748dc0221551890494e08d8239d7aecbfff9777e96a18d24f5df6a570cd86" },
    { bytes: 220984, sha256: "3d117f0af1162d4a78ca3fce7b459e83398068d59002a1c14f58c9c3c6c67e45" },
    { bytes: 396377, sha256: "0bd1e4dd51f8380cd6feaf223b2c1f6c3c3ab6178224be5febde9764e6afe877" },
    { bytes: 198370, sha256: "8624f9775add1e22ac3a015a753207e0d752bc4c967dda04c22cd9e17ac94b57" },
    { bytes: 236001, sha256: "27120d5d8a5fd1c91619e86dad921179c8ae170d1fa5ee33ec357da4528c7cb3" },
    { bytes: 405272, sha256: "9fb18a5c685136aea6fe6edec6b5463d0ce03a9d342e827f2bfd1b816eaec76f" },
  ]);
  assert.deepEqual(dallas.exactMigrationSummary, { inflowReturns: 76480, outflowReturns: 85674, netReturns: -9194, inflowExemptions: 120450, outflowExemptions: 149719, netExemptions: -29269, inflowAgiThousands: 5871779, outflowAgiThousands: 7172111, netAgiThousands: -1300332 });
  assert.deepEqual(dallas.exactMarketContext, { population: 2656028, medianHouseholdIncome: 78932, housingUnits: 1088688, occupiedHousingUnits: 995263, vacantHousingUnits: 93425, medianGrossRent: 1668, medianOwnerOccupiedHomeValue: 330500, annualAverageEstablishments: 82799, annualAverageEmployment: 1831012, annualAverageWeeklyWage: 1781, averageAnnualPay: 92601 });
  assert.deepEqual(dallas.audit.counts, { sourceRows: 53916, parsedRows: 53916, aggregateRows: 51280, detailRows: 2636, invalidRows: 0, duplicateRows: 0, observationCount: 29, featureCount: 0 });
  assert(dallas.probes.every((item) => item.contentPersisted && item.status === "metadata-only"));
  assert.deepEqual(dallas.coverage.observedDomains, ["demographic", "housing", "labor", "migration", "supply"]);
  assert.equal(dallas.coverage.certifiedDomains.length, 0);
  assert.deepEqual(dallas.activation.observedDomains, ["demographic", "housing", "labor", "migration", "supply"]);
  assert.deepEqual(dallas.exactSupplySummary, { issuedPermitEvents: 191, commercialPermitEvents: 110, residentialPermitEvents: 80, unclassifiedPermitEvents: 1, newCommercialBuildingPermitEvents: 23, residentialNoticeOfConstructionEvents: 73, firstIssuedDate: "2026-01-05", lastIssuedDate: "2026-07-30" });
  assert.deepEqual(dallas.exactCitySupplySummary, { recordCount: 1746, uniqueRecordNumberCount: 1746, sourcePageCount: 193, selectedRecordTypeCount: 19, commercialNewConstructionRecords: 27, residentialNewConstructionRecords: 142, commercialAlterationAdditionRecords: 195, residentialAlterationAdditionRecords: 162, demolitionRecords: 109, certificateOfOccupancyRecords: 529 });
  const supplyObservation = dallas.observations.find((item) => item.metricId === "county-issued-permits-ytd");
  assert.equal(supplyObservation.value, 191);
  assert.match(supplyObservation.semantics, /does not include every permit issued by the City of Dallas/i);
  const cityObservation = dallas.observations.find((item) => item.metricId === "city-selected-building-records");
  assert.equal(cityObservation.value, 1746);
  assert.equal(cityObservation.geographyLevel, "place");
  assert.equal(cityObservation.geographyId, "16000US4819000");
  assert.match(cityObservation.semantics, /record dates are not permit issuance dates/i);
  const acsIncome = dallas.observations.find((item) => item.metricId === "median-household-income");
  assert.equal(acsIncome.marginOfError, 2070);
  const acsPopulation = dallas.observations.find((item) => item.metricId === "population");
  assert.equal(acsPopulation.marginOfError, null);
  assert.equal(dallas.activation.parcelDemandScoresBuilt, false);
  assert.equal(dallas.activation.visibleUiActivated, false);
  assert.equal(dallas.activation.parcelAttributionProhibited, true);
  const dallasAdapter = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/county-adapters/dallas/adapter.json"), "utf8"));
  const demandLayer = dallasAdapter.optionalLayers.find((layer) => layer.id === "dallas-migration-demand-intelligence");
  assert(demandLayer);
  assert.equal(demandLayer.status, "source-captured-certification-blocked");
  assert.match(demandLayer.source, /Census ACS 2024/);
  assert.match(demandLayer.source, /Dallas County January-July 2026 issued-permit reports/);
  assert.match(demandLayer.source, /City of Dallas DallasNow Building records/);
  assert.match(demandLayer.joinBehavior, /no parcel attribution/i);
  assert.equal(dallasAdapter.verifiedCounts.countyIssuedPermitEvents2026Ytd, 191);
  assert.equal(dallasAdapter.verifiedCounts.cityDallasNowSelectedBuildingRecords, 1746);
  assert.equal(dallasAdapter.verifiedCounts.cityDallasNowParcelAttributionCount, 0);
  assert.equal(dallasAdapter.verifiedCounts.demandObservationCount, 29);
  assert.equal(dallasAdapter.verifiedCounts.demandObservedDomainCount, 5);
  console.log("White Rabbit county demand semantics, point-in-time leakage, geography, and exact audit tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

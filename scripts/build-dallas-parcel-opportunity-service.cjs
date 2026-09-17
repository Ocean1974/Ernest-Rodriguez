const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createWhiteRabbitPropertyId } = require("./property-identity.cjs");

const root = path.join(__dirname, "..");
const parcelManifestFile = path.join(root, "public", "data", "parcels", "manifest.json");
const developmentIndexFile = path.join(root, "public", "data", "developments", "parcel-development-index.json");
const developmentManifestFile = path.join(root, "public", "data", "developments", "manifest.json");
const zoningIndexFile = path.join(root, "public", "data", "zoning", "parcel-zoning-index.json");
const floodIndexFile = path.join(root, "public", "data", "floodplain", "parcel-floodplain-index.json");
const dallasNowLinkageFile = path.join(root, "output", "dallas-city-building-parcel-linkage.json");
const buildingCharacteristicsManifestFile = path.join(root, "public", "data", "building-characteristics", "manifest.json");
const modelFile = path.join(root, "src", "intelligence", "opportunitySignals.mjs");
const featureGateFile = path.join(root, "src", "data", "platformFeatureGates.ts");
const outputJsonFile = path.join(root, "output", "dallas-parcel-opportunity-intelligence.json");
const outputMarkdownFile = path.join(root, "output", "dallas-parcel-opportunity-intelligence.md");
const publicRoot = path.join(root, "public", "data", "opportunities");
const candidateDir = path.join(publicRoot, "candidates");
const publicManifestFile = path.join(publicRoot, "manifest.json");
const TOP_LIMIT = 5000;
const PAGE_SIZE = 100;
const SOURCE_COUNTY_ID = "dallas-county-dcad";

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readJsonDigest(file) {
  const bytes = fs.readFileSync(file);
  return { value: JSON.parse(bytes.toString("utf8")), bytes: bytes.length, sha256: sha256(bytes) };
}

function numeric(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function landAcres(parcel) {
  const size = numeric(parcel.landAreaSize);
  const unit = String(parcel.landAreaUnit || "").toLowerCase();
  if (size !== null && /acre|\bac\b/.test(unit)) return size;
  const squareFeet = numeric(parcel.landAreaSqFt);
  return squareFeet === null ? null : squareFeet / 43560;
}

function opportunityEvidenceFingerprint(parcel) {
  return sha256(JSON.stringify([
    parcel.accountNum,
    parcel.gisParcelId,
    parcel.address,
    parcel.propertyName,
    parcel.ownerName,
    parcel.ownerName2,
    parcel.businessName,
    parcel.landUseCode,
    parcel.landUseDescription,
    parcel.buildingClass,
    parcel.zoning,
    parcel.landAreaSize,
    parcel.landAreaUnit,
    parcel.landAreaSqFt,
    parcel.grossBuildingArea,
    parcel.landValue,
    parcel.improvementValue,
    parcel.totalValue,
    parcel.yearBuilt,
    parcel.frontage || parcel.dimensions?.frontageFt,
    parcel.depth || parcel.dimensions?.depthFt,
    parcel.perimeter || parcel.dimensions?.perimeterFt,
    parcel.joins || {},
  ]));
}

function compareRank(a, b) {
  if (a.signal.score !== b.signal.score) return a.signal.score - b.signal.score;
  if (a.signal.factors.length !== b.signal.factors.length) return a.signal.factors.length - b.signal.factors.length;
  const aValue = a.metrics.totalValue ?? -1;
  const bValue = b.metrics.totalValue ?? -1;
  if (aValue !== bValue) return aValue - bValue;
  return b.accountNum.localeCompare(a.accountNum);
}

class TopCandidates {
  constructor(limit) {
    this.limit = limit;
    this.heap = [];
  }
  push(candidate) {
    if (this.heap.length < this.limit) {
      this.heap.push(candidate);
      this.#up(this.heap.length - 1);
      return;
    }
    if (compareRank(candidate, this.heap[0]) <= 0) return;
    this.heap[0] = candidate;
    this.#down(0);
  }
  #up(index) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareRank(this.heap[index], this.heap[parent]) >= 0) break;
      [this.heap[index], this.heap[parent]] = [this.heap[parent], this.heap[index]];
      index = parent;
    }
  }
  #down(index) {
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let worst = index;
      if (left < this.heap.length && compareRank(this.heap[left], this.heap[worst]) < 0) worst = left;
      if (right < this.heap.length && compareRank(this.heap[right], this.heap[worst]) < 0) worst = right;
      if (worst === index) break;
      [this.heap[index], this.heap[worst]] = [this.heap[worst], this.heap[index]];
      index = worst;
    }
  }
  ranked() {
    return [...this.heap].sort((a, b) => compareRank(b, a));
  }
}

function unpack(fields, packed) {
  return Object.fromEntries(fields.map((field, index) => [field, packed[index] ?? ""]));
}

function loadSelectedIndexRecords(indexFile, accountNumbers) {
  const index = readJsonDigest(indexFile);
  const directory = path.dirname(indexFile);
  const keys = new Set([...accountNumbers].map((account) => String(account).replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, index.value.shardKeyLength)));
  const records = new Map();
  const sourceFiles = [];
  for (const key of [...keys].sort()) {
    const relative = index.value.files?.[key];
    if (!relative) continue;
    const shard = readJsonDigest(path.join(directory, relative));
    let selectedCount = 0;
    for (const packed of shard.value.records || []) {
      const record = unpack(shard.value.fields || index.value.fields || [], packed);
      const account = String(record.accountNum || record.gisParcelId || "");
      if (!accountNumbers.has(account)) continue;
      records.set(account, record);
      selectedCount += 1;
    }
    sourceFiles.push({ key, path: path.relative(root, path.join(directory, relative)).replace(/\\/g, "/"), bytes: shard.bytes, sha256: shard.sha256, selectedCount });
  }
  return { index, records, sourceFiles };
}

function zoningEvidence(record) {
  if (!record) return { status: "not-found-in-parcel-zoning-index", interpretation: "Unknown; absence is not evidence of unrestricted use." };
  return {
    status: "matched",
    label: record.label || "",
    existingParcelZoning: record.existingParcelZoning || "",
    baseDistricts: record.baseDistricts || [],
    pdNumbers: record.pdNumbers || [],
    pdsNumbers: record.pdsNumbers || [],
    supNumbers: record.supNumbers || [],
    subdistricts: record.subdistricts || [],
    overlays: record.overlays || [],
    caseNumbers: record.caseNumbers || [],
    sourceLayerIds: record.sourceLayerIds || [],
    interpretation: "Planning-screening evidence only; verify permitted use with the governing municipality.",
  };
}

function floodEvidence(record) {
  if (!record) return { status: "not-found-in-parcel-floodplain-index", interpretation: "Unknown; absence is not evidence that the parcel is outside a flood hazard area." };
  return {
    status: "matched",
    label: record.label || "",
    floodZones: record.floodZones || [],
    zoneSubtypes: record.zoneSubtypes || [],
    sfha: record.sfha || [],
    baseFloodElevations: record.baseFloodElevations || [],
    sourceCitations: record.sourceCitations || [],
    sourceLayerIds: record.sourceLayerIds || [],
    interpretation: "Flood screening only; not a FEMA determination or insurance quote.",
  };
}

function candidateFromParcel(parcel, chunkIds, locations, buildingCharacteristics, signal) {
  const accountNum = String(parcel.accountNum || "").trim();
  const center = Array.isArray(parcel.liveGeometry?.center) ? parcel.liveGeometry.center : [];
  return {
    whiteRabbitPropertyId: createWhiteRabbitPropertyId({ sourceCountyId: SOURCE_COUNTY_ID, sourceParcelId: accountNum }),
    accountNum,
    gisParcelId: String(parcel.gisParcelId || ""),
    parcelChunkIds: [...chunkIds].sort(),
    address: String(parcel.address || ""),
    propertyName: String(parcel.propertyName || ""),
    ownerName: String(parcel.ownerName || ""),
    landUseCode: String(parcel.landUseCode || ""),
    landUseDescription: String(parcel.landUseDescription || ""),
    buildingClass: String(parcel.buildingClass || ""),
    assessorZoning: String(parcel.zoning || ""),
    locations: locations.length ? locations : center.length === 2 ? [{ longitude: center[0], latitude: center[1] }] : [],
    metrics: {
      landAreaAcres: landAcres(parcel),
      landAreaSqFt: numeric(parcel.landAreaSqFt),
      grossBuildingArea: numeric(buildingCharacteristics?.grossBuildingArea ?? parcel.grossBuildingArea),
      landValue: numeric(parcel.landValue),
      improvementValue: numeric(parcel.improvementValue),
      totalValue: numeric(parcel.totalValue),
      yearBuilt: numeric(buildingCharacteristics?.conservativeYearBuilt ?? parcel.yearBuilt),
      frontageFt: numeric(parcel.frontage || parcel.dimensions?.frontageFt),
      depthFt: numeric(parcel.depth || parcel.dimensions?.depthFt),
      perimeterFt: numeric(parcel.perimeter || parcel.dimensions?.perimeterFt),
    },
    sourceJoins: parcel.joins || {},
    buildingCharacteristics: buildingCharacteristics
      ? { status: "matched", ...buildingCharacteristics, yearBuiltSemantics: "newest recorded construction year used conservatively" }
      : { status: "not-found", interpretation: "No residential or commercial DCAD detail record was joined to this parcel account." },
    signal,
  };
}

async function main() {
  const { buildOpportunitySignals } = await import(pathToFileUrl(modelFile));
  const parcelManifest = readJsonDigest(parcelManifestFile);
  const developmentIndex = readJsonDigest(developmentIndexFile);
  const developmentManifest = readJsonDigest(developmentManifestFile);
  const dallasNowLinkage = readJsonDigest(dallasNowLinkageFile);
  const buildingCharacteristicsManifest = readJsonDigest(buildingCharacteristicsManifestFile);
  const modelBytes = fs.readFileSync(modelFile);
  const featureGateSource = fs.readFileSync(featureGateFile, "utf8");
  if (!/opportunitySignals:\s*false/.test(featureGateSource)) throw new Error("Opportunity signals must remain feature-gated off while this service is staged.");
  if (parcelManifest.value.featureCount !== 696601 || parcelManifest.value.searchIndexCount !== 696601) throw new Error("Unexpected Dallas parcel-service population.");
  if (developmentManifest.value.parcelCount !== developmentIndex.value.parcelCount) throw new Error("Development index and runtime manifest counts do not reconcile.");
  if (dallasNowLinkage.value.certification?.visibleUiActivated !== false) throw new Error("This build expects DallasNow records to remain outside active runtime development signals.");

  const buildingCharacteristics = new Map();
  for (const shard of Object.values(buildingCharacteristicsManifest.value.shards || {})) {
    for (const page of shard.pages || []) {
      const payload = JSON.parse(fs.readFileSync(path.join(path.dirname(buildingCharacteristicsManifestFile), page.file), "utf8"));
      if ((payload.records || []).length !== page.count) throw new Error(`Building-characteristics page count mismatch: ${page.file}`);
      for (const record of payload.records || []) {
        if (buildingCharacteristics.has(record.accountNum)) throw new Error(`Duplicate building-characteristics account: ${record.accountNum}`);
        buildingCharacteristics.set(record.accountNum, record);
      }
    }
  }
  if (buildingCharacteristics.size !== buildingCharacteristicsManifest.value.recordCount) throw new Error("Building-characteristics manifest population does not reconcile.");

  const developments = new Map((developmentIndex.value.records || []).map((record) => [String(record.parcelId), record]));
  const developmentDates = [...developments.values()].map((record) => String(record.latestActivityDate || "")).filter(Boolean).sort();
  const opportunityObservedAt = Date.parse(parcelManifest.value.generatedAt);
  const recentDevelopmentParcelCount = [...developments.values()].filter((record) => {
    const activity = Date.parse(String(record.latestActivityDate || ""));
    return Number.isFinite(activity) && Number.isFinite(opportunityObservedAt) && Math.max(0, Math.floor((opportunityObservedAt - activity) / 86400000)) <= 730;
  }).length;
  const accountFingerprints = new Map();
  const duplicateAccounts = new Map();
  const conflictingAccounts = new Set();
  let sourceFeatureCount = 0;
  for (const [chunkIndex, chunkMeta] of parcelManifest.value.chunks.entries()) {
    const chunk = JSON.parse(fs.readFileSync(path.join(path.dirname(parcelManifestFile), chunkMeta.file), "utf8"));
    if ((chunk.parcels || []).length !== chunkMeta.count) throw new Error(`Parcel chunk count mismatch: ${chunkMeta.id}`);
    for (const parcel of chunk.parcels || []) {
      const accountNum = String(parcel.accountNum || "").trim();
      if (!accountNum) throw new Error(`Missing parcel account in chunk ${chunkMeta.id}`);
      sourceFeatureCount += 1;
      const fingerprint = opportunityEvidenceFingerprint(parcel);
      if (!accountFingerprints.has(accountNum)) {
        accountFingerprints.set(accountNum, fingerprint);
        continue;
      }
      if (!duplicateAccounts.has(accountNum)) duplicateAccounts.set(accountNum, { featureCount: 1, chunkIds: new Set(), locations: [] });
      const duplicate = duplicateAccounts.get(accountNum);
      duplicate.featureCount += 1;
      duplicate.chunkIds.add(chunkMeta.id);
      const center = parcel.liveGeometry?.center;
      if (Array.isArray(center) && center.length === 2) duplicate.locations.push({ longitude: center[0], latitude: center[1] });
      if (accountFingerprints.get(accountNum) !== fingerprint) conflictingAccounts.add(accountNum);
    }
    if ((chunkIndex + 1) % 500 === 0) console.log(`Audited ${sourceFeatureCount.toLocaleString("en-US")} parcel features for account uniqueness...`);
  }
  if (sourceFeatureCount !== parcelManifest.value.featureCount) throw new Error("Parcel feature pre-audit does not reconcile to the manifest.");

  const top = new TopCandidates(TOP_LIMIT);
  const scoredAccounts = new Set();
  const tierCounts = { high: 0, medium: 0, emerging: 0, "insufficient-evidence": 0 };
  const factorCounts = {};
  const evidenceCounts = { landValue: 0, improvementValue: 0, landArea: 0, yearBuilt: 0, buildingCharacteristics: 0, frontage: 0, development: 0, appraisalJoin: 0, blockIdJoin: 0, parcelDimensionJoin: 0 };
  let parcelCount = 0;
  let mediumOrHighCount = 0;
  for (const [chunkIndex, chunkMeta] of parcelManifest.value.chunks.entries()) {
    const chunk = JSON.parse(fs.readFileSync(path.join(path.dirname(parcelManifestFile), chunkMeta.file), "utf8"));
    if ((chunk.parcels || []).length !== chunkMeta.count) throw new Error(`Parcel chunk count mismatch: ${chunkMeta.id}`);
    for (const parcel of chunk.parcels || []) {
      const accountNum = String(parcel.accountNum || "").trim();
      if (!accountNum || conflictingAccounts.has(accountNum) || scoredAccounts.has(accountNum)) continue;
      scoredAccounts.add(accountNum);
      parcelCount += 1;
      const development = developments.get(accountNum) || null;
      const building = buildingCharacteristics.get(accountNum) || null;
      const signalParcel = {
        ...parcel,
        yearBuilt: building?.conservativeYearBuilt ?? parcel.yearBuilt,
        grossBuildingArea: building?.grossBuildingArea ?? parcel.grossBuildingArea,
        whiteRabbitPropertyId: createWhiteRabbitPropertyId({ sourceCountyId: SOURCE_COUNTY_ID, sourceParcelId: accountNum }),
        dataLineage: {
          contractVersion: "wr-lineage-v1",
          sourceCountyId: SOURCE_COUNTY_ID,
          sourceDataset: parcelManifest.value.source,
          serviceGeneratedAt: parcelManifest.value.generatedAt,
          sourceVersion: "DCAD2026_CURRENT",
          freshnessStatus: "snapshot-build-time-known-source-update-time-unpublished",
        },
      };
      const signal = buildOpportunitySignals({ parcel: signalParcel, permits: null, development, observedAt: parcelManifest.value.generatedAt });
      tierCounts[signal.tier] += 1;
      for (const factor of signal.factors) factorCounts[factor.id] = (factorCounts[factor.id] || 0) + 1;
      if (numeric(parcel.landValue) !== null) evidenceCounts.landValue += 1;
      if (numeric(parcel.improvementValue) !== null) evidenceCounts.improvementValue += 1;
      if (landAcres(parcel) !== null) evidenceCounts.landArea += 1;
      if (numeric(signalParcel.yearBuilt) !== null) evidenceCounts.yearBuilt += 1;
      if (building) evidenceCounts.buildingCharacteristics += 1;
      if (numeric(parcel.frontage || parcel.dimensions?.frontageFt) !== null) evidenceCounts.frontage += 1;
      if (development) evidenceCounts.development += 1;
      if (parcel.joins?.appraisal) evidenceCounts.appraisalJoin += 1;
      if (parcel.joins?.blockId) evidenceCounts.blockIdJoin += 1;
      if (parcel.joins?.parcelDimension) evidenceCounts.parcelDimensionJoin += 1;
      if (signal.score >= 40) {
        mediumOrHighCount += 1;
        const duplicate = duplicateAccounts.get(accountNum);
        const chunkIds = new Set([chunkMeta.id, ...(duplicate ? [...duplicate.chunkIds] : [])]);
        const primaryCenter = parcel.liveGeometry?.center;
        const locations = [
          ...(Array.isArray(primaryCenter) && primaryCenter.length === 2 ? [{ longitude: primaryCenter[0], latitude: primaryCenter[1] }] : []),
          ...(duplicate?.locations || []),
        ].filter((location, index, all) => all.findIndex((item) => item.longitude === location.longitude && item.latitude === location.latitude) === index);
        top.push(candidateFromParcel(parcel, chunkIds, locations, building, signal));
      }
    }
    if ((chunkIndex + 1) % 250 === 0) console.log(`Scored ${parcelCount.toLocaleString("en-US")} parcels across ${chunkIndex + 1} chunks...`);
  }
  if (parcelCount + conflictingAccounts.size !== accountFingerprints.size || scoredAccounts.size !== parcelCount) throw new Error("Unique parcel-account scoring reconciliation failed.");

  const candidates = top.ranked();
  const selectedAccounts = new Set(candidates.map((candidate) => candidate.accountNum));
  const zoning = loadSelectedIndexRecords(zoningIndexFile, selectedAccounts);
  const flood = loadSelectedIndexRecords(floodIndexFile, selectedAccounts);
  const enriched = candidates.map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
    constraints: {
      zoning: zoningEvidence(zoning.records.get(candidate.accountNum)),
      floodplain: floodEvidence(flood.records.get(candidate.accountNum)),
    },
    developmentEvidence: developments.has(candidate.accountNum)
      ? { status: "matched-active-runtime-index", scoringStatus: candidate.signal.factors.some((factor) => factor.id === "development-momentum") ? "recent-within-730-days" : "historical-outside-730-day-scoring-window", ...developments.get(candidate.accountNum) }
      : { status: "not-found-in-active-runtime-development-index", interpretation: "Absence is not proof that no development activity exists." },
  }));

  fs.mkdirSync(candidateDir, { recursive: true });
  for (const file of fs.readdirSync(candidateDir)) fs.rmSync(path.join(candidateDir, file), { force: true });
  const pageFiles = [];
  for (let offset = 0; offset < enriched.length; offset += PAGE_SIZE) {
    const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
    const name = `page-${String(pageNumber).padStart(3, "0")}.json`;
    const payload = `${JSON.stringify({ schemaVersion: "wr-dallas-parcel-opportunity-candidate-page-v1", sourceCountyId: SOURCE_COUNTY_ID, page: pageNumber, records: enriched.slice(offset, offset + PAGE_SIZE) })}\n`;
    fs.writeFileSync(path.join(candidateDir, name), payload);
    pageFiles.push({ page: pageNumber, file: `candidates/${name}`, count: Math.min(PAGE_SIZE, enriched.length - offset), bytes: Buffer.byteLength(payload), sha256: sha256(payload) });
  }

  const generatedAt = new Date().toISOString();
  const exactSummary = {
    sourceParcelFeatureCount: sourceFeatureCount,
    uniqueAccountNumberCount: accountFingerprints.size,
    duplicateAccountNumberCount: duplicateAccounts.size,
    duplicateFeatureExcessCount: sourceFeatureCount - accountFingerprints.size,
    conflictingOpportunityEvidenceAccountCount: conflictingAccounts.size,
    scoredUniqueAccountCount: parcelCount,
    parcelChunkCount: parcelManifest.value.chunks.length,
    activeDevelopmentParcelCount: developments.size,
    activeDevelopmentEarliestActivityDate: developmentDates[0] || "",
    activeDevelopmentLatestActivityDate: developmentDates[developmentDates.length - 1] || "",
    activeDevelopmentWithin730DaysCount: recentDevelopmentParcelCount,
    currentDallasNowExactLinkedRecordCount: dallasNowLinkage.value.exactSummary.exactLinkedRecordCount,
    currentDallasNowClassifiedSignalsStagedOutsideRuntime: 777,
    mediumOrHighCandidateCount: mediumOrHighCount,
    selectedCandidateCount: enriched.length,
    selectedHighCount: enriched.filter((candidate) => candidate.signal.tier === "high").length,
    selectedMediumCount: enriched.filter((candidate) => candidate.signal.tier === "medium").length,
    selectedZoningMatchCount: enriched.filter((candidate) => candidate.constraints.zoning.status === "matched").length,
    selectedFloodplainMatchCount: enriched.filter((candidate) => candidate.constraints.floodplain.status === "matched").length,
    selectedDevelopmentMatchCount: enriched.filter((candidate) => candidate.developmentEvidence.status === "matched-active-runtime-index").length,
    selectedRecentDevelopmentFactorCount: enriched.filter((candidate) => candidate.signal.factors.some((factor) => factor.id === "development-momentum")).length,
    selectedBuildingCharacteristicsMatchCount: enriched.filter((candidate) => candidate.buildingCharacteristics.status === "matched").length,
    selectedScoreFloor: enriched.length ? enriched[enriched.length - 1].signal.score : null,
    candidatePageCount: pageFiles.length,
    tierPartitionTotal: Object.values(tierCounts).reduce((sum, count) => sum + count, 0),
  };
  if (exactSummary.tierPartitionTotal !== parcelCount) throw new Error("Opportunity tier partition does not reconcile to the scored account population.");

  const report = {
    schemaVersion: "wr-dallas-parcel-opportunity-intelligence-v1",
    generatedAt,
    sourceCountyId: SOURCE_COUNTY_ID,
    status: "verified-staged-default-off",
    model: { schemaVersion: "wr-opportunity-signal-v1", source: path.relative(root, modelFile).replace(/\\/g, "/"), sha256: sha256(modelBytes) },
    sourceEvidence: {
      parcelManifest: { path: path.relative(root, parcelManifestFile).replace(/\\/g, "/"), sha256: parcelManifest.sha256, generatedAt: parcelManifest.value.generatedAt, featureCount: parcelManifest.value.featureCount, source: parcelManifest.value.source },
      developmentIndex: { path: path.relative(root, developmentIndexFile).replace(/\\/g, "/"), sha256: developmentIndex.sha256, parcelCount: developmentIndex.value.parcelCount },
      developmentManifest: { path: path.relative(root, developmentManifestFile).replace(/\\/g, "/"), sha256: developmentManifest.sha256 },
      buildingCharacteristics: { path: path.relative(root, buildingCharacteristicsManifestFile).replace(/\\/g, "/"), sha256: buildingCharacteristicsManifest.sha256, recordCount: buildingCharacteristics.size, conservativeYearBuiltRule: buildingCharacteristicsManifest.value.conservativeYearBuiltRule },
      zoningIndex: { path: path.relative(root, zoningIndexFile).replace(/\\/g, "/"), sha256: zoning.index.sha256, selectedShardFiles: zoning.sourceFiles },
      floodplainIndex: { path: path.relative(root, floodIndexFile).replace(/\\/g, "/"), sha256: flood.index.sha256, selectedShardFiles: flood.sourceFiles },
      dallasNowLinkage: { path: path.relative(root, dallasNowLinkageFile).replace(/\\/g, "/"), sha256: dallasNowLinkage.sha256, runtimeActivated: false },
    },
    exactSummary,
    tierCounts,
    factorCounts,
    evidenceCounts,
    rankingContract: {
      eligibleTiers: ["high", "medium"],
      maximumPublishedCandidates: TOP_LIMIT,
      order: ["score-desc", "factor-count-desc", "total-value-desc", "account-number-asc"],
      scoringRule: "Existing explainable additive factor model; every point retains factor-level evidence.",
      constraintsDoNotAddPoints: true,
      permitsEvidencePolicy: "No parcel receives a no-permits factor because available permit feeds are not certified as complete countywide history.",
      developmentRecencyMaximumAgeDays: 730,
      historicalDevelopmentPolicy: "Development records older than 730 days remain context but add zero opportunity points.",
      absencePolicy: "Missing zoning, floodplain, or development index records remain unknown and never become favorable evidence.",
    },
    activation: {
      featureGate: "opportunitySignals",
      featureGateEnabled: false,
      defaultVisible: false,
      publicRuntimeActivated: false,
      pageDesignChanged: false,
      earthImageryChanged: false,
      advisoryOnly: true,
    },
    disclaimers: [
      "Candidate scores are explainable screening priorities, not investment recommendations, appraisals, zoning determinations, flood determinations, or legal advice.",
      "Current DallasNow signals remain staged outside runtime pending reuse-rights and visible-activation approval.",
      "A missing constraint record means unknown, not unrestricted or hazard-free.",
    ],
    accountIdentityAudit: {
      duplicateAccounts: [...duplicateAccounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([accountNum, item]) => ({ accountNum, featureCount: item.featureCount, additionalFeatureChunkIds: [...item.chunkIds].sort(), opportunityEvidenceConsistent: !conflictingAccounts.has(accountNum) })),
      conflictingAccounts: [...conflictingAccounts].sort(),
    },
    candidates: enriched,
  };
  fs.writeFileSync(outputJsonFile, `${JSON.stringify(report, null, 2)}\n`);

  const publicManifest = {
    schemaVersion: "wr-dallas-parcel-opportunity-service-v1",
    generatedAt,
    sourceCountyId: SOURCE_COUNTY_ID,
    status: report.status,
    featureGate: report.activation.featureGate,
    featureGateEnabled: false,
    defaultVisible: false,
    publicRuntimeActivated: false,
    advisoryOnly: true,
    candidateCount: enriched.length,
    pageSize: PAGE_SIZE,
    pageCount: pageFiles.length,
    scoreFloor: exactSummary.selectedScoreFloor,
    pageFiles,
    auditReport: "../../../output/dallas-parcel-opportunity-intelligence.json",
    runtimePolicy: "Fetch one bounded candidate page only after the opportunitySignals feature gate is independently activated; never fetch the full audit report in the browser.",
  };
  fs.writeFileSync(publicManifestFile, `${JSON.stringify(publicManifest, null, 2)}\n`);

  const lines = [
    "# Dallas Parcel Opportunity Intelligence",
    "",
    `Generated: ${generatedAt}`,
    "",
    "## Exact population audit",
    "",
    `- DCAD parcel geometry features audited: ${sourceFeatureCount.toLocaleString("en-US")}`,
    `- Unique parcel accounts: ${accountFingerprints.size.toLocaleString("en-US")}`,
    `- Duplicate account numbers preserved and reconciled: ${duplicateAccounts.size.toLocaleString("en-US")}`,
    `- Accounts excluded for conflicting scoring evidence: ${conflictingAccounts.size.toLocaleString("en-US")}`,
    `- Unique parcel accounts scored: ${parcelCount.toLocaleString("en-US")}`,
    `- Medium/high candidates found: ${mediumOrHighCount.toLocaleString("en-US")}`,
    `- Bounded ranked candidates staged: ${enriched.length.toLocaleString("en-US")}`,
    `- Selected score floor: ${exactSummary.selectedScoreFloor}`,
    `- Selected candidates with zoning evidence: ${exactSummary.selectedZoningMatchCount.toLocaleString("en-US")}`,
    `- Selected candidates with floodplain evidence: ${exactSummary.selectedFloodplainMatchCount.toLocaleString("en-US")}`,
    `- Selected candidates with active development evidence: ${exactSummary.selectedDevelopmentMatchCount.toLocaleString("en-US")}`,
    `- Selected candidates with development momentum inside 730 days: ${exactSummary.selectedRecentDevelopmentFactorCount.toLocaleString("en-US")}`,
    `- Selected candidates with DCAD building characteristics: ${exactSummary.selectedBuildingCharacteristicsMatchCount.toLocaleString("en-US")}`,
    "",
    "## Safety and activation",
    "",
    "- Opportunity feature gate enabled: no",
    "- Public runtime activated: no",
    "- Page design changed: no",
    "- Earth imagery changed: no",
    "- Current DallasNow staged signals added to runtime: no",
    `- Active runtime development index activity range: ${exactSummary.activeDevelopmentEarliestActivityDate} through ${exactSummary.activeDevelopmentLatestActivityDate}; records within 730-day scoring window: ${exactSummary.activeDevelopmentWithin730DaysCount}`,
    "- Missing zoning/flood/development evidence is treated as unknown, never favorable.",
    "- No parcel receives a no-permits factor because countywide permit history is incomplete.",
    "",
    "Scores are explainable screening priorities only, not investment recommendations or legal, appraisal, zoning, or flood determinations.",
    "",
  ];
  fs.writeFileSync(outputMarkdownFile, lines.join("\n"));
  console.log(`Wrote ${outputJsonFile}`);
  console.log(`Wrote ${outputMarkdownFile}`);
  console.log(`Wrote ${publicManifestFile}`);
  console.log(JSON.stringify({ exactSummary, tierCounts, factorCounts, evidenceCounts }, null, 2));
}

function pathToFileUrl(file) {
  return new URL(`file:///${file.replace(/\\/g, "/")}`).href;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

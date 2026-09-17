const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  addressEvidence,
  parcelCandidateKey,
  searchShardKey,
  selectParcelCandidates,
  unpackSearchRecord,
} = require("./dallasnow-parcel-linkage-utils.cjs");

const root = path.join(__dirname, "..");
const sourceFile = path.join(root, "output", "dallas-city-building-supply-intelligence.json");
const parcelManifestFile = path.join(root, "public", "data", "parcels", "manifest.json");
const parcelSearchDir = path.join(root, "public", "data", "parcels", "search");
const outputJson = path.join(root, "output", "dallas-city-building-parcel-linkage.json");
const outputMarkdown = path.join(root, "output", "dallas-city-building-parcel-linkage.md");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readJsonWithDigest(file) {
  const bytes = fs.readFileSync(file);
  return { bytes, sha256: sha256(bytes), value: JSON.parse(bytes.toString("utf8")) };
}

function candidateFor(record, evidence) {
  return {
    parcelKey: parcelCandidateKey(record),
    accountNum: String(record.accountNum || ""),
    gisParcelId: String(record.gisParcelId || ""),
    address: String(record.address || ""),
    normalizedAddress: evidence.normalizedBase,
    normalizedAddressWithUnit: evidence.normalizedWithUnit,
    chunkId: String(record.chunkId || ""),
    screenCentroid: Array.isArray(record.centroid) ? record.centroid : [],
  };
}

function main() {
  const source = readJsonWithDigest(sourceFile);
  const parcelManifest = readJsonWithDigest(parcelManifestFile);
  if (parcelManifest.value.source !== "output/white-rabbit-dallas-parcels.geojson") {
    throw new Error(`Unexpected parcel service source: ${parcelManifest.value.source || "missing"}`);
  }
  const records = source.value.records || [];
  const evidenceByRecord = new Map();
  const groups = new Map();
  const invalidRecordNumbers = [];

  for (const record of records) {
    const evidence = addressEvidence(record.address);
    evidenceByRecord.set(record.recordNumber, evidence);
    if (!evidence.valid) {
      invalidRecordNumbers.push(record.recordNumber);
      continue;
    }
    if (!groups.has(evidence.normalizedBase)) {
      groups.set(evidence.normalizedBase, {
        normalizedBase: evidence.normalizedBase,
        shardKey: searchShardKey(evidence, parcelManifest.value.searchIndexShards?.keyLength || 2),
        sourceRecordNumbers: [],
        sourceAddresses: new Set(),
        units: new Set(),
        candidates: new Map(),
      });
    }
    const group = groups.get(evidence.normalizedBase);
    group.sourceRecordNumbers.push(record.recordNumber);
    group.sourceAddresses.add(evidence.rawAddress);
    if (evidence.unit) group.units.add(evidence.unit);
  }

  const groupsByShard = new Map();
  for (const group of groups.values()) {
    if (!group.shardKey || !parcelManifest.value.searchIndexShards?.files?.[group.shardKey]) continue;
    if (!groupsByShard.has(group.shardKey)) groupsByShard.set(group.shardKey, new Set());
    groupsByShard.get(group.shardKey).add(group.normalizedBase);
  }

  const sourceSearchShards = [];
  for (const [shardKey, normalizedTargets] of [...groupsByShard.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const relativeFile = parcelManifest.value.searchIndexShards.files[shardKey];
    const file = path.join(path.dirname(parcelManifestFile), relativeFile);
    const shard = readJsonWithDigest(file);
    let addressRecordCount = 0;
    let candidateMembershipCount = 0;
    for (const packed of shard.value.parcels || []) {
      const record = unpackSearchRecord(shard.value.fields || [], packed);
      if (!record.address) continue;
      addressRecordCount += 1;
      const evidence = addressEvidence(record.address);
      if (!evidence.valid || !normalizedTargets.has(evidence.normalizedBase)) continue;
      const group = groups.get(evidence.normalizedBase);
      const candidate = candidateFor(record, evidence);
      group.candidates.set(candidate.parcelKey, candidate);
      candidateMembershipCount += 1;
    }
    sourceSearchShards.push({
      shardKey,
      path: path.relative(root, file).replace(/\\/g, "/"),
      bytes: shard.bytes.length,
      sha256: shard.sha256,
      packedRecordCount: (shard.value.parcels || []).length,
      addressRecordCount,
      candidateMembershipCount,
    });
  }

  const addressGroups = [];
  for (const group of [...groups.values()].sort((a, b) => a.normalizedBase.localeCompare(b.normalizedBase))) {
    const candidates = [...group.candidates.values()].sort((a, b) => a.parcelKey.localeCompare(b.parcelKey));
    addressGroups.push({
      normalizedBase: group.normalizedBase,
      shardKey: group.shardKey,
      sourceRecordNumbers: [...group.sourceRecordNumbers].sort(),
      sourceAddresses: [...group.sourceAddresses].sort(),
      units: [...group.units].sort(),
      candidateCount: candidates.length,
      candidates,
    });
  }
  const groupByBase = new Map(addressGroups.map((group) => [group.normalizedBase, group]));

  const recordLinks = records.map((record) => {
    const evidence = evidenceByRecord.get(record.recordNumber);
    const group = evidence.valid ? groupByBase.get(evidence.normalizedBase) : null;
    const candidates = group?.candidates || [];
    const decision = selectParcelCandidates(evidence, candidates.map((candidate) => ({ ...candidate, addressEvidence: addressEvidence(candidate.address) })));
    const selected = decision.candidates.map(({ addressEvidence: _ignored, ...candidate }) => candidate);
    return {
      recordNumber: record.recordNumber,
      recordDate: record.recordDate,
      recordType: record.recordType,
      rawAddress: evidence.rawAddress,
      normalizedBase: evidence.normalizedBase,
      normalizedWithUnit: evidence.normalizedWithUnit,
      unit: evidence.unit,
      partition: decision.partition,
      matchMethod: decision.matchMethod,
      candidateCount: selected.length,
      candidateParcelKeys: selected.map((candidate) => candidate.parcelKey),
      exactParcel: decision.partition === "exact" ? selected[0] : null,
      invalidReason: decision.partition === "invalid" ? evidence.reason : "",
    };
  });

  const partitionCounts = Object.fromEntries(["exact", "ambiguous", "unmatched", "invalid"].map((partition) => [partition, recordLinks.filter((link) => link.partition === partition).length]));
  const partitionTotal = Object.values(partitionCounts).reduce((sum, count) => sum + count, 0);
  if (partitionTotal !== records.length) throw new Error(`Partition reconciliation failed: ${partitionTotal} != ${records.length}`);
  const uniqueRecordNumbers = new Set(recordLinks.map((link) => link.recordNumber));
  if (uniqueRecordNumbers.size !== records.length) throw new Error("Record linkage identities are not unique.");
  const exactLinks = recordLinks.filter((link) => link.partition === "exact");
  if (exactLinks.some((link) => !link.exactParcel?.accountNum || link.candidateCount !== 1)) throw new Error("An exact link lacks one uniquely identified DCAD parcel.");

  const generatedAt = new Date().toISOString();
  const payload = {
    schemaVersion: "wr-dallasnow-dcad-parcel-linkage-v1",
    generatedAt,
    sourceAuthority: source.value.sourceAuthority,
    sourceSystem: source.value.sourceSystem,
    sourceArtifact: path.relative(root, sourceFile).replace(/\\/g, "/"),
    sourceArtifactSha256: source.sha256,
    parcelAuthority: "Dallas Central Appraisal District (DCAD)",
    parcelManifest: path.relative(root, parcelManifestFile).replace(/\\/g, "/"),
    parcelManifestSha256: parcelManifest.sha256,
    sourceCountyId: "dallas-county-dcad",
    sourceCountyIdEvidence: "Parcel manifest source=output/white-rabbit-dallas-parcels.geojson; authority and county are fixed by the approved Dallas DCAD service contract.",
    joinContract: {
      version: "wr-dallasnow-normalized-address-v1",
      candidateRetrieval: "Two-character parcel search shard derived from the compact primary street address.",
      exactRule: "One unique DCAD parcel for the normalized base address, or one unique normalized address-and-unit candidate.",
      ambiguousRule: "Two or more eligible DCAD parcels; no candidate is silently selected.",
      unmatchedRule: "A valid normalized address with no DCAD candidate.",
      invalidRule: "Missing or structurally invalid source address.",
      prohibitedInference: ["first-candidate selection", "fuzzy address selection", "owner-name selection", "permit issuance-date inference"],
      coordinateSemantics: "Search-shard centroids are parcel-engine screen coordinates, not longitude/latitude; this join does not claim a spatial match.",
    },
    exactSummary: {
      sourceRecordCount: records.length,
      uniqueSourceRecordNumberCount: uniqueRecordNumbers.size,
      sourceRecordWithAddressCount: records.filter((record) => String(record.address || "").trim()).length,
      distinctSourceAddressCount: new Set(records.map((record) => String(record.address || "").trim()).filter(Boolean)).size,
      validNormalizedRecordCount: records.length - partitionCounts.invalid,
      normalizedAddressGroupCount: addressGroups.length,
      loadedSearchShardCount: sourceSearchShards.length,
      loadedSearchShardBytes: sourceSearchShards.reduce((sum, shard) => sum + shard.bytes, 0),
      exactLinkedRecordCount: partitionCounts.exact,
      ambiguousRecordCount: partitionCounts.ambiguous,
      unmatchedRecordCount: partitionCounts.unmatched,
      invalidRecordCount: partitionCounts.invalid,
      partitionTotal,
      uniqueExactParcelCount: new Set(exactLinks.map((link) => link.exactParcel.accountNum)).size,
    },
    certification: {
      sourceIdentityReconciled: true,
      partitionsReconciled: true,
      deterministicAddressNormalizationVerified: true,
      duplicateAddressesPreservedAsAmbiguous: true,
      exactParcelLinksCertified: true,
      ambiguousParcelLinksCertified: false,
      unmatchedParcelLinksCertified: false,
      independentReuseRightsCertified: false,
      visibleUiActivated: false,
      lockedUiChanged: false,
    },
    activationPolicy: "Only recordLinks with partition=exact may enter downstream parcel intelligence. Visible UI activation remains blocked by the independent reuse-rights gate.",
    blockers: [
      "Independent reuse-rights review for DallasNow public records is not recorded.",
      "Ambiguous records require stronger unit, spatial, or authoritative parcel evidence.",
      "Unmatched and invalid records are excluded from parcel-level intelligence.",
      "DallasNow record dates are not permit issuance dates.",
    ],
    sourceSearchShards,
    addressGroups,
    invalidRecordNumbers: invalidRecordNumbers.sort(),
    recordLinks,
  };

  fs.writeFileSync(outputJson, `${JSON.stringify(payload, null, 2)}\n`);
  const summary = payload.exactSummary;
  const markdown = [
    "# White Rabbit DallasNow-to-DCAD Parcel Linkage",
    "",
    `Generated: ${generatedAt}`,
    "",
    "## Certified boundary",
    "",
    `- Source DallasNow records: ${summary.sourceRecordCount.toLocaleString("en-US")}`,
    `- Exact parcel links: ${summary.exactLinkedRecordCount.toLocaleString("en-US")}`,
    `- Ambiguous records: ${summary.ambiguousRecordCount.toLocaleString("en-US")}`,
    `- Unmatched records: ${summary.unmatchedRecordCount.toLocaleString("en-US")}`,
    `- Invalid-address records: ${summary.invalidRecordCount.toLocaleString("en-US")}`,
    `- Partition reconciliation: ${summary.partitionTotal.toLocaleString("en-US")} / ${summary.sourceRecordCount.toLocaleString("en-US")}`,
    `- Unique exact-linked DCAD parcels: ${summary.uniqueExactParcelCount.toLocaleString("en-US")}`,
    `- Parcel search shards read: ${summary.loadedSearchShardCount.toLocaleString("en-US")} (${summary.loadedSearchShardBytes.toLocaleString("en-US")} bytes)` ,
    "",
    "Exact means one uniquely evidenced DCAD parcel after deterministic address normalization. Duplicate normalized addresses remain ambiguous; the pipeline never selects the first parcel.",
    "",
    "## Activation",
    "",
    "- Exact links certified for downstream parcel intelligence: yes",
    "- Ambiguous or unmatched links activated: no",
    "- Visible UI activated: no",
    "- Locked Google Earth-style UI changed: no",
    "- Remaining gate: independent DallasNow reuse-rights review",
    "- Date semantics: DallasNow record dates are not permit issuance dates",
    "",
  ].join("\n");
  fs.writeFileSync(outputMarkdown, markdown);
  console.log(`Wrote ${outputJson}`);
  console.log(`Wrote ${outputMarkdown}`);
  console.log(JSON.stringify(payload.exactSummary, null, 2));
}

main();

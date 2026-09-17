const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const countyId = "tarrant-county-tad";
const manifestPath = "public/data/counties/tarrant/parcels/manifest.json";
const absoluteManifestPath = path.join(root, manifestPath);
const outputDirectory = path.join(root, "output", "tarrant", "lineage-audit");

function sha(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

(async () => {
  const capture = await import("../src/operations/countySourceCapture.mjs");
  const manifestBytes = fs.readFileSync(absoluteManifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.sourceCountyId !== countyId) throw new Error("Tarrant output manifest scope mismatch");
  const chunkInventory = [];
  const countyParcelIds = new Set();
  const sourceParcelIds = new Set();
  let observedOutputCount = 0;
  let completeSourceReferenceCount = 0;
  let canonicalIdentityMatchCount = 0;
  let duplicateCountyParcelIdCount = 0;
  let duplicateSourceParcelIdCount = 0;
  let invalidRecordCount = 0;
  let lineageLedgerRootSha256 = sha("wr-tarrant-lineage-ledger-v1");
  const invalidReasonCounts = {};
  const addInvalid = (reason) => { invalidRecordCount += 1; invalidReasonCounts[reason] = (invalidReasonCounts[reason] || 0) + 1; };

  for (let index = 0; index < manifest.chunks.length; index += 1) {
    const descriptor = manifest.chunks[index];
    const relativePath = path.posix.join("public/data/counties/tarrant/parcels", descriptor.file);
    const bytes = fs.readFileSync(path.join(root, relativePath));
    const bodySha256 = sha(bytes);
    const parsed = JSON.parse(bytes.toString("utf8"));
    const parcels = parsed.parcels || [];
    if (parcels.length !== descriptor.count) throw new Error(`Chunk count mismatch for ${descriptor.file}: ${parcels.length} != ${descriptor.count}`);
    chunkInventory.push({ id: descriptor.id, relativePath, declaredCount: descriptor.count, observedCount: parcels.length, bytes: bytes.length, sha256: bodySha256 });
    for (const parcel of parcels) {
      observedOutputCount += 1;
      const sourceParcelId = String(parcel.sourceParcelId || "").trim();
      const countyParcelId = String(parcel.countyParcelId || "").trim();
      if (!sourceParcelId) addInvalid("missing-source-parcel-id");
      if (!countyParcelId) addInvalid("missing-county-parcel-id");
      if (countyParcelIds.has(countyParcelId)) duplicateCountyParcelIdCount += 1;
      else countyParcelIds.add(countyParcelId);
      if (sourceParcelIds.has(sourceParcelId)) duplicateSourceParcelIdCount += 1;
      else sourceParcelIds.add(sourceParcelId);
      const refs = parcel.sourceReferences || {};
      const sourceReferencesComplete = parcel.sourceCountyId === countyId && sourceParcelId && refs.parcelGeometryUrl === manifest.source && refs.primaryParcelKey === "ACCOUNT" && refs.sourceManifest === "data/county-adapters/tarrant/tarrant-county-tad-source-manifest.json" && refs.countyAdapter === "data/county-adapters/tarrant/adapter.json";
      if (sourceReferencesComplete) completeSourceReferenceCount += 1;
      else addInvalid("incomplete-source-references");
      const geometryProperties = parcel.realGeometry?.properties || {};
      const identityMatches = countyParcelId === `${countyId}:${sourceParcelId}` && String(parcel.accountNum || "") === sourceParcelId && String(parcel.accountNumber || "") === sourceParcelId && geometryProperties.countyParcelId === countyParcelId && String(geometryProperties.sourceParcelId || "") === sourceParcelId && String(geometryProperties.accountNum || "") === sourceParcelId;
      if (identityMatches) canonicalIdentityMatchCount += 1;
      else addInvalid("canonical-identity-mismatch");
      const entry = { countyParcelId, sourceParcelId, accountNum: String(parcel.accountNum || ""), sourceCountyId: String(parcel.sourceCountyId || ""), sourceUrl: String(refs.parcelGeometryUrl || ""), primarySourceKey: String(refs.primaryParcelKey || ""), chunkId: descriptor.id };
      lineageLedgerRootSha256 = sha(`${lineageLedgerRootSha256}:${canonicalJson(entry)}`);
    }
    if ((index + 1) % 100 === 0 || index + 1 === manifest.chunks.length) console.log(`Audited ${index + 1}/${manifest.chunks.length} chunks and ${observedOutputCount.toLocaleString()} parcels...`);
  }

  const chunkInventorySha256 = sha(canonicalJson(chunkInventory));
  const evaluatedAt = new Date().toISOString();
  const audit = capture.createCountyOutputLineageAudit({
    organizationId: "white-rabbit-platform",
    countyId,
    outputManifestRef: manifestPath,
    outputManifestSha256: sha(manifestBytes),
    expectedOutputCount: manifest.featureCount,
    observedOutputCount,
    uniqueCountyParcelIdCount: countyParcelIds.size,
    uniqueSourceParcelIdCount: sourceParcelIds.size,
    completeSourceReferenceCount,
    canonicalIdentityMatchCount,
    duplicateCountyParcelIdCount,
    duplicateSourceParcelIdCount,
    invalidRecordCount,
    chunkCount: chunkInventory.length,
    chunkInventorySha256,
    lineageLedgerRootSha256,
    evaluatedAt,
  });
  if (!capture.verifyCountyOutputLineageAudit(audit).outputLineageCertified) throw new Error("Tarrant output lineage audit failed");
  if (audit.sourceToOutputCertified) throw new Error("Source-to-output certification must remain false until a raw source manifest is available");

  const report = {
    schemaVersion: "wr-tarrant-output-lineage-report-v1",
    generatedAt: evaluatedAt,
    countyId,
    pageDesignChanged: false,
    productionActivationAuthorized: false,
    outputManifest: { relativePath: manifestPath, bytes: manifestBytes.length, sha256: sha(manifestBytes), declaredFeatureCount: manifest.featureCount, declaredChunkCount: manifest.chunkCount },
    counts: { observedOutputCount, uniqueCountyParcelIdCount: countyParcelIds.size, uniqueSourceParcelIdCount: sourceParcelIds.size, completeSourceReferenceCount, canonicalIdentityMatchCount, duplicateCountyParcelIdCount, duplicateSourceParcelIdCount, invalidRecordCount },
    invalidReasonCounts,
    chunkInventory,
    chunkInventorySha256,
    lineageLedgerRootSha256,
    audit,
    outcome: {
      outputLineageCertified: audit.outputLineageCertified,
      sourceToOutputCertified: audit.sourceToOutputCertified,
      rawSourceMatchStatus: audit.rawSourceMatchStatus,
      explanation: "Every current Tarrant output parcel has internally consistent source identity and reference fields. Matching those records to raw source bytes remains unverified because no content-addressed raw source capture manifest exists.",
    },
  };
  const markdown = [
    "# Tarrant County Output Lineage Audit",
    "",
    `Generated: ${evaluatedAt}`,
    "",
    `- Output parcels audited: **${observedOutputCount.toLocaleString()}**`,
    `- Unique county parcel IDs: **${countyParcelIds.size.toLocaleString()}**`,
    `- Unique source parcel IDs: **${sourceParcelIds.size.toLocaleString()}**`,
    `- Complete source references: **${completeSourceReferenceCount.toLocaleString()}**`,
    `- Canonical identity matches: **${canonicalIdentityMatchCount.toLocaleString()}**`,
    `- Duplicate county parcel IDs: **${duplicateCountyParcelIdCount}**`,
    `- Duplicate source parcel IDs: **${duplicateSourceParcelIdCount}**`,
    `- Invalid records: **${invalidRecordCount}**`,
    `- Chunks audited: **${chunkInventory.length.toLocaleString()}**`,
    `- Chunk inventory SHA-256: \`${chunkInventorySha256}\``,
    `- Lineage ledger root SHA-256: \`${lineageLedgerRootSha256}\``,
    "",
    "## Outcome",
    "",
    `- Output lineage certified: **${audit.outputLineageCertified ? "yes" : "no"}**`,
    `- Raw source-to-output lineage certified: **${audit.sourceToOutputCertified ? "yes" : "no"}**`,
    `- Raw source match status: \`${audit.rawSourceMatchStatus}\``,
    "",
    report?.outcome?.explanation || "Every current Tarrant output parcel has internally consistent source identity and reference fields. Raw source matching remains unverified.",
    "",
    "No county activation occurred and no White Rabbit page design changed.",
    "",
  ];
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "tarrant-output-lineage-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, "tarrant-output-lineage-audit.md"), markdown.join("\n"));
  console.log(`Built ${path.relative(root, outputDirectory)} with ${observedOutputCount.toLocaleString()} certified output lineage records.`);
})().catch((error) => { console.error(error); process.exit(1); });

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const opportunityManifestFile = path.join(root, "public", "data", "opportunities", "manifest.json");
const opportunityAuditFile = path.join(root, "output", "dallas-parcel-opportunity-intelligence.json");
const outputDir = path.join(root, "public", "data", "savant-tools");
const outputFile = path.join(outputDir, "development-path-radar.json");
const reportFile = path.join(root, "output", "savant-development-path-radar-report.json");
const TOP_LIMIT = 120;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function normalizeKey(value) {
  return String(value || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function safeNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function factorIds(candidate) {
  return (candidate.signal?.factors || []).map((factor) => factor.id).filter(Boolean);
}

function hasFactor(candidate, id) {
  return factorIds(candidate).includes(id);
}

function isDeveloperOwner(ownerName = "") {
  return /\b(DEVELOP|DEV\b|HOLDINGS|PROPERTIES|PROPERTY|REALTY|LAND|CAPITAL|INVEST|VENTURES|PARTNERS|COMMUNITIES|BUILDERS|HOMES|ACQUISITION|REIT|FUND)\b/i.test(ownerName);
}

function primaryChunk(candidate) {
  return (candidate.parcelChunkIds || [])[0] || "unknown";
}

function compactCandidate(candidate, context) {
  const factors = factorIds(candidate);
  const reasonCodes = [];
  const developmentEvidence = candidate.developmentEvidence || {};
  const zoning = candidate.constraints?.zoning || {};
  const ownerPortfolioCount = context.ownerCounts.get(context.ownerKey) || 0;
  const chunkCandidateCount = Math.max(...(candidate.parcelChunkIds || []).map((chunkId) => context.chunkCounts.get(chunkId) || 0), 0);
  const ownerBlockControlCount = Math.max(...(candidate.parcelChunkIds || []).map((chunkId) => context.ownerChunkCounts.get(`${context.ownerKey}::${chunkId}`) || 0), 0);
  const developerOwner = isDeveloperOwner(candidate.ownerName || candidate.propertyName);

  if (hasFactor(candidate, "low-improvement-to-land") || hasFactor(candidate, "older-improvements") || hasFactor(candidate, "large-site")) {
    reasonCodes.push("off-market-development-path");
  }
  if (ownerBlockControlCount >= 2 || chunkCandidateCount >= 8) {
    reasonCodes.push("same-block-assemblage");
  }
  if (developmentEvidence.status === "matched-active-runtime-index" || chunkCandidateCount >= 8 || (zoning.overlays || []).length > 0) {
    reasonCodes.push("growth-pattern");
  }
  if (developerOwner && (ownerPortfolioCount >= 2 || ownerBlockControlCount >= 2)) {
    reasonCodes.push("developer-surrounding-control");
  }

  const score = Math.min(
    100,
    Math.round(
      safeNumber(candidate.signal?.score) +
        reasonCodes.length * 8 +
        Math.min(ownerPortfolioCount, 20) * 0.9 +
        Math.min(chunkCandidateCount, 20) * 0.8 +
        Math.min(ownerBlockControlCount, 10) * 1.5,
    ),
  );

  const category =
    reasonCodes.includes("developer-surrounding-control")
      ? "Developer Control"
      : reasonCodes.includes("same-block-assemblage")
        ? "Same-Block Assemblage"
        : reasonCodes.includes("growth-pattern")
          ? "Growth Pattern"
          : "Development Path";

  return {
    rank: candidate.rank,
    accountNum: candidate.accountNum,
    gisParcelId: candidate.gisParcelId,
    whiteRabbitPropertyId: candidate.whiteRabbitPropertyId,
    address: candidate.address,
    ownerName: candidate.ownerName || candidate.propertyName,
    parcelChunkIds: candidate.parcelChunkIds || [],
    category,
    score,
    reasonCodes,
    ownerPortfolioCount,
    sameBlockCandidateCount: chunkCandidateCount,
    ownerBlockControlCount,
    metrics: {
      landAreaAcres: safeNumber(candidate.metrics?.landAreaAcres),
      landValue: safeNumber(candidate.metrics?.landValue),
      improvementValue: safeNumber(candidate.metrics?.improvementValue),
      totalValue: safeNumber(candidate.metrics?.totalValue),
      yearBuilt: candidate.metrics?.yearBuilt || "",
    },
    zoningLabel: zoning.label || candidate.assessorZoning || "",
    developmentStatus: developmentEvidence.status || "not-found-in-active-runtime-development-index",
    explanation: (candidate.signal?.explanation || []).slice(0, 4),
    factorIds: factors,
    nextAction: reasonCodes.includes("developer-surrounding-control")
      ? "Open the map, inspect surrounding parcel ownership, then verify entity control and registered agents."
      : reasonCodes.includes("same-block-assemblage")
        ? "Open the map and inspect same-block owners, mailing addresses, zoning, and parcel boundaries for assembly."
        : reasonCodes.includes("growth-pattern")
          ? "Open the map and compare zoning overlays, nearby development evidence, and permit momentum."
          : "Open the map, verify ownership, building age, land value pressure, and zoning upside.",
    sourceTrail: [
      "public/data/opportunities/manifest.json",
      "public/data/opportunities/candidates/*.json",
      "output/dallas-parcel-opportunity-intelligence.json",
    ],
  };
}

function main() {
  const generatedAt = new Date().toISOString();
  const manifest = readJson(opportunityManifestFile);
  const audit = readJson(opportunityAuditFile);
  const candidates = [];
  for (const page of manifest.pageFiles || []) {
    const payload = readJson(path.join(root, "public", "data", "opportunities", page.file));
    candidates.push(...(payload.records || []));
  }

  const ownerCounts = new Map();
  const chunkCounts = new Map();
  const ownerChunkCounts = new Map();
  for (const candidate of candidates) {
    const ownerKey = normalizeKey(candidate.ownerName || candidate.propertyName);
    if (ownerKey) ownerCounts.set(ownerKey, (ownerCounts.get(ownerKey) || 0) + 1);
    for (const chunkId of candidate.parcelChunkIds || []) {
      chunkCounts.set(chunkId, (chunkCounts.get(chunkId) || 0) + 1);
      if (ownerKey) ownerChunkCounts.set(`${ownerKey}::${chunkId}`, (ownerChunkCounts.get(`${ownerKey}::${chunkId}`) || 0) + 1);
    }
  }

  const radarCandidates = candidates
    .map((candidate) => compactCandidate(candidate, {
      ownerKey: normalizeKey(candidate.ownerName || candidate.propertyName),
      ownerCounts,
      chunkCounts,
      ownerChunkCounts,
    }))
    .filter((candidate) => candidate.reasonCodes.length)
    .sort((a, b) => b.score - a.score || b.reasonCodes.length - a.reasonCodes.length || a.rank - b.rank);

  const reasonCounts = {
    offMarketDevelopmentPath: radarCandidates.filter((candidate) => candidate.reasonCodes.includes("off-market-development-path")).length,
    sameBlockAssemblage: radarCandidates.filter((candidate) => candidate.reasonCodes.includes("same-block-assemblage")).length,
    growthPattern: radarCandidates.filter((candidate) => candidate.reasonCodes.includes("growth-pattern")).length,
    developerSurroundingControl: radarCandidates.filter((candidate) => candidate.reasonCodes.includes("developer-surrounding-control")).length,
  };

  const payload = {
    schemaVersion: "wr-savant-development-path-radar-v1",
    generatedAt,
    sourceCountyId: manifest.sourceCountyId,
    featureGate: manifest.featureGate,
    advisoryOnly: true,
    sourceParcelFeatureCount: audit.exactSummary.sourceParcelFeatureCount,
    scoredUniqueAccountCount: audit.exactSummary.scoredUniqueAccountCount,
    opportunityCandidateCount: manifest.candidateCount,
    analyzedCandidateCount: candidates.length,
    reasonCounts,
    joinKeys: {
      opportunityCandidate: "accountNum / gisParcelId",
      sameBlockAssemblage: "parcelChunkIds as local block-context groups",
      developerControl: "normalized ownerName + parcelChunkIds",
      growthPattern: "developmentEvidence + zoning overlays + local candidate density",
    },
    runtimePolicy: "Fetch this compact Savant radar only from the Savant Tools page; source pages remain bounded and the full audit report is not fetched by the browser.",
    topCandidates: radarCandidates.slice(0, TOP_LIMIT),
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(reportFile, `${JSON.stringify({
    generatedAt,
    sourceParcelFeatureCount: payload.sourceParcelFeatureCount,
    scoredUniqueAccountCount: payload.scoredUniqueAccountCount,
    opportunityCandidateCount: payload.opportunityCandidateCount,
    analyzedCandidateCount: payload.analyzedCandidateCount,
    reasonCounts: payload.reasonCounts,
    topCandidateCount: payload.topCandidates.length,
    topTen: payload.topCandidates.slice(0, 10).map((candidate) => ({
      accountNum: candidate.accountNum,
      address: candidate.address,
      ownerName: candidate.ownerName,
      category: candidate.category,
      score: candidate.score,
      reasonCodes: candidate.reasonCodes,
    })),
  }, null, 2)}\n`);
  console.log(`Savant Development Path Radar analyzed ${payload.analyzedCandidateCount} opportunity candidates from ${payload.sourceParcelFeatureCount} source parcels.`);
  console.log(`Output: ${path.relative(root, outputFile)}`);
}

main();

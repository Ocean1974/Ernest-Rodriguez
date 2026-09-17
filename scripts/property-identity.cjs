const WHITE_RABBIT_PROPERTY_ID_VERSION = "wr-property-id-v1";
const WHITE_RABBIT_LINEAGE_VERSION = "wr-lineage-v1";

function canonicalIdentityPart(value, { lower = false } = {}) {
  const normalized = String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");
  return lower ? normalized.toLowerCase() : normalized.toUpperCase();
}

function encodeIdentityPart(value) {
  return encodeURIComponent(value).replace(/%[0-9a-f]{2}/gi, (token) => token.toUpperCase());
}

function createWhiteRabbitPropertyId({ sourceCountyId, sourceParcelId }) {
  const county = canonicalIdentityPart(sourceCountyId, { lower: true });
  const parcel = canonicalIdentityPart(sourceParcelId);
  if (!county || !parcel) return "";
  return `wrp:v1:${encodeIdentityPart(county)}:${encodeIdentityPart(parcel)}`;
}

function parseWhiteRabbitPropertyId(value) {
  const match = /^wrp:v1:([^:]+):(.+)$/.exec(String(value || "").trim());
  if (!match) return null;
  try {
    return {
      version: WHITE_RABBIT_PROPERTY_ID_VERSION,
      sourceCountyId: decodeURIComponent(match[1]).toLowerCase(),
      sourceParcelId: decodeURIComponent(match[2]).toUpperCase(),
    };
  } catch {
    return null;
  }
}

function freshnessStatus(sourceUpdatedAt, generatedAt, maxAgeDays = 120) {
  if (!sourceUpdatedAt) return { status: "unknown", ageDays: null, reason: "Source update timestamp is not published by the adapter." };
  const updated = Date.parse(sourceUpdatedAt);
  const observed = Date.parse(generatedAt || new Date().toISOString());
  if (!Number.isFinite(updated) || !Number.isFinite(observed)) {
    return { status: "unknown", ageDays: null, reason: "Source update timestamp could not be parsed." };
  }
  const ageDays = Math.max(0, Math.floor((observed - updated) / 86400000));
  return ageDays <= maxAgeDays
    ? { status: "current", ageDays, reason: `Source age is within the ${maxAgeDays}-day freshness policy.` }
    : { status: "stale", ageDays, reason: `Source age exceeds the ${maxAgeDays}-day freshness policy.` };
}

function createDataLineage({ sourceCountyId, sourceDataset = "", sourceUpdatedAt = "", generatedAt, maxAgeDays = 120 }) {
  const serviceGeneratedAt = generatedAt || new Date().toISOString();
  const freshness = freshnessStatus(sourceUpdatedAt, serviceGeneratedAt, maxAgeDays);
  return {
    contractVersion: WHITE_RABBIT_LINEAGE_VERSION,
    sourceCountyId: canonicalIdentityPart(sourceCountyId, { lower: true }),
    sourceDataset: String(sourceDataset || ""),
    serviceGeneratedAt,
    sourceUpdatedAt: String(sourceUpdatedAt || ""),
    freshnessStatus: freshness.status,
    freshnessAgeDays: freshness.ageDays,
    freshnessMaxAgeDays: maxAgeDays,
    freshnessReason: freshness.reason,
  };
}

module.exports = {
  WHITE_RABBIT_LINEAGE_VERSION,
  WHITE_RABBIT_PROPERTY_ID_VERSION,
  canonicalIdentityPart,
  createDataLineage,
  createWhiteRabbitPropertyId,
  freshnessStatus,
  parseWhiteRabbitPropertyId,
};

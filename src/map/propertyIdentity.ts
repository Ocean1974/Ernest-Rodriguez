export const WHITE_RABBIT_PROPERTY_ID_VERSION = "wr-property-id-v1";
export const WHITE_RABBIT_LINEAGE_VERSION = "wr-lineage-v1";

export type ParcelDataLineage = {
  contractVersion: typeof WHITE_RABBIT_LINEAGE_VERSION;
  sourceCountyId: string;
  sourceDataset: string;
  serviceGeneratedAt: string;
  sourceUpdatedAt: string;
  freshnessStatus: "current" | "stale" | "unknown";
  freshnessAgeDays: number | null;
  freshnessMaxAgeDays: number;
  freshnessReason: string;
};

function canonicalIdentityPart(value: unknown, lower = false): string {
  const normalized = String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ");
  return lower ? normalized.toLowerCase() : normalized.toUpperCase();
}

function encodeIdentityPart(value: string): string {
  return encodeURIComponent(value).replace(/%[0-9a-f]{2}/gi, (token) => token.toUpperCase());
}

export function createWhiteRabbitPropertyId(sourceCountyId: unknown, sourceParcelId: unknown): string {
  const county = canonicalIdentityPart(sourceCountyId, true);
  const parcel = canonicalIdentityPart(sourceParcelId);
  if (!county || !parcel) return "";
  return `wrp:v1:${encodeIdentityPart(county)}:${encodeIdentityPart(parcel)}`;
}

export function parseWhiteRabbitPropertyId(value: unknown): { version: typeof WHITE_RABBIT_PROPERTY_ID_VERSION; sourceCountyId: string; sourceParcelId: string } | null {
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

export function createParcelDataLineage(input: {
  sourceCountyId: unknown;
  sourceDataset?: unknown;
  sourceUpdatedAt?: unknown;
  serviceGeneratedAt?: unknown;
  freshnessMaxAgeDays?: unknown;
}): ParcelDataLineage {
  const serviceGeneratedAt = String(input.serviceGeneratedAt || "");
  const sourceUpdatedAt = String(input.sourceUpdatedAt || "");
  const freshnessMaxAgeDays = Math.max(1, Number(input.freshnessMaxAgeDays || 120));
  const updated = Date.parse(sourceUpdatedAt);
  const observed = Date.parse(serviceGeneratedAt);
  const canMeasure = Boolean(sourceUpdatedAt && serviceGeneratedAt && Number.isFinite(updated) && Number.isFinite(observed));
  const freshnessAgeDays = canMeasure ? Math.max(0, Math.floor((observed - updated) / 86400000)) : null;
  const freshnessStatus = freshnessAgeDays === null ? "unknown" : freshnessAgeDays <= freshnessMaxAgeDays ? "current" : "stale";
  const freshnessReason = freshnessAgeDays === null
    ? "Source update timestamp is not published by the adapter."
    : freshnessStatus === "current"
      ? `Source age is within the ${freshnessMaxAgeDays}-day freshness policy.`
      : `Source age exceeds the ${freshnessMaxAgeDays}-day freshness policy.`;
  return {
    contractVersion: WHITE_RABBIT_LINEAGE_VERSION,
    sourceCountyId: canonicalIdentityPart(input.sourceCountyId, true),
    sourceDataset: String(input.sourceDataset || ""),
    serviceGeneratedAt,
    sourceUpdatedAt,
    freshnessStatus,
    freshnessAgeDays,
    freshnessMaxAgeDays,
    freshnessReason,
  };
}

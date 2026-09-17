export const PROPERTY_PROFILE_SCHEMA_VERSION = "wr-property-profile-v1";

function canonicalPropertyId(parcel) {
  if (parcel?.whiteRabbitPropertyId) return String(parcel.whiteRabbitPropertyId);
  const county = String(parcel?.sourceCountyId || "").trim().toLowerCase();
  const sourceId = String(parcel?.accountNum || parcel?.accountNumber || parcel?.gisParcelId || "").normalize("NFKC").trim().toUpperCase();
  if (!county || !sourceId) return "";
  return `wrp:v1:${encodeURIComponent(county)}:${encodeURIComponent(sourceId)}`;
}

export function buildPropertyProfile({ parcel = null, intelligence = null, permits = [], errors = [] } = {}) {
  const safePermits = Array.isArray(permits) ? permits : [];
  const safeErrors = Array.isArray(errors) ? errors.map(String).filter(Boolean) : [];
  const whiteRabbitPropertyId = canonicalPropertyId(parcel);
  const layerStatus = {
    parcel: parcel ? "matched" : "not-found",
    zoning: intelligence?.status?.zoning || "not-requested",
    floodplain: intelligence?.status?.floodplain || "not-requested",
    permits: safePermits.length ? "matched" : "not-found",
  };
  const matchedLayers = Object.values(layerStatus).filter((status) => status === "matched").length;
  const status = !parcel ? "not-found" : safeErrors.length || matchedLayers < 4 ? "partial" : "complete";
  return {
    schemaVersion: PROPERTY_PROFILE_SCHEMA_VERSION,
    status,
    whiteRabbitPropertyId,
    sourceCountyId: String(parcel?.sourceCountyId || intelligence?.sourceCountyId || ""),
    countyParcelId: String(parcel?.countyParcelId || intelligence?.countyParcelId || ""),
    accountNum: String(parcel?.accountNum || parcel?.accountNumber || intelligence?.accountNum || ""),
    gisParcelId: String(parcel?.gisParcelId || intelligence?.gisParcelId || ""),
    parcel,
    intelligence,
    permits: safePermits,
    lineage: parcel?.dataLineage || null,
    evidence: {
      layerStatus,
      permitCount: safePermits.length,
      errors: safeErrors,
    },
  };
}

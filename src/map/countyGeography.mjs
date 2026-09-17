export const COUNTY_GEOGRAPHY_VERSION = "wr-county-geography-v1";
export const DEFAULT_COUNTY_GEOGRAPHY_ENDPOINT = "/api/geographies";

export function parseCountyGeographyResponse(payload) {
  const counties = payload?.result?.geographies?.Counties;
  if (!Array.isArray(counties) || !counties.length) return null;
  const county = counties[0] || {};
  const stateFips = String(county.STATE || county.STATEFP || "").padStart(2, "0");
  const countyCode = String(county.COUNTY || county.COUNTYFP || "").padStart(3, "0");
  if (!/^\d{2}$/.test(stateFips) || !/^\d{3}$/.test(countyCode)) return null;
  return {
    countyFips: `${stateFips}${countyCode}`,
    stateFips,
    countyCode,
    countyName: String(county.NAME || county.BASENAME || ""),
    geoid: String(county.GEOID || `${stateFips}${countyCode}`),
    source: "U.S. Census Bureau Geocoder",
  };
}

export async function resolveCountyGeography(coordinates, {
  endpoint = DEFAULT_COUNTY_GEOGRAPHY_ENDPOINT,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
} = {}) {
  const longitude = Number(coordinates?.[0]);
  const latitude = Number(coordinates?.[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  const url = new URL(endpoint, globalThis.location?.origin || "http://localhost");
  url.searchParams.set("x", String(longitude));
  url.searchParams.set("y", String(latitude));
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("vintage", "Current_Current");
  url.searchParams.set("format", "json");
  const response = await fetchImpl(url.href, { method: "GET", headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`County geography resolver returned ${response.status}.`);
  return parseCountyGeographyResponse(await response.json());
}

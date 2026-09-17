export const ADDRESS_GEOCODER_VERSION = "wr-address-geocoder-v1";
export const DEFAULT_ADDRESS_GEOCODER_ENDPOINT = "/api/geocode";
export const MAX_ADDRESS_QUERY_LENGTH = 100;

function cleanAddressQuery(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function parseCensusAddressResponse(payload) {
  const matches = payload?.result?.addressMatches;
  if (!Array.isArray(matches)) return [];
  return matches.flatMap((match) => {
    const longitude = Number(match?.coordinates?.x);
    const latitude = Number(match?.coordinates?.y);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return [];
    return [{
      matchedAddress: cleanAddressQuery(match?.matchedAddress),
      coordinates: [longitude, latitude],
      addressComponents: match?.addressComponents || {},
      source: "U.S. Census Bureau Geocoder",
      benchmark: String(payload?.result?.input?.benchmark?.benchmarkName || "Public_AR_Current"),
    }];
  });
}

export async function geocodeAddress(query, {
  endpoint = DEFAULT_ADDRESS_GEOCODER_ENDPOINT,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
} = {}) {
  const address = cleanAddressQuery(query);
  if (!address || address.length > MAX_ADDRESS_QUERY_LENGTH) return null;
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required for address geocoding.");
  const url = new URL(endpoint, globalThis.location?.origin || "http://localhost");
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");
  const response = await fetchImpl(url.href, {
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Address geocoder returned ${response.status}.`);
  const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
  if (contentType && !contentType.includes("application/json")) throw new Error("Address geocoder returned a non-JSON response.");
  const matches = parseCensusAddressResponse(await response.json());
  return matches[0] || null;
}

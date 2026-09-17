import { geocodeAddress } from "./geocodeAddress.mjs";
import { resolveCountyGeography } from "./countyGeography.mjs";

export const NATIONAL_PARCEL_SEARCH_VERSION = "wr-national-parcel-search-v1";
export const DEFAULT_NATIONAL_PARCEL_MANIFEST = "/data/national/parcel-search-manifest.json";

let manifestPromise;

export function looksLikeUsStreetAddress(value) {
  const query = String(value || "").trim();
  const startsWithStreetNumber = /^\d+[a-z]?\s+\S+/i.test(query);
  const hasLocationHint = /,/.test(query) || /\b\d{5}(?:-\d{4})?\b/.test(query) || /\b[A-Z]{2}\b/i.test(query) || /\b(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i.test(query);
  const hasStreetSuffix = /\b(?:st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|pkwy|parkway|pl|place|way|trl|trail|cir|circle|hwy|highway)\b/i.test(query);
  return startsWithStreetNumber && (hasLocationHint || hasStreetSuffix);
}

export async function loadNationalParcelSearchManifest({ endpoint = DEFAULT_NATIONAL_PARCEL_MANIFEST, fetchImpl = globalThis.fetch } = {}) {
  if (!manifestPromise || endpoint !== DEFAULT_NATIONAL_PARCEL_MANIFEST || fetchImpl !== globalThis.fetch) {
    manifestPromise = Promise.resolve(fetchImpl(endpoint, { headers: { accept: "application/json" } })).then(async (response) => {
      if (!response.ok) throw new Error(`National parcel manifest returned ${response.status}.`);
      const manifest = await response.json();
      if (manifest?.schemaVersion !== "wr-national-parcel-search-manifest-v1") throw new Error("National parcel manifest schema is unsupported.");
      return manifest;
    });
  }
  return manifestPromise;
}

export function routeForCountyFips(manifest, countyFips) {
  const fips = String(countyFips || "").padStart(5, "0");
  return (manifest?.counties || []).find((county) => county.countyFips === fips && county.searchReady === true && county.accessMode !== "blocked") || null;
}

export function routeForCoordinates(manifest, coordinates) {
  const longitude = Number(coordinates?.[0]);
  const latitude = Number(coordinates?.[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return (manifest?.counties || []).find((county) => {
    if (county.searchReady !== true || county.accessMode === "blocked") return false;
    const bounds = county?.map?.geoBounds;
    if (!bounds) return false;
    return longitude >= Number(bounds.minLng) && longitude <= Number(bounds.maxLng)
      && latitude >= Number(bounds.minLat) && latitude <= Number(bounds.maxLat);
  }) || null;
}

export function parcelDatasetForNationalRoute(route) {
  if (!route) return null;
  return {
    id: route.datasetId,
    countyName: route.countyName,
    universalParcelSchema: route.universalParcelSchema,
    dataRoots: { parcels: route.dataRoot },
    map: route.map,
  };
}

function addressCandidates(query, geocoded) {
  const components = geocoded?.addressComponents || {};
  const street = [components.fromAddress, components.preDirection, components.streetName, components.suffixType, components.suffixDirection].filter(Boolean).join(" ");
  return [...new Set([street, geocoded?.matchedAddress, query].map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeStreet(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\b(street)\b/g, "st")
    .replace(/\b(avenue)\b/g, "ave")
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(drive)\b/g, "dr")
    .replace(/\b(boulevard)\b/g, "blvd")
    .replace(/\b(lane)\b/g, "ln")
    .replace(/\b(court)\b/g, "ct")
    .replace(/\b(parkway)\b/g, "pkwy")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parcelMatchesGeocodedStreet(parcel, geocoded) {
  const components = geocoded?.addressComponents || {};
  const street = normalizeStreet([components.fromAddress, components.preDirection, components.streetName, components.suffixType, components.suffixDirection].filter(Boolean).join(" "));
  if (!street) return false;
  return [parcel?.address, parcel?.propertyAddress]
    .map(normalizeStreet)
    .some((address) => address === street || address.startsWith(`${street} `));
}

export async function searchNationalParcelAddress(query, {
  geocode = geocodeAddress,
  resolveGeography = resolveCountyGeography,
  loadManifest = loadNationalParcelSearchManifest,
  searchDataset,
  maxFeatures = 40,
} = {}) {
  const normalized = String(query || "").trim();
  if (!normalized) return { status: "empty-query", parcels: [] };
  if (typeof searchDataset !== "function") throw new TypeError("searchDataset is required");
  const geocoded = await geocode(normalized);
  if (!geocoded) return { status: "address-not-found", parcels: [] };
  const [geography, manifest] = await Promise.all([
    Promise.resolve(resolveGeography(geocoded.coordinates)).catch(() => null),
    loadManifest(),
  ]);
  const route = routeForCountyFips(manifest, geography?.countyFips) || routeForCoordinates(manifest, geocoded.coordinates);
  if (!route) return { status: geography ? "county-not-connected" : "county-not-found", geocoded, geography, parcels: [] };
  const dataset = parcelDatasetForNationalRoute(route);
  for (const candidate of addressCandidates(normalized, geocoded)) {
    const parcels = await searchDataset(candidate, maxFeatures, dataset);
    const exactAddressParcels = (parcels || []).filter((parcel) => parcelMatchesGeocodedStreet(parcel, geocoded));
    if (exactAddressParcels.length) return { status: "parcel-found", geocoded, geography, route, dataset, matchedQuery: candidate, parcels: exactAddressParcels };
  }
  return { status: "county-covered-no-parcel-match", geocoded, geography, route, dataset, parcels: [] };
}

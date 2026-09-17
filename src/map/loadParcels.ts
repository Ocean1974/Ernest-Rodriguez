import { requestJson } from "./http";
import { activeCountyDataset } from "../data/countyConfig";
import { createParcelDataLineage, createWhiteRabbitPropertyId, type ParcelDataLineage } from "./propertyIdentity";

export type ParcelServiceDataset = {
  id?: string;
  countyName?: string;
  appraisalDistrictName?: string;
  appraisalDistrictAcronym?: string;
  universalParcelSchema?: {
    version?: string;
  };
  sourceUpdatedAt?: string;
  freshnessPolicy?: {
    maxAgeDays?: number;
  };
  dataRoots?: {
    parcels?: string;
  };
};

export type ParcelBounds = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

export type ParcelFeature = {
  type: "Feature";
  properties: Record<string, unknown> & {
    accountNumber?: string;
    gisParcelId?: string;
    propertyAddress?: string;
    ownerPropertyName?: string;
    buildingClass?: string;
    blockId?: string;
    totalValue?: number;
  };
  geometry: {
    type: string;
    coordinates: unknown;
  };
};

export type LoadParcelsOptions = {
  bounds: ParcelBounds;
  zoom: number;
  search?: string;
  maxFeatures?: number;
};

export type ParcelRecordBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type ParcelRecord = Record<string, unknown> & {
  schemaVersion?: string;
  sourceCountyId?: string;
  countyParcelId?: string;
  whiteRabbitPropertyId?: string;
  accountNum?: string;
  accountNumber?: string;
  gisParcelId?: string;
  address?: string;
  propertyAddress?: string;
  ownerName?: string;
  ownerName2?: string;
  ownerPropertyName?: string;
  propertyName?: string;
  businessName?: string;
  ownerMailingAddress?: string;
  ownerMailingAddress2?: string;
  ownerCity?: string;
  ownerState?: string;
  ownerZip?: string;
  blockId?: string;
  buildingClass?: string;
  totalValue?: string | number;
  landValue?: string | number;
  improvementValue?: string | number;
  centroid?: unknown;
  points?: unknown;
  dataLineage?: ParcelDataLineage;
};

export type ParcelRecordLoadOptions = {
  bounds?: ParcelRecordBounds;
  search?: string;
  maxFeatures?: number;
};

export type ParcelServiceChunk = {
  id: string;
  file: string;
  count: number;
  bounds: ParcelRecordBounds;
};

export type ParcelServiceManifest = {
  generatedAt?: string;
  source?: string;
  sourceCountyId?: string;
  schemaVersion?: string;
  lineageContract?: {
    version?: string;
    sourceUpdatedAt?: string;
    freshnessMaxAgeDays?: number;
  };
  featureCount: number;
  chunkCount: number;
  chunks: ParcelServiceChunk[];
  searchIndex: string;
  searchIndexCount: number;
  searchIndexShards?: {
    keyLength: number;
    fields: string[];
    files: Record<string, string | string[]>;
    counts?: Record<string, number>;
    recordMembershipCount?: number;
  };
  addressSearchIndexShards?: {
    schemaVersion?: string;
    keyLength: number;
    fields: string[];
    files: Record<string, string | string[]>;
    counts?: Record<string, number>;
    indexedParcelCount?: number;
    maximumRecordsPerFile?: number;
  };
  intelligenceSidecars?: {
    version?: string;
    manifest?: string;
    joinKey?: string;
    featureCount?: number;
    chunkCount?: number;
    files: Record<string, string>;
    counts?: Record<string, number>;
    activationStatus?: string;
  };
};

const manifestPromises = new Map<string, Promise<ParcelServiceManifest>>();
const searchIndexPromises = new Map<string, Promise<ParcelRecord[]>>();
const chunkCache = new Map<string, Promise<ParcelRecord[]>>();
const searchShardCache = new Map<string, Promise<ParcelRecord[]>>();
const intelligenceSidecarCache = new Map<string, Promise<{ fields?: string[]; parcels?: unknown[] }>>();
export const MAX_BROAD_SEARCH_SHARD_RECORDS = 125000;
export const MAX_SEARCH_QUERY_RECORD_MEMBERSHIPS = 250000;
export const MAX_CONCURRENT_SEARCH_CHUNK_LOADS = 8;
export const MAX_CONCURRENT_VIEWPORT_CHUNK_LOADS = 4;
export const MAX_CACHED_PARCEL_CHUNKS = 96;
export const MAX_CACHED_SEARCH_SHARDS = 48;

function setBoundedPromise<T>(cache: Map<string, Promise<T>>, key: string, value: Promise<T>, maximumEntries: number): void {
  if (!cache.has(key) && cache.size >= maximumEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, value);
}
const countySearchLabels: Record<string, string[]> = {
  "dallas-county-dcad": ["Dallas County", "Dallas", "Dallas County Appraisal District", "DCAD"],
  "jefferson-ky": ["Jefferson County", "Louisville", "Louisville KY", "Jefferson County PVA", "PVA"],
  "harris-county-tx": ["Harris County", "Houston", "Harris Central Appraisal District", "HCAD"],
  "travis-county-tx": ["Travis County", "Austin", "Travis Central Appraisal District", "TCAD"],
  "maricopa-county-az": ["Maricopa County", "Phoenix", "Maricopa County Assessor", "MCA"],
  "king-county-wa": ["King County", "Seattle", "King County Department of Assessments", "KCDOA"],
};

function parcelServiceBase(dataset: ParcelServiceDataset = activeCountyDataset): string {
  return String(dataset?.dataRoots?.parcels || activeCountyDataset.dataRoots.parcels);
}

function parcelServiceKey(dataset: ParcelServiceDataset = activeCountyDataset): string {
  return parcelServiceBase(dataset);
}

function parcelServiceSchemaVersion(dataset: ParcelServiceDataset = activeCountyDataset): string {
  return String(dataset?.universalParcelSchema?.version || activeCountyDataset.universalParcelSchema.version);
}

export function parcelCountyId(parcel: ParcelRecord): string {
  return String(parcel.sourceCountyId || activeCountyDataset.id);
}

export function parcelStableAccountId(parcel: ParcelRecord): string {
  return String(parcel.accountNum || parcel.accountNumber || parcel.gisParcelId || "").trim();
}

export function countyAwareParcelId(parcel: ParcelRecord): string {
  const countyId = parcelCountyId(parcel);
  const account = parcelStableAccountId(parcel);
  return String(parcel.countyParcelId || (account ? `${countyId}:${account}` : countyId));
}

function withCountyParcelIdentity<T extends ParcelRecord>(parcel: T, dataset: ParcelServiceDataset = activeCountyDataset, manifest?: ParcelServiceManifest): T {
  const sourceCountyId = String(parcel.sourceCountyId || dataset?.id || activeCountyDataset.id);
  const account = parcelStableAccountId(parcel);
  const whiteRabbitPropertyId = String(parcel.whiteRabbitPropertyId || createWhiteRabbitPropertyId(sourceCountyId, account));
  const dataLineage = parcel.dataLineage || createParcelDataLineage({
    sourceCountyId,
    sourceDataset: manifest?.source,
    sourceUpdatedAt: manifest?.lineageContract?.sourceUpdatedAt || dataset.sourceUpdatedAt,
    serviceGeneratedAt: manifest?.generatedAt,
    freshnessMaxAgeDays: manifest?.lineageContract?.freshnessMaxAgeDays || dataset.freshnessPolicy?.maxAgeDays,
  });
  return {
    ...parcel,
    schemaVersion: String(manifest?.schemaVersion || parcelServiceSchemaVersion(dataset)),
    sourceCountyId,
    whiteRabbitPropertyId,
    countyParcelId: String(parcel.countyParcelId || (account ? `${sourceCountyId}:${account}` : sourceCountyId)),
    dataLineage,
  };
}

function unpackParcelSearchIndex(payload: { fields?: string[]; parcels?: unknown[] }, dataset: ParcelServiceDataset = activeCountyDataset, manifest?: ParcelServiceManifest): ParcelRecord[] {
  const parcels = payload.parcels || [];
  if (!Array.isArray(payload.fields)) return (parcels as ParcelRecord[]).map((parcel) => withCountyParcelIdentity(parcel, dataset, manifest));
  return parcels.map((parcel) => {
    if (!Array.isArray(parcel)) return withCountyParcelIdentity(parcel as ParcelRecord, dataset, manifest);
    const record: ParcelRecord = {};
    payload.fields?.forEach((field, index) => {
      const value = parcel[index];
      if (value !== "" && value !== null && value !== undefined) record[field] = value;
    });
    return withCountyParcelIdentity(record, dataset, manifest);
  });
}

function recordBoundsCenter(bounds: ParcelRecordBounds): [number, number] {
  return [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
}

function recordPoint(parcel: ParcelRecord, fallback: [number, number]): [number, number] {
  if (Array.isArray(parcel.centroid) && typeof parcel.centroid[0] === "number" && typeof parcel.centroid[1] === "number") {
    return [parcel.centroid[0], parcel.centroid[1]];
  }
  const bounds = parcelRecordBounds(parcel);
  return bounds ? recordBoundsCenter(bounds) : fallback;
}

function recordDistanceToPoint(parcel: ParcelRecord, center: [number, number]): number {
  const point = recordPoint(parcel, center);
  return Math.hypot(point[0] - center[0], point[1] - center[1]);
}

function sortChunksByViewportCenter(chunks: ParcelServiceChunk[], bounds?: ParcelRecordBounds): ParcelServiceChunk[] {
  if (!bounds) return chunks;
  const center = recordBoundsCenter(bounds);
  return [...chunks].sort((a, b) => {
    const aCenter = recordBoundsCenter(a.bounds);
    const bCenter = recordBoundsCenter(b.bounds);
    return Math.hypot(aCenter[0] - center[0], aCenter[1] - center[1]) - Math.hypot(bCenter[0] - center[0], bCenter[1] - center[1]);
  });
}

function distributeRecordsAcrossViewport<T extends ParcelRecord>(records: T[], bounds: ParcelRecordBounds | undefined, maxFeatures: number): T[] {
  if (!bounds || records.length <= maxFeatures) return records.slice(0, maxFeatures);
  const columns = 12;
  const rows = 8;
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const buckets = new Map<string, T[]>();

  for (const record of records) {
    const [x, y] = recordPoint(record, recordBoundsCenter(bounds));
    const column = Math.max(0, Math.min(columns - 1, Math.floor(((x - bounds.minX) / width) * columns)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor(((y - bounds.minY) / height) * rows)));
    const key = `${column}-${row}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)?.push(record);
  }

  for (const [key, bucket] of buckets) {
    const [column, row] = key.split("-").map((value) => Number.parseInt(value, 10));
    const center: [number, number] = [
      bounds.minX + ((column + 0.5) / columns) * width,
      bounds.minY + ((row + 0.5) / rows) * height,
    ];
    bucket.sort((a, b) => recordDistanceToPoint(a, center) - recordDistanceToPoint(b, center));
  }

  const orderedBuckets = Array.from(buckets.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, bucket]) => bucket);
  const distributed: T[] = [];
  let index = 0;
  while (distributed.length < maxFeatures) {
    let added = false;
    for (const bucket of orderedBuckets) {
      const record = bucket[index];
      if (!record) continue;
      distributed.push(record);
      added = true;
      if (distributed.length >= maxFeatures) break;
    }
    if (!added) break;
    index += 1;
  }

  return distributed;
}

function flattenCoordinates(coordinates: unknown, points: Array<[number, number]> = []): Array<[number, number]> {
  if (!Array.isArray(coordinates)) return points;
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    points.push([coordinates[0], coordinates[1]]);
    return points;
  }
  coordinates.forEach((child) => flattenCoordinates(child, points));
  return points;
}

export function parcelBounds(parcel: ParcelFeature): ParcelBounds | null {
  const points = flattenCoordinates(parcel.geometry.coordinates);
  if (!points.length) return null;
  return points.reduce(
    (bounds, [lng, lat]) => ({
      minLng: Math.min(bounds.minLng, lng),
      minLat: Math.min(bounds.minLat, lat),
      maxLng: Math.max(bounds.maxLng, lng),
      maxLat: Math.max(bounds.maxLat, lat),
    }),
    { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity },
  );
}

export function intersectsBounds(a: ParcelBounds, b: ParcelBounds): boolean {
  return a.minLng <= b.maxLng && a.maxLng >= b.minLng && a.minLat <= b.maxLat && a.maxLat >= b.minLat;
}

export function searchParcels(parcels: ParcelFeature[], search: string): ParcelFeature[] {
  const query = search.trim().toLowerCase();
  if (!query) return parcels;
  return parcels.filter((parcel) =>
    [
      parcel.properties.accountNumber,
      parcel.properties.gisParcelId,
      parcel.properties.propertyAddress,
      parcel.properties.ownerPropertyName,
      parcel.properties.buildingClass,
      parcel.properties.blockId,
      parcel.properties.totalValue,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
}

function flattenScreenPoints(points: unknown, output: Array<[number, number]> = []): Array<[number, number]> {
  if (!Array.isArray(points)) return output;
  if (typeof points[0] === "number" && typeof points[1] === "number") {
    output.push([points[0], points[1]]);
    return output;
  }
  points.forEach((point) => flattenScreenPoints(point, output));
  return output;
}

export function parcelRecordBounds(parcel: ParcelRecord): ParcelRecordBounds | null {
  const points = flattenScreenPoints(parcel.points);
  if (!points.length && Array.isArray(parcel.centroid) && typeof parcel.centroid[0] === "number" && typeof parcel.centroid[1] === "number") {
    points.push([parcel.centroid[0], parcel.centroid[1]]);
  }
  if (!points.length) return null;
  return points.reduce(
    (bounds, [x, y]) => ({
      minX: Math.min(bounds.minX, x),
      minY: Math.min(bounds.minY, y),
      maxX: Math.max(bounds.maxX, x),
      maxY: Math.max(bounds.maxY, y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

export function intersectsRecordBounds(a: ParcelRecordBounds, b: ParcelRecordBounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function parcelRecordSearchText(parcel: ParcelRecord): string {
  const dimensions = parcel.dimensions as Record<string, unknown> | undefined;
  const countyLabels = countySearchLabels[parcelCountyId(parcel)] || [activeCountyDataset.countyName, activeCountyDataset.appraisalDistrictName, activeCountyDataset.appraisalDistrictAcronym];
  return [
    parcel.address,
    parcel.propertyAddress,
    parcel.sourceCountyId,
    parcel.whiteRabbitPropertyId,
    parcel.countyParcelId,
    ...countyLabels,
    parcel.ownerName,
    parcel.ownerName2,
    parcel.businessName,
    parcel.ownerMailingAddress,
    parcel.ownerMailingAddress2,
    parcel.ownerCity,
    parcel.ownerState,
    parcel.ownerZip,
    parcel.legal,
    parcel.zoning,
    parcel.landUseCode,
    parcel.landUseDescription,
    parcel.landSection,
    parcel.landAreaUnit,
    parcel.landPricingMethod,
    parcel.landCostPerUnit,
    parcel.landMarketAdjustmentPct,
    parcel.landValuationAmount,
    parcel.propertyName,
    parcel.ownerPropertyName,
    parcel.accountNum,
    parcel.accountNumber,
    parcel.gisParcelId,
    parcel.blockId,
    parcel.areaLabel,
    parcel.buildingClass,
    parcel.city,
    parcel.propertyZip,
    parcel.yearBuilt,
    parcel.totalValue,
    parcel.landValue,
    parcel.improvementValue,
    parcel.landAreaSqFt,
    parcel.cityJurisdiction,
    parcel.isdJurisdiction,
    parcel.quality,
    parcel.condition,
    dimensions?.dimensionId,
    dimensions?.dimensionLabel,
    dimensions?.bearingLabel,
    dimensions?.frontageFt,
    dimensions?.depthFt,
    dimensions?.perimeterFt,
    dimensions?.sourceLayer,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function normalizeParcelId(value: unknown): string {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function searchShardKeysForQuery(query: string, keyLength: number): string[] {
  const keys = new Set<string>();
  const addKey = (value: string) => {
    const token = normalizeParcelId(value);
    if (token.length >= keyLength) keys.add(token.slice(0, keyLength));
  };
  addKey(query);
  query.split(/[^a-z0-9]+/i).forEach(addKey);
  return [...keys];
}

function allowsOversizedSearchShard(query: string, shardKey: string): boolean {
  const normalizedQuery = normalizeParcelId(query);
  const normalizedKey = normalizeParcelId(shardKey);
  if (!normalizedQuery || !normalizedKey) return false;
  return /^\d+$/.test(normalizedKey) && /^\d{6,}$/.test(normalizedQuery);
}

export function searchShardFilesForQuery(
  query: string,
  searchIndexShards: ParcelServiceManifest["searchIndexShards"],
): string[] {
  if (!searchIndexShards?.files) return [];
  const shardKeys = searchShardKeysForQuery(query, searchIndexShards.keyLength || 2);
  const files: string[] = [];
  const seenFiles = new Set<string>();
  let plannedMemberships = 0;

  for (const key of shardKeys) {
    const entry = searchIndexShards.files[key];
    if (!entry) continue;
    const shardCount = Number(searchIndexShards.counts?.[key] || 0);
    const isOversizedBroadShard =
      shardCount > MAX_BROAD_SEARCH_SHARD_RECORDS &&
      !allowsOversizedSearchShard(query, key);
    const exceedsQueryBudget =
      shardCount > 0 &&
      plannedMemberships > 0 &&
      plannedMemberships + shardCount > MAX_SEARCH_QUERY_RECORD_MEMBERSHIPS &&
      !allowsOversizedSearchShard(query, key);
    if (isOversizedBroadShard || exceedsQueryBudget) continue;

    const entryFiles = Array.isArray(entry) ? entry : [entry];
    for (const file of entryFiles) {
      if (seenFiles.has(file)) continue;
      seenFiles.add(file);
      files.push(file);
    }
    plannedMemberships += shardCount;
  }

  return files;
}

function parcelIdMatchScore(parcel: ParcelRecord, query: string): number {
  const normalizedQuery = normalizeParcelId(query);
  if (normalizedQuery.length < 3) return 0;
  const ids = [parcel.whiteRabbitPropertyId, parcel.accountNum, parcel.accountNumber, parcel.gisParcelId, parcel.countyParcelId, parcel.sourceCountyId].map(normalizeParcelId).filter(Boolean);
  let score = 0;
  for (const id of ids) {
    if (id === normalizedQuery) score = Math.max(score, 1000);
    else if (id.startsWith(normalizedQuery)) score = Math.max(score, 850 - Math.max(0, id.length - normalizedQuery.length));
    else if (id.includes(normalizedQuery)) score = Math.max(score, 700 - id.indexOf(normalizedQuery));
    else if (normalizedQuery.length >= 6 && id.includes(normalizedQuery.slice(0, -1))) score = Math.max(score, 520);
    else if (normalizedQuery.length >= 8 && id.includes(normalizedQuery.slice(1))) score = Math.max(score, 480);
  }
  return score;
}

function parcelTextMatchScore(parcel: ParcelRecord, query: string): number {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) return 0;
  const text = parcelRecordSearchText(parcel);
  if (text.includes(normalizedQuery)) return 100;
  const terms = normalizedQuery.split(/\s+/).filter((term) => term.length >= 2);
  const matchedTerms = terms.filter((term) => text.includes(term)).length;
  const minimumMatches = Math.max(1, Math.ceil(terms.length * 0.6));
  return terms.length && matchedTerms >= minimumMatches ? Math.round((matchedTerms / terms.length) * 80) : 0;
}

function normalizeAddressText(value: unknown): string {
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
    .replace(/\b(place)\b/g, "pl")
    .replace(/\b(parkway)\b/g, "pkwy")
    .replace(/\s+/g, " ");
}

function parcelAddressMatchScore(parcel: ParcelRecord, query: string): number {
  const normalizedQuery = normalizeAddressText(query);
  if (!normalizedQuery) return 0;
  const addresses = [parcel.address, parcel.propertyAddress]
    .map(normalizeAddressText)
    .filter(Boolean);
  let score = 0;
  const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean);
  const queryStreetNumber = queryTerms.find((term) => /^\d+[a-z]?$/.test(term));
  for (const address of addresses) {
    const addressTerms = address.split(/\s+/).filter(Boolean);
    const addressStreetNumber = addressTerms.find((term) => /^\d+[a-z]?$/.test(term));
    if (address === normalizedQuery) score = Math.max(score, 980);
    else if (address.startsWith(normalizedQuery)) score = Math.max(score, 840);
    else if (address.includes(normalizedQuery)) score = Math.max(score, 700);

    const matchedTerms = queryTerms.filter((term) => addressTerms.includes(term)).length;
    const minimumMatches = Math.max(1, Math.ceil(queryTerms.length * 0.6));
    const hasConflictingStreetNumber = Boolean(queryStreetNumber && addressStreetNumber && addressStreetNumber !== queryStreetNumber);
    if (matchedTerms >= minimumMatches && !hasConflictingStreetNumber) {
      const streetNumberBonus = queryStreetNumber && addressStreetNumber === queryStreetNumber ? 320 : 0;
      score = Math.max(score, Math.round((matchedTerms / queryTerms.length) * 560) + streetNumberBonus);
    }
  }
  return score;
}

function parcelNameMatchScore(parcel: ParcelRecord, query: string): number {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) return 0;
  const names = [parcel.ownerName, parcel.ownerName2, parcel.businessName, parcel.propertyName, parcel.ownerPropertyName]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  let score = 0;
  const terms = normalizedQuery.split(/\s+/).filter((term) => term.length >= 2);
  const minimumMatches = Math.max(1, Math.ceil(terms.length * 0.6));
  for (const name of names) {
    if (name === normalizedQuery) score = Math.max(score, 940);
    else if (name.startsWith(normalizedQuery)) score = Math.max(score, 760);
    else if (name.includes(normalizedQuery)) score = Math.max(score, 620);
    else if (terms.length) {
      const matchedTerms = terms.filter((term) => name.includes(term)).length;
      if (matchedTerms >= minimumMatches) score = Math.max(score, Math.round((matchedTerms / terms.length) * 560));
    }
  }
  return score;
}

export function searchParcelRecords<T extends ParcelRecord>(parcels: T[], search: string): T[] {
  const query = String(search || "").trim();
  if (!query) return parcels;
  return parcels
    .map((parcel, index) => ({
      parcel,
      index,
      score: Math.max(parcelIdMatchScore(parcel, query), parcelAddressMatchScore(parcel, query), parcelNameMatchScore(parcel, query), parcelTextMatchScore(parcel, query)),
    }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((result) => result.parcel);
}

export function filterParcelRecordsForViewport<T extends ParcelRecord>(parcels: T[], options: ParcelRecordLoadOptions): T[] {
  const searched = searchParcelRecords(parcels, options.search ?? "");
  const visible = options.bounds
    ? searched.filter((parcel) => {
        const bounds = parcelRecordBounds(parcel);
        return bounds ? intersectsRecordBounds(bounds, options.bounds as ParcelRecordBounds) : false;
      })
    : searched;
  return visible.slice(0, options.maxFeatures ?? 2500);
}

export async function loadParcelServiceManifest(dataset: ParcelServiceDataset = activeCountyDataset): Promise<ParcelServiceManifest> {
  const key = parcelServiceKey(dataset);
  if (!manifestPromises.has(key)) {
    manifestPromises.set(key, requestJson<ParcelServiceManifest>(`${parcelServiceBase(dataset)}manifest.json`).then((response) => {
      if (!response.ok) throw new Error(`Unable to load parcel manifest: ${response.status}`);
      return response.json();
    }));
  }
  return manifestPromises.get(key) as Promise<ParcelServiceManifest>;
}

export function applyParcelIntelligenceSidecar(records: ParcelRecord[], payload: { fields?: string[]; parcels?: unknown[] }): ParcelRecord[] {
  if (!Array.isArray(payload.fields) || !Array.isArray(payload.parcels)) return records;
  const byCountyParcelId = new Map<string, ParcelRecord>();
  for (const packed of payload.parcels) {
    if (!Array.isArray(packed)) continue;
    const enrichment: ParcelRecord = {};
    payload.fields.forEach((field, index) => {
      const value = packed[index];
      if (value !== "" && value !== null && value !== undefined) enrichment[field] = value;
    });
    const id = String(enrichment.countyParcelId || "");
    if (id) byCountyParcelId.set(id, enrichment);
  }
  return records.map((record) => {
    const enrichment = byCountyParcelId.get(String(record.countyParcelId || ""));
    if (!enrichment) return record;
    const { hcadAttached, tcadCertified, ...fields } = enrichment;
    const intelligenceReference = hcadAttached || tcadCertified;
    const joinFlag = hcadAttached ? "hcadAttached" : tcadCertified ? "tcadCertified" : "parcelIntelligenceSidecar";
    return {
      ...record,
      ...fields,
      joins: { ...(record.joins as Record<string, unknown> || {}), [joinFlag]: true },
      sourceReferences: {
        ...(record.sourceReferences as Record<string, unknown> || {}),
        [joinFlag]: intelligenceReference,
      },
    };
  });
}

async function loadParcelIntelligenceSidecar(file: string, dataset: ParcelServiceDataset): Promise<{ fields?: string[]; parcels?: unknown[] }> {
  const key = `${parcelServiceKey(dataset)}${file}`;
  if (!intelligenceSidecarCache.has(key)) {
    intelligenceSidecarCache.set(key, requestJson<{ fields?: string[]; parcels?: unknown[] }>(`${parcelServiceBase(dataset)}${file}`).then((response) => {
      if (!response.ok) throw new Error(`Unable to load parcel intelligence sidecar ${file}: ${response.status}`);
      return response.json();
    }));
  }
  return intelligenceSidecarCache.get(key) as Promise<{ fields?: string[]; parcels?: unknown[] }>;
}

async function loadParcelChunk(chunk: ParcelServiceChunk, dataset: ParcelServiceDataset = activeCountyDataset, manifest?: ParcelServiceManifest): Promise<ParcelRecord[]> {
  const key = `${parcelServiceKey(dataset)}${chunk.id}`;
  if (!chunkCache.has(key)) {
    setBoundedPromise(
      chunkCache,
      key,
      requestJson<{ parcels?: ParcelRecord[] }>(`${parcelServiceBase(dataset)}${chunk.file}`).then((response) => {
        if (!response.ok) throw new Error(`Unable to load parcel chunk ${chunk.id}: ${response.status}`);
        return response.json().then(async (payload) => {
          const records = (payload.parcels || []).map((parcel) => withCountyParcelIdentity(parcel, dataset, manifest));
          const sidecarFile = manifest?.intelligenceSidecars?.files?.[chunk.id];
          if (!sidecarFile) return records;
          const sidecar = await loadParcelIntelligenceSidecar(sidecarFile, dataset);
          return applyParcelIntelligenceSidecar(records, sidecar);
        });
      }),
      MAX_CACHED_PARCEL_CHUNKS,
    );
  }
  return chunkCache.get(key) as Promise<ParcelRecord[]>;
}

async function loadParcelSearchShard(file: string, dataset: ParcelServiceDataset = activeCountyDataset, manifest?: ParcelServiceManifest): Promise<ParcelRecord[]> {
  const key = `${parcelServiceKey(dataset)}${file}`;
  if (!searchShardCache.has(key)) {
    setBoundedPromise(
      searchShardCache,
      key,
      requestJson<{ fields?: string[]; parcels?: unknown[] }>(`${parcelServiceBase(dataset)}${file}`).then((response) => {
        if (!response.ok) throw new Error(`Unable to load parcel search shard ${file}: ${response.status}`);
        return response.json().then((payload) => unpackParcelSearchIndex(payload, dataset, manifest));
      }),
      MAX_CACHED_SEARCH_SHARDS,
    );
  }
  return searchShardCache.get(key) as Promise<ParcelRecord[]>;
}

export async function loadParcelRecordsForViewport(options: ParcelRecordLoadOptions = {}, dataset: ParcelServiceDataset = activeCountyDataset): Promise<ParcelRecord[]> {
  const manifest = await loadParcelServiceManifest(dataset);
  const maxFeatures = options.maxFeatures ?? 2500;
  const chunks = options.bounds
    ? manifest.chunks.filter((chunk) => intersectsRecordBounds(chunk.bounds, options.bounds as ParcelRecordBounds))
    : manifest.chunks;
  const sortedChunks = sortChunksByViewportCenter(chunks, options.bounds);
  const parcels: ParcelRecord[] = [];
  const collectionTarget = maxFeatures;
  for (let start = 0; start < sortedChunks.length; start += MAX_CONCURRENT_VIEWPORT_CHUNK_LOADS) {
    const batch = sortedChunks.slice(start, start + MAX_CONCURRENT_VIEWPORT_CHUNK_LOADS);
    const batchRecords = await Promise.all(batch.map((chunk) => loadParcelChunk(chunk, dataset, manifest)));
    for (const records of batchRecords) parcels.push(...filterParcelRecordsForViewport(records, { ...options, maxFeatures }));
    if (parcels.length >= collectionTarget) break;
  }
  return distributeRecordsAcrossViewport(parcels, options.bounds, maxFeatures);
}

export async function searchFullParcelRecords(search: string, maxFeatures = 250, dataset: ParcelServiceDataset = activeCountyDataset): Promise<ParcelRecord[]> {
  const query = String(search || "").trim();
  if (!query) return [];
  const manifest = await loadParcelServiceManifest(dataset);
  let searchIndex: ParcelRecord[] = [];
  if (manifest.searchIndexShards?.files) {
    const addressLikeQuery = /\d/.test(query) && /[a-z]/i.test(query);
    const hasAddressShards = Boolean(manifest.addressSearchIndexShards?.files && Object.keys(manifest.addressSearchIndexShards.files).length);
    const activeShards = addressLikeQuery && hasAddressShards
      ? manifest.addressSearchIndexShards
      : manifest.searchIndexShards;
    const shardFiles = searchShardFilesForQuery(query, activeShards);
    if (!shardFiles.length) return [];
    const shardRecords: ParcelRecord[][] = [];
    for (let start = 0; start < shardFiles.length; start += MAX_CONCURRENT_SEARCH_CHUNK_LOADS) {
      const batch = shardFiles.slice(start, start + MAX_CONCURRENT_SEARCH_CHUNK_LOADS);
      shardRecords.push(...await Promise.all(batch.map((file) => loadParcelSearchShard(file, dataset, manifest))));
    }
    const seenAccounts = new Set<string>();
    searchIndex = [];
    for (const records of shardRecords) {
      for (const record of records) {
        const account = countyAwareParcelId(record);
        if (account && seenAccounts.has(account)) continue;
        if (account) seenAccounts.add(account);
        searchIndex.push(record);
      }
    }
  } else {
    const key = parcelServiceKey(dataset);
    if (!searchIndexPromises.has(key)) {
      searchIndexPromises.set(key, requestJson<{ fields?: string[]; parcels?: unknown[] }>(`${parcelServiceBase(dataset)}${manifest.searchIndex}`).then((response) => {
        if (!response.ok) throw new Error(`Unable to load parcel search index: ${response.status}`);
        return response.json().then((payload) => unpackParcelSearchIndex(payload, dataset, manifest));
      }));
    }
    searchIndex = await (searchIndexPromises.get(key) as Promise<ParcelRecord[]>);
  }
  const hits = searchParcelRecords(searchIndex, query).slice(0, maxFeatures);
  const chunksById = new Map(manifest.chunks.map((chunk) => [chunk.id, chunk]));
  const requestedChunkIds = [...new Set(hits.map((hit) => String(hit.chunkId || "")).filter((chunkId) => chunksById.has(chunkId)))];
  const loadedRecords: ParcelRecord[] = [];
  for (let start = 0; start < requestedChunkIds.length; start += MAX_CONCURRENT_SEARCH_CHUNK_LOADS) {
    const batch = requestedChunkIds.slice(start, start + MAX_CONCURRENT_SEARCH_CHUNK_LOADS);
    const records = await Promise.all(batch.map((chunkId) => loadParcelChunk(chunksById.get(chunkId)!, dataset, manifest)));
    records.forEach((chunkRecords) => loadedRecords.push(...chunkRecords));
  }
  const recordsByCountyId = new Map<string, ParcelRecord>();
  const recordsByAccount = new Map<string, ParcelRecord>();
  for (const record of loadedRecords) {
    const countyId = countyAwareParcelId(record);
    const account = String(record.accountNum || record.accountNumber || "");
    if (countyId && !recordsByCountyId.has(countyId)) recordsByCountyId.set(countyId, record);
    if (account && !recordsByAccount.has(account)) recordsByAccount.set(account, record);
  }
  return hits.map((hit) => recordsByCountyId.get(countyAwareParcelId(hit)) || recordsByAccount.get(String(hit.accountNum || hit.accountNumber || "")) || hit);
}

export function filterParcelsForViewport(parcels: ParcelFeature[], options: LoadParcelsOptions): ParcelFeature[] {
  const maxFeatures = options.maxFeatures ?? (options.zoom < 13 ? 250 : 2500);
  const searched = searchParcels(parcels, options.search ?? "");
  const visible = searched.filter((parcel) => {
    const bounds = parcelBounds(parcel);
    return bounds ? intersectsBounds(bounds, options.bounds) : false;
  });
  return visible.slice(0, maxFeatures);
}

export async function loadParcels(
  fetchParcels: () => Promise<ParcelFeature[]>,
  options: LoadParcelsOptions,
): Promise<ParcelFeature[]> {
  const parcels = await fetchParcels();
  return filterParcelsForViewport(parcels, options);
}

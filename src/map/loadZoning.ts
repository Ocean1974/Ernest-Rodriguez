import { activeCountyDataset } from "../data/countyConfig";
import { requestJson } from "./http";

export type ZoningBounds = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

export type ZoningRecord = Record<string, unknown> & {
  schemaVersion?: string;
  sourceCountyId?: string;
  zoningRecordId?: string;
  countyParcelId?: string;
  accountNum?: string;
  gisParcelId?: string;
  sourceLayerId?: string;
  sourceLayerTitle?: string;
  sourceUrl?: string;
  recordType?: "tax-parcel-bridge" | "base-zoning" | "zoning-case" | "area-of-request" | "overlay";
  joinMethod?: "account" | "gisAccount" | "spatial" | "metadataOnly" | "unmatched";
  zoneDistrict?: string;
  longZoneDistrict?: string;
  pdNumber?: string;
  cdNumber?: string;
  caseNumber?: string;
  zoneChange?: string;
  councilDate?: string | number | null;
  effectiveDate?: string | number | null;
  bounds?: ZoningBounds | null;
  centroid?: [number, number] | null;
  searchText?: string;
  chunkId?: string;
};

export type ParcelZoningSummary = {
  label?: string;
  baseDistricts: string[];
  longZoneDistricts: string[];
  pdNumbers: string[];
  pdsNumbers: string[];
  supNumbers: string[];
  cdNumbers: string[];
  subdistricts: string[];
  overlays: string[];
  caseNumbers: string[];
};

export type ParcelZoningRecord = Record<string, unknown> & {
  schemaVersion?: string;
  sourceCountyId?: string;
  countyParcelId?: string;
  accountNum?: string;
  gisParcelId?: string;
  parcelChunkId?: string;
  existingParcelZoning?: string;
  zoningSummary: ParcelZoningSummary;
  sourceLayerIds: string[];
  sourceLayerHits: ZoningRecord[];
  searchText?: string;
};

export type ZoningChunk = {
  id: string;
  file: string;
  count: number;
  bounds: ZoningBounds | null;
};

export type ZoningManifest = {
  schemaVersion: string;
  recordSchemaVersion: string;
  sourceCountyId: string;
  status: string;
  defaultVisible: boolean;
  renderDirectlyInBrowser: boolean;
  maxFeaturesPerViewport: number;
  chunkCount: number;
  chunks: ZoningChunk[];
  searchIndex: string;
  searchIndexCount: number;
  parcelIndex?: string;
  parcelIndexCount?: number;
  parcelIndexShards?: {
    keyLength: number;
    fields: string[];
    sourceHitFields: string[];
    files: Record<string, string>;
    counts?: Record<string, number>;
  };
};

export type ZoningLoadOptions = {
  bounds?: ZoningBounds;
  search?: string;
  maxFeatures?: number;
  serviceBase?: string;
};

export const MAX_ZONING_FEATURES_PER_VIEWPORT = 750;

const DEFAULT_ZONING_SERVICE_BASE = activeCountyDataset.dataRoots.zoning || "/data/zoning/";
const manifestPromises = new Map<string, Promise<ZoningManifest>>();
const searchIndexPromises = new Map<string, Promise<ZoningRecord[]>>();
const chunkCache = new Map<string, Promise<ZoningRecord[]>>();
const parcelIndexShardCache = new Map<string, Promise<ParcelZoningRecord[]>>();

function zoningServiceBase(serviceBase = DEFAULT_ZONING_SERVICE_BASE): string {
  const normalized = String(serviceBase || DEFAULT_ZONING_SERVICE_BASE).trim() || DEFAULT_ZONING_SERVICE_BASE;
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function zoningSearchText(record: ZoningRecord): string {
  return [
    record.searchText,
    record.zoningRecordId,
    record.countyParcelId,
    record.accountNum,
    record.gisParcelId,
    record.sourceLayerId,
    record.sourceLayerTitle,
    record.recordType,
    record.zoneDistrict,
    record.longZoneDistrict,
    record.pdNumber,
    record.cdNumber,
    record.caseNumber,
    record.zoneChange,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function unpackSourceLayerHit(fields: string[], values: unknown): ZoningRecord {
  if (!Array.isArray(values)) return values as ZoningRecord;
  const record: ZoningRecord = {};
  fields.forEach((field, index) => {
    const value = values[index];
    if (value !== "" && value !== null && value !== undefined) record[field] = value as never;
  });
  return record;
}

function unpackParcelZoningRecord(payload: { fields?: string[]; sourceHitFields?: string[]; sourceCountyId?: string }, values: unknown): ParcelZoningRecord {
  if (!Array.isArray(values)) return values as ParcelZoningRecord;
  const raw: Record<string, unknown> = {};
  payload.fields?.forEach((field, index) => {
    const value = values[index];
    if (value !== "" && value !== null && value !== undefined) raw[field] = value;
  });
  const summary: ParcelZoningSummary = {
    label: String(raw.label || ""),
    baseDistricts: Array.isArray(raw.baseDistricts) ? (raw.baseDistricts as string[]) : [],
    longZoneDistricts: Array.isArray(raw.longZoneDistricts) ? (raw.longZoneDistricts as string[]) : [],
    pdNumbers: Array.isArray(raw.pdNumbers) ? (raw.pdNumbers as string[]) : [],
    pdsNumbers: Array.isArray(raw.pdsNumbers) ? (raw.pdsNumbers as string[]) : [],
    supNumbers: Array.isArray(raw.supNumbers) ? (raw.supNumbers as string[]) : [],
    cdNumbers: Array.isArray(raw.cdNumbers) ? (raw.cdNumbers as string[]) : [],
    subdistricts: Array.isArray(raw.subdistricts) ? (raw.subdistricts as string[]) : [],
    overlays: Array.isArray(raw.overlays) ? (raw.overlays as string[]) : [],
    caseNumbers: Array.isArray(raw.caseNumbers) ? (raw.caseNumbers as string[]) : [],
  };
  const sourceLayerHits = Array.isArray(raw.sourceLayerHits)
    ? (raw.sourceLayerHits as unknown[]).map((hit) => unpackSourceLayerHit(payload.sourceHitFields || [], hit))
    : [];
  return {
    ...raw,
    schemaVersion: String(raw.schemaVersion || "wr-parcel-zoning-index-v1"),
    sourceCountyId: String(raw.sourceCountyId || payload.sourceCountyId || activeCountyDataset.id),
    countyParcelId: String(raw.countyParcelId || ""),
    accountNum: String(raw.accountNum || ""),
    gisParcelId: String(raw.gisParcelId || ""),
    parcelChunkId: String(raw.parcelChunkId || ""),
    existingParcelZoning: String(raw.existingParcelZoning || ""),
    zoningSummary: summary,
    sourceLayerIds: Array.isArray(raw.sourceLayerIds) ? (raw.sourceLayerIds as string[]) : [],
    sourceLayerHits,
    searchText: String(raw.searchText || ""),
  };
}

export function countyAwareZoningRecordId(record: ZoningRecord): string {
  const sourceCountyId = String(record.sourceCountyId || activeCountyDataset.id).trim();
  const existingId = String(record.zoningRecordId || "").trim();
  if (existingId.includes(":")) return existingId;
  const sourceLayerId = String(record.sourceLayerId || "zoning").trim();
  const recordId = existingId || String(record.objectId || record.OBJECTID || record.id || "").trim();
  return [sourceCountyId, sourceLayerId, recordId || "unmatched"].join(":");
}

export function zoningRecordBounds(record: ZoningRecord): ZoningBounds | null {
  if (record.bounds) return record.bounds;
  if (!Array.isArray(record.centroid) || record.centroid.length < 2) return null;
  const [lng, lat] = record.centroid;
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  return {
    minLng: lng,
    minLat: lat,
    maxLng: lng,
    maxLat: lat,
  };
}

export function intersectsZoningBounds(a: ZoningBounds, b: ZoningBounds): boolean {
  return a.minLng <= b.maxLng && a.maxLng >= b.minLng && a.minLat <= b.maxLat && a.maxLat >= b.minLat;
}

export function searchZoningRecords<T extends ZoningRecord>(records: T[], search = ""): T[] {
  const query = String(search || "").trim().toLowerCase();
  if (!query) return records;
  return records.filter((record) => zoningSearchText(record).includes(query));
}

function normalizeZoningParcelId(value: unknown): string {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function parcelIndexShardKeysForQuery(parcelAccountOrCountyId: string, keyLength: number): string[] {
  const values = [
    parcelAccountOrCountyId,
    String(parcelAccountOrCountyId || "").split(":").pop() || "",
  ];
  return [...new Set(values.map(normalizeZoningParcelId).filter((value) => value.length >= keyLength).map((value) => value.slice(0, keyLength)))];
}

export function filterZoningRecordsForViewport<T extends ZoningRecord>(records: T[], options: ZoningLoadOptions = {}): T[] {
  const searched = searchZoningRecords(records, options.search ?? "");
  const visible = options.bounds
    ? searched.filter((record) => {
        const bounds = zoningRecordBounds(record);
        return bounds ? intersectsZoningBounds(bounds, options.bounds as ZoningBounds) : false;
      })
    : searched;
  return visible.slice(0, options.maxFeatures ?? MAX_ZONING_FEATURES_PER_VIEWPORT);
}

export async function loadZoningManifest(serviceBase = DEFAULT_ZONING_SERVICE_BASE): Promise<ZoningManifest> {
  const base = zoningServiceBase(serviceBase);
  if (!manifestPromises.has(base)) {
    manifestPromises.set(
      base,
      requestJson<ZoningManifest>(`${base}manifest.json`).then((response) => {
        if (!response.ok) throw new Error(`Unable to load zoning manifest: ${response.status}`);
        return response.json();
      }),
    );
  }
  return manifestPromises.get(base) as Promise<ZoningManifest>;
}

async function loadZoningChunk(chunk: ZoningChunk, serviceBase = DEFAULT_ZONING_SERVICE_BASE): Promise<ZoningRecord[]> {
  const base = zoningServiceBase(serviceBase);
  const cacheKey = `${base}:${chunk.id}`;
  if (!chunkCache.has(cacheKey)) {
    chunkCache.set(
      cacheKey,
      requestJson<{ zoningRecords?: ZoningRecord[]; records?: ZoningRecord[] }>(`${base}${chunk.file}`).then((response) => {
        if (!response.ok) throw new Error(`Unable to load zoning chunk ${chunk.id}: ${response.status}`);
        return response.json().then((payload) => payload.zoningRecords || payload.records || []);
      }),
    );
  }
  return chunkCache.get(cacheKey) as Promise<ZoningRecord[]>;
}

async function loadParcelZoningShard(file: string, manifest: ZoningManifest, serviceBase = DEFAULT_ZONING_SERVICE_BASE): Promise<ParcelZoningRecord[]> {
  const base = zoningServiceBase(serviceBase);
  const cacheKey = `${base}:${file}`;
  if (!parcelIndexShardCache.has(cacheKey)) {
    parcelIndexShardCache.set(
      cacheKey,
      requestJson<{ fields?: string[]; sourceHitFields?: string[]; records?: unknown[] }>(`${base}${file}`).then((response) => {
        if (!response.ok) throw new Error(`Unable to load parcel zoning shard ${file}: ${response.status}`);
        return response.json().then((payload) => {
          const fields = payload.fields || manifest.parcelIndexShards?.fields || [];
          const sourceHitFields = payload.sourceHitFields || manifest.parcelIndexShards?.sourceHitFields || [];
          return (payload.records || []).map((record) => unpackParcelZoningRecord({ fields, sourceHitFields, sourceCountyId: manifest.sourceCountyId }, record));
        });
      }),
    );
  }
  return parcelIndexShardCache.get(cacheKey) as Promise<ParcelZoningRecord[]>;
}

function chunkForId(manifest: ZoningManifest, chunkId: unknown): ZoningChunk | null {
  const id = String(chunkId || "").trim();
  if (!id) return null;
  return manifest.chunks.find((chunk) => chunk.id === id) || null;
}

export async function loadZoningRecordsForViewport(options: ZoningLoadOptions = {}): Promise<ZoningRecord[]> {
  const base = zoningServiceBase(options.serviceBase);
  const manifest = await loadZoningManifest(base);
  if (manifest.renderDirectlyInBrowser || manifest.defaultVisible) {
    throw new Error("Zoning manifest is not configured as an optional, viewport-safe layer.");
  }
  const maxFeatures = Math.min(options.maxFeatures ?? manifest.maxFeaturesPerViewport ?? MAX_ZONING_FEATURES_PER_VIEWPORT, MAX_ZONING_FEATURES_PER_VIEWPORT);
  const chunks = options.bounds
    ? manifest.chunks.filter((chunk) => chunk.bounds && intersectsZoningBounds(chunk.bounds, options.bounds as ZoningBounds))
    : manifest.chunks;
  const records: ZoningRecord[] = [];
  for (const chunk of chunks) {
    const chunkRecords = await loadZoningChunk(chunk, base);
    records.push(...filterZoningRecordsForViewport(chunkRecords, { ...options, maxFeatures }));
    if (records.length >= maxFeatures) break;
  }
  return records.slice(0, maxFeatures);
}

export async function searchFullZoningRecords(search: string, maxFeatures = 250, serviceBase = DEFAULT_ZONING_SERVICE_BASE): Promise<ZoningRecord[]> {
  const query = String(search || "").trim();
  if (!query) return [];
  const base = zoningServiceBase(serviceBase);
  const manifest = await loadZoningManifest(base);
  if (!searchIndexPromises.has(base)) {
    searchIndexPromises.set(
      base,
      requestJson<{ zoningRecords?: ZoningRecord[]; records?: ZoningRecord[] }>(`${base}${manifest.searchIndex}`).then((response) => {
        if (!response.ok) throw new Error(`Unable to load zoning search index: ${response.status}`);
        return response.json().then((payload) => payload.zoningRecords || payload.records || []);
      }),
    );
  }
  return searchZoningRecords(await (searchIndexPromises.get(base) as Promise<ZoningRecord[]>), query).slice(0, maxFeatures);
}

export async function loadParcelZoningSummary(parcelAccountOrCountyId: string, serviceBase = DEFAULT_ZONING_SERVICE_BASE): Promise<ParcelZoningRecord | null> {
  const query = String(parcelAccountOrCountyId || "").trim();
  if (!query) return null;
  const base = zoningServiceBase(serviceBase);
  const manifest = await loadZoningManifest(base);
  const shardFiles = manifest.parcelIndexShards?.files || {};
  const shardKeys = parcelIndexShardKeysForQuery(query, manifest.parcelIndexShards?.keyLength || 2);
  const normalizedQuery = normalizeZoningParcelId(query);
  const normalizedAccount = normalizeZoningParcelId(query.split(":").pop() || query);
  for (const key of shardKeys) {
    const file = shardFiles[key];
    if (!file) continue;
    const records = await loadParcelZoningShard(file, manifest, base);
    const hit = records.find((record) => {
      return [record.countyParcelId, record.accountNum, record.gisParcelId].map(normalizeZoningParcelId).some((id) => id === normalizedQuery || id === normalizedAccount);
    });
    if (hit) return hit;
  }
  return null;
}

export async function loadParcelZoningSummaries(parcelAccountOrCountyIds: string[], maxParcels = 750, serviceBase = DEFAULT_ZONING_SERVICE_BASE): Promise<Map<string, ParcelZoningRecord>> {
  const queries = [...new Set(parcelAccountOrCountyIds.map((value) => String(value || "").trim()).filter(Boolean))].slice(0, maxParcels);
  const results = new Map<string, ParcelZoningRecord>();
  if (!queries.length) return results;

  const base = zoningServiceBase(serviceBase);
  const manifest = await loadZoningManifest(base);
  if (manifest.renderDirectlyInBrowser || manifest.defaultVisible) {
    throw new Error("Zoning manifest is not configured as an optional, parcel-safe layer.");
  }

  const keyLength = manifest.parcelIndexShards?.keyLength || 2;
  const shardFiles = manifest.parcelIndexShards?.files || {};
  const normalizedLookupsByShard = new Map<string, Map<string, string[]>>();

  queries.forEach((query) => {
    const normalizedValues = [
      normalizeZoningParcelId(query),
      normalizeZoningParcelId(query.split(":").pop() || query),
    ].filter(Boolean);
    const keys = parcelIndexShardKeysForQuery(query, keyLength);
    keys.forEach((key) => {
      if (!shardFiles[key]) return;
      if (!normalizedLookupsByShard.has(key)) normalizedLookupsByShard.set(key, new Map());
      const lookups = normalizedLookupsByShard.get(key) as Map<string, string[]>;
      normalizedValues.forEach((normalized) => {
        const originals = lookups.get(normalized) || [];
        originals.push(query);
        lookups.set(normalized, originals);
      });
    });
  });

  const shardKeys = [...normalizedLookupsByShard.keys()];
  const batchSize = 24;
  for (let index = 0; index < shardKeys.length; index += batchSize) {
    const batch = shardKeys.slice(index, index + batchSize);
    const shardPayloads = await Promise.all(
      batch.map(async (key) => ({
        key,
        records: await loadParcelZoningShard(shardFiles[key], manifest, base),
      })),
    );

    shardPayloads.forEach(({ key, records }) => {
      const lookups = normalizedLookupsByShard.get(key);
      if (!lookups) return;
      records.forEach((record) => {
        const recordIds = [record.countyParcelId, record.accountNum, record.gisParcelId].map(normalizeZoningParcelId).filter(Boolean);
        const matchedOriginals = new Set<string>();
        recordIds.forEach((recordId) => {
          (lookups.get(recordId) || []).forEach((original) => matchedOriginals.add(original));
        });
        if (!matchedOriginals.size) return;
        const directKeys = [record.countyParcelId, record.accountNum, record.gisParcelId].map((value) => String(value || "").trim()).filter(Boolean);
        matchedOriginals.forEach((original) => results.set(original, record));
        directKeys.forEach((directKey) => results.set(directKey, record));
      });
    });
  }

  return results;
}

export async function loadZoningRecordsForParcel(parcelAccountOrGisId: string, maxFeatures = 250, serviceBase = DEFAULT_ZONING_SERVICE_BASE): Promise<ZoningRecord[]> {
  const parcelId = String(parcelAccountOrGisId || "").trim();
  if (!parcelId) return [];
  const base = zoningServiceBase(serviceBase);
  const parcelSummary = await loadParcelZoningSummary(parcelId, base);
  if (parcelSummary?.sourceLayerHits?.length) return parcelSummary.sourceLayerHits.slice(0, maxFeatures);
  const manifest = await loadZoningManifest(base);
  const hits = (await searchFullZoningRecords(parcelId, maxFeatures, base)).filter((record) => {
    return String(record.accountNum || "") === parcelId || String(record.gisParcelId || "") === parcelId || String(record.countyParcelId || "") === parcelId;
  });
  const chunkIds = Array.from(new Set(hits.map((record) => String(record.chunkId || "").trim()).filter(Boolean)));
  if (!chunkIds.length) return hits.slice(0, maxFeatures);

  const hydrated: ZoningRecord[] = [];
  const hitIds = new Set(hits.map(countyAwareZoningRecordId));
  for (const chunkId of chunkIds) {
    const chunk = chunkForId(manifest, chunkId);
    if (!chunk) continue;
    const records = await loadZoningChunk(chunk, base);
    hydrated.push(...records.filter((record) => hitIds.has(countyAwareZoningRecordId(record))));
  }
  return (hydrated.length ? hydrated : hits).slice(0, maxFeatures);
}

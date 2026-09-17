import { activeCountyDataset } from "../data/countyConfig";
import { requestJson } from "./http";

export type FloodplainSourceHit = Record<string, unknown> & {
  sourceLayerId?: string;
  sourceLayerTitle?: string;
  objectId?: string | number;
  floodZone?: string;
  zoneSubtype?: string;
  sfha?: string;
  staticBfe?: string;
  verticalDatum?: string;
  depth?: string;
  lengthUnit?: string;
  velocity?: string;
  velocityUnit?: string;
  sourceCitation?: string;
  gfid?: string;
};

export type ParcelFloodplainSummary = {
  label?: string;
  floodZones: string[];
  zoneSubtypes: string[];
  sfha: string[];
  baseFloodElevations: string[];
  verticalDatums: string[];
  depths: string[];
  velocities: string[];
  sourceCitations: string[];
};

export type ParcelFloodplainRecord = Record<string, unknown> & {
  schemaVersion?: string;
  sourceCountyId?: string;
  countyParcelId?: string;
  accountNum?: string;
  gisParcelId?: string;
  parcelChunkId?: string;
  floodplainSummary: ParcelFloodplainSummary;
  sourceLayerIds: string[];
  sourceLayerHits: FloodplainSourceHit[];
  searchText?: string;
};

export type FloodplainManifest = {
  schemaVersion: string;
  recordSchemaVersion: string;
  sourceCountyId: string;
  status: string;
  defaultVisible: boolean;
  renderDirectlyInBrowser: boolean;
  publicDataRoot: string;
  maxFeaturesPerViewport: number;
  parcelIndex: string;
  parcelIndexCount: number;
  parcelIndexShards?: {
    keyLength: number;
    fields: string[];
    sourceHitFields: string[];
    files: Record<string, string>;
    counts?: Record<string, number>;
  };
};

const DEFAULT_FLOODPLAIN_SERVICE_BASE = activeCountyDataset.dataRoots.floodplain || "/data/floodplain/";
const floodplainManifestPromises = new Map<string, Promise<FloodplainManifest>>();
const parcelFloodplainShardCache = new Map<string, Promise<ParcelFloodplainRecord[]>>();

function floodplainServiceBase(serviceBase = DEFAULT_FLOODPLAIN_SERVICE_BASE): string {
  const normalized = String(serviceBase || DEFAULT_FLOODPLAIN_SERVICE_BASE).trim() || DEFAULT_FLOODPLAIN_SERVICE_BASE;
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function unpackFloodplainSourceHit(fields: string[], values: unknown): FloodplainSourceHit {
  if (!Array.isArray(values)) return values as FloodplainSourceHit;
  const record: FloodplainSourceHit = {};
  fields.forEach((field, index) => {
    const value = values[index];
    if (value !== "" && value !== null && value !== undefined) record[field] = value as never;
  });
  return record;
}

function unpackParcelFloodplainRecord(payload: { fields?: string[]; sourceHitFields?: string[]; sourceCountyId?: string }, values: unknown): ParcelFloodplainRecord {
  if (!Array.isArray(values)) return values as ParcelFloodplainRecord;
  const raw: Record<string, unknown> = {};
  payload.fields?.forEach((field, index) => {
    const value = values[index];
    if (value !== "" && value !== null && value !== undefined) raw[field] = value;
  });
  const summary: ParcelFloodplainSummary = {
    label: String(raw.label || ""),
    floodZones: Array.isArray(raw.floodZones) ? (raw.floodZones as string[]) : [],
    zoneSubtypes: Array.isArray(raw.zoneSubtypes) ? (raw.zoneSubtypes as string[]) : [],
    sfha: Array.isArray(raw.sfha) ? (raw.sfha as string[]) : [],
    baseFloodElevations: Array.isArray(raw.baseFloodElevations) ? (raw.baseFloodElevations as string[]) : [],
    verticalDatums: Array.isArray(raw.verticalDatums) ? (raw.verticalDatums as string[]) : [],
    depths: Array.isArray(raw.depths) ? (raw.depths as string[]) : [],
    velocities: Array.isArray(raw.velocities) ? (raw.velocities as string[]) : [],
    sourceCitations: Array.isArray(raw.sourceCitations) ? (raw.sourceCitations as string[]) : [],
  };
  const sourceLayerHits = Array.isArray(raw.sourceLayerHits)
    ? (raw.sourceLayerHits as unknown[]).map((hit) => unpackFloodplainSourceHit(payload.sourceHitFields || [], hit))
    : [];
  return {
    ...raw,
    schemaVersion: String(raw.schemaVersion || "wr-parcel-floodplain-index-v1"),
    sourceCountyId: String(raw.sourceCountyId || payload.sourceCountyId || activeCountyDataset.id),
    countyParcelId: String(raw.countyParcelId || ""),
    accountNum: String(raw.accountNum || ""),
    gisParcelId: String(raw.gisParcelId || ""),
    parcelChunkId: String(raw.parcelChunkId || ""),
    floodplainSummary: summary,
    sourceLayerIds: Array.isArray(raw.sourceLayerIds) ? (raw.sourceLayerIds as string[]) : [],
    sourceLayerHits,
    searchText: String(raw.searchText || ""),
  };
}

function normalizeFloodplainParcelId(value: unknown): string {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function parcelIndexShardKeysForQuery(parcelAccountOrCountyId: string, keyLength: number): string[] {
  const values = [
    parcelAccountOrCountyId,
    String(parcelAccountOrCountyId || "").split(":").pop() || "",
  ];
  return [...new Set(values.map(normalizeFloodplainParcelId).filter((value) => value.length >= keyLength).map((value) => value.slice(0, keyLength)))];
}

export async function loadFloodplainManifest(serviceBase = DEFAULT_FLOODPLAIN_SERVICE_BASE): Promise<FloodplainManifest> {
  const base = floodplainServiceBase(serviceBase);
  if (!floodplainManifestPromises.has(base)) {
    floodplainManifestPromises.set(
      base,
      requestJson<FloodplainManifest>(`${base}manifest.json`).then((response) => {
        if (!response.ok) throw new Error(`Unable to load floodplain manifest: ${response.status}`);
        return response.json();
      }),
    );
  }
  return floodplainManifestPromises.get(base) as Promise<FloodplainManifest>;
}

async function loadParcelFloodplainShard(file: string, manifest: FloodplainManifest, serviceBase = DEFAULT_FLOODPLAIN_SERVICE_BASE): Promise<ParcelFloodplainRecord[]> {
  const base = floodplainServiceBase(serviceBase);
  const cacheKey = `${base}:${file}`;
  if (!parcelFloodplainShardCache.has(cacheKey)) {
    parcelFloodplainShardCache.set(
      cacheKey,
      requestJson<{ fields?: string[]; sourceHitFields?: string[]; records?: unknown[] }>(`${base}${file}`).then((response) => {
        if (!response.ok) throw new Error(`Unable to load parcel floodplain shard ${file}: ${response.status}`);
        return response.json().then((payload) => {
          const fields = payload.fields || manifest.parcelIndexShards?.fields || [];
          const sourceHitFields = payload.sourceHitFields || manifest.parcelIndexShards?.sourceHitFields || [];
          return (payload.records || []).map((record) => unpackParcelFloodplainRecord({ fields, sourceHitFields, sourceCountyId: manifest.sourceCountyId }, record));
        });
      }),
    );
  }
  return parcelFloodplainShardCache.get(cacheKey) as Promise<ParcelFloodplainRecord[]>;
}

export async function loadParcelFloodplainSummary(parcelAccountOrCountyId: string, serviceBase = DEFAULT_FLOODPLAIN_SERVICE_BASE): Promise<ParcelFloodplainRecord | null> {
  const query = String(parcelAccountOrCountyId || "").trim();
  if (!query) return null;
  const base = floodplainServiceBase(serviceBase);
  const manifest = await loadFloodplainManifest(base);
  if (manifest.renderDirectlyInBrowser || manifest.defaultVisible) {
    throw new Error("Floodplain manifest is not configured as an optional, parcel-safe layer.");
  }
  const shardFiles = manifest.parcelIndexShards?.files || {};
  const shardKeys = parcelIndexShardKeysForQuery(query, manifest.parcelIndexShards?.keyLength || 2);
  const normalizedQuery = normalizeFloodplainParcelId(query);
  const normalizedAccount = normalizeFloodplainParcelId(query.split(":").pop() || query);
  for (const key of shardKeys) {
    const file = shardFiles[key];
    if (!file) continue;
    const records = await loadParcelFloodplainShard(file, manifest, base);
    const hit = records.find((record) => {
      return [record.countyParcelId, record.accountNum, record.gisParcelId].map(normalizeFloodplainParcelId).some((id) => id === normalizedQuery || id === normalizedAccount);
    });
    if (hit) return hit;
  }
  return null;
}

export async function loadParcelFloodplainSummaries(parcelAccountOrCountyIds: string[], maxParcels = 750, serviceBase = DEFAULT_FLOODPLAIN_SERVICE_BASE): Promise<Map<string, ParcelFloodplainRecord>> {
  const queries = [...new Set(parcelAccountOrCountyIds.map((value) => String(value || "").trim()).filter(Boolean))].slice(0, maxParcels);
  const results = new Map<string, ParcelFloodplainRecord>();
  if (!queries.length) return results;

  const base = floodplainServiceBase(serviceBase);
  const manifest = await loadFloodplainManifest(base);
  if (manifest.renderDirectlyInBrowser || manifest.defaultVisible) {
    throw new Error("Floodplain manifest is not configured as an optional, parcel-safe layer.");
  }

  const keyLength = manifest.parcelIndexShards?.keyLength || 2;
  const shardFiles = manifest.parcelIndexShards?.files || {};
  const normalizedLookupsByShard = new Map<string, Map<string, string[]>>();

  queries.forEach((query) => {
    const normalizedValues = [
      normalizeFloodplainParcelId(query),
      normalizeFloodplainParcelId(query.split(":").pop() || query),
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
        records: await loadParcelFloodplainShard(shardFiles[key], manifest, base),
      })),
    );

    shardPayloads.forEach(({ key, records }) => {
      const lookups = normalizedLookupsByShard.get(key);
      if (!lookups) return;
      records.forEach((record) => {
        const recordIds = [record.countyParcelId, record.accountNum, record.gisParcelId].map(normalizeFloodplainParcelId).filter(Boolean);
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

export async function loadFloodplainRecordsForParcel(parcelAccountOrCountyId: string, maxFeatures = 250, serviceBase = DEFAULT_FLOODPLAIN_SERVICE_BASE): Promise<FloodplainSourceHit[]> {
  const parcelSummary = await loadParcelFloodplainSummary(parcelAccountOrCountyId, serviceBase);
  if (!parcelSummary?.sourceLayerHits?.length) return [];
  return parcelSummary.sourceLayerHits.slice(0, maxFeatures);
}

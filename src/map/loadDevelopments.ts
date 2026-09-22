import { activeCountyDataset } from "../data/countyConfig";
import { requestJson } from "./http";

export type DevelopmentParcelRecord = {
  parcelId: string;
  parcelGisId?: string;
  parcelAddress?: string;
  parcelPropertyName?: string;
  signalCount?: number;
  score?: number;
  latestActivityDate?: string;
  signalTypes?: string[];
  stages?: string[];
};

type DevelopmentShardEntry = { count: number; files: string[] };
type DevelopmentServiceManifest = {
  schemaVersion: "wr-development-parcel-service-v1";
  parcelCount: number;
  shardKeyLength: number;
  maxRecordsPerFile: number;
  maxShardBytes: number;
  recordShards: Record<string, DevelopmentShardEntry>;
  searchShards: Record<string, DevelopmentShardEntry>;
};

const DEFAULT_SERVICE_ROOT = activeCountyDataset.dataRoots.developments || "/data/developments/";
export const MAX_DEVELOPMENT_QUERY_RECORDS = 6000;
const manifestPromises = new Map<string, Promise<DevelopmentServiceManifest>>();
const shardPromises = new Map<string, Promise<DevelopmentParcelRecord[]>>();

function developmentServiceRoot(serviceRoot = DEFAULT_SERVICE_ROOT): string {
  const normalized = String(serviceRoot || DEFAULT_SERVICE_ROOT).trim() || DEFAULT_SERVICE_ROOT;
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function loadManifest(serviceRoot = DEFAULT_SERVICE_ROOT): Promise<DevelopmentServiceManifest> {
  const root = developmentServiceRoot(serviceRoot);
  if (!manifestPromises.has(root)) {
    manifestPromises.set(root, requestJson<DevelopmentServiceManifest>(`${root}manifest.json`).then(async (response) => {
      if (!response.ok) throw new Error(`Unable to load development service manifest: ${response.status}`);
      return response.json();
    }));
  }
  return manifestPromises.get(root) as Promise<DevelopmentServiceManifest>;
}

function normalize(value: unknown): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function shardKey(value: unknown, length: number): string {
  return normalize(value).slice(0, length) || "__";
}

function searchShardKeys(query: string, length: number): string[] {
  const keys = new Set<string>();
  const values = [query, ...query.toLowerCase().split(/[^a-z0-9]+/)];
  for (const value of values) {
    const key = shardKey(value, length);
    if (key !== "__" && key.length >= length) keys.add(key);
  }
  return [...keys];
}

async function loadShard(file: string, serviceRoot = DEFAULT_SERVICE_ROOT): Promise<DevelopmentParcelRecord[]> {
  const root = developmentServiceRoot(serviceRoot);
  const cacheKey = `${root}:${file}`;
  if (!shardPromises.has(cacheKey)) {
    shardPromises.set(cacheKey, requestJson<{ records?: DevelopmentParcelRecord[] }>(`${root}${file}`).then(async (response) => {
      if (!response.ok) throw new Error(`Unable to load development shard: ${response.status}`);
      return (await response.json()).records || [];
    }));
  }
  return shardPromises.get(cacheKey) as Promise<DevelopmentParcelRecord[]>;
}

function searchText(record: DevelopmentParcelRecord): string {
  return [record.parcelPropertyName, record.parcelAddress, record.parcelId, record.parcelGisId, record.latestActivityDate, ...(record.signalTypes || []), ...(record.stages || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export async function loadDevelopmentRecordsForParcels(parcelIds: string[], maxParcels = 750, serviceRoot = DEFAULT_SERVICE_ROOT): Promise<DevelopmentParcelRecord[]> {
  const root = developmentServiceRoot(serviceRoot);
  const manifest = await loadManifest(root);
  const wanted = new Set(parcelIds.slice(0, maxParcels).map((id) => String(id || "").trim()).filter(Boolean));
  const files = new Set<string>();
  for (const id of wanted) {
    for (const file of manifest.recordShards[shardKey(id, manifest.shardKeyLength)]?.files || []) files.add(file);
  }
  const records = (await Promise.all([...files].map((file) => loadShard(file, root)))).flat();
  return records.filter((record) => wanted.has(String(record.parcelId)) || wanted.has(String(record.parcelGisId || "")));
}

export async function searchDevelopmentRecords(query: string, maxResults = 7, serviceRoot = DEFAULT_SERVICE_ROOT): Promise<DevelopmentParcelRecord[]> {
  const trimmed = String(query || "").trim();
  if (trimmed.length < 2) return [];
  const root = developmentServiceRoot(serviceRoot);
  const manifest = await loadManifest(root);
  const files = [];
  let plannedRecords = 0;
  for (const key of searchShardKeys(trimmed, manifest.shardKeyLength)) {
    const shard = manifest.searchShards[key];
    if (!shard) continue;
    for (const file of shard.files) {
      if (plannedRecords >= MAX_DEVELOPMENT_QUERY_RECORDS) break;
      files.push(file);
      plannedRecords += manifest.maxRecordsPerFile;
    }
  }
  const normalizedQuery = trimmed.toLowerCase();
  const seen = new Set<string>();
  return (await Promise.all(files.map((file) => loadShard(file, root))))
    .flat()
    .filter((record) => searchText(record).includes(normalizedQuery))
    .filter((record) => {
      const id = String(record.parcelId);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, maxResults);
}

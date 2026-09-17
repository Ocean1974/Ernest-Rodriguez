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

const SERVICE_ROOT = "/data/developments/";
export const MAX_DEVELOPMENT_QUERY_RECORDS = 6000;
let manifestPromise: Promise<DevelopmentServiceManifest> | null = null;
const shardPromises = new Map<string, Promise<DevelopmentParcelRecord[]>>();

function loadManifest(): Promise<DevelopmentServiceManifest> {
  if (!manifestPromise) {
    manifestPromise = requestJson<DevelopmentServiceManifest>(`${SERVICE_ROOT}manifest.json`).then(async (response) => {
      if (!response.ok) throw new Error(`Unable to load development service manifest: ${response.status}`);
      return response.json();
    });
  }
  return manifestPromise;
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

async function loadShard(file: string): Promise<DevelopmentParcelRecord[]> {
  if (!shardPromises.has(file)) {
    shardPromises.set(file, requestJson<{ records?: DevelopmentParcelRecord[] }>(`${SERVICE_ROOT}${file}`).then(async (response) => {
      if (!response.ok) throw new Error(`Unable to load development shard: ${response.status}`);
      return (await response.json()).records || [];
    }));
  }
  return shardPromises.get(file) as Promise<DevelopmentParcelRecord[]>;
}

function searchText(record: DevelopmentParcelRecord): string {
  return [record.parcelPropertyName, record.parcelAddress, record.parcelId, record.parcelGisId, record.latestActivityDate, ...(record.signalTypes || []), ...(record.stages || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export async function loadDevelopmentRecordsForParcels(parcelIds: string[], maxParcels = 750): Promise<DevelopmentParcelRecord[]> {
  const manifest = await loadManifest();
  const wanted = new Set(parcelIds.slice(0, maxParcels).map((id) => String(id || "").trim()).filter(Boolean));
  const files = new Set<string>();
  for (const id of wanted) {
    for (const file of manifest.recordShards[shardKey(id, manifest.shardKeyLength)]?.files || []) files.add(file);
  }
  const records = (await Promise.all([...files].map(loadShard))).flat();
  return records.filter((record) => wanted.has(String(record.parcelId)) || wanted.has(String(record.parcelGisId || "")));
}

export async function searchDevelopmentRecords(query: string, maxResults = 7): Promise<DevelopmentParcelRecord[]> {
  const trimmed = String(query || "").trim();
  if (trimmed.length < 2) return [];
  const manifest = await loadManifest();
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
  return (await Promise.all(files.map(loadShard)))
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

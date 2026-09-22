import { permitsForParcel, searchPermitRecords } from "./permitSearch";
import { requestJson } from "./http";
import { activeCountyDataset } from "../data/countyConfig";

export type PermitBounds = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

export type PermitRecord = Record<string, unknown> & {
  permitRecordId?: string;
  sourceDataset?: string;
  permitNumber?: string;
  permitType?: string;
  permitSubtype?: string;
  permitStatus?: string;
  address?: string;
  description?: string;
  contractor?: string;
  parcelAccountNum?: string;
  parcelGisId?: string;
  latitude?: number | null;
  longitude?: number | null;
  issueDate?: string;
  searchText?: string;
  chunkId?: string;
};

export type PermitChunk = {
  id: string;
  file: string;
  count: number;
  bounds: PermitBounds | null;
};

export type PermitManifest = {
  permitCount: number;
  locatedPermitCount: number;
  joinedPermitCount: number;
  unmatchedPermitCount: number;
  chunkCount: number;
  chunks: PermitChunk[];
  searchIndex: string;
  searchIndexCount: number;
  parcelSearchShards?: { keyLength: number; files: Record<string, string> };
};

export type PermitLoadOptions = {
  bounds?: PermitBounds;
  search?: string;
  maxFeatures?: number;
  serviceBase?: string;
};

const DEFAULT_PERMIT_SERVICE_BASE = activeCountyDataset.dataRoots.permits;
const manifestPromises = new Map<string, Promise<PermitManifest>>();
const searchIndexPromises = new Map<string, Promise<PermitRecord[]>>();
const chunkCache = new Map<string, Promise<PermitRecord[]>>();
const parcelShardCache = new Map<string, Promise<PermitRecord[]>>();

function permitServiceBase(serviceBase = DEFAULT_PERMIT_SERVICE_BASE): string {
  const normalized = String(serviceBase || DEFAULT_PERMIT_SERVICE_BASE).trim() || DEFAULT_PERMIT_SERVICE_BASE;
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

export function permitRecordBounds(permit: PermitRecord): PermitBounds | null {
  if (typeof permit.longitude !== "number" || typeof permit.latitude !== "number") return null;
  return {
    minLng: permit.longitude,
    minLat: permit.latitude,
    maxLng: permit.longitude,
    maxLat: permit.latitude,
  };
}

export function intersectsPermitBounds(a: PermitBounds, b: PermitBounds): boolean {
  return a.minLng <= b.maxLng && a.maxLng >= b.minLng && a.minLat <= b.maxLat && a.maxLat >= b.minLat;
}

export function filterPermitRecordsForViewport<T extends PermitRecord>(permits: T[], options: PermitLoadOptions = {}): T[] {
  const searched = searchPermitRecords(permits, options.search ?? "");
  const visible = options.bounds
    ? searched.filter((permit) => {
        const bounds = permitRecordBounds(permit);
        return bounds ? intersectsPermitBounds(bounds, options.bounds as PermitBounds) : false;
      })
    : searched;
  return visible.slice(0, options.maxFeatures ?? 1000);
}

export async function loadPermitManifest(serviceBase = DEFAULT_PERMIT_SERVICE_BASE): Promise<PermitManifest> {
  const base = permitServiceBase(serviceBase);
  if (!manifestPromises.has(base)) {
    manifestPromises.set(
      base,
      requestJson<PermitManifest>(`${base}manifest.json`).then((response) => {
        if (!response.ok) throw new Error(`Unable to load permit manifest: ${response.status}`);
        return response.json();
      }),
    );
  }
  return manifestPromises.get(base) as Promise<PermitManifest>;
}

async function loadPermitChunk(chunk: PermitChunk, serviceBase = DEFAULT_PERMIT_SERVICE_BASE): Promise<PermitRecord[]> {
  const base = permitServiceBase(serviceBase);
  const cacheKey = `${base}:${chunk.id}`;
  if (!chunkCache.has(cacheKey)) {
    chunkCache.set(
      cacheKey,
      requestJson<{ permits?: PermitRecord[] }>(`${base}${chunk.file}`).then((response) => {
        if (!response.ok) throw new Error(`Unable to load permit chunk ${chunk.id}: ${response.status}`);
        return response.json().then((payload) => payload.permits || []);
      }),
    );
  }
  return chunkCache.get(cacheKey) as Promise<PermitRecord[]>;
}

function chunkForId(manifest: PermitManifest, chunkId: unknown): PermitChunk | null {
  const id = String(chunkId || "").trim();
  if (!id) return null;
  return manifest.chunks.find((chunk) => chunk.id === id) || null;
}

export async function loadPermitRecordsForViewport(options: PermitLoadOptions = {}): Promise<PermitRecord[]> {
  const base = permitServiceBase(options.serviceBase);
  const manifest = await loadPermitManifest(base);
  const maxFeatures = options.maxFeatures ?? 1000;
  const chunks = options.bounds
    ? manifest.chunks.filter((chunk) => chunk.bounds && intersectsPermitBounds(chunk.bounds, options.bounds as PermitBounds))
    : manifest.chunks;
  const permits: PermitRecord[] = [];
  for (const chunk of chunks) {
    const records = await loadPermitChunk(chunk, base);
    permits.push(...filterPermitRecordsForViewport(records, { ...options, maxFeatures }));
    if (permits.length >= maxFeatures) break;
  }
  return permits.slice(0, maxFeatures);
}

export async function searchFullPermitRecords(search: string, maxFeatures = 250, serviceBase = DEFAULT_PERMIT_SERVICE_BASE): Promise<PermitRecord[]> {
  const query = String(search || "").trim();
  if (!query) return [];
  const base = permitServiceBase(serviceBase);
  const manifest = await loadPermitManifest(base);
  if (!searchIndexPromises.has(base)) {
    searchIndexPromises.set(
      base,
      requestJson<{ permits?: PermitRecord[] }>(`${base}${manifest.searchIndex}`).then((response) => {
        if (!response.ok) throw new Error(`Unable to load permit search index: ${response.status}`);
        return response.json().then((payload) => payload.permits || []);
      }),
    );
  }
  return searchPermitRecords(await (searchIndexPromises.get(base) as Promise<PermitRecord[]>), query).slice(0, maxFeatures);
}

export async function loadPermitsForParcel(parcelAccountNum: string, maxFeatures = 250, serviceBase = DEFAULT_PERMIT_SERVICE_BASE): Promise<PermitRecord[]> {
  const account = String(parcelAccountNum || "").trim();
  if (!account) return [];
  const base = permitServiceBase(serviceBase);
  const manifest = await loadPermitManifest(base);
  let searchableRecords: PermitRecord[];
  if (manifest.parcelSearchShards) {
    const normalized = account.toLowerCase().replace(/[^a-z0-9]/g, "");
    const file = manifest.parcelSearchShards.files[normalized.slice(0, manifest.parcelSearchShards.keyLength) || "__"];
    if (!file) return [];
    const cacheKey = `${base}:${file}`;
    if (!parcelShardCache.has(cacheKey)) {
      parcelShardCache.set(cacheKey, requestJson<{ permits?: PermitRecord[] }>(`${base}${file}`).then(async (response) => {
        if (!response.ok) throw new Error(`Unable to load permit parcel shard: ${response.status}`);
        return (await response.json()).permits || [];
      }));
    }
    searchableRecords = await (parcelShardCache.get(cacheKey) as Promise<PermitRecord[]>);
  } else {
    searchableRecords = await searchFullPermitRecords(account, maxFeatures, base);
  }
  const hits = permitsForParcel(searchableRecords, account).slice(0, maxFeatures);
  const chunkIds = Array.from(new Set(hits.map((permit) => String(permit.chunkId || "").trim()).filter(Boolean)));
  if (!chunkIds.length) return hits;

  const hydratedPermits: PermitRecord[] = [];
  const hitIds = new Set(hits.map((permit) => String(permit.permitRecordId || "").trim()).filter(Boolean));
  for (const chunkId of chunkIds) {
    const chunk = chunkForId(manifest, chunkId);
    if (!chunk) continue;
    const records = await loadPermitChunk(chunk, base);
    hydratedPermits.push(
      ...records.filter((permit) => {
        const recordId = String(permit.permitRecordId || "").trim();
        if (recordId && hitIds.has(recordId)) return true;
        return permitsForParcel([permit], account).length > 0;
      }),
    );
  }

  return (hydratedPermits.length ? hydratedPermits : hits).slice(0, maxFeatures);
}

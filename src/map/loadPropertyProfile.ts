import { activeCountyDataset } from "../data/countyConfig";
import { loadParcelIntelligenceSummary } from "./loadParcelIntelligence";
import { countyAwareParcelId, searchFullParcelRecords, type ParcelRecord, type ParcelServiceDataset } from "./loadParcels";
import { loadPermitsForParcel } from "./loadPermits";
import { parseWhiteRabbitPropertyId } from "./propertyIdentity";
import { buildPropertyProfile, type PropertyProfile } from "./propertyProfileContract.mjs";

export type PropertyProfileLoadOptions = {
  dataset?: ParcelServiceDataset;
  includeIntelligence?: boolean;
  includePermits?: boolean;
  maxPermits?: number;
};

function clean(value: unknown): string {
  return String(value || "").trim();
}

function exactParcelMatch(records: ParcelRecord[], identifier: string, sourceParcelId: string): ParcelRecord | null {
  const normalizedIdentifier = clean(identifier).toLowerCase();
  const normalizedSourceId = clean(sourceParcelId).toUpperCase();
  return records.find((record) => {
    const ids = [record.whiteRabbitPropertyId, countyAwareParcelId(record), record.accountNum, record.accountNumber, record.gisParcelId]
      .map((value) => clean(value));
    return ids.some((value) => value.toLowerCase() === normalizedIdentifier || value.toUpperCase() === normalizedSourceId);
  }) || null;
}

function errorText(prefix: string, result: PromiseSettledResult<unknown>): string {
  if (result.status !== "rejected") return "";
  const message = result.reason instanceof Error ? result.reason.message : String(result.reason || "Unknown error");
  return `${prefix}: ${message}`;
}

export async function loadPropertyProfile(identifier: string, options: PropertyProfileLoadOptions = {}): Promise<PropertyProfile> {
  const dataset = options.dataset || activeCountyDataset;
  const requested = clean(identifier);
  const parsed = parseWhiteRabbitPropertyId(requested);
  const sourceParcelId = parsed?.sourceParcelId || requested.split(":").pop() || requested;
  const datasetId = clean(dataset.id || activeCountyDataset.id).toLowerCase();

  if (!requested || (parsed && parsed.sourceCountyId !== datasetId)) {
    return buildPropertyProfile({ errors: parsed ? [`identity: ${parsed.sourceCountyId} does not match ${datasetId}`] : [] });
  }

  const candidates = await searchFullParcelRecords(sourceParcelId, 25, dataset);
  const parcel = exactParcelMatch(candidates, requested, sourceParcelId);
  if (!parcel) return buildPropertyProfile();

  const accountNum = clean(parcel.accountNum || parcel.accountNumber || parcel.gisParcelId);
  const includeIntelligence = options.includeIntelligence !== false && datasetId === clean(activeCountyDataset.id).toLowerCase();
  const includePermits = options.includePermits !== false && Boolean(dataset.dataRoots?.permits);
  const [intelligenceResult, permitsResult] = await Promise.allSettled([
    includeIntelligence ? loadParcelIntelligenceSummary(accountNum) : Promise.resolve(null),
    includePermits ? loadPermitsForParcel(accountNum, options.maxPermits || 250, dataset.dataRoots?.permits) : Promise.resolve([]),
  ]);
  const errors = [errorText("intelligence", intelligenceResult), errorText("permits", permitsResult)].filter(Boolean);

  return buildPropertyProfile({
    parcel,
    intelligence: intelligenceResult.status === "fulfilled" ? intelligenceResult.value : null,
    permits: permitsResult.status === "fulfilled" ? permitsResult.value : [],
    errors,
  });
}

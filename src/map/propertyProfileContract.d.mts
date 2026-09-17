import type { ParcelRecord } from "./loadParcels";
import type { ParcelIntelligenceSummary } from "./loadParcelIntelligence";
import type { PermitRecord } from "./loadPermits";

export const PROPERTY_PROFILE_SCHEMA_VERSION: "wr-property-profile-v1";

export type PropertyProfile = {
  schemaVersion: typeof PROPERTY_PROFILE_SCHEMA_VERSION;
  status: "complete" | "partial" | "not-found";
  whiteRabbitPropertyId: string;
  sourceCountyId: string;
  countyParcelId: string;
  accountNum: string;
  gisParcelId: string;
  parcel: ParcelRecord | null;
  intelligence: ParcelIntelligenceSummary | null;
  permits: PermitRecord[];
  lineage: ParcelRecord["dataLineage"] | null;
  evidence: {
    layerStatus: Record<string, string>;
    permitCount: number;
    errors: string[];
  };
};

export function buildPropertyProfile(input?: {
  parcel?: ParcelRecord | null;
  intelligence?: ParcelIntelligenceSummary | null;
  permits?: PermitRecord[];
  errors?: string[];
}): PropertyProfile;

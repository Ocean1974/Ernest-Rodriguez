import type { DevelopmentParcelRecord } from "./loadDevelopments";

export const DEVELOPMENT_PRESENTATION_VERSION: "wr-development-presentation-v1";
export type DevelopmentPresentation = {
  schemaVersion?: string;
  id: string;
  title: string;
  linkedAccount: string;
  address: string;
  type: string;
  stage: string;
  summary: string;
  sourceIds: string[];
  sources: Array<{ name?: string }>;
  signalCount?: number;
  score?: number;
  latestActivityDate?: string;
  indexedDevelopment?: DevelopmentParcelRecord;
};
export function toIndexedDevelopmentPresentation(record?: DevelopmentParcelRecord): DevelopmentPresentation | null;
export function resolveSelectedDevelopmentRecord(input?: {
  embeddedRecords?: DevelopmentPresentation[];
  indexedRecords?: Map<string, DevelopmentParcelRecord>;
  selectedDevelopmentId?: string;
  parcelAccountId?: string;
  parcelGisId?: string;
}): DevelopmentPresentation | null;

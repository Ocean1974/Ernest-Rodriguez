export type PermitSearchRecord = Record<string, unknown> & {
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
  issueDate?: string;
  searchText?: string;
};

export function permitSearchText(permit: PermitSearchRecord): string {
  return (
    permit.searchText ||
    [
      permit.permitRecordId,
      permit.sourceDataset,
      permit.permitNumber,
      permit.permitType,
      permit.permitSubtype,
      permit.permitStatus,
      permit.address,
      permit.description,
      permit.contractor,
      permit.parcelAccountNum,
      permit.parcelGisId,
      permit.issueDate,
    ]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();
}

export function searchPermitRecords<T extends PermitSearchRecord>(permits: T[], query: string): T[] {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) return permits;
  return permits.filter((permit) => permitSearchText(permit).includes(normalizedQuery));
}

export function permitsForParcel<T extends PermitSearchRecord>(permits: T[], parcelAccountNum: string): T[] {
  const account = String(parcelAccountNum || "").trim().toUpperCase();
  if (!account) return [];
  return permits.filter((permit) => String(permit.parcelAccountNum || "").trim().toUpperCase() === account);
}

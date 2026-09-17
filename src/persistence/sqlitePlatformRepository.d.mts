export class SqlitePlatformRepository {
  filename: string;
  constructor(options?: { filename: string; clock?: () => string });
  schemaState(): { schemaVersion: number; integrity: string; migrations: Array<Record<string, unknown>> };
  tenantRevision(contextInput: Record<string, unknown>, options?: Record<string, unknown>): number;
  readRecord(contextInput: Record<string, unknown>, namespace: string, key: string, options?: Record<string, unknown>): Record<string, unknown> | null;
  listRecords(contextInput: Record<string, unknown>, namespace: string, options?: Record<string, unknown>): Array<Record<string, unknown>>;
  listRecordsPage(contextInput: Record<string, unknown>, namespace: string, options?: Record<string, unknown>): { records: Array<Record<string, unknown>>; nextKey: string; hasMore: boolean };
  readIdempotencyReceipt(contextInput: Record<string, unknown>, idempotencyKey: string, options?: Record<string, unknown>): Record<string, unknown> | null;
  commit(input: Record<string, unknown>, options?: Record<string, unknown>): Record<string, unknown>;
  commitMany(input: Record<string, unknown>, options?: Record<string, unknown>): Record<string, unknown>;
  exportAuditLog(contextInput: Record<string, unknown>, options?: Record<string, unknown>): Record<string, unknown>;
  exportTenantSnapshot(contextInput: Record<string, unknown>, options?: Record<string, unknown>): Record<string, unknown>;
  restoreTenantSnapshot(contextInput: Record<string, unknown>, snapshot: Record<string, unknown>, options?: Record<string, unknown>): Record<string, unknown>;
  pruneTenantRecords(contextInput: Record<string, unknown>, policies?: Array<Record<string, unknown>>, options?: Record<string, unknown>): Record<string, unknown>;
  close(): void;
}
export function verifyAuditLog(entries?: Array<Record<string, unknown>>): Record<string, unknown>;

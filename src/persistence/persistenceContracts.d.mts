export const PERSISTENCE_CONTEXT_VERSION: "wr-persistence-context-v1";
export const PERSISTENCE_MUTATION_VERSION: "wr-persistence-mutation-v1";
export const PERSISTENCE_RECEIPT_VERSION: "wr-persistence-receipt-v1";
export const PERSISTENCE_BATCH_MUTATION_VERSION: "wr-persistence-batch-mutation-v1";
export const PERSISTENCE_BATCH_RECEIPT_VERSION: "wr-persistence-batch-receipt-v1";
export const PERSISTENCE_SCHEMA_VERSION: 2;
export const PERSISTENCE_NAMESPACES: readonly string[];
export class PersistenceAuthorizationError extends Error { code: "WR_PERSISTENCE_AUTHORIZATION_DENIED"; }
export class TenantIsolationError extends Error { code: "WR_TENANT_ISOLATION_VIOLATION"; expectedOrganizationId: string; foundOrganizationId: string; path: string; }
export function createPersistenceContext(input?: Record<string, unknown>, options?: Record<string, unknown>): Readonly<Record<string, unknown>>;
export function assertPersistenceGrant(context: Record<string, unknown>, grant: string): void;
export function assertTenantBoundValue(value: unknown, organizationId: string, path?: string): void;
export function createPersistenceMutation(input?: Record<string, unknown>, options?: Record<string, unknown>): Readonly<Record<string, unknown>>;
export function createPersistenceBatchMutation(input?: Record<string, unknown>, options?: Record<string, unknown>): Readonly<Record<string, unknown>>;
export function assertReadContext(contextInput: Record<string, unknown>, options?: Record<string, unknown>): Readonly<Record<string, unknown>>;

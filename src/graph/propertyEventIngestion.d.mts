export const PROPERTY_EVENT_VERSION: "wr-property-event-v1";
export const PROPERTY_EVENT_BATCH_VERSION: "wr-property-event-batch-v1";
export const PROPERTY_EVENT_CHECKPOINT_VERSION: "wr-property-event-checkpoint-v1";
export const PROPERTY_GRAPH_QUERY_SERVICE_VERSION: "wr-property-graph-query-service-v1";
export function createPropertyEvent(input?: Record<string, unknown>): Readonly<Record<string, unknown>>;
export function ingestPropertyEventBatch(input?: Record<string, unknown>): Readonly<Record<string, unknown>>;
export function persistPropertyEventBatch(repository: Record<string, unknown>, context: Record<string, unknown>, batch: Record<string, unknown>, options?: Record<string, unknown>): Record<string, unknown>;
export function materializePropertyGraphFromEvents(events?: Array<Record<string, unknown>>, options?: Record<string, unknown>): Record<string, unknown>;
export function createDurablePropertyGraphQueryService(options?: Record<string, unknown>): Readonly<Record<string, unknown>>;

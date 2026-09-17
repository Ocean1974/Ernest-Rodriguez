import { createHash } from "node:crypto";
import {
  buildPropertyGraphState,
  createOwnershipEntity,
  createPropertyGraphEdge,
  createPropertyListing,
  createPropertyTransaction,
  queryPropertyGraph,
} from "./propertyGraph.mjs";

export const PROPERTY_EVENT_VERSION = "wr-property-event-v1";
export const PROPERTY_EVENT_BATCH_VERSION = "wr-property-event-batch-v1";
export const PROPERTY_EVENT_CHECKPOINT_VERSION = "wr-property-event-checkpoint-v1";
export const PROPERTY_GRAPH_QUERY_SERVICE_VERSION = "wr-property-graph-query-service-v1";

const EVENT_TYPES = new Set(["transaction", "listing", "ownership-entity", "edge"]);

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function iso(value, name, allowEmpty = false) {
  if (allowEmpty && !value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`);
  return date.toISOString();
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

function sha256(value) { return createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex"); }

function propertyId(value) {
  const id = required(value, "whiteRabbitPropertyId");
  if (!/^wrp:v1:[^:]+:.+$/.test(id)) throw new TypeError("whiteRabbitPropertyId must use wrp:v1 canonical identity");
  return id;
}

function normalizeSource(input = {}) {
  const observedAt = iso(input.observedAt, "source.observedAt");
  const availableAt = iso(input.availableAt, "source.availableAt");
  if (availableAt < observedAt) throw new TypeError("source.availableAt cannot precede source.observedAt");
  const expiresAt = iso(input.expiresAt, "source.expiresAt", true);
  if (expiresAt && expiresAt < availableAt) throw new TypeError("source.expiresAt cannot precede source.availableAt");
  return {
    providerId: required(input.providerId, "source.providerId"),
    datasetId: required(input.datasetId, "source.datasetId"),
    sourceVersion: required(input.sourceVersion, "source.sourceVersion"),
    recordId: required(input.recordId, "source.recordId"),
    sourceType: String(input.sourceType || "unknown"),
    licenseId: required(input.licenseId, "source.licenseId"),
    licenseStatus: ["authorized", "restricted", "expired", "unknown"].includes(input.licenseStatus) ? input.licenseStatus : "unknown",
    rights: {
      store: input.rights?.store === true,
      derive: input.rights?.derive === true,
      query: input.rights?.query === true,
      display: input.rights?.display === true,
    },
    observedAt,
    availableAt,
    expiresAt,
    sourceUri: String(input.sourceUri || ""),
    sourceFieldMap: input.sourceFieldMap && typeof input.sourceFieldMap === "object" ? structuredClone(input.sourceFieldMap) : {},
  };
}

export function createPropertyEvent(input = {}) {
  const organizationId = required(input.organizationId, "organizationId");
  const whiteRabbitPropertyId = propertyId(input.whiteRabbitPropertyId);
  const eventType = required(input.eventType, "eventType");
  if (!EVENT_TYPES.has(eventType)) throw new TypeError(`Unsupported property event type: ${eventType}`);
  const operation = input.operation === "delete" ? "delete" : "upsert";
  const resourceId = required(input.resourceId, "resourceId");
  const source = normalizeSource(input.source);
  const sequence = Number(input.sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new TypeError("sequence must be a non-negative safe integer");
  const payload = operation === "delete" ? null : structuredClone(input.payload);
  if (operation === "upsert" && (!payload || typeof payload !== "object" || Array.isArray(payload))) throw new TypeError("payload is required for upsert events");
  const payloadSha256 = sha256(payload);
  const identity = `${organizationId}|${source.datasetId}|${source.recordId}|${source.sourceVersion}|${sequence}|${eventType}|${resourceId}|${operation}|${payloadSha256}`;
  return Object.freeze({
    schemaVersion: PROPERTY_EVENT_VERSION,
    id: String(input.id || `wrevent:${sha256(identity)}`),
    organizationId,
    whiteRabbitPropertyId,
    eventType,
    operation,
    resourceId,
    sequence,
    effectiveAt: iso(input.effectiveAt || source.observedAt, "effectiveAt"),
    payload,
    payloadSha256,
    source,
  });
}

export function ingestPropertyEventBatch(input = {}) {
  const organizationId = required(input.organizationId, "organizationId");
  const datasetId = required(input.datasetId, "datasetId");
  const asOf = iso(input.asOf, "asOf");
  const allowedLicenseIds = new Set((input.policy?.allowedLicenseIds || []).map(String));
  const requireRights = input.policy?.requireRights || ["store", "derive", "query"];
  const priorCheckpoint = input.checkpoint || {};
  const priorSequence = Number(priorCheckpoint.lastSequence ?? -1);
  const accepted = [];
  const quarantined = [];
  const replayed = [];
  const seen = new Map();
  for (let index = 0; index < (input.events || []).length; index += 1) {
    let event;
    try { event = createPropertyEvent(input.events[index]); }
    catch (error) { quarantined.push({ index, eventId: String(input.events[index]?.id || ""), code: "WR_EVENT_INVALID", reason: error.message }); continue; }
    let code = "";
    let reason = "";
    if (event.organizationId !== organizationId) { code = "WR_TENANT_ISOLATION_VIOLATION"; reason = "event organization does not match batch organization"; }
    else if (event.source.datasetId !== datasetId) { code = "WR_EVENT_DATASET_MISMATCH"; reason = "event dataset does not match batch dataset"; }
    else if (event.source.licenseStatus !== "authorized" || (allowedLicenseIds.size && !allowedLicenseIds.has(event.source.licenseId))) { code = "WR_EVENT_LICENSE_REJECTED"; reason = "source license is not authorized by policy"; }
    else if (requireRights.some((right) => event.source.rights[right] !== true)) { code = "WR_EVENT_RIGHTS_REJECTED"; reason = `source is missing required rights: ${requireRights.filter((right) => event.source.rights[right] !== true).join(", ")}`; }
    else if (event.source.availableAt > asOf) { code = "WR_EVENT_FUTURE_EVIDENCE"; reason = "source was not available at the batch as-of time"; }
    else if (event.source.expiresAt && event.source.expiresAt < asOf) { code = "WR_EVENT_SOURCE_EXPIRED"; reason = "source license or evidence expired before the batch as-of time"; }
    else if (event.sequence <= priorSequence) { replayed.push({ index, eventId: event.id, code: "WR_EVENT_BEHIND_CHECKPOINT", sequence: event.sequence }); continue; }
    const duplicate = seen.get(event.id);
    if (!code && duplicate) {
      if (duplicate.payloadSha256 === event.payloadSha256) replayed.push({ index, eventId: event.id, code: "WR_EVENT_DUPLICATE", sequence: event.sequence });
      else quarantined.push({ index, eventId: event.id, code: "WR_EVENT_ID_COLLISION", reason: "event ID was reused for different payload content" });
      continue;
    }
    if (code) { quarantined.push({ index, eventId: event.id, code, reason }); continue; }
    seen.set(event.id, event);
    accepted.push(event);
  }
  accepted.sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
  if (accepted.length > 990) throw new RangeError("A property event batch cannot exceed 990 accepted events");
  const lastSequence = accepted.length ? Math.max(priorSequence, ...accepted.map((event) => event.sequence)) : priorSequence;
  const checkpoint = {
    schemaVersion: PROPERTY_EVENT_CHECKPOINT_VERSION,
    organizationId,
    datasetId,
    lastSequence,
    lastAvailableAt: accepted.length ? accepted.at(-1).source.availableAt : String(priorCheckpoint.lastAvailableAt || ""),
    acceptedEventCount: Number(priorCheckpoint.acceptedEventCount || 0) + accepted.length,
    updatedAt: asOf,
  };
  const batchCore = { organizationId, datasetId, asOf, acceptedEventIds: accepted.map((event) => event.id), quarantined, replayed, checkpoint };
  return Object.freeze({
    schemaVersion: PROPERTY_EVENT_BATCH_VERSION,
    id: String(input.id || `wrebatch:${sha256(batchCore)}`),
    ...batchCore,
    accepted,
    stats: { received: (input.events || []).length, accepted: accepted.length, quarantined: quarantined.length, replayed: replayed.length },
    batchSha256: sha256(batchCore),
  });
}

function eventRecordKey(event) { return `event:${encodeURIComponent(event.whiteRabbitPropertyId)}:${event.id}`; }

export function persistPropertyEventBatch(repository, context, batch, options = {}) {
  if (!repository?.commitMany) throw new TypeError("repository.commitMany is required for atomic property-event persistence");
  if (batch?.schemaVersion !== PROPERTY_EVENT_BATCH_VERSION) throw new TypeError("A wr-property-event-batch-v1 batch is required");
  if (batch.organizationId !== context.organizationId) {
    const error = new Error(`Property-event organization ${batch.organizationId} does not match tenant ${context.organizationId}`);
    error.code = "WR_TENANT_ISOLATION_VIOLATION";
    throw error;
  }
  const mutations = batch.accepted.map((event) => ({ namespace: "property-graph", key: eventRecordKey(event), value: event, expectedRecordRevision: 0 }));
  mutations.push({ namespace: "property-graph", key: `batch:${batch.id}`, value: { ...batch, accepted: undefined }, expectedRecordRevision: 0 });
  mutations.push({ namespace: "property-graph", key: `checkpoint:${encodeURIComponent(batch.datasetId)}`, value: batch.checkpoint, expectedRecordRevision: options.expectedCheckpointRevision });
  return repository.commitMany({ context, mutations, expectedTenantRevision: options.expectedTenantRevision, idempotencyKey: options.idempotencyKey || `property-events:${batch.id}`, occurredAt: options.occurredAt || batch.asOf }, options.validation || {});
}

function sourceForGraph(event) {
  return { ...event.source, recordId: event.source.recordId, contentSha256: event.payloadSha256, lineage: { eventId: event.id, sourceUri: event.source.sourceUri, sourceFieldMap: event.source.sourceFieldMap } };
}

export function materializePropertyGraphFromEvents(events = [], options = {}) {
  const asOf = iso(options.asOf, "asOf");
  const eligible = events.map(createPropertyEvent).filter((event) => event.source.availableAt <= asOf && event.effectiveAt <= asOf && (!event.source.expiresAt || event.source.expiresAt >= asOf));
  eligible.sort((a, b) => a.sequence - b.sequence || a.source.availableAt.localeCompare(b.source.availableAt) || a.id.localeCompare(b.id));
  const latest = new Map();
  eligible.forEach((event) => latest.set(`${event.eventType}:${event.resourceId}`, event));
  const active = [...latest.values()].filter((event) => event.operation !== "delete");
  const transactions = [];
  const listings = [];
  const entities = [];
  const edges = [];
  for (const event of active) {
    const payload = { ...event.payload, id: event.resourceId, whiteRabbitPropertyId: event.whiteRabbitPropertyId, sourceRecordId: event.source.recordId, source: sourceForGraph(event) };
    if (event.eventType === "transaction") transactions.push(createPropertyTransaction(payload));
    else if (event.eventType === "listing") listings.push(createPropertyListing(payload));
    else if (event.eventType === "ownership-entity") entities.push({ ...createOwnershipEntity(payload), canonicalEntityId: String(event.payload.canonicalEntityId || event.resourceId) });
    else if (event.eventType === "edge") edges.push(createPropertyGraphEdge(payload));
  }
  return buildPropertyGraphState({ propertyIds: [...new Set(active.map((event) => event.whiteRabbitPropertyId))], transactions, listings, entities, edges, generatedAt: asOf });
}

export function createDurablePropertyGraphQueryService({ repository, context, maxEventsPerProperty = 5000 } = {}) {
  if (!repository?.listRecordsPage) throw new TypeError("repository.listRecordsPage is required");
  if (!context?.organizationId) throw new TypeError("A tenant persistence context is required");
  return Object.freeze({
    schemaVersion: PROPERTY_GRAPH_QUERY_SERVICE_VERSION,
    async loadPropertyEvents(whiteRabbitPropertyId, options = {}) {
      const id = propertyId(whiteRabbitPropertyId);
      const limit = Math.max(1, Math.min(maxEventsPerProperty, Math.trunc(Number(options.limit) || maxEventsPerProperty)));
      const pageSize = Math.max(1, Math.min(1000, Math.trunc(Number(options.pageSize) || 250)));
      const prefix = `event:${encodeURIComponent(id)}:`;
      let afterKey = String(options.afterKey || "");
      const events = [];
      let hasMore = true;
      while (hasMore && events.length < limit) {
        const page = repository.listRecordsPage(context, "property-graph", { keyPrefix: prefix, afterKey, limit: Math.min(pageSize, limit - events.length), validation: options.validation || {} });
        events.push(...page.records.map((record) => record.value));
        afterKey = page.nextKey;
        hasMore = page.hasMore;
      }
      return { whiteRabbitPropertyId: id, events, nextKey: hasMore ? afterKey : "", truncated: hasMore, eventCount: events.length };
    },
    async queryProperty(whiteRabbitPropertyId, input = {}) {
      const asOf = iso(input.at, "at");
      const ledger = await this.loadPropertyEvents(whiteRabbitPropertyId, input);
      const state = materializePropertyGraphFromEvents(ledger.events, { asOf });
      const result = queryPropertyGraph(state, { ...input, at: asOf, startNodeIds: [propertyId(whiteRabbitPropertyId)] });
      return { ...result, serviceVersion: PROPERTY_GRAPH_QUERY_SERVICE_VERSION, ledger: { eventCount: ledger.eventCount, truncated: ledger.truncated, nextKey: ledger.nextKey } };
    },
  });
}

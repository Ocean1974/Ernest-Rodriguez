export const OWNERSHIP_ENTITY_VERSION = "wr-ownership-entity-v1";
export const PROPERTY_TRANSACTION_VERSION = "wr-property-transaction-v1";
export const PROPERTY_LISTING_VERSION = "wr-property-listing-v1";
export const PROPERTY_GRAPH_EDGE_VERSION = "wr-property-graph-edge-v1";
export const PROPERTY_GRAPH_STATE_VERSION = "wr-property-graph-state-v1";
export const PROPERTY_FACT_RECONCILIATION_VERSION = "wr-property-fact-reconciliation-v1";
export const ENTITY_RECONCILIATION_VERSION = "wr-entity-reconciliation-v1";
export const PROPERTY_GRAPH_QUERY_VERSION = "wr-property-graph-query-result-v1";

const SOURCE_PRIORITY = Object.freeze({ "official-record": 100, assessor: 90, recorder: 90, zoning: 85, permit: 85, mls: 70, broker: 60, "user-provided": 50, unknown: 0 });
const EDGE_TYPES = Object.freeze(["owned-by", "transferred-by", "transferred-to", "recorded-as", "listed-as", "represented-by", "secured-by", "related-to"]);

function hash(seed) {
  let value = 2166136261;
  for (const character of String(seed)) { value ^= character.charCodeAt(0); value = Math.imul(value, 16777619); }
  return (value >>> 0).toString(36);
}

function stableId(prefix, seed) { return `${prefix}_${hash(seed)}`; }

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function iso(value, name, allowEmpty = false) {
  if (allowEmpty && !value) return "";
  const date = new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`);
  return date.toISOString();
}

function canonicalPropertyId(value) {
  const id = required(value, "whiteRabbitPropertyId");
  if (!/^wrp:v1:[^:]+:.+$/.test(id)) throw new TypeError("whiteRabbitPropertyId must use wrp:v1 canonical identity");
  return id;
}

function normalizedText(value) { return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase(); }

function source(input = {}) {
  const sourceType = SOURCE_PRIORITY[input.sourceType] !== undefined ? input.sourceType : "unknown";
  const observedAt = iso(input.observedAt, "source.observedAt");
  const availableAt = iso(input.availableAt || observedAt, "source.availableAt");
  const expiresAt = iso(input.expiresAt, "source.expiresAt", true);
  if (expiresAt && expiresAt < availableAt) throw new TypeError("source.expiresAt cannot be before source.availableAt");
  return {
    sourceType,
    providerId: String(input.providerId || ""),
    datasetId: String(input.datasetId || ""),
    sourceVersion: String(input.sourceVersion || ""),
    recordId: String(input.recordId || ""),
    licenseId: String(input.licenseId || ""),
    licenseStatus: ["authorized", "restricted", "expired", "unknown"].includes(input.licenseStatus) ? input.licenseStatus : "unknown",
    observedAt,
    availableAt,
    expiresAt,
    contentSha256: String(input.contentSha256 || ""),
    priority: Math.max(0, Math.min(100, Number(input.priority ?? SOURCE_PRIORITY[sourceType]))),
    lineage: input.lineage || null,
  };
}

function measurement(input, unit, field) {
  const supplied = input && typeof input === "object" && !Array.isArray(input) && "value" in input;
  const raw = supplied ? input.value : input;
  const value = raw === null || raw === undefined || String(raw).trim() === "" ? null : Number(String(raw).replace(/[$,%]/g, "").replace(/,/g, ""));
  const observed = Number.isFinite(value);
  return { value: observed ? value : null, unit, status: observed ? "observed" : "unknown", sourceField: observed ? String((supplied && input.sourceField) || field) : "", confidence: observed ? Math.max(0, Math.min(1, Number((supplied && input.confidence) ?? 1))) : 0 };
}

export function createOwnershipEntity(input = {}) {
  const sourceReference = source(input.source || {});
  const sourceRecordId = required(input.sourceRecordId || sourceReference.recordId, "sourceRecordId");
  const name = required(input.name, "name");
  const externalIds = (input.externalIds || []).map((item) => ({ jurisdiction: normalizedText(item.jurisdiction), type: normalizedText(item.type), value: normalizedText(item.value) })).filter((item) => item.jurisdiction && item.type && item.value).sort((a, b) => `${a.jurisdiction}|${a.type}|${a.value}`.localeCompare(`${b.jurisdiction}|${b.type}|${b.value}`));
  const mailingAddress = String(input.mailingAddress || "").trim();
  return {
    schemaVersion: OWNERSHIP_ENTITY_VERSION,
    id: String(input.id || stableId("entity_record", `${sourceReference.datasetId}|${sourceRecordId}`)),
    entityType: ["person", "company", "trust", "government", "unknown"].includes(input.entityType) ? input.entityType : "unknown",
    name,
    normalizedName: normalizedText(name),
    mailingAddress,
    normalizedMailingAddress: normalizedText(mailingAddress),
    externalIds,
    sourceRecordId,
    source: sourceReference,
    confidence: Math.max(0, Math.min(1, Number(input.confidence ?? 1))),
  };
}

export function createPropertyTransaction(input = {}) {
  const sourceReference = source(input.source || {});
  const sourceRecordId = required(input.sourceRecordId || sourceReference.recordId, "sourceRecordId");
  const propertyId = canonicalPropertyId(input.whiteRabbitPropertyId);
  const recordedAt = iso(input.recordedAt, "recordedAt");
  return {
    schemaVersion: PROPERTY_TRANSACTION_VERSION,
    id: String(input.id || stableId("transaction", `${sourceReference.datasetId}|${sourceRecordId}`)),
    whiteRabbitPropertyId: propertyId,
    transactionType: ["sale", "transfer", "refinance", "foreclosure", "deed", "other"].includes(input.transactionType) ? input.transactionType : "other",
    recordedAt,
    effectiveAt: iso(input.effectiveAt || recordedAt, "effectiveAt"),
    consideration: measurement(input.consideration, "usd", "consideration"),
    grantorEntityIds: [...new Set((input.grantorEntityIds || []).map(String).filter(Boolean))],
    granteeEntityIds: [...new Set((input.granteeEntityIds || []).map(String).filter(Boolean))],
    documentNumber: String(input.documentNumber || ""),
    sourceRecordId,
    source: sourceReference,
  };
}

export function createPropertyListing(input = {}) {
  const sourceReference = source(input.source || {});
  const sourceRecordId = required(input.sourceRecordId || sourceReference.recordId, "sourceRecordId");
  const listedAt = iso(input.listedAt, "listedAt");
  const offMarketAt = iso(input.offMarketAt, "offMarketAt", true);
  if (offMarketAt && offMarketAt < listedAt) throw new TypeError("offMarketAt cannot be before listedAt");
  return {
    schemaVersion: PROPERTY_LISTING_VERSION,
    id: String(input.id || stableId("listing", `${sourceReference.datasetId}|${sourceRecordId}`)),
    whiteRabbitPropertyId: canonicalPropertyId(input.whiteRabbitPropertyId),
    listingStatus: ["coming-soon", "active", "pending", "sold", "expired", "withdrawn", "off-market"].includes(input.listingStatus) ? input.listingStatus : "active",
    propertyType: String(input.propertyType || ""),
    askingPrice: measurement(input.askingPrice, "usd", "askingPrice"),
    listedAt,
    offMarketAt,
    brokerEntityIds: [...new Set((input.brokerEntityIds || []).map(String).filter(Boolean))],
    sourceRecordId,
    source: sourceReference,
  };
}

export function createPropertyGraphEdge(input = {}) {
  const validFrom = iso(input.validFrom, "validFrom");
  const validTo = iso(input.validTo, "validTo", true);
  if (validTo && validTo < validFrom) throw new TypeError("validTo cannot be before validFrom");
  const edgeType = EDGE_TYPES.includes(input.edgeType) ? input.edgeType : "related-to";
  const fromId = required(input.fromId, "fromId");
  const toId = required(input.toId, "toId");
  const sourceReferences = (input.sourceReferences || []).map(source);
  return {
    schemaVersion: PROPERTY_GRAPH_EDGE_VERSION,
    id: String(input.id || stableId("edge", `${edgeType}|${fromId}|${toId}|${validFrom}|${validTo}`)),
    edgeType,
    fromId,
    toId,
    validFrom,
    validTo,
    confidence: Math.max(0, Math.min(1, Number(input.confidence ?? 1))),
    sourceReferences,
    status: input.status === "disputed" ? "disputed" : "asserted",
    conflictIds: [...new Set((input.conflictIds || []).map(String).filter(Boolean))],
  };
}

export function isEdgeActiveAt(edge, at) {
  const time = iso(at, "at");
  return edge.validFrom <= time && (!edge.validTo || edge.validTo >= time);
}

function entitySignals(entity) {
  const registrations = entity.externalIds.map((item) => `registration:${item.jurisdiction}|${item.type}|${item.value}`);
  const nameAddress = entity.normalizedName && entity.normalizedMailingAddress ? [`name-address:${entity.normalizedName}|${entity.normalizedMailingAddress}`] : [];
  return { registrations, nameAddress, fallback: `record:${entity.source.datasetId}|${entity.sourceRecordId}` };
}

export function reconcileOwnershipEntities(inputs = []) {
  const records = inputs.map(createOwnershipEntity).sort((a, b) => a.id.localeCompare(b.id));
  const parent = records.map((_, index) => index);
  const find = (index) => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const union = (left, right) => { const a = find(left); const b = find(right); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
  const matchEvidence = [];
  const conflicts = [];
  for (let left = 0; left < records.length; left += 1) for (let right = left + 1; right < records.length; right += 1) {
    const a = records[left]; const b = records[right]; const as = entitySignals(a); const bs = entitySignals(b);
    const registration = as.registrations.find((item) => bs.registrations.includes(item));
    const nameAddress = as.nameAddress.find((item) => bs.nameAddress.includes(item));
    if (registration || nameAddress) {
      union(left, right);
      matchEvidence.push({ leftRecordId: a.id, rightRecordId: b.id, rule: registration ? "exact-registration" : "exact-normalized-name-and-mailing-address", confidence: registration ? 1 : 0.92, signal: registration || nameAddress });
      if (registration && a.normalizedName !== b.normalizedName) conflicts.push({ id: stableId("conflict", `${registration}|name`), type: "entity-name-conflict", signal: registration, recordIds: [a.id, b.id], values: [a.name, b.name], resolution: "unresolved" });
    }
  }
  const grouped = new Map();
  records.forEach((record, index) => { const root = find(index); grouped.set(root, [...(grouped.get(root) || []), record]); });
  const entities = [...grouped.values()].map((members) => {
    const signals = members.flatMap((member) => entitySignals(member).registrations).sort();
    const nameAddresses = members.flatMap((member) => entitySignals(member).nameAddress).sort();
    const resolutionKey = signals[0] || nameAddresses[0] || entitySignals(members[0]).fallback;
    const preferred = [...members].sort((a, b) => b.source.priority - a.source.priority || b.confidence - a.confidence || a.id.localeCompare(b.id))[0];
    return { canonicalEntityId: `wre:v1:${hash(resolutionKey)}`, resolutionKey, preferredRecord: preferred, memberRecordIds: members.map((item) => item.id), aliases: [...new Set(members.map((item) => item.name))], confidence: members.length > 1 ? Math.max(...matchEvidence.filter((match) => members.some((item) => item.id === match.leftRecordId) && members.some((item) => item.id === match.rightRecordId)).map((match) => match.confidence), preferred.confidence) : preferred.confidence };
  });
  return { schemaVersion: ENTITY_RECONCILIATION_VERSION, entities, recordCount: records.length, canonicalEntityCount: entities.length, matchEvidence, conflicts, unmatchedRecordIds: entities.filter((item) => item.memberRecordIds.length === 1).flatMap((item) => item.memberRecordIds) };
}

function activeAssertion(assertion, asOf) {
  const from = assertion.validFrom ? iso(assertion.validFrom, "validFrom") : "0000-01-01T00:00:00.000Z";
  const to = assertion.validTo ? iso(assertion.validTo, "validTo") : "";
  return from <= asOf && (!to || to >= asOf);
}

export function reconcilePropertyFacts(assertions = [], options = {}) {
  const asOf = iso(options.asOf, "asOf");
  const normalized = assertions.map((item, index) => ({ id: String(item.id || `assertion-${index + 1}`), whiteRabbitPropertyId: canonicalPropertyId(item.whiteRabbitPropertyId), field: required(item.field, "field"), value: item.value ?? null, validFrom: item.validFrom ? iso(item.validFrom, "validFrom") : "", validTo: item.validTo ? iso(item.validTo, "validTo") : "", confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 1))), source: source(item.source || {}) }));
  const groups = new Map();
  normalized.filter((item) => activeAssertion(item, asOf)).forEach((item) => { const key = `${item.whiteRabbitPropertyId}|${item.field}`; groups.set(key, [...(groups.get(key) || []), item]); });
  const resolvedFacts = [];
  const conflicts = [];
  for (const candidates of groups.values()) {
    candidates.sort((a, b) => b.source.priority - a.source.priority || b.confidence - a.confidence || b.source.observedAt.localeCompare(a.source.observedAt) || a.id.localeCompare(b.id));
    const selected = candidates[0];
    const distinctValues = [...new Set(candidates.map((item) => JSON.stringify(item.value)))];
    const conflictId = distinctValues.length > 1 ? stableId("conflict", `${selected.whiteRabbitPropertyId}|${selected.field}|${asOf}|${distinctValues.sort().join("|")}`) : "";
    if (conflictId) conflicts.push({ id: conflictId, type: "property-fact-conflict", whiteRabbitPropertyId: selected.whiteRabbitPropertyId, field: selected.field, asOf, candidateAssertionIds: candidates.map((item) => item.id), values: candidates.map((item) => ({ assertionId: item.id, value: item.value, source: item.source })), selectedAssertionId: selected.id, resolutionRule: "highest source priority, then confidence, then observation time, then stable assertion id" });
    resolvedFacts.push({ whiteRabbitPropertyId: selected.whiteRabbitPropertyId, field: selected.field, value: selected.value, selectedAssertionId: selected.id, status: conflictId ? "resolved-with-conflict" : "resolved", confidence: selected.confidence, source: selected.source, conflictId, candidates });
  }
  return { schemaVersion: PROPERTY_FACT_RECONCILIATION_VERSION, asOf, resolvedFacts, conflicts, inactiveAssertionIds: normalized.filter((item) => !activeAssertion(item, asOf)).map((item) => item.id), rule: "highest source priority, then confidence, then observation time, then stable assertion id" };
}

export function createPropertyGraphState(input = {}) {
  const transactions = (input.transactions || []).map(createPropertyTransaction);
  const listings = (input.listings || []).map(createPropertyListing);
  const propertyIds = [...new Set([...(input.propertyIds || []).map(canonicalPropertyId), ...transactions.map((item) => item.whiteRabbitPropertyId), ...listings.map((item) => item.whiteRabbitPropertyId)])];
  return { schemaVersion: PROPERTY_GRAPH_STATE_VERSION, propertyIds, entities: input.entities || [], transactions, listings, edges: (input.edges || []).map(createPropertyGraphEdge), conflicts: input.conflicts || [], generatedAt: iso(input.generatedAt, "generatedAt") };
}

export function buildPropertyGraphState(input = {}) {
  const transactions = (input.transactions || []).map(createPropertyTransaction);
  const listings = (input.listings || []).map(createPropertyListing);
  const generatedEdges = [];
  for (const transaction of transactions) {
    const shared = { validFrom: transaction.effectiveAt, confidence: 1, sourceReferences: [transaction.source] };
    generatedEdges.push(createPropertyGraphEdge({ ...shared, edgeType: "recorded-as", fromId: transaction.whiteRabbitPropertyId, toId: transaction.id }));
    transaction.grantorEntityIds.forEach((entityId) => generatedEdges.push(createPropertyGraphEdge({ ...shared, edgeType: "transferred-by", fromId: transaction.id, toId: entityId })));
    transaction.granteeEntityIds.forEach((entityId) => generatedEdges.push(createPropertyGraphEdge({ ...shared, edgeType: "transferred-to", fromId: transaction.id, toId: entityId })));
  }
  for (const listing of listings) {
    const shared = { validFrom: listing.listedAt, validTo: listing.offMarketAt, confidence: 1, sourceReferences: [listing.source] };
    generatedEdges.push(createPropertyGraphEdge({ ...shared, edgeType: "listed-as", fromId: listing.whiteRabbitPropertyId, toId: listing.id }));
    listing.brokerEntityIds.forEach((entityId) => generatedEdges.push(createPropertyGraphEdge({ ...shared, edgeType: "represented-by", fromId: listing.id, toId: entityId })));
  }
  const explicitEdges = (input.edges || []).map(createPropertyGraphEdge);
  const edges = [...generatedEdges, ...explicitEdges].filter((edge, index, all) => all.findIndex((candidate) => candidate.id === edge.id) === index);
  return createPropertyGraphState({ ...input, transactions, listings, edges });
}

export function queryPropertyGraph(stateInput, input = {}) {
  const state = stateInput.schemaVersion === PROPERTY_GRAPH_STATE_VERSION ? stateInput : createPropertyGraphState(stateInput);
  const startNodeIds = [...new Set((input.startNodeIds || []).map(String).filter(Boolean))];
  const maxDepth = Math.max(0, Math.min(5, Math.trunc(Number(input.maxDepth ?? 2))));
  const maxNodes = Math.max(1, Math.min(2000, Math.trunc(Number(input.maxNodes ?? 250))));
  const direction = ["outbound", "inbound", "both"].includes(input.direction) ? input.direction : "both";
  const edgeTypes = (input.edgeTypes || []).filter((item) => EDGE_TYPES.includes(item));
  const at = iso(input.at, "at");
  const eligible = state.edges.filter((edge) => isEdgeActiveAt(edge, at) && (!edgeTypes.length || edgeTypes.includes(edge.edgeType)));
  const visited = new Set(startNodeIds);
  const queue = startNodeIds.map((id) => ({ id, depth: 0 }));
  const traversedEdges = [];
  let truncated = false;
  while (queue.length) {
    const current = queue.shift();
    if (current.depth >= maxDepth) continue;
    for (const edge of eligible) {
      const outbound = edge.fromId === current.id;
      const inbound = edge.toId === current.id;
      if ((direction === "outbound" && !outbound) || (direction === "inbound" && !inbound) || (direction === "both" && !outbound && !inbound)) continue;
      const nextId = outbound ? edge.toId : edge.fromId;
      if (!traversedEdges.some((item) => item.id === edge.id)) traversedEdges.push(edge);
      if (!visited.has(nextId)) {
        if (visited.size >= maxNodes) { truncated = true; continue; }
        visited.add(nextId); queue.push({ id: nextId, depth: current.depth + 1 });
      }
    }
  }
  const nodeIndex = new Map([
    ...state.propertyIds.map((id) => [id, { id, nodeType: "property" }]),
    ...state.entities.map((item) => [item.canonicalEntityId || item.id, { ...item, id: item.canonicalEntityId || item.id, nodeType: "entity" }]),
    ...state.transactions.map((item) => [item.id, { ...item, nodeType: "transaction" }]),
    ...state.listings.map((item) => [item.id, { ...item, nodeType: "listing" }]),
  ]);
  return { schemaVersion: PROPERTY_GRAPH_QUERY_VERSION, at, startNodeIds, maxDepth, maxNodes, direction, nodes: [...visited].map((id) => nodeIndex.get(id) || { id, nodeType: "unresolved-reference" }), edges: traversedEdges, truncated, evidence: { activeEdgeCount: eligible.length, returnedEdgeCount: traversedEdges.length, unresolvedNodeCount: [...visited].filter((id) => !nodeIndex.has(id)).length } };
}

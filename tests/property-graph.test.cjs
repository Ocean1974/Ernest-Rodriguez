const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const graph = await import("../src/graph/propertyGraph.mjs");
  const observedAt = "2026-08-13T12:00:00.000Z";
  const propertyId = "wrp:v1:dallas-county-dcad:A1";
  const source = (datasetId, recordId, sourceType = "official-record") => ({ datasetId, recordId, sourceType, observedAt });
  const records = [
    { name: "Rabbit Holdings LLC", mailingAddress: "100 Main St, Dallas TX", entityType: "company", sourceRecordId: "owner-1", externalIds: [{ jurisdiction: "TX", type: "file-number", value: "12345" }], source: source("texas-sos", "owner-1") },
    { name: "Rabbit Holdings, LLC", mailingAddress: "200 Elm St, Dallas TX", entityType: "company", sourceRecordId: "owner-2", externalIds: [{ jurisdiction: "TX", type: "file-number", value: "12345" }], source: source("county-deed", "owner-2", "recorder") },
    { name: "Rabbit Holdings LLC", mailingAddress: "100 Main St, Dallas TX", entityType: "company", sourceRecordId: "owner-3", source: source("dcad", "owner-3", "assessor") },
    { name: "Different Owner LP", mailingAddress: "9 Oak St", entityType: "company", sourceRecordId: "owner-4", source: source("dcad", "owner-4", "assessor") },
  ];
  const entities = graph.reconcileOwnershipEntities(records);
  assert.equal(entities.schemaVersion, "wr-entity-reconciliation-v1");
  assert.equal(entities.recordCount, 4);
  assert.equal(entities.canonicalEntityCount, 2);
  assert.equal(entities.entities.find((item) => item.memberRecordIds.length === 3).memberRecordIds.length, 3);
  assert(entities.matchEvidence.some((item) => item.rule === "exact-registration" && item.confidence === 1));
  assert(entities.matchEvidence.some((item) => item.rule === "exact-normalized-name-and-mailing-address"));
  assert(entities.conflicts.some((item) => item.type === "entity-name-conflict" && item.resolution === "unresolved"));
  assert.equal(entities.unmatchedRecordIds.length, 1);
  const ownerId = entities.entities.find((item) => item.memberRecordIds.length === 3).canonicalEntityId;

  const transaction = graph.createPropertyTransaction({ whiteRabbitPropertyId: propertyId, transactionType: "sale", recordedAt: "2026-01-15", effectiveAt: "2026-01-10", consideration: { value: 1200000, sourceField: "document.consideration", confidence: 0.95 }, granteeEntityIds: [ownerId], sourceRecordId: "deed-1", documentNumber: "2026-001", source: source("dallas-recorder", "deed-1", "recorder") });
  assert.equal(transaction.schemaVersion, "wr-property-transaction-v1");
  assert.equal(transaction.consideration.value, 1200000);
  assert.equal(transaction.consideration.sourceField, "document.consideration");
  const listing = graph.createPropertyListing({ whiteRabbitPropertyId: propertyId, listingStatus: "active", askingPrice: 1500000, listedAt: "2026-05-01", offMarketAt: "2026-09-01", brokerEntityIds: [ownerId], sourceRecordId: "listing-1", source: source("broker-feed", "listing-1", "broker") });
  assert.equal(listing.schemaVersion, "wr-property-listing-v1");
  assert.throws(() => graph.createPropertyListing({ whiteRabbitPropertyId: propertyId, listedAt: "2026-05-01", offMarketAt: "2026-04-01", sourceRecordId: "bad", source: source("feed", "bad") }), /offMarketAt/);

  const facts = graph.reconcilePropertyFacts([
    { id: "broker-owner", whiteRabbitPropertyId: propertyId, field: "ownerName", value: "Prior Owner", validFrom: "2026-01-01", confidence: 0.99, source: source("broker-feed", "1", "broker") },
    { id: "official-owner", whiteRabbitPropertyId: propertyId, field: "ownerName", value: "Rabbit Holdings LLC", validFrom: "2026-01-01", confidence: 0.9, source: source("dallas-recorder", "2", "official-record") },
    { id: "expired-owner", whiteRabbitPropertyId: propertyId, field: "ownerName", value: "Historic Owner", validFrom: "2020-01-01", validTo: "2025-12-31", source: source("dcad-2025", "3", "assessor") },
  ], { asOf: "2026-08-13T12:00:00.000Z" });
  assert.equal(facts.schemaVersion, "wr-property-fact-reconciliation-v1");
  assert.equal(facts.resolvedFacts[0].value, "Rabbit Holdings LLC", "official source priority must outrank broker confidence");
  assert.equal(facts.resolvedFacts[0].status, "resolved-with-conflict");
  assert.equal(facts.conflicts.length, 1);
  assert.equal(facts.conflicts[0].values.length, 2, "conflicting evidence must be retained");
  assert.deepEqual(facts.inactiveAssertionIds, ["expired-owner"]);

  const ownership = graph.createPropertyGraphEdge({ edgeType: "owned-by", fromId: propertyId, toId: ownerId, validFrom: "2026-01-10", confidence: 0.95, sourceReferences: [source("dallas-recorder", "deed-1", "recorder")] });
  assert(graph.isEdgeActiveAt(ownership, "2026-08-13"));
  assert.throws(() => graph.createPropertyGraphEdge({ edgeType: "owned-by", fromId: propertyId, toId: ownerId, validFrom: "2026-02-01", validTo: "2026-01-01" }), /validTo/);
  const state = graph.buildPropertyGraphState({ entities: entities.entities, transactions: [transaction], listings: [listing], edges: [ownership], conflicts: [...entities.conflicts, ...facts.conflicts], generatedAt: observedAt });
  assert.equal(state.schemaVersion, "wr-property-graph-state-v1");
  assert(state.propertyIds.includes(propertyId));
  assert(state.edges.some((edge) => edge.edgeType === "recorded-as"));
  assert(state.edges.some((edge) => edge.edgeType === "transferred-to"));
  assert(state.edges.some((edge) => edge.edgeType === "listed-as"));

  const neighborhood = graph.queryPropertyGraph(state, { startNodeIds: [propertyId], maxDepth: 2, at: "2026-07-01", direction: "both" });
  assert.equal(neighborhood.schemaVersion, "wr-property-graph-query-result-v1");
  assert(neighborhood.nodes.some((node) => node.nodeType === "transaction"));
  assert(neighborhood.nodes.some((node) => node.nodeType === "listing"));
  assert(neighborhood.nodes.some((node) => node.nodeType === "entity"));
  assert.equal(neighborhood.evidence.unresolvedNodeCount, 0);
  const afterListing = graph.queryPropertyGraph(state, { startNodeIds: [propertyId], maxDepth: 1, at: "2026-10-01", edgeTypes: ["listed-as"] });
  assert.equal(afterListing.edges.length, 0, "off-market listing edges must expire");
  const bounded = graph.queryPropertyGraph(state, { startNodeIds: [propertyId], maxDepth: 5, maxNodes: 1, at: "2026-07-01" });
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.nodes.length, 1);

  const stateSchema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "property-graph.schema.json"), "utf8"));
  const reconciliationSchema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "property-graph-reconciliation.schema.json"), "utf8"));
  assert.equal(stateSchema.properties.schemaVersion.const, "wr-property-graph-state-v1");
  assert(reconciliationSchema.oneOf.some((item) => item.properties.schemaVersion.const === "wr-entity-reconciliation-v1"));
  console.log("White Rabbit canonical property graph and reconciliation tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

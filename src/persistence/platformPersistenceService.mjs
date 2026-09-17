import { createUserIntelligenceState } from "../platform/userIntelligenceStore.mjs";
import { createCollaborationState } from "../collaboration/dealCollaborationStore.mjs";
import { createAlertRoutingState, createPropertySnapshot } from "../alerts/alertRoutingStore.mjs";
import { ALERT_DELIVERY_ATTEMPT_VERSION } from "../alerts/alertRoutingStore.mjs";
import { assertTenantBoundValue } from "./persistenceContracts.mjs";
import { createAlertWorkerState } from "../alerts/alertDeliveryWorker.mjs";
import { createUnderwritingGovernanceState } from "../underwriting/underwritingGovernance.mjs";
import { createDealRoomState } from "../collaboration/dealRoomRegistry.mjs";
import { createDocumentEvidenceState } from "../collaboration/documentEvidenceRegistry.mjs";
import { createDiligenceWorkflow } from "../collaboration/transactionDiligence.mjs";
import { createAssetOperationsState } from "../portfolio/assetOperations.mjs";
import { createForwardStrategyState } from "../portfolio/forwardStrategy.mjs";
import { createOperatingControlState } from "../portfolio/operatingFeedControl.mjs";
import { createOperatingConnectorWorkerState } from "../portfolio/operatingConnectorRuntime.mjs";
import { createConnectorAssuranceState } from "../portfolio/operatingConnectorAssurance.mjs";
import { createProviderExecutionState, validateVendorSandboxCertificationPack } from "../portfolio/operatingProviderSdk.mjs";
import { createProviderGovernanceState } from "../portfolio/providerOnboardingGovernance.mjs";
import { createCountyReleaseState } from "../operations/countyReleasePipeline.mjs";

export const PLATFORM_PERSISTENCE_SERVICE_VERSION = "wr-platform-persistence-service-v1";

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function write(repository, context, namespace, key, value, options = {}) {
  if (!repository?.commit) throw new TypeError("repository.commit is required");
  return repository.commit({
    context,
    namespace,
    key,
    value,
    expectedTenantRevision: options.expectedTenantRevision,
    expectedRecordRevision: options.expectedRecordRevision,
    idempotencyKey: options.idempotencyKey,
    occurredAt: options.occurredAt,
  }, options.validation || {});
}

function read(repository, context, namespace, key, options = {}) {
  if (!repository?.readRecord) throw new TypeError("repository.readRecord is required");
  return repository.readRecord(context, namespace, key, options.validation || {})?.value || null;
}

export function persistUserIntelligenceState(repository, context, stateInput, options = {}) {
  const normalized = createUserIntelligenceState(stateInput);
  const state = { ...normalized, organizationId: normalized.organizationId || context.organizationId, ownerUserId: normalized.ownerUserId || context.actorUserId };
  if (state.organizationId && state.organizationId !== context.organizationId) {
    const error = new Error(`User intelligence organization ${state.organizationId} does not match tenant ${context.organizationId}`); error.code = "WR_TENANT_ISOLATION_VIOLATION"; throw error;
  }
  if (state.ownerUserId && state.ownerUserId !== context.actorUserId) {
    const error = new Error(`User intelligence owner ${state.ownerUserId} does not match actor ${context.actorUserId}`); error.code = "WR_USER_SCOPE_VIOLATION"; throw error;
  }
  assertTenantBoundValue(state, context.organizationId);
  return write(repository, context, "user-intelligence", context.actorUserId, state, options);
}

export function loadUserIntelligenceState(repository, context, options = {}) {
  const value = read(repository, context, "user-intelligence", context.actorUserId, options);
  return value ? createUserIntelligenceState(value) : null;
}

export function persistCollaborationState(repository, context, stateInput, options = {}) {
  const state = createCollaborationState(stateInput);
  const foreignOrganization = state.organizations.find((organization) => organization.id !== context.organizationId);
  if (foreignOrganization) {
    const error = new Error(`Collaboration organization ${foreignOrganization.id} does not match tenant ${context.organizationId}`);
    error.code = "WR_TENANT_ISOLATION_VIOLATION";
    throw error;
  }
  assertTenantBoundValue(state, context.organizationId);
  return write(repository, context, "collaboration", "state", state, options);
}

export function loadCollaborationState(repository, context, options = {}) {
  const value = read(repository, context, "collaboration", "state", options);
  return value ? createCollaborationState(value) : null;
}

export function persistAlertRoutingState(repository, context, stateInput, options = {}) {
  const state = createAlertRoutingState(stateInput);
  assertTenantBoundValue(state, context.organizationId);
  return write(repository, context, "alert-routing", "state", state, options);
}

export function loadAlertRoutingState(repository, context, options = {}) {
  const value = read(repository, context, "alert-routing", "state", options);
  return value ? createAlertRoutingState(value) : null;
}

export function persistPropertySnapshot(repository, context, snapshotInput, options = {}) {
  const normalized = createPropertySnapshot(snapshotInput);
  const snapshot = { ...normalized, organizationId: normalized.organizationId || context.organizationId, ownerUserId: normalized.ownerUserId || context.actorUserId };
  if (snapshot.organizationId !== context.organizationId) {
    const error = new Error(`Property snapshot organization ${snapshot.organizationId} does not match tenant ${context.organizationId}`); error.code = "WR_TENANT_ISOLATION_VIOLATION"; throw error;
  }
  return write(repository, context, "property-snapshots", snapshot.id, snapshot, options);
}

export function listPropertySnapshots(repository, context, options = {}) {
  if (!repository?.listRecords) throw new TypeError("repository.listRecords is required");
  return repository.listRecords(context, "property-snapshots", options.validation || {}).map((record) => record.value).sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)));
}

export function persistDeliveryAttempt(repository, context, attemptInput, options = {}) {
  const attempt = { ...attemptInput, schemaVersion: ALERT_DELIVERY_ATTEMPT_VERSION };
  const id = required(attempt.id, "deliveryAttempt.id");
  if (attempt.organizationId && attempt.organizationId !== context.organizationId) {
    const error = new Error(`Delivery attempt organization ${attempt.organizationId} does not match tenant ${context.organizationId}`);
    error.code = "WR_TENANT_ISOLATION_VIOLATION";
    throw error;
  }
  return write(repository, context, "delivery-attempts", id, attempt, options);
}

export function listDeliveryAttempts(repository, context, options = {}) {
  if (!repository?.listRecords) throw new TypeError("repository.listRecords is required");
  return repository.listRecords(context, "delivery-attempts", options.validation || {}).map((record) => record.value);
}

export function persistAlertWorkerState(repository, context, stateInput, options = {}) {
  const state = createAlertWorkerState(stateInput);
  if (state.organizationId !== context.organizationId) {
    const error = new Error(`Alert worker organization ${state.organizationId} does not match tenant ${context.organizationId}`);
    error.code = "WR_TENANT_ISOLATION_VIOLATION";
    throw error;
  }
  assertTenantBoundValue(state, context.organizationId);
  return write(repository, context, "alert-worker", "state", state, options);
}

export function loadAlertWorkerState(repository, context, options = {}) {
  const value = read(repository, context, "alert-worker", "state", options);
  return value ? createAlertWorkerState(value) : null;
}

export function persistUnderwritingGovernanceState(repository, context, stateInput, options = {}) {
  const state = createUnderwritingGovernanceState(stateInput);
  if (state.organizationId !== context.organizationId) {
    const error = new Error(`Underwriting organization ${state.organizationId} does not match tenant ${context.organizationId}`);
    error.code = "WR_TENANT_ISOLATION_VIOLATION";
    throw error;
  }
  assertTenantBoundValue(state, context.organizationId);
  return write(repository, context, "underwriting", "governance-state", state, options);
}

export function loadUnderwritingGovernanceState(repository, context, options = {}) {
  const value = read(repository, context, "underwriting", "governance-state", options);
  return value ? createUnderwritingGovernanceState(value) : null;
}

export function persistDealRoomState(repository, context, stateInput, options = {}) {
  const state = createDealRoomState(stateInput);
  if (state.organizationId !== context.organizationId) {
    const error = new Error(`Deal-room organization ${state.organizationId} does not match tenant ${context.organizationId}`);
    error.code = "WR_TENANT_ISOLATION_VIOLATION";
    throw error;
  }
  assertTenantBoundValue(state, context.organizationId);
  return write(repository, context, "deal-room", "state", state, options);
}

export function loadDealRoomState(repository, context, options = {}) {
  const value = read(repository, context, "deal-room", "state", options);
  return value ? createDealRoomState(value) : null;
}

export function persistDocumentEvidenceState(repository, context, stateInput, options = {}) {
  const state = createDocumentEvidenceState(stateInput);
  if (state.organizationId !== context.organizationId) {
    const error = new Error(`Document-evidence organization ${state.organizationId} does not match tenant ${context.organizationId}`);
    error.code = "WR_TENANT_ISOLATION_VIOLATION";
    throw error;
  }
  assertTenantBoundValue(state, context.organizationId);
  return write(repository, context, "document-evidence", "state", state, options);
}

export function loadDocumentEvidenceState(repository, context, options = {}) {
  const value = read(repository, context, "document-evidence", "state", options);
  return value ? createDocumentEvidenceState(value) : null;
}

export function persistDiligenceWorkflow(repository, context, workflowInput, options = {}) {
  const workflow = createDiligenceWorkflow(workflowInput);
  if (workflow.organizationId !== context.organizationId) {
    const error = new Error(`Diligence workflow organization ${workflow.organizationId} does not match tenant ${context.organizationId}`);
    error.code = "WR_TENANT_ISOLATION_VIOLATION";
    throw error;
  }
  assertTenantBoundValue(workflow, context.organizationId);
  return write(repository, context, "diligence", `workflow:${workflow.id}`, workflow, options);
}

export function loadDiligenceWorkflow(repository, context, workflowId, options = {}) {
  const value = read(repository, context, "diligence", `workflow:${required(workflowId, "workflowId")}`, options);
  return value ? createDiligenceWorkflow(value) : null;
}

export function listDiligenceWorkflows(repository, context, options = {}) {
  if (!repository?.listRecordsPage) throw new TypeError("repository.listRecordsPage is required");
  const page = repository.listRecordsPage(context, "diligence", { keyPrefix: "workflow:", afterKey: options.afterKey, limit: options.limit, validation: options.validation || {} });
  return { ...page, records: page.records.map((record) => ({ ...record, value: createDiligenceWorkflow(record.value) })) };
}

export function persistAssetOperationsState(repository, context, stateInput, options = {}) {
  const state = createAssetOperationsState(stateInput);
  if (state.organizationId !== context.organizationId) {
    const error = new Error(`Asset-operations organization ${state.organizationId} does not match tenant ${context.organizationId}`);
    error.code = "WR_TENANT_ISOLATION_VIOLATION";
    throw error;
  }
  assertTenantBoundValue(state, context.organizationId);
  return write(repository, context, "portfolio", "asset-operations-state", state, options);
}

export function loadAssetOperationsState(repository, context, options = {}) {
  const value = read(repository, context, "portfolio", "asset-operations-state", options);
  return value ? createAssetOperationsState(value) : null;
}

export function persistForwardStrategyState(repository, context, stateInput, options = {}) {
  const state = createForwardStrategyState(stateInput);
  if (state.organizationId !== context.organizationId) {
    const error = new Error(`Forward-strategy organization ${state.organizationId} does not match tenant ${context.organizationId}`);
    error.code = "WR_TENANT_ISOLATION_VIOLATION";
    throw error;
  }
  assertTenantBoundValue(state, context.organizationId);
  return write(repository, context, "portfolio", "forward-strategy-state", state, options);
}

export function loadForwardStrategyState(repository, context, options = {}) {
  const value = read(repository, context, "portfolio", "forward-strategy-state", options);
  return value ? createForwardStrategyState(value) : null;
}

export function persistOperatingControlState(repository, context, stateInput, options = {}) {
  const state = createOperatingControlState(stateInput);
  if (state.organizationId !== context.organizationId) {
    const error = new Error(`Operating-control organization ${state.organizationId} does not match tenant ${context.organizationId}`);
    error.code = "WR_TENANT_ISOLATION_VIOLATION";
    throw error;
  }
  assertTenantBoundValue(state, context.organizationId);
  return write(repository, context, "operating-feed", "control-state", state, options);
}

export function loadOperatingControlState(repository, context, options = {}) {
  const value = read(repository, context, "operating-feed", "control-state", options);
  return value ? createOperatingControlState(value) : null;
}

export function persistOperatingConnectorWorkerState(repository, context, stateInput, options = {}) {
  const state = createOperatingConnectorWorkerState(stateInput);
  if (state.organizationId !== context.organizationId) {
    const error = new Error(`Operating-connector organization ${state.organizationId} does not match tenant ${context.organizationId}`);
    error.code = "WR_TENANT_ISOLATION_VIOLATION";
    throw error;
  }
  assertTenantBoundValue(state, context.organizationId);
  return write(repository, context, "operating-feed", "connector-worker-state", state, options);
}

export function loadOperatingConnectorWorkerState(repository, context, options = {}) {
  const value = read(repository, context, "operating-feed", "connector-worker-state", options);
  return value ? createOperatingConnectorWorkerState(value) : null;
}

export function persistConnectorAssuranceState(repository, context, stateInput, options = {}) {
  const state = createConnectorAssuranceState(stateInput);
  if (state.organizationId !== context.organizationId) {
    const error = new Error(`Connector-assurance organization ${state.organizationId} does not match tenant ${context.organizationId}`);
    error.code = "WR_TENANT_ISOLATION_VIOLATION";
    throw error;
  }
  assertTenantBoundValue(state, context.organizationId);
  return write(repository, context, "operating-feed", "connector-assurance-state", state, options);
}

export function loadConnectorAssuranceState(repository, context, options = {}) {
  const value = read(repository, context, "operating-feed", "connector-assurance-state", options);
  return value ? createConnectorAssuranceState(value) : null;
}

export function persistProviderExecutionState(repository, context, stateInput, options = {}) {
  const state = createProviderExecutionState(stateInput);
  if (state.organizationId !== context.organizationId) {
    const error = new Error(`Provider-execution organization ${state.organizationId} does not match tenant ${context.organizationId}`);
    error.code = "WR_TENANT_ISOLATION_VIOLATION";
    throw error;
  }
  return write(repository, context, "operating-feed", `provider-execution:${encodeURIComponent(state.connectorId)}`, state, options);
}

export function loadProviderExecutionState(repository, context, connectorId, options = {}) {
  const value = read(repository, context, "operating-feed", `provider-execution:${encodeURIComponent(required(connectorId, "connectorId"))}`, options);
  return value ? createProviderExecutionState(value) : null;
}

export function persistVendorSandboxCertificationPack(repository, context, packInput, options = {}) {
  const pack = validateVendorSandboxCertificationPack(packInput);
  if (pack.organizationId !== context.organizationId) {
    const error = new Error(`Vendor-pack organization ${pack.organizationId} does not match tenant ${context.organizationId}`);
    error.code = "WR_TENANT_ISOLATION_VIOLATION";
    throw error;
  }
  return write(repository, context, "operating-feed", `vendor-sandbox-pack:${pack.id}`, pack, options);
}

export function loadVendorSandboxCertificationPack(repository, context, packId, options = {}) {
  const value = read(repository, context, "operating-feed", `vendor-sandbox-pack:${required(packId, "packId")}`, options);
  return value ? validateVendorSandboxCertificationPack(value) : null;
}

export function persistProviderGovernanceState(repository, context, stateInput, options = {}) {
  const state = createProviderGovernanceState(stateInput);
  if (state.organizationId !== context.organizationId) {
    const error = new Error(`Provider-governance organization ${state.organizationId} does not match tenant ${context.organizationId}`);
    error.code = "WR_TENANT_ISOLATION_VIOLATION";
    throw error;
  }
  assertTenantBoundValue(state, context.organizationId);
  return write(repository, context, "operating-feed", "provider-governance-state", state, options);
}

export function loadProviderGovernanceState(repository, context, options = {}) {
  const value = read(repository, context, "operating-feed", "provider-governance-state", options);
  return value ? createProviderGovernanceState(value) : null;
}

export function persistCountyReleaseState(repository, context, stateInput, options = {}) {
  if (String(stateInput?.organizationId || "") !== context.organizationId) {
    const error = new Error(`County-release organization ${String(stateInput?.organizationId || "<empty>")} does not match tenant ${context.organizationId}`);
    error.code = "WR_TENANT_ISOLATION_VIOLATION";
    throw error;
  }
  const state = createCountyReleaseState(stateInput);
  if (state.organizationId !== context.organizationId) {
    const error = new Error(`County-release organization ${state.organizationId} does not match tenant ${context.organizationId}`);
    error.code = "WR_TENANT_ISOLATION_VIOLATION";
    throw error;
  }
  assertTenantBoundValue(state, context.organizationId);
  return write(repository, context, "release-control", `county-release:${encodeURIComponent(state.countyId)}`, state, options);
}

export function loadCountyReleaseState(repository, context, countyId, options = {}) {
  const value = read(repository, context, "release-control", `county-release:${encodeURIComponent(required(countyId, "countyId"))}`, options);
  return value ? createCountyReleaseState(value) : null;
}

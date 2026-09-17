import { assertPersistenceGrant } from "../persistence/persistenceContracts.mjs";
import { computeReleaseAttestationSha256, verifyPlatformReleaseManifest, verifyReleaseEvidenceAttestation } from "./releaseActivation.mjs";
import { trustStoreFromReleaseState } from "./releaseEvidenceRegistry.mjs";

export const STAGING_ACTIVATION_RUN_VERSION = "wr-staging-activation-run-v1";
export const STAGING_GATE_TRANSACTION_VERSION = "wr-staging-gate-transaction-v1";

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function iso(value, name) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`);
  return date.toISOString();
}

function requireActivationContext(context, organizationId) {
  assertPersistenceGrant(context, "release:activate-staging");
  if (context.organizationId !== organizationId) { const error = new Error("Activation manifest belongs to another tenant"); error.code = "WR_TENANT_ISOLATION_VIOLATION"; throw error; }
}

export function createInMemoryStagingGateAdapter({ initialStates = {}, failTransactions = [] } = {}) {
  const states = new Map(Object.entries(initialStates).map(([gate, enabled]) => [gate, enabled === true]));
  const failures = new Set(failTransactions.map(String));
  const receipts = new Map();
  return Object.freeze({
    readGateStates(gates = []) { return Object.fromEntries(gates.map((gate) => [gate, states.get(gate) === true])); },
    applyGateTransaction(input = {}) {
      const idempotencyKey = required(input.idempotencyKey, "idempotencyKey");
      const request = JSON.stringify({ expectedStates: input.expectedStates || {}, changes: input.changes || {} });
      const prior = receipts.get(idempotencyKey);
      if (prior) {
        if (prior.request !== request) { const error = new Error("Gate transaction idempotency conflict"); error.code = "WR_IDEMPOTENCY_CONFLICT"; throw error; }
        return { ...prior.receipt, replayed: true };
      }
      if (failures.has(idempotencyKey)) { const error = new Error(`Injected gate transaction failure: ${idempotencyKey}`); error.code = "WR_GATE_TRANSACTION_FAILURE"; throw error; }
      for (const [gate, expected] of Object.entries(input.expectedStates || {})) if ((states.get(gate) === true) !== (expected === true)) { const error = new Error(`Gate state conflict for ${gate}`); error.code = "WR_GATE_STATE_CONFLICT"; throw error; }
      for (const [gate, enabled] of Object.entries(input.changes || {})) states.set(gate, enabled === true);
      const receipt = { schemaVersion: STAGING_GATE_TRANSACTION_VERSION, idempotencyKey, changedGates: Object.keys(input.changes || {}).sort(), resultingStates: Object.fromEntries(Object.keys(input.changes || {}).sort().map((gate) => [gate, states.get(gate) === true])), replayed: false };
      receipts.set(idempotencyKey, { request, receipt });
      return receipt;
    },
  });
}

function persistRun(repository, context, run, options = {}) {
  if (!repository?.commit) return null;
  return repository.commit({ context, namespace: "release-control", key: `activation-run:${run.id}`, value: run, expectedTenantRevision: options.expectedTenantRevision, expectedRecordRevision: options.expectedRecordRevision, idempotencyKey: options.idempotencyKey, occurredAt: options.occurredAt }, options.validation || {});
}

async function verifyCurrentEvidence(manifest, trustStore, evidenceResolver, asOf) {
  const results = [];
  for (const decision of manifest.decisions || []) {
    for (const [kind, hashes] of [["evidence", decision.evidenceAttestationSha256s || []], ["approval", decision.approvalAttestationSha256s || []]]) {
      for (const hash of hashes) {
        const entry = await evidenceResolver(hash);
        const attestation = entry?.content || entry?.attestation || entry;
        const digestMatches = Boolean(attestation) && computeReleaseAttestationSha256(attestation) === hash;
        const verification = digestMatches ? verifyReleaseEvidenceAttestation(attestation, { trustStore, asOf, expectedOrganizationId: manifest.organizationId, expectedCapabilityId: decision.capabilityId }) : { valid: false, checks: [{ id: "registry-digest", passed: false, reason: "Attestation is missing or content digest changed." }] };
        results.push({ capabilityId: decision.capabilityId, kind, contentSha256: hash, valid: digestMatches && verification.valid, verification });
      }
    }
  }
  return results;
}

export function createStagingActivationController({ gateAdapter, evidenceResolver, healthEvaluator = async () => ({ healthy: true, abortSignals: [] }), repository = null, context = null, clock = () => new Date().toISOString() } = {}) {
  if (!gateAdapter?.readGateStates || !gateAdapter?.applyGateTransaction) throw new TypeError("A transactional staging gate adapter is required");
  if (typeof evidenceResolver !== "function") throw new TypeError("evidenceResolver is required");
  return Object.freeze({
    async execute(input = {}) {
      const manifest = input.manifest;
      const asOf = iso(input.asOf || clock(), "asOf");
      const runContext = input.context || context;
      requireActivationContext(runContext, manifest?.organizationId);
      if (manifest?.environment !== "staging") { const error = new Error("This controller can activate staging manifests only"); error.code = "WR_PRODUCTION_ACTIVATION_PROHIBITED"; throw error; }
      const trustStore = trustStoreFromReleaseState(input.trustState);
      const manifestVerification = verifyPlatformReleaseManifest(manifest, { trustStore, asOf, expectedOrganizationId: runContext.organizationId });
      const evidenceVerification = manifestVerification.valid ? await verifyCurrentEvidence(manifest, trustStore, evidenceResolver, asOf) : [];
      const gates = [...new Set((manifest.decisions || []).flatMap((decision) => decision.candidate?.featureGates || []))].sort();
      const initialStates = gateAdapter.readGateStates(gates);
      const blockers = [];
      if (!manifestVerification.activationAuthorized) blockers.push({ code: "WR_MANIFEST_INVALID", reason: "Signed platform manifest is invalid or expired." });
      evidenceVerification.filter((item) => !item.valid).forEach((item) => blockers.push({ code: "WR_ATTESTATION_INVALID", reason: `${item.kind} attestation ${item.contentSha256} failed current verification.` }));
      Object.entries(initialStates).filter(([, enabled]) => enabled).forEach(([gate]) => blockers.push({ code: "WR_GATE_ALREADY_ENABLED", reason: `Staging gate is already enabled: ${gate}` }));
      const runId = required(input.runId, "runId");
      const mode = input.mode === "staging" ? "staging" : "dry-run";
      const baseRun = {
        schemaVersion: STAGING_ACTIVATION_RUN_VERSION,
        id: runId,
        organizationId: runContext.organizationId,
        releaseId: manifest.releaseId,
        manifestSha256: manifest.manifestSha256,
        environment: "staging",
        mode,
        requestedBy: runContext.actorUserId,
        startedAt: asOf,
        completedAt: "",
        status: blockers.length ? "rejected" : mode === "dry-run" ? "validated" : "prepared",
        gates,
        initialStates,
        finalStates: initialStates,
        manifestVerification,
        evidenceVerification,
        blockers,
        health: null,
        transactions: [],
      };
      if (blockers.length || mode === "dry-run") {
        const finalRun = Object.freeze({ ...baseRun, completedAt: iso(input.completedAt || clock(), "completedAt") });
        if (repository) persistRun(repository, runContext, finalRun, { expectedTenantRevision: input.expectedTenantRevision, expectedRecordRevision: 0, idempotencyKey: `activation:${runId}:final`, occurredAt: finalRun.completedAt, validation: input.validation || {} });
        return finalRun;
      }
      if (input.allowStagingMutation !== true) { const error = new Error("allowStagingMutation=true is required for staging gate changes"); error.code = "WR_STAGING_MUTATION_NOT_AUTHORIZED"; throw error; }
      if (!repository) throw new TypeError("A durable release-control repository is required for staging mutations");
      const preparedReceipt = persistRun(repository, runContext, baseRun, { expectedTenantRevision: input.expectedTenantRevision, expectedRecordRevision: 0, idempotencyKey: `activation:${runId}:prepared`, occurredAt: asOf, validation: input.validation || {} });
      const enabledStates = Object.fromEntries(gates.map((gate) => [gate, true]));
      const disabledStates = Object.fromEntries(gates.map((gate) => [gate, false]));
      const transactions = [];
      let enableReceipt;
      try {
        enableReceipt = gateAdapter.applyGateTransaction({ expectedStates: disabledStates, changes: enabledStates, idempotencyKey: `${runId}:enable` });
        transactions.push(enableReceipt);
      } catch (error) {
        const failedRun = { ...baseRun, status: "enable-failed", completedAt: iso(clock(), "completedAt"), blockers: [...blockers, { code: String(error.code || "WR_GATE_TRANSACTION_FAILURE"), reason: String(error.message || error) }], transactions };
        if (repository) persistRun(repository, runContext, failedRun, { expectedTenantRevision: preparedReceipt.tenantRevision, expectedRecordRevision: 1, idempotencyKey: `activation:${runId}:enable-failed`, occurredAt: failedRun.completedAt, validation: input.validation || {} });
        return Object.freeze(failedRun);
      }
      let health;
      try { health = await healthEvaluator({ manifest, gates, runId, asOf: iso(clock(), "healthEvaluatedAt") }); }
      catch (error) { health = { healthy: false, abortSignals: [String(error.code || "health-evaluator-error")], error: String(error.message || error) }; }
      const declaredSignals = new Set((manifest.decisions || []).flatMap((decision) => decision.rollbackPlan?.abortSignals || []));
      const observedSignals = (health?.abortSignals || []).map(String);
      const mustRollback = health?.healthy !== true || observedSignals.length > 0;
      let status = "active";
      const rollbackErrors = [];
      if (mustRollback) {
        try {
          const rollbackReceipt = gateAdapter.applyGateTransaction({ expectedStates: enabledStates, changes: disabledStates, idempotencyKey: `${runId}:rollback` });
          transactions.push(rollbackReceipt);
          status = "rolled-back";
        } catch (error) {
          rollbackErrors.push({ code: String(error.code || "WR_GATE_TRANSACTION_FAILURE"), message: String(error.message || error), attempt: "primary" });
          try {
            const emergencyReceipt = gateAdapter.applyGateTransaction({ expectedStates: enabledStates, changes: disabledStates, idempotencyKey: `${runId}:rollback-emergency` });
            transactions.push(emergencyReceipt);
            status = "rolled-back";
          } catch (emergencyError) {
            rollbackErrors.push({ code: String(emergencyError.code || "WR_GATE_TRANSACTION_FAILURE"), message: String(emergencyError.message || emergencyError), attempt: "emergency" });
            status = "rollback-failed";
          }
        }
      }
      const completedAt = iso(clock(), "completedAt");
      const finalStates = gateAdapter.readGateStates(gates);
      const finalRun = { ...baseRun, status, completedAt, finalStates, health: { ...(health || {}), declaredAbortSignals: [...declaredSignals], undeclaredAbortSignals: observedSignals.filter((signal) => !declaredSignals.has(signal)), rollbackErrors }, transactions };
      try {
        if (repository) persistRun(repository, runContext, finalRun, { expectedTenantRevision: preparedReceipt.tenantRevision, expectedRecordRevision: 1, idempotencyKey: `activation:${runId}:final`, occurredAt: completedAt, validation: input.validation || {} });
      } catch (error) {
        if (status === "active") {
          try { gateAdapter.applyGateTransaction({ expectedStates: enabledStates, changes: disabledStates, idempotencyKey: `${runId}:journal-failure-rollback` }); } catch {}
        }
        const failure = new Error("Final activation journal commit failed; staging gates were rolled back");
        failure.code = "WR_ACTIVATION_JOURNAL_FAILURE";
        failure.cause = error;
        throw failure;
      }
      if (status === "rollback-failed") {
        const failure = new Error("Staging activation rollback failed after primary and emergency attempts");
        failure.code = "WR_ACTIVATION_ROLLBACK_FAILED";
        failure.run = finalRun;
        throw failure;
      }
      return Object.freeze(finalRun);
    },
  });
}

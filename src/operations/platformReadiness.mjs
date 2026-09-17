export const PLATFORM_CAPABILITY_REGISTRY_VERSION = "wr-platform-capability-registry-v1";
export const PLATFORM_READINESS_MATRIX_VERSION = "wr-platform-readiness-matrix-v1";

function iso(value, name) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`);
  return date.toISOString();
}

export function createPlatformReadinessMatrix(input = {}) {
  const registry = input.registry;
  if (registry?.schemaVersion !== PLATFORM_CAPABILITY_REGISTRY_VERSION) throw new TypeError("A wr-platform-capability-registry-v1 registry is required");
  const stages = new Set();
  const capabilityIds = new Set();
  const gateStates = input.featureGateStates || {};
  const inventory = input.evidenceInventory || {};
  const decisionVerifications = input.releaseDecisionVerifications || [];
  const resolvedBlockers = input.resolvedExternalBlockers || {};
  const capabilities = registry.capabilities.map((capability) => {
    if (!Number.isInteger(capability.stage) || capability.stage < 1 || capability.stage > 10 || stages.has(capability.stage)) throw new TypeError(`Invalid or duplicate roadmap stage: ${capability.stage}`);
    if (!capability.capabilityId || capabilityIds.has(capability.capabilityId)) throw new TypeError(`Invalid or duplicate capability ID: ${capability.capabilityId}`);
    stages.add(capability.stage);
    capabilityIds.add(capability.capabilityId);
    const missingFoundationEvidence = capability.foundationEvidence.filter((reference) => !inventory[reference]?.exists);
    const unknownFeatureGates = capability.featureGates.filter((gate) => typeof gateStates[gate] !== "boolean");
    const enabledFeatureGates = capability.featureGates.filter((gate) => gateStates[gate] === true);
    const resolved = new Set(resolvedBlockers[capability.capabilityId] || []);
    const externalBlockers = capability.externalBlockers.filter((blocker) => !resolved.has(blocker));
    const verifiedDecision = decisionVerifications.find((item) => item?.decision?.capabilityId === capability.capabilityId && item?.verification?.valid === true && item?.verification?.activationAuthorized === true && item.decision.activationAuthorized === true);
    const unsafeConfiguration = enabledFeatureGates.length > 0 && !verifiedDecision;
    const activationAuthorized = Boolean(verifiedDecision) && !missingFoundationEvidence.length && !unknownFeatureGates.length && !externalBlockers.length && !unsafeConfiguration;
    let status = "release-evidence-needed";
    if (unsafeConfiguration) status = "unsafe-configuration";
    else if (missingFoundationEvidence.length || unknownFeatureGates.length) status = "foundation-incomplete";
    else if (externalBlockers.length) status = "foundation-complete-external-blockers";
    else if (activationAuthorized) status = "activation-authorized";
    return {
      stage: capability.stage,
      capabilityId: capability.capabilityId,
      name: capability.name,
      status,
      activationAuthorized,
      featureGates: capability.featureGates.map((gate) => ({ gate, enabled: gateStates[gate] === true, known: typeof gateStates[gate] === "boolean" })),
      foundationEvidence: capability.foundationEvidence.map((reference) => ({ reference, ...(inventory[reference] || { exists: false }) })),
      requiredReleaseEvidence: capability.requiredReleaseEvidence,
      externalBlockers,
      missingFoundationEvidence,
      unknownFeatureGates,
      enabledFeatureGates,
      verifiedDecisionSha256: verifiedDecision?.decision?.decisionSha256 || "",
    };
  }).sort((a, b) => a.stage - b.stage);
  if (capabilities.length !== 10 || stages.size !== 10) throw new TypeError("The platform readiness matrix must cover all 10 roadmap stages exactly once");
  const summary = {
    capabilityCount: capabilities.length,
    activationAuthorizedCount: capabilities.filter((item) => item.activationAuthorized).length,
    externalBlockedCount: capabilities.filter((item) => item.status === "foundation-complete-external-blockers").length,
    foundationIncompleteCount: capabilities.filter((item) => item.status === "foundation-incomplete").length,
    releaseEvidenceNeededCount: capabilities.filter((item) => item.status === "release-evidence-needed").length,
    unsafeConfigurationCount: capabilities.filter((item) => item.status === "unsafe-configuration").length,
    enabledFeatureGateCount: capabilities.flatMap((item) => item.enabledFeatureGates).length,
  };
  return Object.freeze({
    schemaVersion: PLATFORM_READINESS_MATRIX_VERSION,
    organizationId: registry.organizationId,
    generatedAt: iso(input.generatedAt, "generatedAt"),
    activationPolicy: "Fail closed: a capability needs complete foundation artifacts, resolved external blockers, known disabled pre-activation gates, and a valid signed release decision before activation can be authorized.",
    summary,
    observedFacts: structuredClone(input.observedFacts || {}),
    capabilities,
  });
}

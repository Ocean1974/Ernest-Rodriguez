export const ACQUISITION_HANDOFF_WORKFLOW_VERSION: "wr-acquisition-handoff-workflow-v1";
export const ACQUISITION_HANDOFF_VERSION: "wr-acquisition-handoff-v1";
export const ACQUISITION_HANDOFF_LEDGER_VERSION: "wr-acquisition-handoff-ledger-v1";
export const ACQUISITION_HANDOFF_RESULT_VERSION: "wr-acquisition-handoff-result-v1";
export const HANDOFF_PROFILE_PROVIDER_VERSION: "wr-acquisition-handoff-profile-provider-v1";
export const UNDERWRITING_EVIDENCE_PROVIDER_VERSION: "wr-underwriting-evidence-provider-v1";
export const UNDERWRITING_EVIDENCE_PACK_VERSION: "wr-underwriting-evidence-pack-v1";
export function createAcquisitionHandoffWorkflow(input?: Record<string, any>): Readonly<{ schemaVersion: string; activationAuthorized: boolean; create(input?: Record<string, any>, context?: Record<string, any>): Promise<Record<string, any>> }>;

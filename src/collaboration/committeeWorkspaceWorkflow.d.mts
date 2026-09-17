export const COMMITTEE_WORKSPACE_WORKFLOW_VERSION: "wr-committee-workspace-workflow-v1";
export const COMMITTEE_WORKSPACE_VERSION: "wr-committee-workspace-v1";
export const COMMITTEE_WORKSPACE_LEDGER_VERSION: "wr-committee-workspace-ledger-v1";
export const COMMITTEE_WORKSPACE_RESULT_VERSION: "wr-committee-workspace-result-v1";
export const COMMITTEE_WORKSPACE_PROVIDER_VERSION: "wr-committee-workspace-provider-v1";
export const COMMITTEE_WORKSPACE_PACK_VERSION: "wr-committee-workspace-pack-v1";
export function createCommitteeWorkspaceWorkflow(input?: Record<string, any>): Readonly<{ schemaVersion: string; activationAuthorized: boolean; create(input?: Record<string, any>, context?: Record<string, any>): Promise<Record<string, any>> }>;

export declare const OPPORTUNITY_DECISION_WORKFLOW_VERSION: "wr-opportunity-decision-workflow-v1";
export declare const OPPORTUNITY_DECISION_VERSION: "wr-opportunity-decision-v1";
export declare const OPPORTUNITY_DECISION_LEDGER_VERSION: "wr-opportunity-decision-ledger-v1";
export declare const OPPORTUNITY_EVALUATION_RESULT_VERSION: "wr-opportunity-evaluation-result-v1";
export declare const CERTIFIED_SIGNAL_MODEL_PACK_VERSION: "wr-certified-signal-model-pack-v1";
export declare const SIGNAL_OBSERVATION_PROVIDER_VERSION: "wr-signal-observation-provider-v1";
export declare const OPPORTUNITY_PROFILE_PROVIDER_VERSION: "wr-opportunity-profile-provider-v1";
export declare function createOpportunityDecisionWorkflow(options: Record<string, unknown>): { readonly schemaVersion: typeof OPPORTUNITY_DECISION_WORKFLOW_VERSION; readonly activationAuthorized: boolean; evaluate(input?: Record<string, unknown>, context?: Record<string, unknown>): Promise<Record<string, unknown>> };

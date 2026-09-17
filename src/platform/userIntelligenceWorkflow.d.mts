export declare const USER_INTELLIGENCE_WORKFLOW_VERSION: "wr-user-intelligence-workflow-v1";
export declare const USER_INTELLIGENCE_OPERATION_RESULT_VERSION: "wr-user-intelligence-operation-result-v1";
export declare const USER_INTELLIGENCE_EVALUATION_RESULT_VERSION: "wr-user-intelligence-evaluation-result-v1";
export declare const SAVED_SEARCH_MONITOR_EXECUTOR_VERSION: "wr-saved-search-monitor-executor-v1";
export declare const PROPERTY_PROFILE_MONITOR_PROVIDER_VERSION: "wr-property-profile-monitor-provider-v1";
export declare function createUserIntelligenceWorkflow(options: Record<string, unknown>): {
  readonly schemaVersion: typeof USER_INTELLIGENCE_WORKFLOW_VERSION;
  readonly activationAuthorized: boolean;
  inspect(context: Record<string, unknown>, input?: Record<string, unknown>): Record<string, unknown>;
  saveSearch(input?: Record<string, unknown>, context?: Record<string, unknown>): Promise<Record<string, unknown>>;
  saveWatchlist(input?: Record<string, unknown>, context?: Record<string, unknown>): Promise<Record<string, unknown>>;
  deleteSearch(input?: Record<string, unknown>, context?: Record<string, unknown>): Promise<Record<string, unknown>>;
  deleteWatchlist(input?: Record<string, unknown>, context?: Record<string, unknown>): Promise<Record<string, unknown>>;
  evaluateSavedSearch(input?: Record<string, unknown>, context?: Record<string, unknown>): Promise<Record<string, unknown>>;
  evaluateWatchlist(input?: Record<string, unknown>, context?: Record<string, unknown>): Promise<Record<string, unknown>>;
};

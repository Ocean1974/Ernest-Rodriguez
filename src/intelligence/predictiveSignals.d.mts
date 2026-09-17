export const SIGNAL_MODEL_VERSION: "wr-predictive-signal-model-v1";
export const SIGNAL_OBSERVATION_VERSION: "wr-market-signal-observation-v1";
export const POINT_IN_TIME_FEATURE_SET_VERSION: "wr-point-in-time-feature-set-v1";
export const EXPLAINABLE_SIGNAL_SCORE_VERSION: "wr-explainable-signal-score-v1";
export function createPredictiveSignalModel(input?: Record<string, any>): Record<string, any>;
export function createSignalObservation(input?: Record<string, any>): Record<string, any>;
export function assemblePointInTimeFeatures(input?: Record<string, any>): Record<string, any>;
export function composeExplainableSignalScore(featureSet: Record<string, any>): Record<string, any>;

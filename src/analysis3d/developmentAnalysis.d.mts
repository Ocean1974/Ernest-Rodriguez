export const DEVELOPMENT_SITE_MODEL_VERSION: "wr-development-site-model-v1";
export const DEVELOPMENT_FEASIBILITY_VERSION: "wr-development-feasibility-v1";
export const SHADOW_ANALYSIS_VERSION: "wr-shadow-analysis-v1";
export const LINE_OF_SIGHT_VERSION: "wr-line-of-sight-v1";
export function createDevelopmentSiteModel(input?: Record<string, any>): Record<string, any>;
export function createMassingProposal(input?: Record<string, any>): Record<string, any>;
export function evaluateDevelopmentFeasibility(site: Record<string, any>, proposal: Record<string, any>): Record<string, any>;
export function calculateShadow(input?: Record<string, any>): Record<string, any>;
export function analyzeLineOfSight(input?: Record<string, any>): Record<string, any>;

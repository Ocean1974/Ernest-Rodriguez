export const DOCUMENT_EVIDENCE_STATE_VERSION: "wr-document-evidence-state-v1";
export function createDocumentEvidenceState(input?: Record<string, any>): Record<string, any>;
export function addDocumentExtractionRun(state: Record<string, any>, run: Record<string, any>, context?: Record<string, any>): Record<string, any>;
export function addDocumentCitationVerification(state: Record<string, any>, verification: Record<string, any>, context?: Record<string, any>): Record<string, any>;
export function addDocumentExtractionReview(state: Record<string, any>, review: Record<string, any>, context?: Record<string, any>): Record<string, any>;
export function addReviewedFactPromotion(state: Record<string, any>, promotion: Record<string, any>, context?: Record<string, any>): Record<string, any>;

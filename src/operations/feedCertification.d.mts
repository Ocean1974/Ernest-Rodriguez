export const FEED_CONNECTOR_MANIFEST_VERSION: "wr-feed-connector-manifest-v1";
export const FEED_CERTIFICATION_EVIDENCE_VERSION: "wr-feed-certification-evidence-v1";
export const FEED_CERTIFICATION_DECISION_VERSION: "wr-feed-certification-decision-v1";
export function createFeedConnectorManifest(input?: Record<string, unknown>): Readonly<Record<string, unknown>>;
export function createFeedCertificationEvidence(input?: Record<string, unknown>): Readonly<Record<string, unknown>>;
export function certifyFeedConnector(input?: Record<string, unknown>): Readonly<Record<string, unknown>>;

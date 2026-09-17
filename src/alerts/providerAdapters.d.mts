export const REFERENCE_RESOLUTION_VERSION: "wr-reference-resolution-v1";
export const DESTINATION_POLICY_VERSION: "wr-alert-destination-policy-v1";
export const PROVIDER_CIRCUIT_STATE_VERSION: "wr-provider-circuit-state-v1";
export const WEBHOOK_SIGNATURE_VERSION: "wr-webhook-signature-v1";
export class ReferenceResolutionError extends Error { code: string; }
export function createScopedReferenceResolver(options?: Record<string, any>): Readonly<Record<string, any>>;
export function createDestinationPolicy(input?: Record<string, any>): Readonly<Record<string, any>>;
export function validateEmailDestination(address: string, policyInput?: Record<string, any>): string;
export function isPublicNetworkAddress(address: string): boolean;
export function validateWebhookDestination(value: string, policyInput?: Record<string, any>): string;
export function signWebhookPayload(payload: unknown, secret: string, timestamp: string): Readonly<Record<string, any>>;
export function createEmailProviderAdapter(options?: Record<string, any>): Readonly<Record<string, any>>;
export function createWebhookProviderAdapter(options?: Record<string, any>): Readonly<Record<string, any>>;
export function createFetchWebhookTransport(options?: Record<string, any>): Readonly<Record<string, any>>;
export function createCircuitBreakerProvider(provider: Record<string, any>, options?: Record<string, any>): Readonly<Record<string, any>>;

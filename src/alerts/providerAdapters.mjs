import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";

export const REFERENCE_RESOLUTION_VERSION = "wr-reference-resolution-v1";
export const DESTINATION_POLICY_VERSION = "wr-alert-destination-policy-v1";
export const PROVIDER_CIRCUIT_STATE_VERSION = "wr-provider-circuit-state-v1";
export const WEBHOOK_SIGNATURE_VERSION = "wr-webhook-signature-v1";

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function iso(value, name) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid date`);
  return date.toISOString();
}

function providerFailure(errorCode, errorMessage, retryable = true) {
  return { success: false, retryable, providerMessageId: "", errorCode, errorMessage };
}

export class ReferenceResolutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReferenceResolutionError";
    this.code = code;
  }
}

export function createScopedReferenceResolver({ prefix, entries = {} } = {}) {
  const normalizedPrefix = required(prefix, "prefix");
  const records = new Map(Object.entries(entries));
  return Object.freeze({
    schemaVersion: REFERENCE_RESOLUTION_VERSION,
    async resolve(reference, context = {}) {
      const ref = required(reference, "reference");
      if (!ref.startsWith(normalizedPrefix)) throw new ReferenceResolutionError("WR_REFERENCE_PREFIX_INVALID", `Reference must start with ${normalizedPrefix}`);
      const record = records.get(ref);
      if (!record) throw new ReferenceResolutionError("WR_REFERENCE_NOT_FOUND", `Reference not found: ${ref}`);
      if (record.organizationId !== context.organizationId) throw new ReferenceResolutionError("WR_REFERENCE_TENANT_DENIED", `Reference ${ref} is not available to organization ${context.organizationId}`);
      return structuredClone(record.value);
    },
  });
}

export function createDestinationPolicy(input = {}) {
  return Object.freeze({
    schemaVersion: DESTINATION_POLICY_VERSION,
    allowedEmailDomains: [...new Set((input.allowedEmailDomains || []).map((item) => String(item).trim().toLowerCase()).filter(Boolean))],
    allowedWebhookOrigins: [...new Set((input.allowedWebhookOrigins || []).map((item) => new URL(String(item)).origin.toLowerCase()))],
    requireHttps: input.requireHttps !== false,
  });
}

export function validateEmailDestination(address, policyInput = {}) {
  const policy = createDestinationPolicy(policyInput);
  const normalized = required(address, "email address").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new TypeError("Email destination is invalid");
  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
  if (!policy.allowedEmailDomains.includes(domain)) {
    const error = new Error(`Email domain is not allowlisted: ${domain}`);
    error.code = "WR_DESTINATION_NOT_ALLOWED";
    throw error;
  }
  return normalized;
}

function privateIpv4(address) {
  const octets = address.split(".").map(Number);
  return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 ||
    (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && (octets[1] === 0 || octets[1] === 168)) ||
    (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19 || (octets[1] === 51 && octets[2] === 100))) ||
    (octets[0] === 203 && octets[1] === 0 && octets[2] === 113) ||
    octets[0] >= 224;
}

export function isPublicNetworkAddress(address) {
  const normalized = String(address || "").toLowerCase().split("%")[0];
  const family = isIP(normalized);
  if (family === 4) return !privateIpv4(normalized);
  if (family === 6) {
    if (normalized.startsWith("::ffff:")) return isPublicNetworkAddress(normalized.slice(7));
    return normalized !== "::" && normalized !== "::1" && !normalized.startsWith("fc") && !normalized.startsWith("fd") && !normalized.startsWith("fe8") && !normalized.startsWith("fe9") && !normalized.startsWith("fea") && !normalized.startsWith("feb") && !normalized.startsWith("ff") && !normalized.startsWith("2001:db8:");
  }
  return false;
}

export function validateWebhookDestination(value, policyInput = {}) {
  const policy = createDestinationPolicy(policyInput);
  const url = new URL(required(value, "webhook URL"));
  if (url.username || url.password) throw new TypeError("Webhook URL must not contain credentials");
  if (policy.requireHttps && url.protocol !== "https:") {
    const error = new Error("Webhook URL must use HTTPS");
    error.code = "WR_DESTINATION_NOT_ALLOWED";
    throw error;
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || (isIP(hostname) && !isPublicNetworkAddress(hostname))) {
    const error = new Error(`Webhook host is not public: ${hostname}`);
    error.code = "WR_DESTINATION_NOT_ALLOWED";
    throw error;
  }
  if (!policy.allowedWebhookOrigins.includes(url.origin.toLowerCase())) {
    const error = new Error(`Webhook origin is not allowlisted: ${url.origin}`);
    error.code = "WR_DESTINATION_NOT_ALLOWED";
    throw error;
  }
  return url.toString();
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

export function signWebhookPayload(payload, secret, timestamp) {
  const body = canonicalJson(payload);
  const signedAt = iso(timestamp, "timestamp");
  const signature = createHmac("sha256", required(secret, "webhook signing secret")).update(`${signedAt}.${body}`).digest("hex");
  return Object.freeze({ schemaVersion: WEBHOOK_SIGNATURE_VERSION, body, signedAt, signature: `v1=${signature}`, bodySha256: createHash("sha256").update(body).digest("hex") });
}

export function createEmailProviderAdapter({ secretResolver, payloadResolver, transport, destinationPolicy, credentialRef, clock = () => new Date().toISOString() } = {}) {
  if (!secretResolver?.resolve || !payloadResolver?.resolve || !transport?.send) throw new TypeError("secretResolver, payloadResolver, and transport.send are required");
  return Object.freeze({
    async send(request) {
      if (request.channelType !== "email") return providerFailure("channel-mismatch", "Email adapter received a non-email request", false);
      const context = { organizationId: request.organizationId, purpose: "alert-email" };
      const [destination, credential, payload] = await Promise.all([
        secretResolver.resolve(request.endpointRef, context),
        secretResolver.resolve(required(credentialRef, "credentialRef"), context),
        payloadResolver.resolve(request.payloadRef, context),
      ]);
      const to = validateEmailDestination(destination.address, destinationPolicy);
      const result = await transport.send({ to, payload, credential, idempotencyKey: request.idempotencyKey, occurredAt: iso(clock(), "clock") });
      if (result?.accepted === true) return { success: true, retryable: false, providerMessageId: String(result.messageId || ""), providerIdempotentReplay: result.idempotentReplay === true };
      const status = Number(result?.statusCode || 0);
      const retryable = status === 408 || status === 425 || status === 429 || status >= 500 || status === 0;
      return providerFailure(String(result?.errorCode || `email-http-${status || "unknown"}`), String(result?.errorMessage || "Email provider rejected the request"), retryable);
    },
  });
}

export function createWebhookProviderAdapter({ secretResolver, payloadResolver, transport, destinationPolicy, clock = () => new Date().toISOString() } = {}) {
  if (!secretResolver?.resolve || !payloadResolver?.resolve || !transport?.send) throw new TypeError("secretResolver, payloadResolver, and transport.send are required");
  return Object.freeze({
    async send(request) {
      if (request.channelType !== "webhook") return providerFailure("channel-mismatch", "Webhook adapter received a non-webhook request", false);
      const context = { organizationId: request.organizationId, purpose: "alert-webhook" };
      const [destination, payload] = await Promise.all([secretResolver.resolve(request.endpointRef, context), payloadResolver.resolve(request.payloadRef, context)]);
      const url = validateWebhookDestination(destination.url, destinationPolicy);
      const signingSecretRecord = await secretResolver.resolve(required(destination.signingSecretRef, "signingSecretRef"), context);
      const signed = signWebhookPayload(payload, signingSecretRecord.secret, clock());
      const response = await transport.send({
        url,
        body: signed.body,
        headers: {
          "content-type": "application/json",
          "user-agent": "White-Rabbit-Alerts/1.0",
          "x-white-rabbit-signature": signed.signature,
          "x-white-rabbit-timestamp": signed.signedAt,
          "x-white-rabbit-content-sha256": signed.bodySha256,
          "idempotency-key": request.idempotencyKey,
        },
      });
      const status = Number(response?.status || 0);
      if (status >= 200 && status < 300) return { success: true, retryable: false, providerMessageId: String(response?.messageId || response?.headers?.["x-request-id"] || ""), providerIdempotentReplay: response?.idempotentReplay === true };
      const retryable = status === 408 || status === 425 || status === 429 || status >= 500 || status === 0;
      return providerFailure(`webhook-http-${status || "unknown"}`, `Webhook provider returned HTTP ${status || "unknown"}`, retryable);
    },
  });
}

export function createFetchWebhookTransport({ fetchImpl = globalThis.fetch, resolveHostname, timeoutMs = 5000 } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  if (typeof resolveHostname !== "function") throw new TypeError("resolveHostname is required to prevent DNS rebinding and SSRF");
  const timeout = Math.max(100, Number(timeoutMs) || 5000);
  return Object.freeze({
    async send({ url, body, headers }) {
      const parsed = new URL(url);
      const addresses = await resolveHostname(parsed.hostname);
      if (!Array.isArray(addresses) || !addresses.length || addresses.some((address) => !isPublicNetworkAddress(address))) {
        const error = new Error("Webhook DNS resolution did not return exclusively public addresses");
        error.code = "WR_DESTINATION_NOT_ALLOWED";
        throw error;
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetchImpl(url, { method: "POST", headers, body, redirect: "error", signal: controller.signal });
        return { status: response.status, headers: { "x-request-id": response.headers?.get?.("x-request-id") || "" } };
      } catch (error) {
        if (error?.name === "AbortError") {
          const timeoutError = new Error(`Webhook request timed out after ${timeout}ms`);
          timeoutError.code = "WR_PROVIDER_TIMEOUT";
          throw timeoutError;
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    },
  });
}

export function createCircuitBreakerProvider(provider, options = {}) {
  if (!provider?.send) throw new TypeError("provider.send is required");
  const failureThreshold = Math.max(1, Math.trunc(Number(options.failureThreshold) || 5));
  const resetAfterMs = Math.max(1, Number(options.resetAfterMs) || 60000);
  const clock = options.clock || (() => new Date().toISOString());
  let state = { schemaVersion: PROVIDER_CIRCUIT_STATE_VERSION, status: "closed", consecutiveFailures: 0, openedAt: "", lastOutcomeAt: "" };
  return Object.freeze({
    getState: () => Object.freeze({ ...state }),
    async send(request) {
      const now = iso(clock(), "clock");
      if (state.status === "open" && new Date(now).getTime() - new Date(state.openedAt).getTime() < resetAfterMs) return providerFailure("provider-circuit-open", "Provider circuit is open", true);
      if (state.status === "open") state = { ...state, status: "half-open" };
      let result;
      try {
        result = await provider.send(request);
      } catch (error) {
        const failures = state.consecutiveFailures + 1;
        state = { ...state, status: failures >= failureThreshold ? "open" : "closed", consecutiveFailures: failures, openedAt: failures >= failureThreshold ? now : state.openedAt, lastOutcomeAt: now };
        throw error;
      }
      if (result?.success === true) state = { ...state, status: "closed", consecutiveFailures: 0, openedAt: "", lastOutcomeAt: now };
      else {
        const failures = state.consecutiveFailures + 1;
        state = { ...state, status: failures >= failureThreshold ? "open" : "closed", consecutiveFailures: failures, openedAt: failures >= failureThreshold ? now : state.openedAt, lastOutcomeAt: now };
      }
      return result;
    },
  });
}

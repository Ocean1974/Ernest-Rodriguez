const assert = require("assert");
const fs = require("fs");
const path = require("path");

(async () => {
  const adapters = await import("../src/alerts/providerAdapters.mjs");
  const fixed = "2026-08-14T13:00:00.000Z";
  const secrets = adapters.createScopedReferenceResolver({ prefix: "secret-ref:", entries: {
    "secret-ref:email-destination": { organizationId: "org-a", value: { address: "alerts@example.com" } },
    "secret-ref:email-credential": { organizationId: "org-a", value: { apiKey: "test-api-key" } },
    "secret-ref:webhook-destination": { organizationId: "org-a", value: { url: "https://hooks.example.com/white-rabbit", signingSecretRef: "secret-ref:webhook-signing" } },
    "secret-ref:webhook-signing": { organizationId: "org-a", value: { secret: "test-signing-secret" } },
  } });
  const payloads = adapters.createScopedReferenceResolver({ prefix: "payload-ref:", entries: {
    "payload-ref:alert-1": { organizationId: "org-a", value: { event: "ownership-change", parcelId: "wrp:v1:dallas-county-dcad:A1" } },
  } });
  await assert.rejects(() => secrets.resolve("secret-ref:email-destination", { organizationId: "org-b" }), (error) => error.code === "WR_REFERENCE_TENANT_DENIED");
  await assert.rejects(() => secrets.resolve("payload-ref:alert-1", { organizationId: "org-a" }), (error) => error.code === "WR_REFERENCE_PREFIX_INVALID");

  const policy = adapters.createDestinationPolicy({ allowedEmailDomains: ["example.com"], allowedWebhookOrigins: ["https://hooks.example.com"] });
  assert.equal(adapters.validateEmailDestination("Alerts@Example.com", policy), "alerts@example.com");
  assert.throws(() => adapters.validateEmailDestination("attacker@evil.example", policy), (error) => error.code === "WR_DESTINATION_NOT_ALLOWED");
  assert.throws(() => adapters.validateWebhookDestination("http://hooks.example.com/path", policy), (error) => error.code === "WR_DESTINATION_NOT_ALLOWED");
  assert.throws(() => adapters.validateWebhookDestination("https://127.0.0.1/hook", { allowedWebhookOrigins: ["https://127.0.0.1"] }), (error) => error.code === "WR_DESTINATION_NOT_ALLOWED");
  assert.throws(() => adapters.validateWebhookDestination("https://user:password@hooks.example.com/hook", policy), /credentials/);
  assert.equal(adapters.isPublicNetworkAddress("8.8.8.8"), true);
  assert.equal(adapters.isPublicNetworkAddress("10.0.0.1"), false);
  assert.equal(adapters.isPublicNetworkAddress("::1"), false);
  assert.equal(adapters.isPublicNetworkAddress("100.64.0.1"), false);
  assert.equal(adapters.isPublicNetworkAddress("203.0.113.10"), false);
  assert.equal(adapters.isPublicNetworkAddress("::ffff:127.0.0.1"), false);

  let emailTransportInput;
  const email = adapters.createEmailProviderAdapter({ secretResolver: secrets, payloadResolver: payloads, destinationPolicy: policy, credentialRef: "secret-ref:email-credential", clock: () => fixed, transport: { send: async (input) => { emailTransportInput = input; return { accepted: true, messageId: "email-message-1" }; } } });
  const emailResult = await email.send({ organizationId: "org-a", channelType: "email", endpointRef: "secret-ref:email-destination", payloadRef: "payload-ref:alert-1", idempotencyKey: "delivery-key-1" });
  assert.equal(emailResult.success, true);
  assert.equal(emailTransportInput.to, "alerts@example.com");
  assert.equal(emailTransportInput.credential.apiKey, "test-api-key");
  assert.equal(JSON.stringify(emailResult).includes("test-api-key"), false, "provider results must not expose credentials");
  const emailFailure = adapters.createEmailProviderAdapter({ secretResolver: secrets, payloadResolver: payloads, destinationPolicy: policy, credentialRef: "secret-ref:email-credential", clock: () => fixed, transport: { send: async () => ({ accepted: false, statusCode: 429, errorCode: "rate-limit" }) } });
  assert.equal((await emailFailure.send({ organizationId: "org-a", channelType: "email", endpointRef: "secret-ref:email-destination", payloadRef: "payload-ref:alert-1", idempotencyKey: "delivery-key-2" })).retryable, true);

  let webhookTransportInput;
  const webhook = adapters.createWebhookProviderAdapter({ secretResolver: secrets, payloadResolver: payloads, destinationPolicy: policy, clock: () => fixed, transport: { send: async (input) => { webhookTransportInput = input; return { status: 202, headers: { "x-request-id": "webhook-message-1" } }; } } });
  const webhookResult = await webhook.send({ organizationId: "org-a", channelType: "webhook", endpointRef: "secret-ref:webhook-destination", payloadRef: "payload-ref:alert-1", idempotencyKey: "delivery-key-3" });
  assert.equal(webhookResult.success, true);
  assert.equal(webhookTransportInput.headers["idempotency-key"], "delivery-key-3");
  assert.match(webhookTransportInput.headers["x-white-rabbit-signature"], /^v1=[a-f0-9]{64}$/);
  assert.equal(webhookTransportInput.headers["x-white-rabbit-timestamp"], fixed);
  const signedAgain = adapters.signWebhookPayload({ parcelId: "wrp:v1:dallas-county-dcad:A1", event: "ownership-change" }, "test-signing-secret", fixed);
  assert.equal(signedAgain.signature, webhookTransportInput.headers["x-white-rabbit-signature"], "canonical signing must ignore object key order");

  let fetchInput;
  const fetchTransport = adapters.createFetchWebhookTransport({ timeoutMs: 500, resolveHostname: async () => ["8.8.8.8"], fetchImpl: async (url, input) => { fetchInput = { url, input }; return { status: 204, headers: { get: () => "request-1" } }; } });
  const fetchResult = await fetchTransport.send({ url: "https://hooks.example.com/white-rabbit", body: "{}", headers: {} });
  assert.equal(fetchResult.status, 204);
  assert.equal(fetchInput.input.redirect, "error");
  const privateDnsTransport = adapters.createFetchWebhookTransport({ resolveHostname: async () => ["192.168.1.5"], fetchImpl: async () => { throw new Error("must not fetch"); } });
  await assert.rejects(() => privateDnsTransport.send({ url: "https://hooks.example.com/hook", body: "{}", headers: {} }), (error) => error.code === "WR_DESTINATION_NOT_ALLOWED");
  const timeoutTransport = adapters.createFetchWebhookTransport({ timeoutMs: 100, resolveHostname: async () => ["8.8.8.8"], fetchImpl: async (_url, input) => new Promise((_resolve, reject) => input.signal.addEventListener("abort", () => { const error = new Error("aborted"); error.name = "AbortError"; reject(error); })) });
  await assert.rejects(() => timeoutTransport.send({ url: "https://hooks.example.com/hook", body: "{}", headers: {} }), (error) => error.code === "WR_PROVIDER_TIMEOUT");

  let providerCalls = 0;
  let clock = fixed;
  const circuit = adapters.createCircuitBreakerProvider({ send: async () => { providerCalls += 1; return providerCalls <= 2 ? { success: false, retryable: true } : { success: true, providerMessageId: "recovered" }; } }, { failureThreshold: 2, resetAfterMs: 1000, clock: () => clock });
  await circuit.send({});
  await circuit.send({});
  assert.equal(circuit.getState().status, "open");
  assert.equal((await circuit.send({})).errorCode, "provider-circuit-open");
  assert.equal(providerCalls, 2);
  clock = "2026-08-14T13:00:02.000Z";
  assert.equal((await circuit.send({})).success, true);
  assert.equal(circuit.getState().status, "closed");

  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "schemas", "alert-provider.schema.json"), "utf8"));
  assert.equal(schema.$defs.destinationPolicy.properties.schemaVersion.const, "wr-alert-destination-policy-v1");
  console.log("White Rabbit tenant-scoped provider, allowlist, signed-webhook, SSRF, timeout-transport, and circuit-breaker tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

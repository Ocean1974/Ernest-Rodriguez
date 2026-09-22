const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const root = path.join(__dirname, "..");
  const service = await import(pathToFileURL(path.join(root, "src/listings/hostedMemberService.mjs")).href);
  const config = { url: "https://example.supabase.co", anonKey: "public-anon-key" };
  assert.equal(service.hostedMemberServiceConfigured(config), true);
  assert.equal(service.hostedMemberServiceConfigured({}), false);

  const requests = [];
  const responses = [
    { access_token: "access", refresh_token: "refresh", expires_in: 3600, user: { id: "member-1", email: "ernest@example.com", user_metadata: { display_name: "Ernest" } } },
    { access_token: "signup-access", refresh_token: "signup-refresh", expires_in: 3600, user: { id: "member-2", email: "jon@example.com", user_metadata: { display_name: "Jon" } } },
    [{ id: "listing-1", owner_id: "member-1", listing_kind: "cre", property_name: "Rabbit Center", address: "100 Main", county: "Dallas County", city: "Dallas", state: "TX", payload: { status: "For Sale" }, created_at: "2026-09-16T00:00:00.000Z", updated_at: "2026-09-16T00:00:00.000Z" }],
    {},
    {},
  ];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    const body = responses.shift();
    return { ok: true, status: 200, async json() { return body; } };
  };
  try {
    const session = await service.signInHostedMember(config, "Ernest@Example.com", "secret");
    assert.equal(session.memberId, "member-1");
    assert.equal(session.provider, "supabase");
    const signupSession = await service.signUpHostedMember(config, "Jon@Example.com", "secret-pass", "Jon");
    assert.equal(signupSession.memberId, "member-2");
    assert.equal(signupSession.displayName, "Jon");
    const records = await service.loadHostedMemberListings(config, session);
    assert.equal(records[0].ownerMemberId, "member-1");
    assert.equal(records[0].listingKind, "cre");
    await service.saveHostedMemberListing(config, session, records[0]);
    await service.deleteHostedMemberListing(config, session, "listing-1");
    assert.match(requests[0].url, /auth\/v1\/token/);
    assert.match(requests[1].url, /auth\/v1\/signup/);
    assert.deepEqual(JSON.parse(requests[1].options.body).data, { display_name: "Jon" });
    assert.match(requests[2].url, /owner_id=eq\.member-1/);
    assert.equal(requests[3].options.method, "POST");
    assert.equal(requests[4].options.method, "DELETE");
  } finally {
    global.fetch = originalFetch;
  }

  const migration = fs.readFileSync(path.join(root, "supabase/migrations/202609160001_member_listing_portal.sql"), "utf8");
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /auth\.uid\(\) = owner_id/);
  assert.match(migration, /listing_kind in \('resi', 'rentals', 'cre'\)/);
  const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
  const landingStart = app.indexOf("export default function WhiteRabbitLanding");
  const landing = app.slice(landingStart);
  assert.match(landing, /data-landing-member-access="true"/);
  assert.match(landing, /openMemberAccess\("login"\)/);
  assert.match(landing, /openMemberAccess\("signup"\)/);
  assert.match(app, /data-member-mode-signup="true"/);
  console.log("Hosted member authentication, listing persistence, and owner RLS contract tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });

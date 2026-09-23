const assert = require("node:assert/strict");
const path = require("node:path");
const { verifyMemberProductionConfig } = require("../scripts/verify-member-production-config.cjs");

const root = path.join(__dirname, "..");
const blocked = verifyMemberProductionConfig({}, root);
assert.equal(blocked.status, "blocked");
assert.equal(blocked.activationAuthorized, false);
assert(blocked.blockers.some((check) => check.id === "supabase-https-url"));

const ready = verifyMemberProductionConfig({
  VITE_SUPABASE_URL: "https://rabbit.supabase.co",
  VITE_SUPABASE_ANON_KEY: "sb_publishable_12345678901234567890",
  VITE_PUBLIC_SITE_URL: "https://staging.realestatesavant.example",
  VITE_ENABLE_DEMO_MEMBER_ACCESS: "false",
}, root);
assert.equal(ready.status, "ready");
assert.equal(ready.activationAuthorized, true);

const unsafe = verifyMemberProductionConfig({
  VITE_SUPABASE_URL: "https://rabbit.supabase.co",
  VITE_SUPABASE_ANON_KEY: "sb_publishable_12345678901234567890",
  VITE_PUBLIC_SITE_URL: "https://realestatesavant.example",
  VITE_ENABLE_DEMO_MEMBER_ACCESS: "true",
  VITE_DATABASE_URL: "secret",
}, root);
assert(unsafe.blockers.some((check) => check.id === "demo-access-disabled"));
assert(unsafe.blockers.some((check) => check.id === "no-public-server-secrets"));
console.log("Member production configuration preflight tests passed.");

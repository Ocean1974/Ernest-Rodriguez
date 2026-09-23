const fs = require("node:fs");
const path = require("node:path");

function verifyMemberProductionConfig(env = process.env, root = path.join(__dirname, "..")) {
  const checks = [];
  const add = (id, passed, detail) => checks.push({ id, passed: Boolean(passed), detail });
  const supabaseUrl = String(env.VITE_SUPABASE_URL || "").trim();
  const anonKey = String(env.VITE_SUPABASE_ANON_KEY || "").trim();
  const siteUrl = String(env.VITE_PUBLIC_SITE_URL || "").trim();
  add("supabase-https-url", /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(supabaseUrl), "VITE_SUPABASE_URL must be the HTTPS Supabase project URL.");
  add("supabase-public-key", anonKey.length >= 20, "VITE_SUPABASE_ANON_KEY must contain the public anonymous/publishable key.");
  add("public-site-https", /^https:\/\//i.test(siteUrl), "VITE_PUBLIC_SITE_URL must be the deployed HTTPS site origin.");
  add("demo-access-disabled", String(env.VITE_ENABLE_DEMO_MEMBER_ACCESS || "false").toLowerCase() !== "true", "Demo member access must remain disabled outside deliberate local demonstrations.");
  add("member-schema-migration", fs.existsSync(path.join(root, "supabase/migrations/202609160001_member_listing_portal.sql")), "Member profile/listing migration must exist.");
  add("analytics-migration", fs.existsSync(path.join(root, "supabase/migrations/202609220001_listing_analytics.sql")), "Listing analytics migration must exist.");
  add("media-migration", fs.existsSync(path.join(root, "supabase/migrations/202609220002_listing_media.sql")), "Listing media migration must exist.");
  const exposedSecrets = ["DATABASE_URL", "EMAIL_PROVIDER_KEY", "SMS_PROVIDER_KEY", "AI_PROVIDER_KEY", "ENCRYPTION_KEY_REFERENCE"].filter((name) => String(env[`VITE_${name}`] || "").trim());
  add("no-public-server-secrets", exposedSecrets.length === 0, exposedSecrets.length ? `Remove public secret variables: ${exposedSecrets.map((name) => `VITE_${name}`).join(", ")}` : "No server-only secret is exposed through a VITE_ variable.");
  const blockers = checks.filter((check) => !check.passed);
  return { schemaVersion: "wr-member-production-preflight-v1", status: blockers.length ? "blocked" : "ready", activationAuthorized: blockers.length === 0, checks, blockers };
}

if (require.main === module) {
  const report = verifyMemberProductionConfig();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.activationAuthorized ? 0 : 2;
}

module.exports = { verifyMemberProductionConfig };

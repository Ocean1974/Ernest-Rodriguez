const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const root = path.join(__dirname, "..");
  const service = await import(pathToFileURL(path.join(root, "src/listings/hostedMemberService.mjs")).href);
  const config = { url: "https://example.supabase.co", anonKey: "public-anon-key" };
  const session = { memberId: "member-1", accessToken: "access" };
  const requests = [];
  const responses = [
    {},
    [{ id: "asset-1", listing_id: "listing-1", scan_status: "pending" }],
    [{ listing_id: "listing-1", created_at: "2026-09-23T00:00:00Z" }],
    {},
    {},
    [{ id: "inquiry-1", listing_id: "listing-1", status: "new" }],
    [{ id: "inquiry-1", listing_id: "listing-1", status: "new" }],
    "conversion-1",
    [{ id: "asset-1", listing_id: "listing-1", scan_status: "clean" }],
  ];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    const body = responses.shift();
    return { ok: true, status: 200, async json() { return body; } };
  };
  try {
    const asset = await service.uploadHostedListingAsset(config, session, "listing-1", { name: "Offering Memorandum.pdf", type: "application/pdf", size: 2048 }, "offering_memorandum");
    assert.equal(asset.scanStatus, "pending");
    assert.match(requests[0].url, /listing-asset-quarantine/);
    assert.match(requests[1].url, /listing_assets/);
    assert.equal(JSON.parse(requests[1].options.body).scan_status, "pending");
    const favorites = await service.loadHostedFavorites(config, session);
    assert.equal(favorites[0].listing_id, "listing-1");
    await service.saveHostedFavorite(config, session, "listing-1");
    await service.removeHostedFavorite(config, session, "listing-1");
    const inquiry = await service.createHostedListingInquiry(config, session, "listing-1", "member-2", "Please send the survey and rent roll.");
    assert.equal(inquiry.status, "new");
    const inquiries = await service.loadHostedListingInquiries(config, session);
    assert.equal(inquiries.length, 1);
    await service.recordHostedListingConversion(config, session, "listing-1", "visitor-member-1", "inquiry", { source: "email", campaign: "fall-launch", referrerHost: "mail.example.com" });
    const conversionBody = JSON.parse(requests[7].options.body);
    assert.equal(conversionBody.p_source, "email");
    assert.equal(conversionBody.p_event_type, "inquiry");
    const assets = await service.loadHostedListingAssets(config, session, "listing-1");
    assert.equal(assets[0].scan_status, "clean");
    await assert.rejects(() => service.createHostedListingInquiry(config, session, "listing-1", "member-2", "short"), /between 10 and 4,000/);
    await assert.rejects(() => service.uploadHostedListingAsset(config, session, "listing-1", { name: "bad.exe", type: "application/octet-stream", size: 50 }, "other"), /JPG, PNG, WebP, or PDF/);
  } finally {
    global.fetch = originalFetch;
  }
  console.log("Hosted listing assets, favorites, inquiries, and conversion attribution tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });

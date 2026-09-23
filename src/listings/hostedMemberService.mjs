function trim(value) {
  return String(value || "").trim();
}

const LISTING_PUBLICATION_STATUSES = new Set(["draft", "published", "pending", "sold", "leased", "expired", "archived"]);

export function hostedMemberServiceConfigured(config = {}) {
  return Boolean(trim(config.url) && trim(config.anonKey));
}

function headers(config, accessToken, extra = {}) {
  return {
    apikey: trim(config.anonKey),
    Authorization: `Bearer ${accessToken || trim(config.anonKey)}`,
    ...extra,
  };
}

async function readResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.msg || body?.message || body?.error_description || "Member service request failed.");
  return body;
}

function hostedSessionFromBody(body) {
  const session = body.session || body;
  const user = body.user || session.user || {};
  const accessToken = session.access_token;
  if (!user.id || !accessToken) return null;
  return {
    memberId: user.id,
    username: user.email,
    email: user.email,
    displayName: trim(user.user_metadata?.display_name) || trim(user.email).split("@")[0],
    accessToken,
    refreshToken: session.refresh_token,
    expiresAt: Date.now() + Number(session.expires_in || 3600) * 1000,
    provider: "supabase",
  };
}

export async function signInHostedMember(config, email, password) {
  if (!hostedMemberServiceConfigured(config)) throw new Error("Hosted member accounts are not configured.");
  const response = await fetch(`${trim(config.url).replace(/\/$/, "")}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: headers(config, "", { "Content-Type": "application/json" }),
    body: JSON.stringify({ email: trim(email).toLowerCase(), password: String(password || "") }),
  });
  const body = await readResponse(response);
  const session = hostedSessionFromBody(body);
  if (!session) throw new Error("Member service did not return an authenticated session.");
  return session;
}

export async function signUpHostedMember(config, email, password, displayName = "") {
  if (!hostedMemberServiceConfigured(config)) throw new Error("Hosted member accounts are not configured.");
  const normalizedEmail = trim(email).toLowerCase();
  const response = await fetch(`${trim(config.url).replace(/\/$/, "")}/auth/v1/signup`, {
    method: "POST",
    headers: headers(config, "", { "Content-Type": "application/json" }),
    body: JSON.stringify({ email: normalizedEmail, password: String(password || ""), data: { display_name: trim(displayName) } }),
  });
  const body = await readResponse(response);
  const session = hostedSessionFromBody(body);
  if (session) return session;
  if (body.user?.id) return { verificationRequired: true, email: body.user.email || normalizedEmail };
  throw new Error("Member service did not create an account.");
}

export async function requestHostedPasswordReset(config, email, redirectTo = "") {
  if (!hostedMemberServiceConfigured(config)) throw new Error("Hosted member accounts are not configured.");
  const body = { email: trim(email).toLowerCase() };
  if (trim(redirectTo)) body.redirect_to = trim(redirectTo);
  const response = await fetch(`${trim(config.url).replace(/\/$/, "")}/auth/v1/recover`, {
    method: "POST",
    headers: headers(config, "", { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  await readResponse(response);
  return true;
}

export async function loadHostedMemberProfile(config, session) {
  if (!hostedMemberServiceConfigured(config) || !session?.accessToken) return null;
  const url = `${trim(config.url).replace(/\/$/, "")}/rest/v1/member_profiles?id=eq.${encodeURIComponent(session.memberId)}&select=id,display_name,phone,company,created_at,updated_at&limit=1`;
  const rows = await readResponse(await fetch(url, { headers: headers(config, session.accessToken) }));
  const row = rows[0];
  return row ? { id: row.id, displayName: row.display_name || "", phone: row.phone || "", company: row.company || "", createdAt: row.created_at, updatedAt: row.updated_at } : null;
}

export async function saveHostedMemberProfile(config, session, profile = {}) {
  if (!hostedMemberServiceConfigured(config) || !session?.accessToken) throw new Error("Hosted member accounts are not configured.");
  const url = `${trim(config.url).replace(/\/$/, "")}/rest/v1/member_profiles?id=eq.${encodeURIComponent(session.memberId)}`;
  const rows = await readResponse(await fetch(url, {
    method: "PATCH",
    headers: headers(config, session.accessToken, { "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify({ display_name: trim(profile.displayName), phone: trim(profile.phone), company: trim(profile.company), updated_at: new Date().toISOString() }),
  }));
  const row = rows[0];
  if (!row) throw new Error("Member profile was not updated.");
  return { id: row.id, displayName: row.display_name || "", phone: row.phone || "", company: row.company || "", createdAt: row.created_at, updatedAt: row.updated_at };
}

function listingFromRow(row) {
  return {
    ...(row.payload || {}),
    id: row.id,
    listingKind: row.listing_kind,
    publicationStatus: row.publication_status,
    propertyName: row.property_name,
    address: row.address,
    county: row.county,
    city: row.city,
    state: row.state,
    ownerMemberId: row.owner_id,
    submissionType: "user-submitted",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadHostedMemberListings(config, session) {
  if (!hostedMemberServiceConfigured(config) || !session?.accessToken) return [];
  const url = `${trim(config.url).replace(/\/$/, "")}/rest/v1/member_listings?owner_id=eq.${encodeURIComponent(session.memberId)}&select=*&order=updated_at.desc`;
  const rows = await readResponse(await fetch(url, { headers: headers(config, session.accessToken) }));
  return rows.map(listingFromRow);
}

export async function loadHostedPublicListings(config, session = null) {
  if (!hostedMemberServiceConfigured(config)) return [];
  const url = `${trim(config.url).replace(/\/$/, "")}/rest/v1/member_listings?publication_status=in.(published,pending,sold,leased)&select=*&order=updated_at.desc`;
  const rows = await readResponse(await fetch(url, { headers: headers(config, session?.accessToken) }));
  return rows.map(listingFromRow);
}

export async function saveHostedMemberListing(config, session, listing) {
  if (!hostedMemberServiceConfigured(config) || !session?.accessToken) return listing;
  const row = {
    id: listing.id,
    owner_id: session.memberId,
    listing_kind: listing.listingKind,
    publication_status: LISTING_PUBLICATION_STATUSES.has(listing.publicationStatus) ? listing.publicationStatus : "published",
    property_name: listing.propertyName,
    address: listing.address,
    county: listing.county,
    city: listing.city || "",
    state: listing.state || "",
    payload: listing,
  };
  const response = await fetch(`${trim(config.url).replace(/\/$/, "")}/rest/v1/member_listings?on_conflict=id`, {
    method: "POST",
    headers: headers(config, session.accessToken, { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(row),
  });
  await readResponse(response);
  return listing;
}

export async function deleteHostedMemberListing(config, session, listingId) {
  if (!hostedMemberServiceConfigured(config) || !session?.accessToken) return;
  const response = await fetch(`${trim(config.url).replace(/\/$/, "")}/rest/v1/member_listings?id=eq.${encodeURIComponent(listingId)}&owner_id=eq.${encodeURIComponent(session.memberId)}`, {
    method: "DELETE",
    headers: headers(config, session.accessToken),
  });
  await readResponse(response);
}

function safeMediaName(fileName = "listing-media") {
  const source = trim(fileName).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return source || "listing-media";
}

export async function uploadHostedListingMedia(config, session, listingId, file) {
  if (!hostedMemberServiceConfigured(config) || !session?.accessToken) throw new Error("Hosted member media is not configured.");
  if (!listingId || !file) throw new Error("A listing and file are required.");
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
  if (!allowedTypes.has(file.type)) throw new Error("Choose a JPG, PNG, WebP, or PDF file.");
  if (Number(file.size) > 10 * 1024 * 1024) throw new Error("Listing media must be 10 MB or smaller.");
  const path = `${encodeURIComponent(session.memberId)}/${encodeURIComponent(listingId)}/${Date.now()}-${safeMediaName(file.name)}`;
  const response = await fetch(`${trim(config.url).replace(/\/$/, "")}/storage/v1/object/listing-media/${path}`, {
    method: "POST",
    headers: headers(config, session.accessToken, { "Content-Type": file.type, "x-upsert": "false" }),
    body: file,
  });
  await readResponse(response);
  return {
    path: decodeURIComponent(path),
    publicUrl: `${trim(config.url).replace(/\/$/, "")}/storage/v1/object/public/listing-media/${path}`,
    mediaType: file.type,
  };
}

export async function uploadHostedListingAsset(config, session, listingId, file, assetKind = "other") {
  if (!hostedMemberServiceConfigured(config) || !session?.accessToken) throw new Error("Hosted listing assets are not configured.");
  if (!listingId || !file) throw new Error("A listing and file are required.");
  const allowedKinds = new Set(["photo", "brochure", "survey", "offering_memorandum", "other"]);
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
  if (!allowedKinds.has(assetKind)) throw new Error("Choose a supported listing asset type.");
  if (!allowedTypes.has(file.type)) throw new Error("Choose a JPG, PNG, WebP, or PDF file.");
  if (!Number(file.size) || Number(file.size) > 25 * 1024 * 1024) throw new Error("Listing assets must be between 1 byte and 25 MB.");
  const storagePath = `${session.memberId}/${listingId}/${Date.now()}-${safeMediaName(file.name)}`;
  const storageUrl = `${trim(config.url).replace(/\/$/, "")}/storage/v1/object/listing-asset-quarantine/${storagePath.split("/").map(encodeURIComponent).join("/")}`;
  await readResponse(await fetch(storageUrl, {
    method: "POST",
    headers: headers(config, session.accessToken, { "Content-Type": file.type, "x-upsert": "false" }),
    body: file,
  }));
  const rows = await readResponse(await fetch(`${trim(config.url).replace(/\/$/, "")}/rest/v1/listing_assets`, {
    method: "POST",
    headers: headers(config, session.accessToken, { "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify({
      listing_id: listingId,
      owner_id: session.memberId,
      storage_path: storagePath,
      asset_kind: assetKind,
      file_name: trim(file.name),
      mime_type: file.type,
      byte_size: Number(file.size),
      scan_status: "pending",
    }),
  }));
  return { ...rows[0], scanStatus: "pending" };
}

export async function loadHostedListingAssets(config, session, listingId) {
  if (!hostedMemberServiceConfigured(config) || !listingId) return [];
  const url = `${trim(config.url).replace(/\/$/, "")}/rest/v1/listing_assets?listing_id=eq.${encodeURIComponent(listingId)}&deleted_at=is.null&select=*&order=created_at.asc`;
  return readResponse(await fetch(url, { headers: headers(config, session?.accessToken) }));
}

export async function loadHostedFavorites(config, session) {
  if (!hostedMemberServiceConfigured(config) || !session?.accessToken) return [];
  const url = `${trim(config.url).replace(/\/$/, "")}/rest/v1/listing_favorites?member_id=eq.${encodeURIComponent(session.memberId)}&select=listing_id,created_at&order=created_at.desc`;
  return readResponse(await fetch(url, { headers: headers(config, session.accessToken) }));
}

export async function saveHostedFavorite(config, session, listingId) {
  if (!hostedMemberServiceConfigured(config) || !session?.accessToken) throw new Error("Sign in to save listings.");
  await readResponse(await fetch(`${trim(config.url).replace(/\/$/, "")}/rest/v1/listing_favorites?on_conflict=member_id,listing_id`, {
    method: "POST",
    headers: headers(config, session.accessToken, { "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" }),
    body: JSON.stringify({ member_id: session.memberId, listing_id: listingId }),
  }));
  return true;
}

export async function removeHostedFavorite(config, session, listingId) {
  if (!hostedMemberServiceConfigured(config) || !session?.accessToken) return false;
  const url = `${trim(config.url).replace(/\/$/, "")}/rest/v1/listing_favorites?member_id=eq.${encodeURIComponent(session.memberId)}&listing_id=eq.${encodeURIComponent(listingId)}`;
  await readResponse(await fetch(url, { method: "DELETE", headers: headers(config, session.accessToken) }));
  return true;
}

export async function createHostedListingInquiry(config, session, listingId, listingOwnerId, message) {
  if (!hostedMemberServiceConfigured(config) || !session?.accessToken) throw new Error("Sign in to contact a listing owner.");
  const cleanMessage = trim(message);
  if (cleanMessage.length < 10 || cleanMessage.length > 4000) throw new Error("Inquiry messages must be between 10 and 4,000 characters.");
  const rows = await readResponse(await fetch(`${trim(config.url).replace(/\/$/, "")}/rest/v1/listing_inquiries`, {
    method: "POST",
    headers: headers(config, session.accessToken, { "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify({ listing_id: listingId, listing_owner_id: listingOwnerId, inquirer_id: session.memberId, message: cleanMessage }),
  }));
  return rows[0] || null;
}

export async function loadHostedListingInquiries(config, session) {
  if (!hostedMemberServiceConfigured(config) || !session?.accessToken) return [];
  const url = `${trim(config.url).replace(/\/$/, "")}/rest/v1/listing_inquiries?listing_owner_id=eq.${encodeURIComponent(session.memberId)}&select=*&order=created_at.desc`;
  return readResponse(await fetch(url, { headers: headers(config, session.accessToken) }));
}

export async function recordHostedListingConversion(config, session, listingId, visitorSessionId, eventType, attribution = {}) {
  if (!hostedMemberServiceConfigured(config) || !listingId || !visitorSessionId) return null;
  const response = await fetch(`${trim(config.url).replace(/\/$/, "")}/rest/v1/rpc/record_listing_conversion`, {
    method: "POST",
    headers: headers(config, session?.accessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      p_listing_id: listingId,
      p_visitor_session_id: visitorSessionId,
      p_event_type: eventType,
      p_source: trim(attribution.source) || "direct",
      p_campaign: trim(attribution.campaign),
      p_referrer_host: trim(attribution.referrerHost),
    }),
  });
  return readResponse(response);
}

export async function recordHostedListingView(config, session, listingId, viewerSessionId) {
  if (!hostedMemberServiceConfigured(config) || !listingId || !viewerSessionId) return null;
  const response = await fetch(`${trim(config.url).replace(/\/$/, "")}/rest/v1/rpc/record_listing_view`, {
    method: "POST",
    headers: headers(config, session?.accessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify({ p_listing_id: listingId, p_viewer_session_id: viewerSessionId }),
  });
  return readResponse(response);
}

export async function loadHostedListingViews(config, session) {
  if (!hostedMemberServiceConfigured(config) || !session?.accessToken) return [];
  const url = `${trim(config.url).replace(/\/$/, "")}/rest/v1/listing_views?listing_owner_id=eq.${encodeURIComponent(session.memberId)}&select=*&order=viewed_at.desc&limit=5000`;
  const rows = await readResponse(await fetch(url, { headers: headers(config, session.accessToken) }));
  return rows.map((row) => ({
    id: row.id,
    listingId: row.listing_id,
    listingOwnerId: row.listing_owner_id,
    viewerMemberId: row.viewer_id || "",
    viewerSessionId: row.viewer_session_id,
    viewerDisplayName: row.viewer_display_name || "Anonymous visitor",
    viewedAt: row.viewed_at,
  }));
}

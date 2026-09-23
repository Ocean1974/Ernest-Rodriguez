function trim(value) {
  return String(value || "").trim();
}

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
  const url = `${trim(config.url).replace(/\/$/, "")}/rest/v1/member_listings?publication_status=eq.published&select=*&order=updated_at.desc`;
  const rows = await readResponse(await fetch(url, { headers: headers(config, session?.accessToken) }));
  return rows.map(listingFromRow);
}

export async function saveHostedMemberListing(config, session, listing) {
  if (!hostedMemberServiceConfigured(config) || !session?.accessToken) return listing;
  const row = {
    id: listing.id,
    owner_id: session.memberId,
    listing_kind: listing.listingKind,
    publication_status: listing.status === "Watch" ? "draft" : "published",
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

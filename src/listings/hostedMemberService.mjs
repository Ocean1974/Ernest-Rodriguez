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

export async function signInHostedMember(config, email, password) {
  if (!hostedMemberServiceConfigured(config)) throw new Error("Hosted member accounts are not configured.");
  const response = await fetch(`${trim(config.url).replace(/\/$/, "")}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: headers(config, "", { "Content-Type": "application/json" }),
    body: JSON.stringify({ email: trim(email).toLowerCase(), password: String(password || "") }),
  });
  const body = await readResponse(response);
  const user = body.user || {};
  return {
    memberId: user.id,
    username: user.email,
    email: user.email,
    displayName: trim(user.user_metadata?.display_name) || trim(user.email).split("@")[0],
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000,
    provider: "supabase",
  };
}

export async function loadHostedMemberListings(config, session) {
  if (!hostedMemberServiceConfigured(config) || !session?.accessToken) return [];
  const url = `${trim(config.url).replace(/\/$/, "")}/rest/v1/member_listings?owner_id=eq.${encodeURIComponent(session.memberId)}&select=*&order=updated_at.desc`;
  const rows = await readResponse(await fetch(url, { headers: headers(config, session.accessToken) }));
  return rows.map((row) => ({
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
  }));
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

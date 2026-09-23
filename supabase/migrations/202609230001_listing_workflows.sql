-- Production listing workflows, tenant-scoped engagement, and quarantined assets.
-- Asset objects remain private and unavailable to marketplace users until an
-- external malware scanner marks the corresponding record clean.

alter table public.member_listings
  drop constraint if exists member_listings_publication_status_check;

alter table public.member_listings
  add constraint member_listings_publication_status_check
  check (publication_status in ('draft', 'published', 'pending', 'sold', 'leased', 'expired', 'archived'));

drop policy if exists "Published listings are visible" on public.member_listings;
create policy "Marketable listings are visible" on public.member_listings
for select using (publication_status in ('published', 'pending', 'sold', 'leased') or auth.uid() = owner_id);

create or replace function public.listing_owner_id(p_listing_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select owner_id from public.member_listings where id = p_listing_id;
$$;

create table if not exists public.listing_assets (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.member_listings(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  asset_kind text not null check (asset_kind in ('photo', 'brochure', 'survey', 'offering_memorandum', 'other')),
  file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 26214400),
  scan_status text not null default 'pending' check (scan_status in ('pending', 'clean', 'rejected', 'failed')),
  scan_provider text,
  scan_reference text,
  scanned_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint listing_assets_owner_matches check (owner_id = public.listing_owner_id(listing_id))
);

create index if not exists listing_assets_listing_idx on public.listing_assets(listing_id, asset_kind, created_at);
create index if not exists listing_assets_scan_queue_idx on public.listing_assets(scan_status, created_at) where deleted_at is null;

create table if not exists public.listing_favorites (
  member_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references public.member_listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, listing_id)
);

create table if not exists public.listing_inquiries (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.member_listings(id) on delete cascade,
  listing_owner_id uuid not null references auth.users(id) on delete cascade,
  inquirer_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(message) between 10 and 4000),
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'closed', 'spam')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listing_inquiries_owner_matches check (listing_owner_id = public.listing_owner_id(listing_id)),
  check (listing_owner_id <> inquirer_id)
);

create index if not exists listing_inquiries_owner_idx on public.listing_inquiries(listing_owner_id, status, created_at desc);

create table if not exists public.listing_conversion_events (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.member_listings(id) on delete cascade,
  listing_owner_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  visitor_session_id text not null check (char_length(visitor_session_id) between 8 and 128),
  event_type text not null check (event_type in ('view', 'favorite', 'inquiry', 'document_download', 'share', 'map_open')),
  source text not null default 'direct' check (char_length(source) between 1 and 120),
  campaign text not null default '' check (char_length(campaign) <= 120),
  referrer_host text not null default '' check (char_length(referrer_host) <= 255),
  occurred_at timestamptz not null default now(),
  constraint listing_conversion_owner_matches check (listing_owner_id = public.listing_owner_id(listing_id))
);

create index if not exists listing_conversion_owner_idx on public.listing_conversion_events(listing_owner_id, occurred_at desc);
create index if not exists listing_conversion_listing_idx on public.listing_conversion_events(listing_id, event_type, occurred_at desc);

alter table public.listing_assets enable row level security;
alter table public.listing_favorites enable row level security;
alter table public.listing_inquiries enable row level security;
alter table public.listing_conversion_events enable row level security;

create policy "Owners read listing assets" on public.listing_assets
for select using (auth.uid() = owner_id);
create policy "Owners register pending listing assets" on public.listing_assets
for insert with check (auth.uid() = owner_id and scan_status = 'pending' and deleted_at is null and scanned_at is null);
create policy "Owners delete listing assets" on public.listing_assets
for delete using (auth.uid() = owner_id);
create policy "Marketplace reads clean assets" on public.listing_assets
for select using (
  scan_status = 'clean' and deleted_at is null and exists (
    select 1 from public.member_listings listing
    where listing.id = listing_id and listing.publication_status in ('published', 'pending', 'sold', 'leased')
  )
);

create policy "Members read their favorites" on public.listing_favorites for select using (auth.uid() = member_id);
create policy "Members create their favorites" on public.listing_favorites for insert with check (auth.uid() = member_id);
create policy "Members remove their favorites" on public.listing_favorites for delete using (auth.uid() = member_id);

create policy "Inquiry parties read inquiries" on public.listing_inquiries
for select using (auth.uid() in (listing_owner_id, inquirer_id));
create policy "Members create inquiries" on public.listing_inquiries
for insert with check (auth.uid() = inquirer_id);
create policy "Listing owners update inquiry workflow" on public.listing_inquiries
for update using (auth.uid() = listing_owner_id) with check (auth.uid() = listing_owner_id);

create policy "Listing owners read conversion analytics" on public.listing_conversion_events
for select using (auth.uid() = listing_owner_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'listing-asset-quarantine',
  'listing-asset-quarantine',
  false,
  26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'listing-assets',
  'listing-assets',
  false,
  26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Members upload quarantined assets" on storage.objects
for insert to authenticated
with check (bucket_id = 'listing-asset-quarantine' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Members delete quarantined assets" on storage.objects
for delete to authenticated
using (bucket_id = 'listing-asset-quarantine' and owner_id = auth.uid()::text);

create or replace function public.record_listing_conversion(
  p_listing_id uuid,
  p_visitor_session_id text,
  p_event_type text,
  p_source text default 'direct',
  p_campaign text default '',
  p_referrer_host text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare target_owner uuid; new_id uuid;
begin
  if char_length(coalesce(p_visitor_session_id, '')) not between 8 and 128 then raise exception 'A valid visitor session is required'; end if;
  if p_event_type not in ('view', 'favorite', 'inquiry', 'document_download', 'share', 'map_open') then raise exception 'Unsupported conversion event'; end if;
  select owner_id into target_owner from public.member_listings where id = p_listing_id and publication_status in ('published', 'pending', 'sold', 'leased');
  if target_owner is null or auth.uid() = target_owner then return null; end if;
  insert into public.listing_conversion_events (listing_id, listing_owner_id, actor_id, visitor_session_id, event_type, source, campaign, referrer_host)
  values (p_listing_id, target_owner, auth.uid(), p_visitor_session_id, p_event_type, left(coalesce(nullif(p_source, ''), 'direct'), 120), left(coalesce(p_campaign, ''), 120), left(coalesce(p_referrer_host, ''), 255))
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.record_listing_conversion(uuid, text, text, text, text, text) from public;
grant execute on function public.record_listing_conversion(uuid, text, text, text, text, text) to anon, authenticated;

revoke all on function public.listing_owner_id(uuid) from public;
grant execute on function public.listing_owner_id(uuid) to authenticated;

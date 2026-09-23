-- Privacy-aware listing view analytics for member-owned listings.

create table if not exists public.listing_views (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.member_listings(id) on delete cascade,
  listing_owner_id uuid not null references auth.users(id) on delete cascade,
  viewer_id uuid references auth.users(id) on delete set null,
  viewer_session_id text not null check (char_length(viewer_session_id) between 8 and 128),
  viewer_display_name text not null default 'Anonymous visitor',
  viewed_at timestamptz not null default now()
);

create index if not exists listing_views_owner_time_idx on public.listing_views(listing_owner_id, viewed_at desc);
create index if not exists listing_views_listing_time_idx on public.listing_views(listing_id, viewed_at desc);

alter table public.listing_views enable row level security;

drop policy if exists "Listing owners read their analytics" on public.listing_views;
create policy "Listing owners read their analytics" on public.listing_views
for select using (auth.uid() = listing_owner_id);

create or replace function public.record_listing_view(p_listing_id uuid, p_viewer_session_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_owner uuid;
  new_id uuid;
  viewer_name text;
begin
  if char_length(coalesce(p_viewer_session_id, '')) not between 8 and 128 then
    raise exception 'A valid visitor session is required';
  end if;

  select owner_id into target_owner
  from public.member_listings
  where id = p_listing_id and publication_status = 'published';

  if target_owner is null or auth.uid() = target_owner then return null; end if;

  if auth.uid() is null then
    viewer_name := 'Anonymous visitor';
  else
    select coalesce(nullif(raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(email, ''), '@', 1), 'Member')
      into viewer_name from auth.users where id = auth.uid();
  end if;

  insert into public.listing_views (listing_id, listing_owner_id, viewer_id, viewer_session_id, viewer_display_name)
  values (p_listing_id, target_owner, auth.uid(), p_viewer_session_id, viewer_name)
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.record_listing_view(uuid, text) from public;
grant execute on function public.record_listing_view(uuid, text) to anon, authenticated;

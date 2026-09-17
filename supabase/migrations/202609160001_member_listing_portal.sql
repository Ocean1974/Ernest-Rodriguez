-- Real Estate Savant member profiles and owner-scoped listings.
-- Apply this migration to the production Supabase project before enabling hosted member accounts.

create extension if not exists pgcrypto;

create table if not exists public.member_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  phone text not null default '',
  company text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.member_listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  listing_kind text not null check (listing_kind in ('resi', 'rentals', 'cre')),
  publication_status text not null default 'draft' check (publication_status in ('draft', 'published', 'archived')),
  property_name text not null,
  address text not null,
  county text not null,
  city text not null default '',
  state text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists member_listings_owner_kind_idx on public.member_listings(owner_id, listing_kind, updated_at desc);
create index if not exists member_listings_public_idx on public.member_listings(listing_kind, publication_status, updated_at desc);

alter table public.member_profiles enable row level security;
alter table public.member_listings enable row level security;

drop policy if exists "Members can read their profile" on public.member_profiles;
create policy "Members can read their profile" on public.member_profiles for select using (auth.uid() = id);
drop policy if exists "Members can update their profile" on public.member_profiles;
create policy "Members can update their profile" on public.member_profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Published listings are visible" on public.member_listings;
create policy "Published listings are visible" on public.member_listings for select using (publication_status = 'published' or auth.uid() = owner_id);
drop policy if exists "Members create their listings" on public.member_listings;
create policy "Members create their listings" on public.member_listings for insert with check (auth.uid() = owner_id);
drop policy if exists "Members update their listings" on public.member_listings;
create policy "Members update their listings" on public.member_listings for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "Members delete their listings" on public.member_listings;
create policy "Members delete their listings" on public.member_listings for delete using (auth.uid() = owner_id);

create or replace function public.create_member_profile() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.member_profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_member_profile_after_signup on auth.users;
create trigger create_member_profile_after_signup after insert on auth.users for each row execute function public.create_member_profile();

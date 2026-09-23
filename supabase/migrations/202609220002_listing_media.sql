-- Owner-scoped listing media with a public-read bucket for published marketplace images.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'listing-media',
  'listing-media',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Members upload their listing media" on storage.objects;
create policy "Members upload their listing media" on storage.objects
for insert to authenticated
with check (bucket_id = 'listing-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Members update their listing media" on storage.objects;
create policy "Members update their listing media" on storage.objects
for update to authenticated
using (bucket_id = 'listing-media' and owner_id = auth.uid()::text)
with check (bucket_id = 'listing-media' and owner_id = auth.uid()::text);

drop policy if exists "Members delete their listing media" on storage.objects;
create policy "Members delete their listing media" on storage.objects
for delete to authenticated
using (bucket_id = 'listing-media' and owner_id = auth.uid()::text);

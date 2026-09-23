# Member platform staging runbook

This runbook activates the already-tested member, listing, analytics, and media
contracts without weakening the fail-closed production boundary.

## Required external inputs

- A staging Supabase project and a separate production Supabase project.
- An HTTPS staging site origin and production domain.
- The Supabase project URL and public anonymous/publishable key for each environment.

Never place the service-role key, database URL, provider secrets, or encryption
keys in a `VITE_` variable.

## Database activation order

Apply migrations in filename order:

1. `202609160001_member_listing_portal.sql`
2. `202609220001_listing_analytics.sql`
3. `202609220002_listing_media.sql`
4. `202609230001_listing_workflows.sql`

Verify that row-level security is enabled for profiles, listings, views,
favorites, inquiries, conversion events, and listing assets.
Confirm that a member cannot select, update, or delete another member's private
records. Confirm that storage writes are restricted to the authenticated user's
folder.

The `listing-asset-quarantine` bucket is deliberately private. Connect an
external malware-scanning worker that reads pending asset records, scans the
object, moves clean objects into the private `listing-assets` delivery bucket,
records the provider and
scan reference, and marks rejected files without exposing them. Do not publish
or sign a short-lived download URL while `scan_status` is anything other than
`clean`. Run a scheduled cleanup for rejected, failed, soft-deleted, and orphaned
quarantine objects according to the approved retention policy.

## Staging environment

Set these public values in the staging frontend:

```text
VITE_SUPABASE_URL=https://PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=PUBLIC_KEY
VITE_PUBLIC_SITE_URL=https://STAGING_DOMAIN
VITE_ENABLE_DEMO_MEMBER_ACCESS=false
```

Run `npm run member:preflight`, `npm run test:user-listings`, `npm test`, and
`npm run build`. A nonzero preflight exit is an activation blocker.

## Two-account acceptance test

1. Create and verify an owner account and a separate viewer account.
2. Complete and save both profiles.
3. Create a draft listing; verify the viewer cannot see it.
4. Upload a supported image and reject an unsupported or oversized file.
5. Publish the listing; verify the viewer can open it.
6. Verify owner self-views are excluded.
7. Open the listing repeatedly as the viewer and once anonymously.
8. Verify total views, unique visitors, viewer name, and anonymous grouping.
9. Favorite the listing and submit an inquiry; verify only the correct viewer
   and listing owner can see their respective records.
10. Exercise pending, sold/leased, expired, and archived states; verify only the
    public lifecycle states remain visible in the marketplace.
11. Upload an asset and verify it remains unavailable while its malware scan is
    pending or rejected.
12. Confirm the viewer cannot edit the listing or read its owner-only analytics.

Production promotion requires the same test, backup/restore evidence, security
review, load evidence, rollback rehearsal, and Ernest Rodriguez's approval.

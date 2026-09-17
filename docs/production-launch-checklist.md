# Real Estate Savant production launch checklist

This checklist separates locally completed foundations from external launch dependencies. Production activation must fail closed until every required item is verified.

## Completed locally

- Production frontend build and bundle-boundary verification.
- Dallas parcel preprocessing, exact count reports, viewport loaders, and county-aware search.
- CRM CSV ingestion, duplicate repair, complete export-field retention, row-level import review, editing, column controls, and undoable deletion.
- Listing CSV ingestion and user listing workflows.
- Member Exchange matching and local conversation experience.
- Savant Orchestrator, specialist registry, approval policy, audit-shaped runs, and local event queue.
- Human approval required for publishing, communications, spending, deletion, equation changes, and production-code changes.

## External activation requirements

- [ ] Select a production hosting provider and connect the domain.
- [ ] Provision production and staging environments separately.
- [ ] Connect an identity provider with verified email, MFA options, sessions, password reset, and organization membership.
- [ ] Deploy a supported shared database with tenant isolation, migrations, backups, and point-in-time recovery.
- [ ] Migrate CRM, listings, conversations, reminders, and agent runs from browser storage.
- [ ] Connect encrypted object storage for listing media and exports.
- [ ] Connect email, SMS, voice, and notification providers in sandbox first.
- [ ] Configure consent, unsubscribe, suppression, Do Not Call, rate-limit, and delivery-receipt handling.
- [ ] Install a production tile-building toolchain and create the content-addressed PMTiles artifact.
- [ ] Verify data licenses, source freshness, and county release evidence.
- [ ] Run tenant-isolation, penetration, sustained-load, recovery, and rollback tests.
- [ ] Publish privacy policy, terms, acceptable-use rules, data-retention policy, and support contacts.
- [ ] Obtain product, security, and release approval before enabling production feature gates.

## Required environment boundary

Public frontend configuration may use `VITE_` variables. Database credentials, provider secrets, encryption keys, object-storage credentials, and AI provider keys must remain server-only. See `.env.example`.

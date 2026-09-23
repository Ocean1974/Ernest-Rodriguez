# Real Estate Savant collaboration setup

## Decision authority

Ernest Rodriguez is the founder, creator, chief executive, product owner, and
final decision-maker. Jon participates as a minority partner and collaborator
within authority delegated by Ernest. See `GOVERNANCE.md` before changing,
sharing, licensing, or releasing the project.

This repository contains the application source, data-pipeline code, tests, and
configuration needed to develop Real Estate Savant. Large source datasets and
generated artifacts are deliberately kept outside Git.

## First-time setup

Install these tools:

- Git
- Node.js 20 LTS or newer
- npm (included with Node.js)

Clone the private repository, open PowerShell in the cloned folder, and run:

```powershell
npm install
Copy-Item .env.example .env
npm test
npm run dev
```

Vite prints the local address to open in a browser. Never commit `.env` or put
private API keys in a variable whose name begins with `VITE_`.

## Shared parcel data

The Dallas source bundle is transferred separately through the team's shared
OneDrive or another access-controlled file service. Put these files in
`data/raw/` using these exact names:

```text
data/raw/BLKID.zip
data/raw/DCAD2026_CURRENT.ZIP
data/raw/PARCEL_GEOM.zip
data/raw/ParcelDimension.zip
```

The exact byte sizes and SHA-256 fingerprints of Ernest's approved copies are
recorded in `data/source-bundle-checksums.sha256`. On Windows, inspect the
copied files with:

```powershell
Get-ChildItem data/raw -File | Get-FileHash -Algorithm SHA256
```

Compare the results with the checksum file before rebuilding the pipeline.

After copying the sources, generate and verify the Dallas parcel output:

```powershell
npm run data:build
npm run data:test
```

Generated folders such as `output/`, `public/data/`, `dist/`, and
`node_modules/` are not committed. Use the project scripts to recreate them or
copy an approved generated-data bundle when a full local mirror is needed.

## Daily workflow

Before starting work:

```powershell
git pull
npm install
```

Create a branch for each change:

```powershell
git switch -c initials/short-description
```

Before sharing work:

```powershell
npm test
npm run build
git add --all
git commit -m "Describe the change"
git push -u origin HEAD
```

Open a pull request so the other teammate can review and merge the change.
Do not commit generated datasets, secret keys, recovery archives, or local logs.
Material changes require Ernest's explicit approval before merge or release.

## Baseline verification status

On September 17, 2026, `npm run build` completed successfully and verified that
the production bundle excludes 102,952 generated data files (about 58.1 GB).
The full `npm test` run currently reaches the application integration suite and
then stops in `scripts/test-loader-integration.cjs` with this known assertion:

```text
WhiteRabbitMap does not declare a safe Earth-first map shell with marketplace and CRM navigation
```

Treat that assertion as an existing baseline issue, not as a failed workstation
setup. Do not change the locked UI merely to silence it; resolve the source/test
contract deliberately in a reviewed change.

## Project rules

Read `AGENTS.md` and `README.md` before changing the application. In particular:

- Keep the approved Google Earth-style landing page and Earth imagery.
- Preserve the Dallas parcel engine's visible behavior until its pipeline is
  verified.
- Process large parcel data at build time or on the server, not in the browser.
- Add tests for data-pipeline changes.

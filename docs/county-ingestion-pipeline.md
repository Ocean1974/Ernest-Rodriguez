# Repeatable County Ingestion Pipeline

The county ingestion pipeline is adapter-based. Each county gets its own folder under `data/county-adapters/<county>/` with:

- `adapter.json`
- `pipeline.json`
- `README.md`

Dallas County / DCAD is the first working adapter at `data/county-adapters/dallas/`.

## Shared Importer Batches

The pilot parcel builders are registered in `data/county-importer-registry.json` by source-system family. The registry keeps each verified join key, adapter folder, sample/full command, service manifest, and FIPS routing identity together.

```powershell
npm.cmd run county:importers:pilots
npm.cmd run county:importers:texas
npm.cmd run county:importers:kentucky
npm.cmd run county:importers:national
```

The eight-pilot batch covers Jefferson KY, Tarrant, Harris, Travis, Collin, Denton, Maricopa, and King. Execution is fail-closed: sample or full execution is refused when a county lacks an adapter, duplicate-safe join key, importer command, parcel manifest, or exact parcel/search count parity. State expansion plans may contain blocked counties so source work can be planned without treating a scaffold as data coverage.

`arcgis-rest-parcel-service` handles paged ArcGIS FeatureServer and MapServer sources. `lojic-pva-bulk` handles official LOJIC geometry joined to PVA bulk appraisal records. County field maps remain explicit because schemas and durable parcel identifiers differ.

## Standard Flow

1. Inspect source schemas and join keys.
2. Build the joined parcel GeoJSON.
3. Convert parcel GeoJSON into viewport chunks and search shards.
4. Build owner/contact parcel matches.
5. Fetch official permit sources when network access is available.
6. Build permit chunks.
7. Build development intelligence and parcel development index.
8. Run tests.
9. Build the app.
10. Generate PMTiles/vector tiles outside this workspace when Tippecanoe, PMTiles, or Docker is available.

## Commands

Plan a county ingestion run:

```powershell
node scripts\run-county-ingestion.cjs --county dallas --plan
```

Execute the county ingestion commands:

```powershell
node scripts\run-county-ingestion.cjs --county dallas --execute
```

The plan command writes:

- `output/county-ingestion-plan-dallas-county-dcad.json`
- `output/county-ingestion-plan-dallas-county-dcad.md`

Check whether Dallas/DCAD is locked and the next county can move forward without changing the UI:

```powershell
npm run county:readiness
```

The readiness command writes:

- `output/county-expansion-readiness-report.json`
- `output/county-expansion-readiness-report.md`

This report is the handoff between Dallas completion and the next county. It keeps Dallas as the only active production adapter, records the exact DCAD counts and join keys, and lists pilot-county blockers such as missing source files or placeholder join keys.

## Controlled Priority Batch

Generate plans for Tarrant, Collin, Denton, Fort Bend, Travis, and Bexar together:

```powershell
npm run county:priority-batch-plan
```

The batch command writes:

- `output/county-batch-plan/county-batch-plan.json`
- `output/county-batch-plan/county-batch-plan.md`

Batch execution fails closed until every selected adapter has zero validation errors and zero missing-source/output warnings. A source-needed adapter shell is never treated as an ingested county.

Generate the production-promotion gate for the four map/search pilots and six Texas priorities:

```powershell
npm run county:priority-promotion
```

The promotion report records exact QC warnings, parcel counts, chunk counts, search-shard counts, placeholder fields, official-source audit status, and safe activation state for every target.

## Fast App-Shell Verification

The public data tree is approximately 32 GB, so a normal `npm run build` copies the full data tree and can take a long time. Verify frontend compilation without overwriting `dist` or duplicating county data with:

```powershell
npm run build:verify
```

This builds the application shell into `output/app-shell-build` and preserves production `dist`. Tailwind source detection is restricted to `src` so generated county artifacts are not scanned as frontend templates.

## Universal Parcel Contract

Every county adapter should map raw parcel data into `wr-universal-parcel-v1` before publishing app parcel chunks.

Schema:

- `data/schemas/universal-parcel.schema.json`
- `data/schemas/universal-parcel.md`

## UI Constraint

This pipeline is data plumbing only. Do not redesign or restyle the White Rabbit pages while adding or running a county adapter.

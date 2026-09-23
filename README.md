# Real Estate Savant — Codex Handoff

## Founder and decision authority

Ernest Rodriguez is the founder, creator, chief executive, product owner, and
final decision-maker for Real Estate Savant. All contributors and automated
agents must follow the founder-control policy in `GOVERNANCE.md`.

## Current locked canvas file
White-rabbit-google-earth-landing

## Critical instruction
Do not redesign or rebuild from scratch unless Ernest explicitly requests it.

Use the current ChatGPT canvas code as the source of truth.

## Locked baseline
- Google Earth-style landing page
- Earth-only landing experience
- Logo-only identity
- Enter Map opens the live map engine
- Live Earth imagery background remains behind parcels
- Dallas aerial tile background removed
- Dallas DCAD parcel engine is the primary live map
- Parcel geometry + BLKID + ParcelDimension integration
- Search bar connected to uploaded DCAD parcel data
- Rotate / tilt / zoom / pan controls
- Parcel labels and dimension overlays
- Frontage / depth / perimeter display
- Focused parcel card
- Active parcel panel
- Dallas parcel view as the permanent live map baseline

## Uploaded/Referenced data sources
- DCAD 2026 CURRENT.ZIP
- PARCEL_GEOM.zip
- BLKID.zip
- ParcelDimension (1).zip

## Added local source files
The core DCAD files have been copied into `data/raw/`:

- `data/raw/DCAD2026_CURRENT.ZIP`
- `data/raw/PARCEL_GEOM.zip`
- `data/raw/BLKID.zip`
- `data/raw/ParcelDimension.zip`

See `data/source-manifest.json` for source descriptions and join keys.

Extracted sources are available under `data/extracted/`:

- `data/extracted/DCAD2026_CURRENT/`
- `data/extracted/PARCEL_GEOM/`
- `data/extracted/BLKID/`
- `data/extracted/ParcelDimension/`

Processed parcel database:

- `data/processed/parcel-database.ndjson`
- `data/processed/parcel-database-manifest.json`

The processed parcel database is generated from the full `PARCEL_GEOM` shapefile and currently contains 696,601 parcel records keyed by `Acct` / account.

Joined GeoJSON pipeline:

- `npm run data:build`
- `npm run data:test`
- Output: `output/white-rabbit-dallas-parcels.geojson`
- Manifest: `output/white-rabbit-dallas-parcels-manifest.json`

The joined output preserves parcel geometry in WGS84 / EPSG:4326 and joins DCAD appraisal/account, block label, and parcel dimension fields where available.

## Current modeled sample parcels
- 10300 SANDEN DR
- 1616 GREENVILLE AVE
- 1701 SKILLMAN ST
- 1901 N HENDERSON AVE

## Current behavior
Landing page:
- dark Google Earth-style background
- rabbit icon only
- search bar
- Enter Map card
- Enter Map opens the live Dallas parcel engine

Live map:
- Earth imagery is the permanent background
- Dallas aerial map tiles are removed
- parcel polygons render over Earth imagery
- search works across DCAD parcel fields and parcel dimensions
- selected parcels update the focused card and active parcel panel

## Recommended Codex tasks
1. Keep the current canvas-aligned code in src/App.tsx as the UI source of truth.
2. Split components only when it preserves the locked visual behavior.
3. Keep DCAD parcel, dimension, BLKID, zoning, floodplain, and permit inputs behind build-time or server-side loaders.
4. Preprocess shapefiles server-side or build-time into GeoJSON/vector tiles.
5. Add viewport-based parcel loading for production-scale data.
6. Preserve the locked UI baseline.

## Known limitation
The current canvas uses embedded sample parcel polygons for reliability. Production should convert uploaded shapefiles into viewport-loadable GeoJSON/vector tiles instead of loading huge shapefiles directly in the browser.

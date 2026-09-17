# Real Estate Savant — AGENTS.md

## Source of truth
The approved frontend baseline is the current ChatGPT canvas file:

White-rabbit-google-earth-landing

Do not redesign the UI unless Ernest explicitly requests it.

## Locked UI baseline
- Google Earth-style landing page
- Enter Map opens the Dallas parcel engine
- live Earth imagery background remains behind parcels
- Dallas aerial tile background stays removed
- DCAD parcel layer is primary
- parcel geometry + BLKID + ParcelDimension integration
- search bar tied to uploaded DCAD parcel data
- rotate / tilt / zoom / pan controls
- focused parcel card
- active parcel panel

## Data files
Assume these files exist in /data:
- PARCEL_GEOM.zip
- DCAD2026_CURRENT.ZIP
- BLKID (1).zip
- ParcelDimension (1).zip

## Rules
- Do not redesign the landing page.
- Do not replace the Earth imagery background.
- Do not load huge shapefiles directly in the browser.
- Prefer build-time or server-side preprocessing.
- Prefer viewport-based loading for production data.
- Add tests for every data-pipeline step.
- Report exact parcel counts and exact join keys.
- If a join key is uncertain, document it explicitly.
- Do not change visible frontend behavior until the parcel pipeline is verified.

## Expected outputs
- /output/schema-report.md
- /output/schema-report.json
- /output/join-key-report.md
- /output/full-parcel-access-report.md
- /output/white-rabbit-dallas-parcels.geojson
- /output/white-rabbit-dallas-parcels.pmtiles or /output/vector-tiles/

## Commands
- npm install
- npm test
- npm run build

## Permit mining rules
- Do not redesign the current Real Estate Savant UI while adding permit data.
- Prefer official City of Dallas data sources first.
- Preserve source dataset identifiers in output metadata.
- Normalize permits into a parcel-joinable format.
- Prefer address match plus spatial join when possible.
- Keep a record of unmatched permits.
- Do not render huge permit datasets directly in the browser at once.
- Use viewport loading and indexed search for production.

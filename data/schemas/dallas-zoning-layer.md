# White Rabbit Dallas Zoning Layer Schema

This schema defines optional Dallas zoning records for White Rabbit. These records are enrichment layers only. They do not replace the DCAD parcel schema, DCAD parcel geometry, parcel IDs, owner data, or parcel search index.

## Source Layers

- Dallas Public Zoning app: `https://developmentweb.dallascityhall.com/publiczoningweb/`
- City tax parcel bridge: `CRMHostedLayers/FeatureServer/13`
- Base zoning: `Dallas_Zoning/FeatureServer/15`
- Area of request search: `AORSearch/FeatureServer/0`
- Current-year zoning cases: `AreasOfRequest/FeatureServer/10`

## Join Order

1. Use `ACCT` from City tax parcel services when it is present and matches White Rabbit `accountNum`.
2. Use `GIS_ACCT` when `ACCT` is unavailable and it matches White Rabbit `gisParcelId`.
3. Use a spatial join for zoning polygons, overlays, and zoning case areas that do not expose a parcel account key.
4. Keep unmatched zoning records as optional records with `joinMethod: "unmatched"` so they can be reported without modifying base parcels.

## Runtime Rules

- Do not render full ArcGIS layers directly in the browser.
- Publish viewport chunks and a small search index before any visible map layer is activated.
- Keep `defaultVisible` false for zoning until chunk counts, joins, and QA reports are reviewed.
- Cap runtime loading by viewport. The Dallas adapter currently sets `maxFeaturesPerViewport` to `750`.

## Required IDs

Each normalized zoning record must have a stable county-aware ID:

`sourceCountyId:sourceLayerId:objectId`

For Dallas this starts with:

`dallas-county-dcad:<layer-id>:<object-id>`

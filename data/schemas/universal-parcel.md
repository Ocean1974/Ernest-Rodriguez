# White Rabbit Universal Parcel Schema

Version: `wr-universal-parcel-v1`

This is the county-neutral parcel record that every county adapter should produce before the app consumes parcel chunks, search hydration, permit joins, development signals, and parcel cards.

## Required Core Fields

- `schemaVersion`: must be `wr-universal-parcel-v1`
- `sourceCountyId`: county adapter id, for example `dallas-county-dcad`
- `whiteRabbitPropertyId`: canonical White Rabbit property id, for example `wrp:v1:dallas-county-dcad:008052000B01A0000`
- `countyParcelId`: county-aware stable parcel id, for example `dallas-county-dcad:008052000B01A0000`
- `accountNum`: normalized primary appraisal/account identifier
- `accountNumber`: compatibility alias for `accountNum`
- `gisParcelId`: GIS parcel identifier, or account fallback if unavailable
- `address`: normalized situs/property address
- `centroid`: app screen coordinate `[x, y]` from `0` to `100`
- `points`: simplified app screen polygon points
- `liveGeometry`: lightweight lng/lat geometry used by the live map
- `realGeometry`: source GeoJSON feature geometry
- `joins`: booleans describing which source joins succeeded
- `sourceReferences`: source dataset/table references and raw lineage
- `dataLineage`: normalized source, generation time, source update time, and freshness evaluation

## Standard Field Groups

Identity:

- `sourceParcelId`
- `sourceCountyId`
- `whiteRabbitPropertyId`
- `countyParcelId`
- `accountNum`
- `accountNumber`
- `gisParcelId`

Address:

- `address`
- `propertyAddress`
- `city`
- `propertyZip`

Owner:

- `propertyName`
- `ownerName`
- `ownerName2`
- `businessName`
- `ownerMailingAddress`
- `ownerMailingAddress2`
- `ownerCity`
- `ownerState`
- `ownerZip`
- `ownerCountry`
- `ownerPhone`
- `ownerEmail`

Assessment and land:

- `buildingClass`
- `zoning`
- `landUseCode`
- `landUseDescription`
- `landSection`
- `landAreaSize`
- `landAreaUnit`
- `landAreaSqFt`
- `yearBuilt`
- `grossBuildingArea`
- `landValue`
- `improvementValue`
- `totalValue`

Map and geometry:

- `blockId`
- `areaLabel`
- `frontage`
- `depth`
- `perimeter`
- `centroid`
- `points`
- `liveGeometry`
- `realGeometry`
- `dimensions`

## County Adapter Rule

Each county adapter must map its raw parcel/appraisal fields into this schema before publishing app parcel chunks. Unknown fields may be preserved as extra properties, but the required core fields must stay stable.

## Identity and Lineage Rule

`whiteRabbitPropertyId` is a backward-compatible extension to the v1 parcel record and is not a display label. Identity version 1 uses the county adapter id plus the adapter's primary source parcel identifier. Runtime loaders add it to older parcel chunks during migration, so the visible map does not need to change while large artifacts are rebuilt.

`dataLineage.freshnessStatus` must be `unknown` when the upstream source does not publish a trustworthy update timestamp. White Rabbit must not infer a current source merely from the time its own service artifact was generated.

No page redesign is needed to add or update this schema.

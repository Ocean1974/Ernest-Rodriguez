# King County Adapter

This is a disabled pilot adapter created from the national DCAD-style rollout queue.

- Status: official parcel/property sources verified; production build needed
- Production enabled: no
- UI/page redesign: no
- Primary parcel geometry source: King County GIS `Property/KingCo_Parcels`
- Property info source: King County GIS `Property/KingCo_PropertyInfo` layer 2
- Primary join key: `PIN` with one-to-many geometry joins allowed
- GIS object key: `OBJECTID`
- Verified parcel geometry count: 638,648
- Duplicate geometry PIN count: 2,581
- Next step: build duplicate-safe viewport parcel chunks, search shards, production QA, owner source, permits/CO, floodplain, development signals, and aggregate demand sources before activation.

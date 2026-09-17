import { filterParcelsForViewport, type ParcelFeature } from "../src/map/loadParcels";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const sampleParcels: ParcelFeature[] = [
  {
    type: "Feature",
    properties: {
      accountNumber: "000001",
      propertyAddress: "10300 SANDEN DR",
      totalValue: 1000000,
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-96.9, 32.7],
          [-96.89, 32.7],
          [-96.89, 32.71],
          [-96.9, 32.71],
          [-96.9, 32.7],
        ],
      ],
    },
  },
  {
    type: "Feature",
    properties: {
      accountNumber: "000002",
      propertyAddress: "OUTSIDE DALLAS TEST",
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-97.5, 33.3],
          [-97.49, 33.3],
          [-97.49, 33.31],
          [-97.5, 33.31],
          [-97.5, 33.3],
        ],
      ],
    },
  },
];

const visible = filterParcelsForViewport(sampleParcels, {
  bounds: { minLng: -96.91, minLat: 32.69, maxLng: -96.88, maxLat: 32.72 },
  zoom: 16,
});

assert(visible.length === 1, "viewport loader should return only parcels inside bounds");
assert(visible[0].properties.propertyAddress === "10300 SANDEN DR", "search fixture should include 10300 SANDEN DR");

const searched = filterParcelsForViewport(sampleParcels, {
  bounds: { minLng: -98, minLat: 32, maxLng: -96, maxLat: 34 },
  zoom: 16,
  search: "10300 SANDEN",
});

assert(searched.length === 1, "parcel search should find 10300 SANDEN DR");

import { filterParcelRecordsForViewport } from "../src/map/loadParcels";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const parcels = [
  { accountNum: "inside", points: [[10, 10], [12, 10], [12, 12], [10, 12]] },
  { accountNum: "outside", points: [[90, 90], [92, 90], [92, 92], [90, 92]] },
];

const visible = filterParcelRecordsForViewport(parcels, {
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
});

assert(visible.length === 1, "viewport loader returns only parcels inside bounds");
assert(visible[0].accountNum === "inside", "inside parcel is returned");

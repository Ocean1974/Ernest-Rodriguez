import { searchParcelRecords } from "../src/map/loadParcels";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const parcels = [
  { accountNum: "008052000B01A0000", address: "10300 SANDEN DR", ownerName: "SANDEN INTERNATIONAL USA INC", blockId: "B/8052", buildingClass: "STORAGE WAREHOUSE", totalValue: 40624920 },
  { accountNum: "00000155887000000", address: "1616 GREENVILLE AVE", ownerName: "GREENVILLE RETAIL OWNER LLC", businessName: "GREENVILLE RETAIL HOLDINGS", blockId: "K/1477", buildingClass: "RETAIL", totalValue: 1716000 },
  { accountNum: "00000155887000001", address: "10301 OTHER DR", ownerName: "OTHER OWNER LLC", blockId: "K/1478", buildingClass: "RETAIL", totalValue: 650000 },
];

assert(searchParcelRecords(parcels, "10300 SANDEN").length === 1, "search finds address");
assert(searchParcelRecords(parcels, "10300 SANDEN DR")[0].accountNum === "008052000B01A0000", "search ranks exact address first");
assert(searchParcelRecords(parcels, "008052000B01A0000").length === 1, "search finds account number");
assert(searchParcelRecords(parcels, "SANDEN INTERNATIONAL")[0].accountNum === "008052000B01A0000", "search finds owner name");
assert(searchParcelRecords(parcels, "GREENVILLE RETAIL HOLDINGS")[0].accountNum === "00000155887000000", "search finds business name");
assert(searchParcelRecords(parcels, "B/8052").length === 1, "search finds block ID");
assert(searchParcelRecords(parcels, "40624920").length === 1, "search finds value fields");
assert(searchParcelRecords(parcels, "10300 SANDEN DR").length === 1, "exact street-number searches exclude weak street-suffix matches");
assert(searchParcelRecords(parcels, "SANDEN DR").length === 1, "multi-word searches require a meaningful majority of matching terms");

console.log("White Rabbit parcel search relevance tests passed.");

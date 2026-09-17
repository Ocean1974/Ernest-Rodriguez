const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const importer = await import(pathToFileURL(path.join(__dirname, "..", "src", "listings", "importListings.mjs")).href);
  const csv = [
    "Listing Name,Property Address,County,City,State,Property Type,Asking Price,Market Value,NOI,Agent Email,Latitude,Longitude,Description",
    'Rabbit Creek Center,"100 Main St, Suite 1",Jefferson County,Louisville,KY,Retail,$1.2M,$1.5M,90000,agent@example.com,38.2527,-85.7585,"Corner retail, renovated"',
    "Rabbit Row,200 Oak St,Jefferson County,Louisville,KY,Multifamily,850K,925000,65000,owner@example.com,38.25,-85.75,Value-add",
    "Rabbit Row,200 Oak St,Jefferson County,Louisville,KY,Multifamily,850K,925000,65000,owner@example.com,38.25,-85.75,Duplicate",
    ",300 Elm St,Jefferson County,Louisville,KY,Office,500000,600000,40000,,,,Missing name",
  ].join("\n");
  const result = importer.importUserListingsFromCsv(csv, "cre", [], { now: "2026-09-13T12:00:00.000Z" });
  assert.equal(result.error, "");
  assert.equal(result.imported, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.invalid, 1);
  assert.equal(result.records[0].propertyName, "Rabbit Creek Center");
  assert.equal(result.records[0].address, "100 Main St, Suite 1");
  assert.equal(result.records[0].askingPrice, 1200000);
  assert.equal(result.records[0].estimatedMarketValue, 1500000);
  assert.equal(result.records[0].coordinates, "38.2527, -85.7585");
  assert.equal(result.records[0].submissionType, "user-submitted");

  const ownedImport = importer.importUserListingsFromCsv("Name,Address,County\nOwned Import,300 Main St,Dallas County", "resi", [], { now: "2026-09-13T12:00:00.000Z", ownerMemberId: "member-1", ownerDisplayName: "Ernest" });
  assert.equal(ownedImport.records[0].ownerMemberId, "member-1");
  assert.equal(ownedImport.records[0].ownerDisplayName, "Ernest");

  const second = importer.importUserListingsFromCsv(csv, "cre", result.records, { now: "2026-09-14T12:00:00.000Z" });
  assert.equal(second.imported, 0);
  assert.equal(second.skipped, 3);
  assert.equal(second.records.length, 2);

  const rental = importer.importUserListingsFromCsv("Name,Address,County,Rent\nRabbit Rental,10 Pine St,Fayette County,2200", "rentals", []);
  assert.equal(rental.records[0].status, "For Rent");
  assert.equal(rental.records[0].monthlyRent, 2200);
  assert.match(rental.records[0].priceLabel, /2,200\/mo/);

  const missingColumns = importer.importUserListingsFromCsv("Name,Address\nRabbit,10 Main", "resi", []);
  assert.match(missingColumns.error, /Property Name, Address, and County/);
  console.log("CRE, residential, and rental CSV listing import tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });

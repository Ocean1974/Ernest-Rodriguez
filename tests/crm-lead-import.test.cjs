const assert = require("node:assert/strict");

(async () => {
  const { importCrmLeadsFromCsv, removeCrexiLinksFromText, sanitizeCrmLead } = await import("../src/crm/importLeads.mjs");
  const csv = [
    "First Name,Last Name,Phone,Email,Price,Created,Last Activity,Agent,Lead Source,Stage,Property Address,Next Action,Follow Up Date",
    'Ada,Lovelace,"(214) 555-0101",ada@example.com,"$1,250,000",2026-01-02,2026-02-03,Ernest,Referral,Qualified,100 Main St,Call owner,2026-09-20',
    "Grace,Hopper,214-555-0102,grace@example.com,850K,2026-01-03,2026-02-04,Ernest,Website,Lead,200 Oak St,Send brief,2026-09-21",
    "Duplicate,Lead,999-555-0000,ada@example.com,100000,2026-01-04,2026-02-05,Ernest,Import,Lead,300 Elm St,,",
  ].join("\n");
  const result = importCrmLeadsFromCsv(csv, [], { now: "2026-09-13T12:00:00.000Z" });
  assert.equal(result.imported, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.issues.length, 1);
  assert.equal(result.invalid, 0);
  assert.equal(result.records[0].contact, "Ada Lovelace");
  assert.equal(result.records[0].value, 1250000);
  assert.equal(result.records[0].stage, "Qualified");
  assert.equal(result.records[0].agent, "Ernest");
  assert.equal(result.records[0].source, "Referral");
  assert.equal(result.records[1].value, 850000);
  const secondImport = importCrmLeadsFromCsv(csv, result.records, { now: "2026-09-13T12:00:00.000Z" });
  assert.equal(secondImport.imported, 0);
  assert.equal(secondImport.skipped, 3);
  assert.equal(secondImport.records.length, 2);

  const propertyExport = [
    "Property Link,Property Name,Property Type,APN,Address,City,Zip Code,State,County,Sale Date,Sold Price,Owner Name,Contact Name,Phone 1,Phone 2,Email 1,Email 2",
    "https://example.com/property,Rabbit Plaza,Multifamily,123-456,100 Market St,Louisville,40202,KY,Jefferson County,06/04/2024,1250000,Rabbit Holdings,Ernest Owner,502-555-0101,502-555-0102,owner@example.com,assistant@example.com",
  ].join("\n");
  const propertyResult = importCrmLeadsFromCsv(propertyExport, [], { now: "2026-09-14T12:00:00.000Z" });
  assert.equal(propertyResult.imported, 1);
  assert.deepEqual(propertyResult.records[0].phones, ["502-555-0101", "502-555-0102"]);
  assert.deepEqual(propertyResult.records[0].emails, ["owner@example.com", "assistant@example.com"]);
  assert.equal(propertyResult.records[0].name, "Rabbit Plaza");
  assert.equal(propertyResult.records[0].propertyType, "Multifamily");
  assert.equal(propertyResult.records[0].county, "Jefferson County");
  assert.equal(propertyResult.records[0].state, "KY");
  assert.equal(propertyResult.records[0].city, "Louisville");
  assert.equal(propertyResult.records[0].saleDate, "06/04/2024");
  assert.equal(propertyResult.records[0].soldPrice, 1250000);
  assert.equal(propertyResult.records[0].importedFields["Property Name"], "Rabbit Plaza");
  assert.equal(propertyResult.records[0].phone, "502-555-0101 · 502-555-0102");
  assert.equal(propertyResult.records[0].email, "owner@example.com · assistant@example.com");

  const oldImportWithoutChannels = [{ ...propertyResult.records[0], phone: "", phones: [], email: "", emails: [] }];
  const repaired = importCrmLeadsFromCsv(propertyExport, oldImportWithoutChannels, { now: "2026-09-14T12:00:00.000Z" });
  assert.equal(repaired.imported, 0);
  assert.equal(repaired.updated, 1);
  assert.equal(repaired.records.length, 1);
  assert.equal(repaired.records[0].phone, "502-555-0101 · 502-555-0102");
  assert.equal(repaired.records[0].email, "owner@example.com · assistant@example.com");
  const invalid = importCrmLeadsFromCsv("Owner Name,Phone 1\nOnly Owner,", [], { now: "2026-09-14T12:00:00.000Z" });

  const crexiCsv = 'Contact Name,Phone 1,Property Link,Notes,Website\nCasey Seller,5025550100,https://www.crexi.com/properties/123/rose-building,"Review https://crexi.com/properties/123 before calling",https://example.com/property';
  const crexiResult = importCrmLeadsFromCsv(crexiCsv, [], { now: "2026-09-14T12:00:00.000Z" });
  assert.equal(crexiResult.records[0].propertyLink, "");
  assert.equal(crexiResult.records[0].importedFields["Property Link"], undefined);
  assert.equal(crexiResult.records[0].importedFields.Notes, "Review before calling");
  assert.equal(crexiResult.records[0].importedFields.Website, "https://example.com/property");
  assert.equal(removeCrexiLinksFromText("See https://www.crexi.com/listing/55 now"), "See now");
  assert.equal(sanitizeCrmLead({ propertyLink: "https://crexi.com/x", importedFields: { Link: "https://crexi.com/x", County: "Jefferson" } }).importedFields.County, "Jefferson");
  assert.equal(invalid.invalid, 1);
  assert.deepEqual(invalid.issues, [{ row: 2, reason: "No contact, address, phone, or email data." }]);
  console.log("Real Estate Savant CRM CSV lead import tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });

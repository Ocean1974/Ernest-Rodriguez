const assert = require("assert");

(async () => {
  const { planParcelQuery } = await import("../src/search/parcelQueryPlanner.mjs");
  const { executeParcelQueryPlan } = await import("../src/search/parcelQueryExecutor.mjs");
  const plan = planParcelQuery("parcels over 5 acres owned by an LLC with improvement value below land value and no recent permits");
  const parcels = [
    { whiteRabbitPropertyId: "wrp:v1:dallas-county-dcad:A1", accountNum: "A1", landAreaSize: 7, landAreaUnit: "ACRE", ownerName: "ALPHA LAND LLC", improvementValue: 100000, landValue: 900000 },
    { whiteRabbitPropertyId: "wrp:v1:dallas-county-dcad:A2", accountNum: "A2", landAreaSize: 2, landAreaUnit: "ACRE", ownerName: "BETA LAND LLC", improvementValue: 100000, landValue: 900000 },
    { whiteRabbitPropertyId: "wrp:v1:dallas-county-dcad:A3", accountNum: "A3", landAreaSize: 8, landAreaUnit: "ACRE", ownerName: "GAMMA LAND LLC", improvementValue: "", landValue: 900000 },
  ];
  const permitsByParcel = new Map([["A1", []], ["A2", []], ["A3", []]]);
  const result = executeParcelQueryPlan(plan, parcels, { permitsByParcel }, { includeIndeterminate: true });
  assert.equal(result.schemaVersion, "wr-parcel-query-result-v1");
  assert.equal(result.totals.evaluated, 3);
  assert.equal(result.totals.matched, 1);
  assert.equal(result.matches[0].parcel.accountNum, "A1");
  assert.equal(result.totals.indeterminate, 1);
  assert(result.indeterminate[0].evaluation.filterEvidence.some((item) => item.status === "unknown"));
  assert(result.matches[0].evaluation.filterEvidence.every((item) => item.explanation));
  const missingArea = executeParcelQueryPlan(planParcelQuery("parcels over 5 acres"), [{ whiteRabbitPropertyId: "wrp:v1:dallas-county-dcad:MISSING" }], {}, { includeIndeterminate: true });
  assert.equal(missingArea.totals.indeterminate, 1, "Missing numeric evidence must not be coerced to zero");

  const acquisitionPlan = planParcelQuery("vacant land between 5 and 20 acres with buildings over 50k sqft valued under $4m having recent permits");
  const acquisitionParcels = [
    { whiteRabbitPropertyId: "wrp:v1:dallas-county-dcad:B1", accountNum: "B1", landAreaSize: 8, landAreaUnit: "ACRE", buildingClass: "VACANT LAND", buildingAreaSqFt: 60000, totalValue: 3500000 },
    { whiteRabbitPropertyId: "wrp:v1:dallas-county-dcad:B2", accountNum: "B2", landAreaSize: 22, landAreaUnit: "ACRE", buildingClass: "VACANT LAND", grossBuildingArea: 90000, totalValue: 3000000 },
  ];
  const acquisitionResult = executeParcelQueryPlan(acquisitionPlan, acquisitionParcels, { permitsByParcel: new Map([["B1", [{}]], ["B2", [{}]]]) });
  assert.equal(acquisitionResult.totals.matched, 1);
  assert.equal(acquisitionResult.matches[0].parcel.accountNum, "B1");
  assert(acquisitionResult.matches[0].evaluation.filterEvidence.every((item) => item.status === "matched"));
  console.log("White Rabbit structured parcel query execution tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

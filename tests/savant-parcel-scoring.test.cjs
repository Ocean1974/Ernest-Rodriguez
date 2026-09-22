const assert = require("assert");
const { baseScore, ownerEligibility, parcelBlockKey, addGrowthPoint, surroundingGrowthSignal, calibrateGrowthScores } = require("../scripts/build-savant-city-radars.cjs");

assert.equal(ownerEligibility("CITY OF DALLAS").eligible, false);
assert.equal(ownerEligibility("FIRST BAPTIST CHURCH").eligible, false);
assert.equal(ownerEligibility("COLUMBIA MEDICAL CENTER OF PLANO LP").eligible, false);
assert.equal(ownerEligibility("HEALTH CARE SERVICE CORPORATION").eligible, false);
assert.equal(ownerEligibility("WINDY HILL FARMS HOMEOWNERS ASSOC INC").eligible, false);
assert.equal(ownerEligibility("TIME WARNER CABLE TEXAS LLC").eligible, false);
assert.equal(ownerEligibility("EBHOA INC").eligible, false);
assert.equal(ownerEligibility("HIDDEN CREEK COMMUNITY ASSN INC").eligible, false);
assert.equal(ownerEligibility("EXPLORER PIPELINE CO").eligible, false);
assert.equal(ownerEligibility("USA WASTE OF TEXAS LANDFILLS INC").eligible, false);
assert.equal(ownerEligibility("OAKDALE RESIDENTIAL ASSOC INC").eligible, false);
assert.equal(ownerEligibility("TEXAS HEALTH RESOURCES").eligible, false);
assert.equal(ownerEligibility("DALLAS AREA RAPID TRANSIT").eligible, false);
assert.equal(ownerEligibility("ONCOR ELECTRIC DELIVERY COMPANY LLC").eligible, false);
assert.equal(ownerEligibility("WEST DALLAS INVESTMENTS LP").eligible, true);

const privateParcel = {
  ownerName: "WEST DALLAS INVESTMENTS LP",
  city: "DALLAS",
  ownerCity: "AUSTIN",
  ownerState: "TX",
  landValue: 1000000,
  improvementValue: 100000,
  totalValue: 1100000,
  landAreaSqFt: 87120,
  yearBuilt: 1970,
  blockId: "B-17",
};
const privateScore = baseScore(privateParcel, 3, false, "current-permit-activity");
const activeProjectScore = baseScore(privateParcel, 3, true, "current-permit-activity");
assert.equal(privateScore.eligible, true);
assert(privateScore.factors.some((factor) => factor.id === "absentee-owner"));
assert(privateScore.factors.some((factor) => factor.id === "legacy-improvements"));
assert(activeProjectScore.score < privateScore.score, "Active development on the target must reduce prospect score");
assert.equal(activeProjectScore.eligible, false, "Active development on the target must be excluded from off-market prospects");
assert.equal(activeProjectScore.exclusionReason, "active-development-on-target");
assert(activeProjectScore.factors.some((factor) => factor.id === "current-permit-activity-on-target-penalty"));
assert.equal(parcelBlockKey(privateParcel), "B17");

const subdivisionParcel = { ...privateParcel, blockId: "1", legalDescription: "PLANO MEDICAL PLAZA, BLK 1, LOT 1R" };
assert.equal(parcelBlockKey(subdivisionParcel), "PLANOMEDICALPLAZA:1");

const publicParcel = { ...privateParcel, ownerName: "DALLAS CITY OF" };
assert.equal(baseScore(publicParcel, 2, false).eligible, false);
assert.equal(baseScore(publicParcel, 2, false).exclusionReason, "government-owner");

const operatorParcel = { ...privateParcel, ownerName: "WAL-MART REAL ESTATE BUSINESS TRUST" };
assert(baseScore(operatorParcel, 3, false).score < privateScore.score, "National owner-operators must be penalized");

const developerParcel = { ...privateParcel, ownerName: "CANNON DEVELOPMENT COMPANY TEXAS LLC" };
assert(baseScore(developerParcel, 3, false).score < privateScore.score, "Active development companies must be penalized");

const texasSpelledOut = { ...privateParcel, ownerCity: "DALLAS", ownerState: "TEXAS" };
assert(!baseScore(texasSpelledOut, 1, false).factors.some((factor) => factor.id === "out-of-state-owner"), "Spelled-out Texas must remain in-state");

const growthGrid = new Map();
addGrowthPoint(growthGrid, { accountNum: "development-1", liveGeometry: { center: [-96.8, 33.01] } }, { latestActivityDate: "2026-06-01", signalCount: 4 }, new Date("2026-09-21"));
addGrowthPoint(growthGrid, { accountNum: "development-2", liveGeometry: { center: [-96.79, 33.015] } }, { latestActivityDate: "2025-03-01", signalCount: 2 }, new Date("2026-09-21"));
const growthSignal = surroundingGrowthSignal({ accountNum: "candidate", liveGeometry: { center: [-96.8, 33] } }, "candidate", growthGrid);
assert(growthSignal.activityIndex > 0, "Nearby development must create a Path of Growth activity index");
assert.equal(growthSignal.nearbyActivityCount, 2);
const remoteGrowthSignal = surroundingGrowthSignal({ accountNum: "remote", liveGeometry: { center: [-97.8, 34] } }, "remote", growthGrid);
const calibrated = calibrateGrowthScores([{ pathOfGrowth: remoteGrowthSignal }, { pathOfGrowth: growthSignal }]);
assert.equal(calibrated[0].pathOfGrowth.score, 0, "Remote development must not affect the parcel rating");
assert.equal(calibrated[1].pathOfGrowth.score, 100, "The strongest local growth signal must receive the highest city-local percentile");
assert(calibrated[1].pathOfGrowth.ratingPoints > 0 && calibrated[1].pathOfGrowth.ratingPoints <= 20);

console.log("Savant private off-market prospect scoring tests passed.");

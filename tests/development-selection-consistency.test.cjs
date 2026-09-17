const assert = require("assert");

(async () => {
  const presentation = await import("../src/map/developmentPresentation.mjs");
  const indexed = {
    parcelId: "00000100039000200",
    parcelGisId: "00000100039000200",
    parcelAddress: "501 N HOUSTON ST",
    parcelPropertyName: "CORDOVAN VENTURERS &",
    signalCount: 1,
    score: 76,
    latestActivityDate: "2019-01-16",
    signalTypes: ["site_preparation"],
    stages: ["site_preparation"],
  };
  const indexedRecords = new Map([[indexed.parcelId, indexed]]);
  const resolved = presentation.resolveSelectedDevelopmentRecord({
    embeddedRecords: [],
    indexedRecords,
    selectedDevelopmentId: `indexed-development-${indexed.parcelId}`,
    parcelAccountId: indexed.parcelId,
  });
  assert.equal(resolved.schemaVersion, "wr-development-presentation-v1");
  assert.equal(resolved.title, "CORDOVAN VENTURERS &");
  assert.equal(resolved.stage, "site_preparation");
  assert.equal(resolved.summary, "1 development signal(s) through 2019-01-16.");
  assert.equal(resolved.linkedAccount, indexed.parcelId);

  const embedded = { id: "curated-1", linkedAccount: indexed.parcelId, title: "Curated development", sources: [] };
  assert.equal(presentation.resolveSelectedDevelopmentRecord({ embeddedRecords: [embedded], indexedRecords, parcelAccountId: indexed.parcelId }), embedded);
  assert.equal(presentation.resolveSelectedDevelopmentRecord({ embeddedRecords: [], indexedRecords: new Map(), parcelAccountId: indexed.parcelId }), null);
  console.log("White Rabbit development search, selection, and parcel-card consistency tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { buildDevelopmentSignal } = require("./development-intel-utils.cjs");

const root = path.join(__dirname, "..");
const joinedPermitsFile = path.join(root, "data", "permits", "processed", "dallas-permits-joined.json");
const dallasNowSupplyFile = path.join(root, "output", "dallas-city-building-supply-intelligence.json");
const dallasNowLinkageFile = path.join(root, "output", "dallas-city-building-parcel-linkage.json");
const outputDir = path.join(root, "output");
const outputJsonFile = path.join(outputDir, "development-intelligence.json");
const reportFile = path.join(outputDir, "development-intelligence-report.md");
const geojsonFile = path.join(outputDir, "upcoming-development-parcels.geojson");
const unmatchedCsvFile = path.join(outputDir, "unmatched-development-signals.csv");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function buildStagedDallasNowSignals(supply, linkage) {
  const records = new Map((supply.records || []).map((record) => [record.recordNumber, record]));
  return (linkage.recordLinks || [])
    .filter((link) => link.partition === "exact")
    .map((link) => {
      const record = records.get(link.recordNumber);
      if (!record) throw new Error(`DallasNow linkage record is absent from its source artifact: ${link.recordNumber}`);
      return buildDevelopmentSignal({
        permitRecordId: record.recordNumber,
        sourceDataset: "dallasnow-building",
        sourceName: supply.sourceSystem,
        sourceUrl: record.detailUrl || supply.sourceUrl,
        permitNumber: record.recordNumber,
        permitType: record.recordType,
        permitStatus: record.status,
        recordDate: record.recordDate,
        dateSemantics: "dallasnow-search-record-date-not-permit-issuance-date",
        description: record.description,
        parcelAccountNum: link.exactParcel.accountNum,
        parcelGisId: link.exactParcel.gisParcelId,
        parcelAddress: link.exactParcel.address,
        joinMethod: link.matchMethod,
        parcelJoinSource: "Certified DallasNow-to-DCAD deterministic address linkage",
      });
    })
    .filter(Boolean);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(values) {
  return values.map(csvEscape).join(",");
}

function signalFeature(signal) {
  if (typeof signal.location.longitude !== "number" || typeof signal.location.latitude !== "number") return null;
  return {
    type: "Feature",
    properties: {
      signalId: signal.signalId,
      parcelId: signal.parcelId,
      parcelGisId: signal.parcelGisId,
      parcelAddress: signal.parcelAddress,
      parcelPropertyName: signal.parcelPropertyName,
      signalType: signal.signalType,
      stage: signal.stage,
      confidence: signal.confidence,
      score: signal.score,
      permitNumber: signal.source.permitNumber,
      permitType: signal.source.permitType,
      activityDate: signal.source.activityDate,
      valuation: signal.source.valuation,
      sourceDataset: signal.source.dataset,
      sourceUrl: signal.source.url,
      joinMethod: signal.source.joinMethod,
    },
    geometry: {
      type: "Point",
      coordinates: [signal.location.longitude, signal.location.latitude],
    },
  };
}

function summarizeBy(items, key) {
  return items.reduce((counts, item) => {
    const value = item[key] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function topParcelSummaries(signals, limit = 50) {
  const parcels = new Map();
  for (const signal of signals) {
    if (!signal.parcelId) continue;
    if (!parcels.has(signal.parcelId)) {
      parcels.set(signal.parcelId, {
        parcelId: signal.parcelId,
        parcelGisId: signal.parcelGisId,
        parcelAddress: signal.parcelAddress,
        parcelPropertyName: signal.parcelPropertyName,
        signalCount: 0,
        score: 0,
        latestActivityDate: "",
        signalTypes: new Set(),
        stages: new Set(),
      });
    }
    const parcel = parcels.get(signal.parcelId);
    parcel.signalCount += 1;
    parcel.score += signal.score;
    parcel.signalTypes.add(signal.signalType);
    parcel.stages.add(signal.stage);
    if (signal.source.activityDate && signal.source.activityDate > parcel.latestActivityDate) {
      parcel.latestActivityDate = signal.source.activityDate;
    }
  }
  return Array.from(parcels.values())
    .map((parcel) => ({
      ...parcel,
      signalTypes: Array.from(parcel.signalTypes),
      stages: Array.from(parcel.stages),
    }))
    .sort((a, b) => b.score - a.score || b.signalCount - a.signalCount)
    .slice(0, limit);
}

function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const payload = readJson(joinedPermitsFile);
  const dallasNowSupplyBytes = fs.readFileSync(dallasNowSupplyFile);
  const dallasNowSupply = JSON.parse(dallasNowSupplyBytes.toString("utf8"));
  const dallasNowLinkage = readJson(dallasNowLinkageFile);
  if (dallasNowLinkage.sourceArtifactSha256 !== sha256(dallasNowSupplyBytes)) throw new Error("DallasNow linkage source digest does not match the current supply artifact.");
  if (!dallasNowLinkage.certification?.sourceIdentityReconciled || !dallasNowLinkage.certification?.partitionsReconciled || !dallasNowLinkage.certification?.exactParcelLinksCertified) {
    throw new Error("DallasNow exact parcel links have not passed their certification gates.");
  }
  const stagedDallasNowSignals = buildStagedDallasNowSignals(dallasNowSupply, dallasNowLinkage);
  const dallasNowRuntimeActivated = Boolean(dallasNowLinkage.certification.independentReuseRightsCertified && dallasNowLinkage.certification.visibleUiActivated);
  const signals = [];
  const unmatched = [];
  for (const permit of payload.permits || []) {
    const signal = buildDevelopmentSignal(permit);
    if (!signal) continue;
    if (!signal.parcelId) {
      unmatched.push(signal);
      continue;
    }
    signals.push(signal);
  }
  if (dallasNowRuntimeActivated) signals.push(...stagedDallasNowSignals);
  const features = signals.map(signalFeature).filter(Boolean);
  const summary = {
    generatedAt: new Date().toISOString(),
    source: "data/permits/processed/dallas-permits-joined.json",
    sourcePermitCount: (payload.permits || []).length,
    joinedPermitCount: payload.totalPermitsJoinedToParcels,
    unmatchedPermitCount: payload.totalPermitsUnmatched,
    developmentSignalCount: signals.length,
    unmatchedDevelopmentSignalCount: unmatched.length,
    parcelCountWithSignals: new Set(signals.map((signal) => signal.parcelId)).size,
    signalTypeCounts: summarizeBy(signals, "signalType"),
    stageCounts: summarizeBy(signals, "stage"),
    sourceDatasets: Array.from(new Set(signals.map((signal) => signal.source.dataset).filter(Boolean))),
    dallasNowStaging: {
      sourceRecordCount: dallasNowLinkage.exactSummary.sourceRecordCount,
      certifiedExactLinkCount: dallasNowLinkage.exactSummary.exactLinkedRecordCount,
      classifiedExactSignalCount: stagedDallasNowSignals.length,
      ambiguousRecordCount: dallasNowLinkage.exactSummary.ambiguousRecordCount,
      unmatchedRecordCount: dallasNowLinkage.exactSummary.unmatchedRecordCount,
      invalidRecordCount: dallasNowLinkage.exactSummary.invalidRecordCount,
      independentReuseRightsCertified: dallasNowLinkage.certification.independentReuseRightsCertified,
      visibleUiActivated: dallasNowRuntimeActivated,
      sourceDateSemantics: "dallasnow-search-record-date-not-permit-issuance-date",
    },
  };
  const topParcels = topParcelSummaries(signals);

  writeJson(outputJsonFile, {
    ...summary,
    topParcels,
    signals,
    stagedSignals: {
      dallasNowBuilding: stagedDallasNowSignals,
    },
  });
  writeJson(geojsonFile, {
    type: "FeatureCollection",
    metadata: summary,
    features,
  });
  fs.writeFileSync(
    unmatchedCsvFile,
    [
      csvRow(["signalId", "sourceDataset", "permitNumber", "permitType", "address", "activityDate", "reason"]),
      ...unmatched.map((signal) =>
        csvRow([
          signal.signalId,
          signal.source.dataset,
          signal.source.permitNumber,
          signal.source.permitType,
          signal.parcelAddress,
          signal.source.activityDate,
          "Development signal lacked parcelAccountNum after current join pipeline",
        ]),
      ),
    ].join("\n") + "\n",
  );

  const report = [
    "# Development Intelligence Report",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "## Scope",
    "",
    "- Uses official City of Dallas permit and Certificate of Occupancy records already normalized in the project.",
    "- Stages current DallasNow Building records only when their DCAD parcel link is certified exact.",
    "- Keeps the staged DallasNow feed out of runtime signals until both reuse-rights and visible-activation gates pass.",
    "- Links signals to parcel IDs only when the permit pipeline has a parcel join.",
    "- Classifies development signals from permit type, description, land use, valuation, and source dataset.",
    "- Does not redesign or change any frontend page.",
    "",
    "## Counts",
    "",
    `- Source permit/CO records inspected: ${summary.sourcePermitCount}`,
    `- Permit records already joined to parcels: ${summary.joinedPermitCount}`,
    `- Development signals linked to parcel IDs: ${summary.developmentSignalCount}`,
    `- Parcels with development signals: ${summary.parcelCountWithSignals}`,
    `- Development signals still unmatched to parcel IDs: ${summary.unmatchedDevelopmentSignalCount}`,
    `- Current DallasNow records reconciled: ${summary.dallasNowStaging.sourceRecordCount}`,
    `- Certified exact DallasNow parcel links: ${summary.dallasNowStaging.certifiedExactLinkCount}`,
    `- Classified DallasNow signals staged: ${summary.dallasNowStaging.classifiedExactSignalCount}`,
    `- DallasNow runtime/UI activated: ${summary.dallasNowStaging.visibleUiActivated ? "yes" : "no"}`,
    "",
    "## Signal Types",
    "",
    ...Object.entries(summary.signalTypeCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => `- ${type}: ${count}`),
    "",
    "## Stages",
    "",
    ...Object.entries(summary.stageCounts).sort((a, b) => b[1] - a[1]).map(([stage, count]) => `- ${stage}: ${count}`),
    "",
    "## Outputs",
    "",
    "- `output/development-intelligence.json`",
    "- `output/development-intelligence-report.md`",
    "- `output/upcoming-development-parcels.geojson`",
    "- `output/unmatched-development-signals.csv`",
    "",
    "## Notes",
    "",
    "- This first pass is permit-driven. Zoning/CPC/council agenda mining should be added as the next source-specific stage.",
    "- Older permits are retained as development history; future/upcoming confidence improves when current official feeds are refreshed.",
    "- DallasNow record dates are preserved as search-record dates and are never described as permit issuance dates.",
  ].join("\n");
  fs.writeFileSync(reportFile, report);
  console.log(`Wrote ${outputJsonFile}`);
  console.log(`Wrote ${reportFile}`);
  console.log(`Wrote ${geojsonFile}`);
  console.log(JSON.stringify(summary, null, 2));
}

main();

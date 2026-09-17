const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const universePath = path.join(root, "data", "national-county-intelligence", "us-county-universe.json");
const adaptersRoot = path.join(root, "data", "county-adapters");
const nextWavePath = path.join(root, "data", "state-county-growth-next-wave.json");
const outputRoot = path.join(root, "output", "national-county-intelligence");
const outputJson = path.join(outputRoot, "national-coverage-manifest.json");
const outputMarkdown = path.join(outputRoot, "national-coverage-manifest.md");

const adapterAliases = {
  "dallas-county-tx": "dallas",
  "jefferson-county-ky": "louisville",
  "tarrant-county-tx": "tarrant",
};

const stages = ["scaffolded", "source-found", "processing", "qa", "live"];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function readJsonIfPresent(file) {
  return fs.existsSync(file) ? readJson(file) : null;
}

function sourceIsUsable(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return ![
    "source-needed",
    "placeholder",
    "not verified",
    "unverified",
    "unknown",
  ].some((marker) => normalized.includes(marker));
}

function hasDiscoveredSource(adapter) {
  return Object.values(adapter.sourceFiles || {}).some(sourceIsUsable)
    || sourceIsUsable(adapter.ownerEnrichment?.propertyRecordSource)
    || sourceIsUsable(adapter.appraisalDistrictName);
}

function qcEvidenceFor(county, adapter) {
  const candidates = [
    path.join(root, "output", "county-qc", `${adapter.id || county.countyId}.json`),
    path.join(root, "output", "county-qc", `${county.countyId}.json`),
  ];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) return null;
  const report = readJsonIfPresent(file);
  return {
    path: path.relative(root, file).replace(/\\/g, "/"),
    status: report?.status || report?.summary?.status || "present",
  };
}

function determineStage(county, adapter) {
  const reasons = [];
  const verifiedParcelCount = Number(adapter.verifiedCounts?.parcelGeometryFeatures || 0);
  const enabledForProduction = adapter.enabledForProduction === true;
  const activeStatus = String(adapter.status || "").toLowerCase() === "active";
  const scaffoldOnly = adapter.scaffoldOnly === true;
  const qc = qcEvidenceFor(county, adapter);

  if (!scaffoldOnly && (enabledForProduction || activeStatus)) {
    reasons.push(enabledForProduction ? "adapter enabled for production" : "adapter status is active");
    return { stage: "live", reasons, qc, verifiedParcelCount };
  }
  if (qc && verifiedParcelCount > 0) {
    reasons.push(`county QC evidence is present (${qc.status})`);
    return { stage: "qa", reasons, qc, verifiedParcelCount };
  }
  if (verifiedParcelCount > 0) {
    reasons.push(`verified parcel geometry count recorded (${verifiedParcelCount})`);
    return { stage: "processing", reasons, qc, verifiedParcelCount };
  }
  if (hasDiscoveredSource(adapter) && !scaffoldOnly) {
    reasons.push("at least one non-placeholder source is configured");
    return { stage: "source-found", reasons, qc, verifiedParcelCount };
  }
  reasons.push("official sources and join keys remain to be verified");
  return { stage: "scaffolded", reasons, qc, verifiedParcelCount };
}

function main() {
  const universe = readJson(universePath);
  const nextWave = readJson(nextWavePath);
  const priority = new Map();
  nextWave.waves.forEach((wave, stateIndex) => {
    wave.nextCounties.forEach((county, countyIndex) => {
      priority.set(county.countyId, {
        wave: stateIndex + 1,
        sequence: countyIndex + 1,
        workOrder: `${stateIndex + 1}.${countyIndex + 1}`,
        market: county.market,
      });
    });
  });

  const counties = universe.counties.map((county) => {
    const adapterFolder = adapterAliases[county.countyId] || county.countyId;
    const adapterPath = path.join(adaptersRoot, adapterFolder, "adapter.json");
    if (!fs.existsSync(adapterPath)) {
      throw new Error(`Missing adapter for Census county ${county.countyId} (${county.fips})`);
    }
    const adapter = readJson(adapterPath);
    const assessment = determineStage(county, adapter);
    return {
      fips: county.fips,
      stateFips: county.stateFips,
      countyFips: county.countyFips,
      state: county.state,
      countyId: county.countyId,
      countyName: county.countyName,
      censusClassFp: county.classFp,
      adapterId: adapter.id || adapterFolder,
      adapterFolder,
      adapterPath: path.relative(root, adapterPath).replace(/\\/g, "/"),
      stage: assessment.stage,
      stageReasons: assessment.reasons,
      verifiedParcelCount: assessment.verifiedParcelCount,
      qc: assessment.qc,
      enabledForProduction: adapter.enabledForProduction === true,
      scaffoldOnly: adapter.scaffoldOnly === true,
      priority: priority.get(county.countyId) || null,
    };
  });

  const stageCounts = Object.fromEntries(stages.map((stage) => [stage, counties.filter((county) => county.stage === stage).length]));
  const states = [...new Set(counties.map((county) => county.state))].sort().map((state) => {
    const stateCounties = counties.filter((county) => county.state === state);
    return {
      state,
      countyEquivalentCount: stateCounties.length,
      priorityCountyCount: stateCounties.filter((county) => county.priority).length,
      stageCounts: Object.fromEntries(stages.map((stage) => [stage, stateCounties.filter((county) => county.stage === stage).length])),
    };
  });

  const manifest = {
    schemaVersion: "wr-national-coverage-manifest-v1",
    generatedAt: new Date().toISOString(),
    censusSource: universe.source,
    coveragePolicy: "One canonical Census county/county-equivalent record per FIPS. Stage is evidence-derived and fails closed; scaffolding alone never authorizes visible activation.",
    stageDefinitions: {
      scaffolded: "Adapter and pipeline shell exist; official sources or joins are not yet verified.",
      "source-found": "At least one official/non-placeholder source is configured; processing evidence is not yet present.",
      processing: "A verified parcel count exists; complete QC evidence is not yet present.",
      qa: "County QC evidence exists, but production activation has not been authorized.",
      live: "A non-scaffold adapter is explicitly active or production-enabled.",
    },
    summary: {
      countyEquivalentCount: counties.length,
      uniqueFipsCount: new Set(counties.map((county) => county.fips)).size,
      stateAreaCount: states.length,
      priorityCountyCount: counties.filter((county) => county.priority).length,
      stageCounts,
    },
    states,
    counties,
  };

  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(outputJson, `${JSON.stringify(manifest, null, 2)}\n`);

  const lines = [
    "# White Rabbit U.S. Parcel Intelligence Coverage",
    "",
    `Generated: ${manifest.generatedAt}`,
    "",
    `- Census counties/county-equivalents: ${manifest.summary.countyEquivalentCount}`,
    `- Unique county FIPS codes: ${manifest.summary.uniqueFipsCount}`,
    `- States/areas represented: ${manifest.summary.stateAreaCount}`,
    `- Priority counties: ${manifest.summary.priorityCountyCount}`,
    `- Stages: ${stages.map((stage) => `${stage} ${stageCounts[stage]}`).join(", ")}`,
    "",
    "## State coverage",
    "",
    "| State/area | Counties | Priority | Scaffolded | Source found | Processing | QA | Live |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...states.map((state) => `| ${state.state} | ${state.countyEquivalentCount} | ${state.priorityCountyCount} | ${state.stageCounts.scaffolded} | ${state.stageCounts["source-found"]} | ${state.stageCounts.processing} | ${state.stageCounts.qa} | ${state.stageCounts.live} |`),
    "",
    "## Release rule",
    "",
    manifest.coveragePolicy,
    "",
  ];
  fs.writeFileSync(outputMarkdown, lines.join("\n"));
  console.log(JSON.stringify(manifest.summary, null, 2));
}

main();

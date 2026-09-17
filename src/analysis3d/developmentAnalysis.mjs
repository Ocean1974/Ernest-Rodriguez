export const DEVELOPMENT_SITE_MODEL_VERSION = "wr-development-site-model-v1";
export const DEVELOPMENT_FEASIBILITY_VERSION = "wr-development-feasibility-v1";
export const SHADOW_ANALYSIS_VERSION = "wr-shadow-analysis-v1";
export const LINE_OF_SIGHT_VERSION = "wr-line-of-sight-v1";

function numeric(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(String(value).replace(/[$,%]/g, "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function evidence(value, unit, sourceField) {
  const supplied = value && typeof value === "object" && !Array.isArray(value) && "value" in value;
  const parsed = numeric(supplied ? value.value : value);
  return {
    value: parsed,
    unit: String((supplied && value.unit) || unit),
    source: parsed === null ? "" : String((supplied && value.source) || "user-provided"),
    sourceField: parsed === null ? "" : String((supplied && value.sourceField) || sourceField),
    asOf: parsed === null ? "" : String((supplied && value.asOf) || ""),
    confidence: parsed === null ? 0 : Math.max(0, Math.min(1, numeric(supplied && value.confidence) ?? 1)),
    status: parsed === null ? "unknown" : (supplied && ["observed", "defaulted", "derived"].includes(value.status) ? value.status : "observed"),
  };
}

function propertyId(value) {
  const id = String(value || "").trim();
  if (!/^wrp:v1:[^:]+:.+$/.test(id)) throw new TypeError("whiteRabbitPropertyId must use wrp:v1 canonical identity");
  return id;
}

function round(value, digits = 3) {
  return value === null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));
}

export function createDevelopmentSiteModel(input = {}) {
  const whiteRabbitPropertyId = propertyId(input.whiteRabbitPropertyId);
  const siteAreaSqFt = evidence(input.siteAreaSqFt, "sqft", "siteAreaSqFt");
  const terrain = {
    minimumElevationFt: evidence(input.terrain?.minimumElevationFt, "ft", "terrain.minimumElevationFt"),
    maximumElevationFt: evidence(input.terrain?.maximumElevationFt, "ft", "terrain.maximumElevationFt"),
    meanElevationFt: evidence(input.terrain?.meanElevationFt, "ft", "terrain.meanElevationFt"),
    sourceDatasetId: String(input.terrain?.sourceDatasetId || ""),
  };
  const constraints = {
    maximumHeightFt: evidence(input.constraints?.maximumHeightFt, "ft", "constraints.maximumHeightFt"),
    maximumFar: evidence(input.constraints?.maximumFar, "ratio", "constraints.maximumFar"),
    maximumCoveragePct: evidence(input.constraints?.maximumCoveragePct, "percent", "constraints.maximumCoveragePct"),
    minimumFrontSetbackFt: evidence(input.constraints?.minimumFrontSetbackFt, "ft", "constraints.minimumFrontSetbackFt"),
    minimumRearSetbackFt: evidence(input.constraints?.minimumRearSetbackFt, "ft", "constraints.minimumRearSetbackFt"),
    minimumSideSetbackFt: evidence(input.constraints?.minimumSideSetbackFt, "ft", "constraints.minimumSideSetbackFt"),
  };
  const existingBuildings = (input.existingBuildings || []).map((building, index) => ({
    id: String(building.id || `building-${index + 1}`),
    footprintAreaSqFt: evidence(building.footprintAreaSqFt, "sqft", `existingBuildings.${index}.footprintAreaSqFt`),
    heightFt: evidence(building.heightFt, "ft", `existingBuildings.${index}.heightFt`),
    stories: evidence(building.stories, "count", `existingBuildings.${index}.stories`),
    geometry: building.geometry || null,
    sourceDatasetId: String(building.sourceDatasetId || ""),
  }));
  const requiredEvidence = [siteAreaSqFt.status === "unknown" ? "siteAreaSqFt" : ""].filter(Boolean);
  return {
    schemaVersion: DEVELOPMENT_SITE_MODEL_VERSION,
    whiteRabbitPropertyId,
    boundaryGeometry: input.boundaryGeometry || null,
    siteAreaSqFt,
    terrain,
    existingBuildings,
    constraints,
    sourceLineage: input.sourceLineage || null,
    status: requiredEvidence.length ? "partial" : "ready",
    missingEvidence: requiredEvidence,
  };
}

export function createMassingProposal(input = {}) {
  const stories = evidence(input.stories, "count", "proposal.stories");
  const floorToFloorHeightFt = evidence(input.floorToFloorHeightFt ?? { value: 12, source: "white-rabbit-default", sourceField: "proposal.floorToFloorHeightFt", confidence: 0.35, status: "defaulted" }, "ft", "proposal.floorToFloorHeightFt");
  const footprintAreaSqFt = evidence(input.footprintAreaSqFt, "sqft", "proposal.footprintAreaSqFt");
  const explicitGross = evidence(input.grossFloorAreaSqFt, "sqft", "proposal.grossFloorAreaSqFt");
  const explicitHeight = evidence(input.heightFt, "ft", "proposal.heightFt");
  const grossFloorAreaSqFt = explicitGross.value ?? (footprintAreaSqFt.value !== null && stories.value !== null ? footprintAreaSqFt.value * stories.value : null);
  const heightFt = explicitHeight.value ?? (stories.value !== null && floorToFloorHeightFt.value !== null ? stories.value * floorToFloorHeightFt.value : null);
  return {
    id: String(input.id || "proposal-1"),
    name: String(input.name || "Development proposal"),
    footprintAreaSqFt,
    stories,
    floorToFloorHeightFt,
    grossFloorAreaSqFt: explicitGross.value !== null ? explicitGross : evidence({ value: grossFloorAreaSqFt, source: "white-rabbit-derived", sourceField: "footprintAreaSqFt*stories", confidence: Math.min(footprintAreaSqFt.confidence, stories.confidence), status: "derived" }, "sqft", "derived:footprintAreaSqFt*stories"),
    heightFt: explicitHeight.value !== null ? explicitHeight : evidence({ value: heightFt, source: "white-rabbit-derived", sourceField: "stories*floorToFloorHeightFt", confidence: Math.min(stories.confidence, floorToFloorHeightFt.confidence), status: "derived" }, "ft", "derived:stories*floorToFloorHeightFt"),
    clearances: {
      frontFt: evidence(input.clearances?.frontFt, "ft", "proposal.clearances.frontFt"),
      rearFt: evidence(input.clearances?.rearFt, "ft", "proposal.clearances.rearFt"),
      sideFt: evidence(input.clearances?.sideFt, "ft", "proposal.clearances.sideFt"),
    },
    geometry: input.geometry || null,
  };
}

function check(id, label, actual, limit, operator) {
  if (actual === null || limit === null) return { id, label, status: "unknown", actual, limit, margin: null };
  const passes = operator === "max" ? actual <= limit : actual >= limit;
  return { id, label, status: passes ? "pass" : "fail", actual: round(actual), limit: round(limit), margin: round(operator === "max" ? limit - actual : actual - limit) };
}

export function evaluateDevelopmentFeasibility(siteInput, proposalInput) {
  const site = siteInput?.schemaVersion === DEVELOPMENT_SITE_MODEL_VERSION ? siteInput : createDevelopmentSiteModel(siteInput);
  const proposal = proposalInput?.footprintAreaSqFt?.status ? proposalInput : createMassingProposal(proposalInput);
  const area = site.siteAreaSqFt.value;
  const footprint = proposal.footprintAreaSqFt.value;
  const grossFloorArea = proposal.grossFloorAreaSqFt.value;
  const height = proposal.heightFt.value;
  const coveragePct = area > 0 && footprint !== null ? footprint / area * 100 : null;
  const far = area > 0 && grossFloorArea !== null ? grossFloorArea / area : null;
  const checks = [
    check("height", "Maximum building height", height, site.constraints.maximumHeightFt.value, "max"),
    check("far", "Maximum floor-area ratio", far, site.constraints.maximumFar.value, "max"),
    check("coverage", "Maximum lot coverage", coveragePct, site.constraints.maximumCoveragePct.value, "max"),
    check("front-setback", "Minimum front setback", proposal.clearances.frontFt.value, site.constraints.minimumFrontSetbackFt.value, "min"),
    check("rear-setback", "Minimum rear setback", proposal.clearances.rearFt.value, site.constraints.minimumRearSetbackFt.value, "min"),
    check("side-setback", "Minimum side setback", proposal.clearances.sideFt.value, site.constraints.minimumSideSetbackFt.value, "min"),
  ];
  const requiredMissing = [area === null ? "siteAreaSqFt" : "", footprint === null ? "proposal.footprintAreaSqFt" : "", grossFloorArea === null ? "proposal.grossFloorAreaSqFt-or-stories" : "", height === null ? "proposal.heightFt-or-stories" : ""].filter(Boolean);
  const status = requiredMissing.length ? "insufficient-evidence" : checks.some((item) => item.status === "fail") ? "not-feasible" : checks.some((item) => item.status === "unknown") ? "indeterminate" : "feasible";
  const knownMaximumFloorAreaSqFt = area !== null && site.constraints.maximumFar.value !== null ? area * site.constraints.maximumFar.value : null;
  const knownMaximumFootprintSqFt = area !== null && site.constraints.maximumCoveragePct.value !== null ? area * site.constraints.maximumCoveragePct.value / 100 : null;
  return {
    schemaVersion: DEVELOPMENT_FEASIBILITY_VERSION,
    whiteRabbitPropertyId: site.whiteRabbitPropertyId,
    status,
    site,
    proposal,
    metrics: { siteAreaSqFt: round(area), footprintAreaSqFt: round(footprint), grossFloorAreaSqFt: round(grossFloorArea), heightFt: round(height), coveragePct: round(coveragePct), far: round(far), maximumFloorAreaSqFtFromKnownFar: round(knownMaximumFloorAreaSqFt), maximumFootprintSqFtFromKnownCoverage: round(knownMaximumFootprintSqFt) },
    checks,
    missingEvidence: [...new Set([...requiredMissing, ...checks.filter((item) => item.status === "unknown").map((item) => item.id)])],
    disclaimer: "Feasibility is a mathematical screening result based only on supplied constraints; it is not a zoning or entitlement determination.",
  };
}

export function calculateShadow({ heightFt, sunElevationDeg, sunAzimuthDeg, observedAt = "" } = {}) {
  const height = numeric(heightFt);
  const elevation = numeric(sunElevationDeg);
  const azimuth = numeric(sunAzimuthDeg);
  if (height === null || height < 0 || elevation === null || elevation <= 0 || elevation > 90 || azimuth === null) return { schemaVersion: SHADOW_ANALYSIS_VERSION, status: "insufficient-evidence", shadowLengthFt: null, shadowBearingDeg: null, vector: null, observedAt, warnings: ["Height, sun elevation (greater than 0 and at most 90), and sun azimuth are required."] };
  const length = elevation === 90 ? 0 : height / Math.tan(elevation * Math.PI / 180);
  const bearing = ((azimuth + 180) % 360 + 360) % 360;
  return { schemaVersion: SHADOW_ANALYSIS_VERSION, status: "modeled", shadowLengthFt: round(length), shadowBearingDeg: round(bearing), vector: { eastFt: round(length * Math.sin(bearing * Math.PI / 180)), northFt: round(length * Math.cos(bearing * Math.PI / 180)) }, observedAt, warnings: [] };
}

export function analyzeLineOfSight({ observer = {}, target = {}, obstructions = [] } = {}) {
  const distance = numeric(target.distanceFt);
  const observerEye = numeric(observer.groundElevationFt) !== null && numeric(observer.eyeHeightFt) !== null ? numeric(observer.groundElevationFt) + numeric(observer.eyeHeightFt) : null;
  const targetPoint = numeric(target.groundElevationFt) !== null && numeric(target.heightFt) !== null ? numeric(target.groundElevationFt) + numeric(target.heightFt) : null;
  if (distance === null || distance <= 0 || observerEye === null || targetPoint === null) return { schemaVersion: LINE_OF_SIGHT_VERSION, status: "insufficient-evidence", visible: null, obstructionResults: [], minimumClearanceFt: null };
  const results = (obstructions || []).map((item, index) => {
    const obstructionDistance = numeric(item.distanceFt);
    const top = numeric(item.groundElevationFt) !== null && numeric(item.heightFt) !== null ? numeric(item.groundElevationFt) + numeric(item.heightFt) : null;
    if (obstructionDistance === null || top === null || obstructionDistance < 0 || obstructionDistance > distance) return { id: String(item.id || `obstruction-${index + 1}`), status: "unknown", clearanceFt: null };
    const sightline = observerEye + (targetPoint - observerEye) * (obstructionDistance / distance);
    const clearance = sightline - top;
    return { id: String(item.id || `obstruction-${index + 1}`), status: clearance >= 0 ? "clear" : "blocked", distanceFt: obstructionDistance, sightlineElevationFt: round(sightline), obstructionTopElevationFt: round(top), clearanceFt: round(clearance) };
  });
  const known = results.filter((item) => item.clearanceFt !== null);
  const visible = results.some((item) => item.status === "blocked") ? false : results.some((item) => item.status === "unknown") ? null : true;
  return { schemaVersion: LINE_OF_SIGHT_VERSION, status: visible === null ? "indeterminate" : "modeled", visible, obstructionResults: results, minimumClearanceFt: known.length ? round(Math.min(...known.map((item) => item.clearanceFt))) : null };
}

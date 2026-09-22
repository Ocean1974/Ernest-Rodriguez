const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const outputRoot = path.join(root, "public", "data", "savant-tools");
const marketsRoot = path.join(outputRoot, "markets");
const harrisParcelRoot = path.join(root, "public", "data", "counties", "harris-county-tx", "parcels");
const harrisDevelopmentFile = path.join(root, "public", "data", "counties", "harris-county-tx", "developments", "parcel-development-index.json");
const harrisZoningRoot = path.join(root, "public", "data", "counties", "harris-county-tx", "zoning");
const harrisFloodRoot = path.join(root, "public", "data", "counties", "harris-county-tx", "floodplain");
const travisParcelRoot = path.join(root, "public", "data", "counties", "travis-county-tx", "parcels");
const travisDevelopmentFile = path.join(root, "public", "data", "counties", "travis-county-tx", "developments", "parcel-development-index.json");
const travisZoningRoot = path.join(root, "public", "data", "counties", "travis-county-tx", "zoning");
const travisFloodRoot = path.join(root, "public", "data", "counties", "travis-county-tx", "floodplain");
const bexarParcelRoot = path.join(root, "public", "data", "counties", "bexar-county-tx", "parcels");
const bexarDevelopmentFile = path.join(root, "public", "data", "counties", "bexar-county-tx", "developments", "parcel-development-index.json");
const bexarZoningRoot = path.join(root, "public", "data", "counties", "bexar-county-tx", "zoning");
const bexarFloodRoot = path.join(root, "public", "data", "counties", "bexar-county-tx", "floodplain");
const collinParcelRoot = path.join(root, "public", "data", "counties", "collin-county-tx", "parcels");
const collinDevelopmentFile = path.join(root, "public", "data", "counties", "collin-county-tx", "developments", "parcel-development-index.json");
const collinZoningRoot = path.join(root, "public", "data", "counties", "collin-county-tx", "zoning");
const collinFloodRoot = path.join(root, "public", "data", "counties", "collin-county-tx", "floodplain");
const dallasParcelRoot = path.join(root, "public", "data", "parcels");
const dallasDevelopmentFile = path.join(root, "public", "data", "developments", "parcel-development-index.json");
const dallasZoningRoot = path.join(root, "public", "data", "zoning");
const dallasFloodRoot = path.join(root, "public", "data", "floodplain");
const nationalDemandRoot = path.join(root, "public", "data", "national", "migration-demand");
const TOP_LIMIT = 100;
const PRESELECT_LIMIT = 6000;
const PRE_GROWTH_LIMIT = 12000;
const GROWTH_RADIUS_MILES = 3;
const GROWTH_GRID_DEGREES = 0.04;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function clean(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return clean(value).replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function number(value) {
  const parsed = Number.parseFloat(clean(value).replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isEntityOwner(value) {
  return /\b(LLC|LP|LTD|INC|CORP|COMPANY|CO\b|HOLDINGS|PROPERTIES|PROPERTY|REALTY|LAND|CAPITAL|INVEST|VENTURES|PARTNERS|COMMUNITIES|BUILDERS|HOMES|DEVELOP|ACQUISITION|REIT|FUND|TRUST)\b/i.test(value);
}

const INELIGIBLE_OWNER_RULES = [
  ["government-owner", /\b(CITY OF|COUNTY OF|STATE OF|UNITED STATES|U\.?S\.? GOVERNMENT|FEDERAL|MUNICIPAL|HOUSING AUTHORITY|TRANSIT AUTHORITY|RAPID TRANSIT|COMMUNITY DEVELOPMENT CORP)\b/i],
  ["education-owner", /\b(ISD|INDEPENDENT SCHOOL DISTRICT|SCHOOL DISTRICT|PUBLIC SCHOOL|UNIVERSITY|COLLEGE)\b/i],
  ["religious-owner", /\b(CHURCH|MINISTR(?:Y|IES)|MOSQUE|SYNAGOGUE|DIOCESE|ARCHDIOCESE|BISHOP|BAPTIST|METHODIST|CATHOLIC|LUTHERAN|PRESBYTERIAN|FELLOWSHIP)\b/i],
  ["healthcare-institution-owner", /\b(HOSPITAL|MEDICAL CENTER|MEDICAL CTR|HEALTH\s*CARE|HEALTH SYSTEM|HEALTH RESOURCES|WELLTOWER)\b/i],
  ["association-common-area-owner", /(HOA\b|HOMEOWNERS?|\bASSOC(?:IATION)?\b|\bASSN\b)/i],
  ["public-utility-owner", /\b(UTILITY DISTRICT|MUD\b|WATER DISTRICT|ELECTRIC COOPERATIVE|ONCOR|ELECTRIC DELIVERY COMPANY|TELECOMMUNICATIONS|TELECOM|CABLE|PIPELINE)\b/i],
  ["industrial-operator-owner", /\b(LANDFILL|WASTE MANAGEMENT|WASTE OF|DISPOSAL|MATERIALS)\b/i],
];

const NATIONAL_OWNER_OPERATOR_PATTERN = /\b(WAL\s*-?\s*MART|HEB GROCERY|LOWES HOME|LOWE'S HOME|HOME DEPOT|TARGET CORP|COSTCO|KROGER)\b/i;
const ACTIVE_DEVELOPER_OWNER_PATTERN = /\b(DEVELOPMENT COMPANY|DEVELOPMENT PARTNERS|DEVELOPERS?|COMMUNITIES|HOMES|BUILDERS)\b/i;

function ownerEligibility(ownerName) {
  const owner = clean(ownerName);
  if (!owner) return { eligible: false, exclusionReason: "missing-owner" };
  const matched = INELIGIBLE_OWNER_RULES.find(([, pattern]) => pattern.test(owner));
  return matched ? { eligible: false, exclusionReason: matched[0] } : { eligible: true, exclusionReason: "" };
}

function ownerKey(parcel) {
  return normalize(parcel.ownerName || parcel.propertyName);
}

function parcelBlockKey(parcel) {
  const block = normalize(parcel.blockId || parcel.block || parcel.blockNumber);
  if (!block) return "";
  const legal = clean(parcel.legalDescription);
  const subdivision = legal ? normalize(legal.split(/\bBLK\b/i)[0]) : "";
  return subdivision ? `${subdivision}:${block}` : block;
}

function account(parcel) {
  return clean(parcel.accountNum || parcel.accountNumber || parcel.sourceParcelId);
}

function parcelLngLat(parcel) {
  const center = parcel.liveGeometry?.center || parcel.geometryCenter || [parcel.longitude, parcel.latitude];
  const lng = Number(center?.[0]);
  const lat = Number(center?.[1]);
  return Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90 ? [lng, lat] : null;
}

function haversineMiles(a, b) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(b[1] - a[1]);
  const dLng = radians(b[0] - a[0]);
  const lat1 = radians(a[1]);
  const lat2 = radians(b[1]);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function activityRecencyWeight(value, referenceDate = new Date()) {
  const activity = new Date(value);
  if (!value || Number.isNaN(activity.getTime())) return 0.15;
  const years = Math.max(0, (referenceDate.getTime() - activity.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  if (years <= 1) return 1;
  if (years <= 3) return 0.7;
  if (years <= 5) return 0.4;
  return 0;
}

function growthGridKey(lng, lat) {
  return `${Math.floor(lng / GROWTH_GRID_DEGREES)}:${Math.floor(lat / GROWTH_GRID_DEGREES)}`;
}

function addGrowthPoint(grid, parcel, development, referenceDate) {
  const center = parcelLngLat(parcel);
  if (!center) return;
  const point = {
    accountNum: account(parcel),
    center,
    recencyWeight: activityRecencyWeight(development.latestActivityDate, referenceDate),
    signalCount: Math.max(1, number(development.signalCount)),
    latestActivityDate: clean(development.latestActivityDate),
  };
  const key = growthGridKey(center[0], center[1]);
  const records = grid.get(key) || [];
  records.push(point);
  grid.set(key, records);
}

function compassDirection(dx, dy) {
  if (Math.abs(dx) + Math.abs(dy) < 1e-9) return "distributed";
  const degrees = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
  return ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"][Math.round(degrees / 45) % 8];
}

function surroundingGrowthSignal(parcel, parcelAccount, grid) {
  const center = parcelLngLat(parcel);
  if (!center) return { score: 0, ratingPoints: 0, activityIndex: 0, nearbyActivityCount: 0, recentActivityCount: 0, nearestMiles: null, direction: "unknown" };
  const cellX = Math.floor(center[0] / GROWTH_GRID_DEGREES);
  const cellY = Math.floor(center[1] / GROWTH_GRID_DEGREES);
  const cellRadius = Math.ceil(GROWTH_RADIUS_MILES / 69 / GROWTH_GRID_DEGREES) + 1;
  let weightedActivity = 0;
  let nearbyActivityCount = 0;
  let recentActivityCount = 0;
  let nearestMiles = Infinity;
  let directionX = 0;
  let directionY = 0;
  for (let x = cellX - cellRadius; x <= cellX + cellRadius; x += 1) {
    for (let y = cellY - cellRadius; y <= cellY + cellRadius; y += 1) {
      for (const point of grid.get(`${x}:${y}`) || []) {
        if (point.accountNum === parcelAccount) continue;
        const miles = haversineMiles(center, point.center);
        if (miles > GROWTH_RADIUS_MILES) continue;
        const distanceWeight = miles <= 0.5 ? 1 : miles <= 1.5 ? 0.6 : 0.25;
        const intensityWeight = 1 + Math.min(1.5, Math.log2(point.signalCount + 1) / 4);
        const weight = distanceWeight * point.recencyWeight * intensityWeight;
        if (weight <= 0) continue;
        weightedActivity += weight;
        nearbyActivityCount += 1;
        if (point.recencyWeight >= 0.7) recentActivityCount += 1;
        nearestMiles = Math.min(nearestMiles, miles);
        directionX += (point.center[0] - center[0]) * weight;
        directionY += (point.center[1] - center[1]) * weight;
      }
    }
  }
  return {
    score: 0,
    ratingPoints: 0,
    activityIndex: Number(weightedActivity.toFixed(3)),
    nearbyActivityCount,
    recentActivityCount,
    nearestMiles: Number.isFinite(nearestMiles) ? Number(nearestMiles.toFixed(2)) : null,
    direction: nearbyActivityCount ? compassDirection(directionX, directionY) : "none detected",
  };
}

function calibrateGrowthScores(candidates) {
  const positive = candidates.filter((candidate) => candidate.pathOfGrowth.activityIndex > 0).sort((a, b) => a.pathOfGrowth.activityIndex - b.pathOfGrowth.activityIndex);
  for (const candidate of candidates) {
    candidate.pathOfGrowth.score = 0;
    candidate.pathOfGrowth.ratingPoints = 0;
  }
  positive.forEach((candidate, index) => {
    const score = positive.length === 1 ? 100 : Math.round(1 + (index * 99) / (positive.length - 1));
    candidate.pathOfGrowth.score = score;
    candidate.pathOfGrowth.ratingPoints = Math.min(20, Math.round(score / 5));
  });
  return candidates;
}

function baseScore(parcel, ownerPortfolioCount, hasDevelopmentSignal, developmentFactorId = "current-plat-activity") {
  const landValue = number(parcel.landValue);
  const improvementValue = number(parcel.improvementValue);
  const totalValue = number(parcel.totalValue) || landValue + improvementValue;
  const acres = number(parcel.landAreaSize) || number(parcel.landAreaSqFt) / 43560;
  const ratio = landValue > 0 ? improvementValue / landValue : null;
  const yearBuilt = Math.trunc(number(parcel.yearBuilt));
  const eligibility = ownerEligibility(parcel.ownerName || parcel.propertyName);
  const factors = [];
  let score = 10;

  if (!eligibility.eligible) return { score: 0, factors, landValue, improvementValue, totalValue, acres, ratio, yearBuilt, ...eligibility };

  if (landValue > 0 && improvementValue === 0) {
    score += 38;
    factors.push({ id: "vacant-or-no-improvement-value", points: 38 });
  } else if (ratio !== null && ratio <= 0.25) {
    score += 28;
    factors.push({ id: "low-improvement-to-land", points: 28 });
  } else if (ratio !== null && ratio <= 0.6) {
    score += 16;
    factors.push({ id: "moderate-improvement-to-land", points: 16 });
  }

  if (acres >= 5 && acres <= 20) {
    score += 15;
    factors.push({ id: "marketable-site-scale", points: 15 });
  } else if (acres >= 2 && acres < 5) {
    score += 12;
    factors.push({ id: "marketable-site-scale", points: 12 });
  } else if (acres >= 1) {
    score += 9;
    factors.push({ id: "marketable-site-scale", points: 9 });
  } else if (acres >= 0.5) {
    score += 5;
    factors.push({ id: "marketable-site-scale", points: 5 });
  } else if (acres > 50) {
    score -= 8;
    factors.push({ id: "oversized-site-penalty", points: -8 });
  }

  if (yearBuilt > 0 && yearBuilt <= 1985 && improvementValue > 0) {
    score += 12;
    factors.push({ id: "legacy-improvements", points: 12 });
  } else if (yearBuilt > 0 && yearBuilt <= 2000 && improvementValue > 0) {
    score += 7;
    factors.push({ id: "legacy-improvements", points: 7 });
  }

  const propertyCity = normalize(parcel.city);
  const ownerCity = normalize(parcel.ownerCity);
  if (propertyCity && ownerCity && propertyCity !== ownerCity) {
    score += 8;
    factors.push({ id: "absentee-owner", points: 8 });
  }
  if (clean(parcel.ownerState) && !["TX", "TEXAS"].includes(normalize(parcel.ownerState))) {
    score += 7;
    factors.push({ id: "out-of-state-owner", points: 7 });
  }

  if (ownerPortfolioCount >= 2 && ownerPortfolioCount <= 10) {
    score += 4;
    factors.push({ id: "small-owner-portfolio", points: 4 });
  } else if (ownerPortfolioCount > 25) {
    score -= 10;
    factors.push({ id: "institutional-scale-portfolio-penalty", points: -10 });
  } else if (ownerPortfolioCount > 10) {
    score -= 5;
    factors.push({ id: "large-portfolio-penalty", points: -5 });
  }
  if (NATIONAL_OWNER_OPERATOR_PATTERN.test(clean(parcel.ownerName || parcel.propertyName))) {
    score -= 20;
    factors.push({ id: "national-owner-operator-penalty", points: -20 });
  }
  if (ACTIVE_DEVELOPER_OWNER_PATTERN.test(clean(parcel.ownerName || parcel.propertyName))) {
    score -= 12;
    factors.push({ id: "active-developer-owner-penalty", points: -12 });
  }
  if (hasDevelopmentSignal) {
    score -= 18;
    factors.push({ id: `${developmentFactorId}-on-target-penalty`, points: -18 });
  }

  const hasOpportunityBasis = factors.some((factor) => ["vacant-or-no-improvement-value", "low-improvement-to-land", "moderate-improvement-to-land", "legacy-improvements"].includes(factor.id));
  const eligible = !hasDevelopmentSignal && hasOpportunityBasis && score >= 25;
  const exclusionReason = hasDevelopmentSignal ? "active-development-on-target" : hasOpportunityBasis ? "below-score-floor" : "no-off-market-opportunity-basis";
  return { score: Math.max(0, Math.min(100, Math.round(score))), factors, landValue, improvementValue, totalValue, acres, ratio, yearBuilt, eligible, exclusionReason };
}

function hasDevelopmentFactor(candidate) {
  return candidate.base.factors.some((factor) => factor.id.endsWith("-on-target-penalty"));
}

function boundedPush(records, candidate) {
  records.push(candidate);
  if (records.length < PRE_GROWTH_LIMIT * 2) return;
  records.sort((a, b) => b.selectionScore - a.selectionScore || b.base.factors.length - a.base.factors.length || a.accountNum.localeCompare(b.accountNum));
  records.length = PRE_GROWTH_LIMIT;
}

function applyMarketScore(candidates) {
  const ranked = candidates.slice(0, TOP_LIMIT);
  return ranked.map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
    evidenceScore: Number(candidate.score || 0),
    score: ranked.length <= 1 ? 100 : Math.round(100 - (index * 99) / (ranked.length - 1)),
  }));
}

function loadIndexRecords(indexRoot, selectedAccounts, manifestName, fieldName) {
  const manifest = readJson(path.join(indexRoot, "manifest.json"));
  const index = readJson(path.join(indexRoot, manifestName));
  const files = index.files || manifest.parcelIndexShards?.files || {};
  const fields = index.fields || manifest.parcelIndexShards?.fields || [];
  const records = new Map();
  const keyLength = index.shardKeyLength || manifest.parcelIndexShards?.keyLength || 4;
  const keys = new Set([...selectedAccounts].map((value) => normalize(value).slice(0, keyLength)));
  for (const key of keys) {
    const relative = files[key];
    if (!relative) continue;
    const payload = readJson(path.join(indexRoot, relative));
    const payloadFields = payload.fields || fields;
    for (const packed of payload.records || []) {
      const record = Object.fromEntries(payloadFields.map((field, index) => [field, packed[index]]));
      if (selectedAccounts.has(clean(record.accountNum))) records.set(clean(record.accountNum), record);
    }
  }
  return { records, fieldName };
}

function buildTexasMarketRadar(config) {
  const generatedAt = new Date().toISOString();
  const manifest = readJson(path.join(config.parcelRoot, "manifest.json"));
  const demandState = readJson(path.join(nationalDemandRoot, "places", `${config.placeFips.slice(0, 2)}.json`));
  const demandContext = (demandState.records || []).find((record) => record.geographyId === config.placeFips);
  if (!demandContext) throw new Error(`Missing national demand context for ${config.marketName} place ${config.placeFips}`);
  const developmentIndex = readJson(config.developmentFile);
  const developmentByAccount = new Map((developmentIndex.records || []).map((record) => [clean(record.parcelId), record]));
  const ownerCounts = new Map();
  const growthGrid = new Map();
  const referenceDate = new Date(generatedAt);
  const parcelMatchesMarket = (parcel) => !config.cityNames?.length || config.cityNames.map(normalize).includes(normalize(parcel.city));
  let marketParcelCount = 0;

  for (const chunk of manifest.chunks || []) {
    const payload = readJson(path.join(config.parcelRoot, chunk.file));
    for (const parcel of payload.parcels || []) {
      if (!parcelMatchesMarket(parcel)) continue;
      marketParcelCount += 1;
      const key = ownerKey(parcel);
      if (key) ownerCounts.set(key, (ownerCounts.get(key) || 0) + 1);
      const development = developmentByAccount.get(account(parcel));
      if (development) addGrowthPoint(growthGrid, parcel, development, referenceDate);
    }
  }

  const preselected = [];
  const candidateBlockCounts = new Map();
  const ownerBlockCounts = new Map();
  const exclusionCounts = new Map();
  let scoredUniqueAccountCount = 0;
  for (const chunk of manifest.chunks || []) {
    const payload = readJson(path.join(config.parcelRoot, chunk.file));
    const chunkId = clean(chunk.id || payload.chunkId);
    for (const parcel of payload.parcels || []) {
      if (!parcelMatchesMarket(parcel)) continue;
      const accountNum = account(parcel);
      if (!accountNum) continue;
      scoredUniqueAccountCount += 1;
      const owner = ownerKey(parcel);
      const base = baseScore(parcel, ownerCounts.get(owner) || 0, developmentByAccount.has(accountNum), config.developmentFactorId);
      if (!base.eligible) {
        exclusionCounts.set(base.exclusionReason, (exclusionCounts.get(base.exclusionReason) || 0) + 1);
        continue;
      }
      const blockKey = parcelBlockKey(parcel);
      if (blockKey) {
        candidateBlockCounts.set(blockKey, (candidateBlockCounts.get(blockKey) || 0) + 1);
        if (owner) ownerBlockCounts.set(`${owner}::${blockKey}`, (ownerBlockCounts.get(`${owner}::${blockKey}`) || 0) + 1);
      }
      boundedPush(preselected, { parcel, accountNum, owner, blockKey, chunkId, base, pathOfGrowth: null, selectionScore: base.score });
    }
  }
  preselected.sort((a, b) => b.selectionScore - a.selectionScore || b.base.factors.length - a.base.factors.length || a.accountNum.localeCompare(b.accountNum));
  preselected.length = Math.min(PRE_GROWTH_LIMIT, preselected.length);
  for (const candidate of preselected) {
    candidate.pathOfGrowth = surroundingGrowthSignal(candidate.parcel, candidate.accountNum, growthGrid);
  }
  calibrateGrowthScores(preselected);
  for (const candidate of preselected) {
    candidate.selectionScore = Math.min(100, candidate.base.score + candidate.pathOfGrowth.ratingPoints);
  }
  preselected.sort((a, b) => b.selectionScore - a.selectionScore || b.base.factors.length - a.base.factors.length || a.accountNum.localeCompare(b.accountNum));
  preselected.length = Math.min(PRESELECT_LIMIT, preselected.length);

  const selectedAccounts = new Set(preselected.map((candidate) => candidate.accountNum));
  const zoning = loadIndexRecords(config.zoningRoot, selectedAccounts, "parcel-zoning-index.json", "zoning").records;
  const flood = loadIndexRecords(config.floodRoot, selectedAccounts, "parcel-floodplain-index.json", "floodplain").records;

  const candidates = applyMarketScore(preselected.map((candidate) => {
    const parcel = candidate.parcel;
    const development = developmentByAccount.get(candidate.accountNum);
    const sameBlockCandidateCount = candidate.blockKey ? candidateBlockCounts.get(candidate.blockKey) || 0 : 0;
    const ownerBlockControlCount = candidate.blockKey ? ownerBlockCounts.get(`${candidate.owner}::${candidate.blockKey}`) || 0 : 0;
    const factorIds = candidate.base.factors.map((factor) => factor.id);
    const reasonCodes = ["private-owner-prospect"];
    if (factorIds.some((factor) => ["vacant-or-no-improvement-value", "low-improvement-to-land", "moderate-improvement-to-land"].includes(factor))) reasonCodes.push("underimproved-land");
    if (factorIds.includes("absentee-owner") || factorIds.includes("out-of-state-owner")) reasonCodes.push("absentee-owner");
    if (factorIds.includes("legacy-improvements")) reasonCodes.push("legacy-improvements");
    if (candidate.pathOfGrowth.score >= 65) reasonCodes.push("path-of-growth");
    if (sameBlockCandidateCount >= 3 || ownerBlockControlCount >= 2) reasonCodes.push("assemblage-potential");
    if (development) reasonCodes.push("active-development-on-target");
    if (isEntityOwner(parcel.ownerName || parcel.propertyName) && ownerBlockControlCount >= 2 && (ownerCounts.get(candidate.owner) || 0) <= 10) reasonCodes.push("small-owner-block-control");
    const densityPoints = Math.min(6, Math.floor(sameBlockCandidateCount / 3));
    const controlPoints = Math.min(6, ownerBlockControlCount * 2);
    const score = Math.min(100, candidate.selectionScore + densityPoints + controlPoints);
    const category = reasonCodes.includes("assemblage-potential") ? "Assemblage Potential" : candidate.pathOfGrowth.score >= 65 ? "Path of Growth" : reasonCodes.includes("underimproved-land") ? "Vacant / Underimproved" : reasonCodes.includes("absentee-owner") ? "Absentee Owner" : "Legacy Improvement";
    return {
      accountNum: candidate.accountNum,
      gisParcelId: clean(parcel.gisParcelId),
      whiteRabbitPropertyId: `wrp:v1:${config.sourceCountyId}:${candidate.accountNum}`,
      address: clean(parcel.address || parcel.propertyAddress),
      ownerName: clean(parcel.ownerName || parcel.propertyName),
      parcelChunkIds: [candidate.chunkId],
      category,
      score,
      reasonCodes,
      ownerPortfolioCount: ownerCounts.get(candidate.owner) || 0,
      sameBlockCandidateCount,
      ownerBlockControlCount,
      metrics: { landAreaAcres: candidate.base.acres, landValue: candidate.base.landValue, improvementValue: candidate.base.improvementValue, totalValue: candidate.base.totalValue, yearBuilt: candidate.base.yearBuilt || "" },
      pathOfGrowth: {
        ...candidate.pathOfGrowth,
        methodology: "City-local percentile of source-backed development activity from the prior five years within three miles; distance, recency, and evidence intensity determine the underlying activity index.",
      },
      zoningLabel: zoning.get(candidate.accountNum)?.label || "Development-control coverage unknown",
      floodplainLabel: flood.get(candidate.accountNum)?.label || "Flood classification not found",
      developmentStatus: development ? config.matchedDevelopmentStatus : config.unmatchedDevelopmentStatus,
      listingStatus: "not-verified-against-complete-listing-feed",
      factorIds,
      explanation: candidate.base.factors.map((factor) => `${factor.id}: ${factor.points >= 0 ? "+" : ""}${factor.points}`).slice(0, 6),
      nextAction: development
        ? `${config.developmentNextAction(development)} Active work reduced this parcel's prospect score; verify whether the project is complete before outreach.`
        : reasonCodes.includes("path-of-growth")
          ? `Verify the ${candidate.pathOfGrowth.direction} growth corridor: ${candidate.pathOfGrowth.nearbyActivityCount} nearby development signals within three miles, nearest ${candidate.pathOfGrowth.nearestMiles ?? "unknown"} miles. Confirm access, utilities, zoning, flood classification, and listing status.`
          : reasonCodes.includes("assemblage-potential")
            ? `Open the ${config.marketName} map and verify actual block adjacency, ownership, development controls, flood classification, and listing status.`
            : `Open the ${config.marketName} map and verify ownership, vacancy or under-improvement, development controls, flood classification, and listing status before outreach.`,
      sourceTrail: config.sourceTrail,
    };
  }).sort((a, b) => b.score - a.score || Number(a.reasonCodes.includes("active-development-on-target")) - Number(b.reasonCodes.includes("active-development-on-target")) || b.reasonCodes.length - a.reasonCodes.length || a.accountNum.localeCompare(b.accountNum)));
  const reasonCounts = {
    offMarketDevelopmentPath: candidates.filter((candidate) => candidate.reasonCodes.includes("private-owner-prospect")).length,
    sameBlockAssemblage: candidates.filter((candidate) => candidate.reasonCodes.includes("assemblage-potential")).length,
    growthPattern: candidates.filter((candidate) => candidate.reasonCodes.includes("path-of-growth")).length,
    developerSurroundingControl: candidates.filter((candidate) => candidate.reasonCodes.includes("small-owner-block-control")).length,
  };
  return {
    schemaVersion: "wr-savant-development-path-radar-v4",
    generatedAt,
    marketId: config.marketId,
    marketName: config.marketName,
    coverageLabel: config.coverageLabel,
    sourceCountyId: config.sourceCountyId,
    featureGate: "opportunitySignals",
    advisoryOnly: true,
    sourceParcelFeatureCount: marketParcelCount,
    scoredUniqueAccountCount,
    opportunityCandidateCount: candidates.length,
    analyzedCandidateCount: scoredUniqueAccountCount,
    eligibilityPolicy: {
      version: "private-prospect-v1",
      eligibleCandidateCount: preselected.length,
      exclusionCounts: Object.fromEntries([...exclusionCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
      rules: ["exclude-government-education-religious-healthcare-association-and-public-utility-owners", "require-vacancy-under-improvement-or-legacy-improvement-evidence", "exclude-active-development-on-target", "penalize-national-owner-operators-and-large-portfolios", "use-real-block-identifiers-for-assemblage"],
    },
    pathOfGrowthPolicy: {
      version: "surrounding-development-v1",
      radiusMiles: GROWTH_RADIUS_MILES,
      targetParcelRule: "Known development on the target parcel is excluded; only surrounding parcel activity can add Path of Growth points.",
      maximumRatingPoints: 20,
      factors: ["distance-to-surrounding-development", "activity-within-prior-five-years", "development-evidence-intensity", "growth-corridor-direction", "city-local-growth-percentile"],
    },
    scoreOrder: "strictly-descending-100-to-1-within-market",
    reasonCounts,
    coverageDisclosure: config.coverageDisclosure,
    listingCoverage: `Known active listings should be excluded when a certified complete listing feed exists. ${config.marketName} listing exclusion is not yet complete, so every candidate remains listing-status unverified.`,
    scoringPolicy: "Market Score is the city-local rank percentile from 100 to 1 after private-owner eligibility screening. evidenceScore preserves the source-factor model used to order candidates, including up to 20 Path of Growth points for recent source-backed development on surrounding parcels within three miles. Known development on the target is excluded. National owner-operators and institutional-scale portfolios reduce rank; flood and development-control records are constraints/context and add no favorable points.",
    runtimePolicy: "Fetch only the selected city radar. Never combine candidates from different markets into one ranking.",
    marketDemandContext: { ...demandContext, parcelAttribution: false, scoringImpact: "context-only-no-parcel-points" },
    topCandidates: candidates,
  };
}

function buildCollinRadar({ marketId, marketName, placeFips, cityNames = [marketName] }) {
  return buildTexasMarketRadar({
    marketId, marketName, placeFips, cityNames,
    coverageLabel: `${marketName} / Collin County`, sourceCountyId: "collin-county-tx",
    parcelRoot: collinParcelRoot, developmentFile: collinDevelopmentFile, zoningRoot: collinZoningRoot, floodRoot: collinFloodRoot,
    developmentFactorId: "current-permit-activity", matchedDevelopmentStatus: "matched-official-ccad-permit-signal",
    unmatchedDevelopmentStatus: "not-found-in-official-three-year-ccad-permit-index",
    developmentNextAction: (development) => `Review official permit evidence ${development.evidenceRecordIds?.[0] || development.parcelId || "record"}.`,
    coverageDisclosure: `Parcel and FEMA planning coverage is Collin County. Zoning coverage is the verified municipal source footprint for ${marketName}; permit evidence is the official CCAD three-year permit dataset.`,
    sourceTrail: ["public/data/counties/collin-county-tx/parcels/manifest.json", "public/data/counties/collin-county-tx/developments/parcel-development-index.json", "public/data/counties/collin-county-tx/zoning/manifest.json", "public/data/counties/collin-county-tx/floodplain/manifest.json", "public/data/counties/collin-county-tx/permits/manifest.json"],
  });
}

function buildDallasRadar() {
  return buildTexasMarketRadar({
    marketId: "dallas-tx",
    marketName: "Dallas",
    placeFips: "4819000",
    coverageLabel: "Dallas / Dallas County",
    sourceCountyId: "dallas-county-dcad",
    parcelRoot: dallasParcelRoot,
    developmentFile: dallasDevelopmentFile,
    zoningRoot: dallasZoningRoot,
    floodRoot: dallasFloodRoot,
    developmentFactorId: "current-development-activity",
    matchedDevelopmentStatus: "matched-permit-or-development-signal",
    unmatchedDevelopmentStatus: "not-found-in-permit-or-development-index",
    developmentNextAction: (development) => `Review development evidence for parcel ${development.parcelId || "record"}.`,
    coverageDisclosure: "Parcel coverage is the full Dallas County DCAD service. Dallas parcel records do not carry a reliable normalized city field, so this market intentionally ranks the county-wide pool; zoning, floodplain, and development evidence retain their source-specific footprints.",
    sourceTrail: ["public/data/parcels/manifest.json", "public/data/developments/parcel-development-index.json", "public/data/zoning/manifest.json", "public/data/floodplain/manifest.json"],
  });
}

function buildHoustonRadar() {
  return buildTexasMarketRadar({
    marketId: "houston-tx",
    marketName: "Houston",
    placeFips: "4835000",
    coverageLabel: "Houston / Harris County",
    sourceCountyId: "harris-county-tx",
    parcelRoot: harrisParcelRoot,
    developmentFile: harrisDevelopmentFile,
    zoningRoot: harrisZoningRoot,
    floodRoot: harrisFloodRoot,
    developmentFactorId: "current-plat-activity",
    matchedDevelopmentStatus: "matched-current-plat-agenda",
    unmatchedDevelopmentStatus: "not-found-in-current-plat-agenda",
    developmentNextAction: (development) => `Review current plat application ${development.applicationNumber || "evidence"}.`,
    coverageDisclosure: "Parcel coverage is Harris County; development-control coverage is source-specific and may not cover every municipality.",
    sourceTrail: ["public/data/counties/harris-county-tx/parcels/manifest.json", "public/data/counties/harris-county-tx/developments/parcel-development-index.json", "public/data/counties/harris-county-tx/zoning/manifest.json", "public/data/counties/harris-county-tx/floodplain/manifest.json"],
  });
}

function buildAustinRadar() {
  return buildTexasMarketRadar({
    marketId: "austin-tx",
    marketName: "Austin",
    placeFips: "4805000",
    coverageLabel: "Austin / Travis County",
    sourceCountyId: "travis-county-tx",
    parcelRoot: travisParcelRoot,
    developmentFile: travisDevelopmentFile,
    zoningRoot: travisZoningRoot,
    floodRoot: travisFloodRoot,
    developmentFactorId: "current-permit-activity",
    matchedDevelopmentStatus: "matched-permit-development-signal",
    unmatchedDevelopmentStatus: "not-found-in-permit-development-index",
    developmentNextAction: (development) => `Review permit/development evidence ${development.evidenceRecordIds?.[0] || development.parcelId || "record"}.`,
    coverageDisclosure: "Parcel coverage is Travis County. Zoning, floodplain, and permit evidence reflects the available City of Austin source footprints and must not be interpreted as complete coverage for every Travis County municipality.",
    sourceTrail: ["public/data/counties/travis-county-tx/parcels/manifest.json", "public/data/counties/travis-county-tx/developments/parcel-development-index.json", "public/data/counties/travis-county-tx/zoning/manifest.json", "public/data/counties/travis-county-tx/floodplain/manifest.json", "public/data/counties/travis-county-tx/permits/manifest.json"],
  });
}

function buildSanAntonioRadar() {
  return buildTexasMarketRadar({
    marketId: "san-antonio-tx",
    marketName: "San Antonio",
    placeFips: "4865000",
    coverageLabel: "San Antonio / Bexar County",
    sourceCountyId: "bexar-county-tx",
    parcelRoot: bexarParcelRoot,
    developmentFile: bexarDevelopmentFile,
    zoningRoot: bexarZoningRoot,
    floodRoot: bexarFloodRoot,
    developmentFactorId: "current-permit-activity",
    matchedDevelopmentStatus: "matched-permit-or-plat-development-signal",
    unmatchedDevelopmentStatus: "not-found-in-permit-or-plat-development-index",
    developmentNextAction: (development) => `Review permit/plat evidence ${development.evidenceRecordIds?.[0] || development.parcelId || "record"}.`,
    coverageDisclosure: "Parcel and FEMA planning coverage is Bexar County. Zoning, issued-permit, and plat evidence reflects City of San Antonio source footprints and must not be interpreted as complete coverage for every Bexar County municipality.",
    sourceTrail: ["public/data/counties/bexar-county-tx/parcels/manifest.json", "public/data/counties/bexar-county-tx/developments/parcel-development-index.json", "public/data/counties/bexar-county-tx/zoning/manifest.json", "public/data/counties/bexar-county-tx/floodplain/manifest.json", "public/data/counties/bexar-county-tx/permits/manifest.json"],
  });
}

function rerankLegacyMarket(payload, marketName) {
  const exclusionCounts = new Map();
  const rescored = [];
  for (const candidate of payload.topCandidates || []) {
    const parcel = {
      ownerName: candidate.ownerName,
      landValue: candidate.metrics?.landValue,
      improvementValue: candidate.metrics?.improvementValue,
      totalValue: candidate.metrics?.totalValue,
      landAreaSize: candidate.metrics?.landAreaAcres,
      yearBuilt: candidate.metrics?.yearBuilt,
    };
    const base = baseScore(parcel, Number(candidate.ownerPortfolioCount || 0), false, "current-development-activity");
    if (!base.eligible) {
      exclusionCounts.set(base.exclusionReason, (exclusionCounts.get(base.exclusionReason) || 0) + 1);
      continue;
    }
    const factorIds = base.factors.map((factor) => factor.id);
    const reasonCodes = ["private-owner-prospect"];
    if (factorIds.some((factor) => ["vacant-or-no-improvement-value", "low-improvement-to-land", "moderate-improvement-to-land"].includes(factor))) reasonCodes.push("underimproved-land");
    if (factorIds.includes("legacy-improvements")) reasonCodes.push("legacy-improvements");
    rescored.push({
      ...candidate,
      category: factorIds.includes("vacant-or-no-improvement-value") ? "Vacant / Underimproved" : factorIds.includes("legacy-improvements") ? "Legacy Improvement" : "Underimproved Land",
      score: base.score,
      evidenceScore: base.score,
      reasonCodes,
      factorIds,
      explanation: base.factors.map((factor) => `${factor.id}: ${factor.points >= 0 ? "+" : ""}${factor.points}`).slice(0, 6),
      nextAction: `Open the ${marketName} map and verify private ownership, vacancy or under-improvement, development controls, flood classification, and listing status before outreach.`,
    });
  }
  rescored.sort((a, b) => b.evidenceScore - a.evidenceScore || a.accountNum.localeCompare(b.accountNum));
  const topCandidates = applyMarketScore(rescored);
  return {
    ...payload,
    schemaVersion: "wr-savant-development-path-radar-v3",
    opportunityCandidateCount: topCandidates.length,
    reasonCounts: {
      offMarketDevelopmentPath: topCandidates.length,
      sameBlockAssemblage: 0,
      growthPattern: 0,
      developerSurroundingControl: 0,
    },
    eligibilityPolicy: {
      version: "private-prospect-v1",
      eligibleCandidateCount: topCandidates.length,
      exclusionCounts: Object.fromEntries([...exclusionCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
      rules: ["exclude-government-education-religious-healthcare-and-public-utility-owners", "require-vacancy-under-improvement-or-legacy-improvement-evidence", "do-not-infer-assemblage-from-storage-chunks"],
    },
    scoringPolicy: "Market Score is the city-local rank percentile after private-owner eligibility screening. Active listing status remains unverified and must be checked before outreach.",
    topCandidates,
  };
}

function main() {
  const generatedAt = new Date().toISOString();
  const dallasPayload = buildDallasRadar();
  const houstonPayload = buildHoustonRadar();
  const austinPayload = buildAustinRadar();
  const sanAntonioPayload = buildSanAntonioRadar();
  const collinConfigs = [
    ["plano-tx", "Plano", "4858016"], ["mckinney-tx", "McKinney", "4845744"], ["frisco-tx", "Frisco", "4827684"],
    ["allen-tx", "Allen", "4801924"], ["wylie-tx", "Wylie", "4880356"], ["princeton-tx", "Princeton", "4859576"],
    ["anna-tx", "Anna", "4803300"], ["prosper-tx", "Prosper", "4859696"], ["murphy-tx", "Murphy", "4850100"],
    ["richardson-collin-tx", "Richardson", "4861796"], ["dallas-collin-tx", "Dallas (Collin County)", "4819000", ["Dallas"]],
  ];
  const collinPayloads = collinConfigs.map(([marketId, marketName, placeFips, cityNames]) => buildCollinRadar({ marketId, marketName, placeFips, cityNames }));
  const markets = [
    { id: "dallas-tx", name: "Dallas", stateCode: "TX", stateName: "Texas", coverageLabel: dallasPayload.coverageLabel, sourceCountyId: dallasPayload.sourceCountyId, status: "ready", radar: "markets/dallas-tx/development-path-radar.json", sourceParcelFeatureCount: dallasPayload.sourceParcelFeatureCount, candidateCount: dallasPayload.topCandidates.length, highestScore: dallasPayload.topCandidates[0]?.score || 0 },
    { id: "houston-tx", name: "Houston", stateCode: "TX", stateName: "Texas", coverageLabel: houstonPayload.coverageLabel, sourceCountyId: houstonPayload.sourceCountyId, status: "ready", radar: "markets/houston-tx/development-path-radar.json", sourceParcelFeatureCount: houstonPayload.sourceParcelFeatureCount, candidateCount: houstonPayload.topCandidates.length, highestScore: houstonPayload.topCandidates[0]?.score || 0 },
    { id: "austin-tx", name: "Austin", stateCode: "TX", stateName: "Texas", coverageLabel: austinPayload.coverageLabel, sourceCountyId: austinPayload.sourceCountyId, status: "ready", radar: "markets/austin-tx/development-path-radar.json", sourceParcelFeatureCount: austinPayload.sourceParcelFeatureCount, candidateCount: austinPayload.topCandidates.length, highestScore: austinPayload.topCandidates[0]?.score || 0 },
    { id: "san-antonio-tx", name: "San Antonio", stateCode: "TX", stateName: "Texas", coverageLabel: sanAntonioPayload.coverageLabel, sourceCountyId: sanAntonioPayload.sourceCountyId, status: "ready", radar: "markets/san-antonio-tx/development-path-radar.json", sourceParcelFeatureCount: sanAntonioPayload.sourceParcelFeatureCount, candidateCount: sanAntonioPayload.topCandidates.length, highestScore: sanAntonioPayload.topCandidates[0]?.score || 0 },
    ...collinPayloads.map((payload) => ({ id: payload.marketId, name: payload.marketName, stateCode: "TX", stateName: "Texas", coverageLabel: payload.coverageLabel, sourceCountyId: payload.sourceCountyId, status: "ready", radar: `markets/${payload.marketId}/development-path-radar.json`, sourceParcelFeatureCount: payload.sourceParcelFeatureCount, candidateCount: payload.topCandidates.length, highestScore: payload.topCandidates[0]?.score || 0 })),
  ];
  const payloadByMarketId = { "dallas-tx": dallasPayload, "houston-tx": houstonPayload, "austin-tx": austinPayload, "san-antonio-tx": sanAntonioPayload, ...Object.fromEntries(collinPayloads.map((payload) => [payload.marketId, payload])) };
  writeJson(path.join(marketsRoot, "dallas-tx", "development-path-radar.json"), dallasPayload);
  writeJson(path.join(marketsRoot, "houston-tx", "development-path-radar.json"), houstonPayload);
  writeJson(path.join(marketsRoot, "austin-tx", "development-path-radar.json"), austinPayload);
  writeJson(path.join(marketsRoot, "san-antonio-tx", "development-path-radar.json"), sanAntonioPayload);
  for (const payload of collinPayloads) writeJson(path.join(marketsRoot, payload.marketId, "development-path-radar.json"), payload);
  writeJson(path.join(outputRoot, "market-index.json"), { schemaVersion: "wr-savant-market-index-v1", generatedAt, defaultMarketId: "dallas-tx", rankingContract: "Each city has an independent candidate pool and score order from 100 downward. Cross-city ranks are prohibited.", markets });
  writeJson(path.join(root, "output", "savant-city-radar-report.json"), { generatedAt, markets: markets.map((market) => ({ ...market, lowestPublishedScore: payloadByMarketId[market.id].topCandidates.at(-1)?.score || 0 })) });
  console.log(JSON.stringify({ markets }, null, 2));
}

if (require.main === module) main();

module.exports = { baseScore, ownerEligibility, parcelBlockKey, parcelLngLat, haversineMiles, activityRecencyWeight, addGrowthPoint, surroundingGrowthSignal, calibrateGrowthScores, rerankLegacyMarket, buildDallasRadar };

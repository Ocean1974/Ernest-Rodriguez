const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const generatedAt = "2026-06-30T00:00:00.000Z";
const auditDate = "2026-06-30";
const status = "source-discovery-started-official-source-not-verified";
const missing = "official-source, verified-parcel-count, viewport-chunks, search-shards, owner-appraisal-ready, source-needed-fields-or-join-keys";

const counties = [
  {
    sequence: 58,
    id: "deaf-smith-county-tx",
    name: "Deaf Smith County",
    cad: "Deaf Smith County Appraisal District",
    coordinates: [-102.6, 34.97],
    geoBounds: { minLng: -103.05, minLat: 34.65, maxLng: -102.15, maxLat: 35.25 },
  },
  {
    sequence: 59,
    id: "delta-county-tx",
    name: "Delta County",
    cad: "Delta County Appraisal District",
    coordinates: [-95.67, 33.38],
    geoBounds: { minLng: -95.95, minLat: 33.2, maxLng: -95.35, maxLat: 33.6 },
  },
  {
    sequence: 60,
    id: "denton-county-tx",
    name: "Denton County",
    cad: "Denton Central Appraisal District",
    coordinates: [-97.13, 33.21],
    geoBounds: { minLng: -97.55, minLat: 32.95, maxLng: -96.75, maxLat: 33.45 },
  },
  {
    sequence: 61,
    id: "dewitt-county-tx",
    name: "DeWitt County",
    cad: "DeWitt County Appraisal District",
    coordinates: [-97.36, 29.09],
    geoBounds: { minLng: -97.75, minLat: 28.75, maxLng: -96.95, maxLat: 29.45 },
  },
  {
    sequence: 62,
    id: "dickens-county-tx",
    name: "Dickens County",
    cad: "Dickens County Appraisal District",
    coordinates: [-100.78, 33.62],
    geoBounds: { minLng: -101.1, minLat: 33.35, maxLng: -100.5, maxLat: 33.9 },
  },
  {
    sequence: 63,
    id: "dimmit-county-tx",
    name: "Dimmit County",
    cad: "Dimmit County Appraisal District",
    coordinates: [-99.76, 28.42],
    geoBounds: { minLng: -100.25, minLat: 27.95, maxLng: -99.25, maxLat: 28.85 },
  },
  {
    sequence: 64,
    id: "donley-county-tx",
    name: "Donley County",
    cad: "Donley County Appraisal District",
    coordinates: [-100.81, 34.97],
    geoBounds: { minLng: -101.15, minLat: 34.7, maxLng: -100.45, maxLat: 35.25 },
  },
  {
    sequence: 65,
    id: "duval-county-tx",
    name: "Duval County",
    cad: "Duval County Appraisal District",
    coordinates: [-98.52, 27.68],
    geoBounds: { minLng: -99.2, minLat: 27.15, maxLng: -98.0, maxLat: 28.25 },
  },
  {
    sequence: 66,
    id: "eastland-county-tx",
    name: "Eastland County",
    cad: "Eastland County Appraisal District",
    coordinates: [-98.83, 32.33],
    geoBounds: { minLng: -99.25, minLat: 32.05, maxLng: -98.45, maxLat: 32.75 },
  },
  {
    sequence: 67,
    id: "ector-county-tx",
    name: "Ector County",
    cad: "Ector County Appraisal District",
    coordinates: [-102.54, 31.87],
    geoBounds: { minLng: -102.85, minLat: 31.6, maxLng: -102.2, maxLat: 32.15 },
  },
  {
    sequence: 68,
    id: "edwards-county-tx",
    name: "Edwards County",
    cad: "Edwards County Appraisal District",
    coordinates: [-100.3, 29.98],
    geoBounds: { minLng: -101.0, minLat: 29.55, maxLng: -99.65, maxLat: 30.45 },
  },
  {
    sequence: 69,
    id: "ellis-county-tx",
    name: "Ellis County",
    cad: "Ellis County Appraisal District",
    coordinates: [-96.8, 32.35],
    geoBounds: { minLng: -97.15, minLat: 32.05, maxLng: -96.45, maxLat: 32.65 },
  },
  {
    sequence: 70,
    id: "el-paso-county-tx",
    name: "El Paso County",
    cad: "El Paso Central Appraisal District",
    coordinates: [-106.49, 31.76],
    geoBounds: { minLng: -106.75, minLat: 31.45, maxLng: -105.95, maxLat: 32.1 },
  },
  {
    sequence: 71,
    id: "erath-county-tx",
    name: "Erath County",
    cad: "Erath County Appraisal District",
    coordinates: [-98.22, 32.23],
    geoBounds: { minLng: -98.6, minLat: 31.95, maxLng: -97.85, maxLat: 32.55 },
  },
  {
    sequence: 72,
    id: "falls-county-tx",
    name: "Falls County",
    cad: "Falls County Appraisal District",
    coordinates: [-96.94, 31.25],
    geoBounds: { minLng: -97.25, minLat: 30.9, maxLng: -96.55, maxLat: 31.55 },
  },
  {
    sequence: 73,
    id: "fannin-county-tx",
    name: "Fannin County",
    cad: "Fannin County Appraisal District",
    coordinates: [-96.1, 33.59],
    geoBounds: { minLng: -96.5, minLat: 33.3, maxLng: -95.75, maxLat: 33.9 },
  },
  {
    sequence: 74,
    id: "fayette-county-tx",
    name: "Fayette County",
    cad: "Fayette County Appraisal District",
    coordinates: [-96.92, 29.88],
    geoBounds: { minLng: -97.35, minLat: 29.55, maxLng: -96.45, maxLat: 30.2 },
  },
  {
    sequence: 75,
    id: "fisher-county-tx",
    name: "Fisher County",
    cad: "Fisher County Appraisal District",
    coordinates: [-100.4, 32.74],
    geoBounds: { minLng: -100.75, minLat: 32.45, maxLng: -100.05, maxLat: 33.05 },
  },
  {
    sequence: 76,
    id: "floyd-county-tx",
    name: "Floyd County",
    cad: "Floyd County Appraisal District",
    coordinates: [-101.3, 34.07],
    geoBounds: { minLng: -101.6, minLat: 33.75, maxLng: -101.0, maxLat: 34.4 },
  },
  {
    sequence: 77,
    id: "foard-county-tx",
    name: "Foard County",
    cad: "Foard County Appraisal District",
    coordinates: [-99.75, 33.97],
    geoBounds: { minLng: -100.1, minLat: 33.75, maxLng: -99.45, maxLat: 34.25 },
  },
  {
    sequence: 78,
    id: "fort-bend-county-tx",
    name: "Fort Bend County",
    cad: "Fort Bend Central Appraisal District",
    coordinates: [-95.81, 29.57],
    geoBounds: { minLng: -96.15, minLat: 29.25, maxLng: -95.25, maxLat: 29.9 },
  },
  {
    sequence: 79,
    id: "franklin-county-tx",
    name: "Franklin County",
    cad: "Franklin County Appraisal District",
    coordinates: [-95.2, 33.18],
    geoBounds: { minLng: -95.45, minLat: 32.95, maxLng: -94.95, maxLat: 33.4 },
  },
  {
    sequence: 80,
    id: "freestone-county-tx",
    name: "Freestone County",
    cad: "Freestone County Appraisal District",
    coordinates: [-96.15, 31.7],
    geoBounds: { minLng: -96.5, minLat: 31.4, maxLng: -95.85, maxLat: 32.0 },
  },
  {
    sequence: 81,
    id: "frio-county-tx",
    name: "Frio County",
    cad: "Frio County Appraisal District",
    coordinates: [-99.1, 28.87],
    geoBounds: { minLng: -99.55, minLat: 28.45, maxLng: -98.75, maxLat: 29.25 },
  },
  {
    sequence: 82,
    id: "gaines-county-tx",
    name: "Gaines County",
    cad: "Gaines County Appraisal District",
    coordinates: [-102.63, 32.74],
    geoBounds: { minLng: -103.1, minLat: 32.45, maxLng: -102.15, maxLat: 33.05 },
  },
  {
    sequence: 83,
    id: "galveston-county-tx",
    name: "Galveston County",
    cad: "Galveston County Appraisal District",
    coordinates: [-94.86, 29.39],
    geoBounds: { minLng: -95.35, minLat: 29.05, maxLng: -94.35, maxLat: 29.75 },
  },
  {
    sequence: 84,
    id: "garza-county-tx",
    name: "Garza County",
    cad: "Garza County Appraisal District",
    coordinates: [-101.3, 33.18],
    geoBounds: { minLng: -101.65, minLat: 32.9, maxLng: -101.0, maxLat: 33.45 },
  },
  {
    sequence: 85,
    id: "gillespie-county-tx",
    name: "Gillespie County",
    cad: "Gillespie County Appraisal District",
    coordinates: [-98.95, 30.3],
    geoBounds: { minLng: -99.35, minLat: 30.0, maxLng: -98.55, maxLat: 30.65 },
  },
  {
    sequence: 86,
    id: "glasscock-county-tx",
    name: "Glasscock County",
    cad: "Glasscock County Appraisal District",
    coordinates: [-101.52, 31.87],
    geoBounds: { minLng: -101.85, minLat: 31.55, maxLng: -101.15, maxLat: 32.15 },
  },
  {
    sequence: 87,
    id: "goliad-county-tx",
    name: "Goliad County",
    cad: "Goliad County Appraisal District",
    coordinates: [-97.43, 28.66],
    geoBounds: { minLng: -97.8, minLat: 28.35, maxLng: -97.05, maxLat: 29.0 },
  },
  {
    sequence: 88,
    id: "gonzales-county-tx",
    name: "Gonzales County",
    cad: "Gonzales County Appraisal District",
    coordinates: [-97.49, 29.46],
    geoBounds: { minLng: -97.9, minLat: 29.15, maxLng: -97.05, maxLat: 29.85 },
  },
  {
    sequence: 89,
    id: "gray-county-tx",
    name: "Gray County",
    cad: "Gray County Appraisal District",
    coordinates: [-100.81, 35.4],
    geoBounds: { minLng: -101.1, minLat: 35.15, maxLng: -100.5, maxLat: 35.7 },
  },
  {
    sequence: 90,
    id: "grayson-county-tx",
    name: "Grayson County",
    cad: "Grayson County Appraisal District",
    coordinates: [-96.68, 33.63],
    geoBounds: { minLng: -97.1, minLat: 33.35, maxLng: -96.25, maxLat: 33.95 },
  },
  {
    sequence: 91,
    id: "gregg-county-tx",
    name: "Gregg County",
    cad: "Gregg County Appraisal District",
    coordinates: [-94.82, 32.49],
    geoBounds: { minLng: -95.1, minLat: 32.3, maxLng: -94.55, maxLat: 32.7 },
  },
  {
    sequence: 92,
    id: "grimes-county-tx",
    name: "Grimes County",
    cad: "Grimes County Appraisal District",
    coordinates: [-95.98, 30.55],
    geoBounds: { minLng: -96.35, minLat: 30.25, maxLng: -95.65, maxLat: 30.85 },
  },
  {
    sequence: 93,
    id: "guadalupe-county-tx",
    name: "Guadalupe County",
    cad: "Guadalupe County Appraisal District",
    coordinates: [-97.95, 29.58],
    geoBounds: { minLng: -98.25, minLat: 29.35, maxLng: -97.65, maxLat: 29.8 },
  },
  {
    sequence: 94,
    id: "hale-county-tx",
    name: "Hale County",
    cad: "Hale County Appraisal District",
    coordinates: [-101.83, 34.07],
    geoBounds: { minLng: -102.1, minLat: 33.85, maxLng: -101.55, maxLat: 34.35 },
  },
  {
    sequence: 95,
    id: "hall-county-tx",
    name: "Hall County",
    cad: "Hall County Appraisal District",
    coordinates: [-100.68, 34.53],
    geoBounds: { minLng: -101.1, minLat: 34.25, maxLng: -100.35, maxLat: 34.85 },
  },
  {
    sequence: 96,
    id: "hamilton-county-tx",
    name: "Hamilton County",
    cad: "Hamilton County Appraisal District",
    coordinates: [-98.11, 31.7],
    geoBounds: { minLng: -98.45, minLat: 31.4, maxLng: -97.8, maxLat: 32.0 },
  },
  {
    sequence: 97,
    id: "hansford-county-tx",
    name: "Hansford County",
    cad: "Hansford County Appraisal District",
    coordinates: [-101.35, 36.27],
    geoBounds: { minLng: -101.65, minLat: 36.05, maxLng: -101.05, maxLat: 36.5 },
  },
  {
    sequence: 98,
    id: "hardeman-county-tx",
    name: "Hardeman County",
    cad: "Hardeman County Appraisal District",
    coordinates: [-99.75, 34.29],
    geoBounds: { minLng: -100.05, minLat: 34.0, maxLng: -99.45, maxLat: 34.6 },
  },
  {
    sequence: 99,
    id: "hardin-county-tx",
    name: "Hardin County",
    cad: "Hardin County Appraisal District",
    coordinates: [-94.39, 30.33],
    geoBounds: { minLng: -94.75, minLat: 30.0, maxLng: -94.05, maxLat: 30.65 },
  },
  {
    sequence: 101,
    id: "harrison-county-tx",
    name: "Harrison County",
    cad: "Harrison Central Appraisal District",
    coordinates: [-94.37, 32.55],
    geoBounds: { minLng: -94.75, minLat: 32.3, maxLng: -94.0, maxLat: 32.8 },
  },
  {
    sequence: 102,
    id: "hartley-county-tx",
    name: "Hartley County",
    cad: "Hartley County Appraisal District",
    coordinates: [-102.6, 35.84],
    geoBounds: { minLng: -103.05, minLat: 35.55, maxLng: -102.2, maxLat: 36.1 },
  },
  {
    sequence: 103,
    id: "haskell-county-tx",
    name: "Haskell County",
    cad: "Haskell County Appraisal District",
    coordinates: [-99.73, 33.16],
    geoBounds: { minLng: -100.05, minLat: 32.95, maxLng: -99.45, maxLat: 33.4 },
  },
  {
    sequence: 104,
    id: "hays-county-tx",
    name: "Hays County",
    cad: "Hays Central Appraisal District",
    coordinates: [-98.03, 30.06],
    geoBounds: { minLng: -98.35, minLat: 29.75, maxLng: -97.7, maxLat: 30.35 },
  },
  {
    sequence: 105,
    id: "hemphill-county-tx",
    name: "Hemphill County",
    cad: "Hemphill County Appraisal District",
    coordinates: [-100.27, 35.84],
    geoBounds: { minLng: -100.55, minLat: 35.6, maxLng: -100.0, maxLat: 36.1 },
  },
  {
    sequence: 106,
    id: "henderson-county-tx",
    name: "Henderson County",
    cad: "Henderson County Appraisal District",
    coordinates: [-95.85, 32.21],
    geoBounds: { minLng: -96.2, minLat: 31.8, maxLng: -95.45, maxLat: 32.55 },
  },
  {
    sequence: 107,
    id: "hidalgo-county-tx",
    name: "Hidalgo County",
    cad: "Hidalgo County Appraisal District",
    coordinates: [-98.18, 26.4],
    geoBounds: { minLng: -98.6, minLat: 26.05, maxLng: -97.85, maxLat: 26.75 },
  },
  {
    sequence: 108,
    id: "hill-county-tx",
    name: "Hill County",
    cad: "Hill County Appraisal District",
    coordinates: [-97.13, 32.0],
    geoBounds: { minLng: -97.5, minLat: 31.75, maxLng: -96.8, maxLat: 32.3 },
  },
  {
    sequence: 109,
    id: "hockley-county-tx",
    name: "Hockley County",
    cad: "Hockley County Appraisal District",
    coordinates: [-102.34, 33.61],
    geoBounds: { minLng: -102.65, minLat: 33.35, maxLng: -102.05, maxLat: 33.9 },
  },
  {
    sequence: 110,
    id: "hood-county-tx",
    name: "Hood County",
    cad: "Hood County Appraisal District",
    coordinates: [-97.83, 32.43],
    geoBounds: { minLng: -98.1, minLat: 32.2, maxLng: -97.55, maxLat: 32.65 },
  },
  {
    sequence: 111,
    id: "hopkins-county-tx",
    name: "Hopkins County",
    cad: "Hopkins County Appraisal District",
    coordinates: [-95.56, 33.15],
    geoBounds: { minLng: -95.85, minLat: 32.9, maxLng: -95.25, maxLat: 33.4 },
  },
  {
    sequence: 112,
    id: "houston-county-tx",
    name: "Houston County",
    cad: "Houston County Appraisal District",
    coordinates: [-95.42, 31.32],
    geoBounds: { minLng: -95.85, minLat: 31.0, maxLng: -95.0, maxLat: 31.65 },
  },
  {
    sequence: 113,
    id: "howard-county-tx",
    name: "Howard County",
    cad: "Howard County Appraisal District",
    coordinates: [-101.44, 32.3],
    geoBounds: { minLng: -101.75, minLat: 32.05, maxLng: -101.15, maxLat: 32.55 },
  },
  {
    sequence: 114,
    id: "hudspeth-county-tx",
    name: "Hudspeth County",
    cad: "Hudspeth County Appraisal District",
    coordinates: [-105.37, 31.45],
    geoBounds: { minLng: -106.0, minLat: 30.9, maxLng: -104.8, maxLat: 32.0 },
  },
  {
    sequence: 115,
    id: "hunt-county-tx",
    name: "Hunt County",
    cad: "Hunt County Appraisal District",
    coordinates: [-96.08, 33.12],
    geoBounds: { minLng: -96.45, minLat: 32.85, maxLng: -95.75, maxLat: 33.4 },
  },
  {
    sequence: 116,
    id: "hutchinson-county-tx",
    name: "Hutchinson County",
    cad: "Hutchinson County Appraisal District",
    coordinates: [-101.35, 35.84],
    geoBounds: { minLng: -101.65, minLat: 35.55, maxLng: -101.05, maxLat: 36.1 },
  },
  {
    sequence: 117,
    id: "irion-county-tx",
    name: "Irion County",
    cad: "Irion County Appraisal District",
    coordinates: [-100.98, 31.3],
    geoBounds: { minLng: -101.35, minLat: 31.0, maxLng: -100.65, maxLat: 31.6 },
  },
  {
    sequence: 118,
    id: "jack-county-tx",
    name: "Jack County",
    cad: "Jack County Appraisal District",
    coordinates: [-98.17, 33.21],
    geoBounds: { minLng: -98.5, minLat: 32.95, maxLng: -97.85, maxLat: 33.45 },
  },
  {
    sequence: 119,
    id: "jackson-county-tx",
    name: "Jackson County",
    cad: "Jackson County Appraisal District",
    coordinates: [-96.58, 28.95],
    geoBounds: { minLng: -96.95, minLat: 28.65, maxLng: -96.25, maxLat: 29.25 },
  },
  {
    sequence: 120,
    id: "jasper-county-tx",
    name: "Jasper County",
    cad: "Jasper County Appraisal District",
    coordinates: [-94.0, 30.75],
    geoBounds: { minLng: -94.35, minLat: 30.4, maxLng: -93.65, maxLat: 31.05 },
  },
  {
    sequence: 121,
    id: "jeff-davis-county-tx",
    name: "Jeff Davis County",
    cad: "Jeff Davis County Appraisal District",
    coordinates: [-104.14, 30.72],
    geoBounds: { minLng: -104.9, minLat: 30.25, maxLng: -103.55, maxLat: 31.25 },
  },
];

const protectedSpecializedCountyIds = new Set([
  "dallas-county-dcad",
  "dallas-county-tx",
  "harris-county-tx",
]);

function fallbackBoundsForSequence(sequence) {
  const index = Math.max(0, Number(sequence || 0) - 1);
  const columns = 18;
  const col = index % columns;
  const row = Math.floor(index / columns);
  const centerLng = -106.4 + col * 0.72;
  const centerLat = 36.2 - row * 0.58;
  return {
    coordinates: [Number(centerLng.toFixed(4)), Number(centerLat.toFixed(4))],
    geoBounds: {
      minLng: Number((centerLng - 0.28).toFixed(4)),
      minLat: Number((centerLat - 0.18).toFixed(4)),
      maxLng: Number((centerLng + 0.28).toFixed(4)),
      maxLat: Number((centerLat + 0.18).toFixed(4)),
    },
  };
}

function adapterMapDefaults(entry) {
  const fallback = fallbackBoundsForSequence(entry.sequence);
  const adapterPath = entry.adapterPath ? path.join(root, entry.adapterPath) : "";
  if (!adapterPath || !fs.existsSync(adapterPath)) return fallback;
  try {
    const adapter = JSON.parse(fs.readFileSync(adapterPath, "utf8"));
    const coordinates = Array.isArray(adapter.map?.coordinates) && adapter.map.coordinates.length === 2
      ? adapter.map.coordinates
      : fallback.coordinates;
    const geoBounds = adapter.map?.geoBounds && Number.isFinite(Number(adapter.map.geoBounds.minLng))
      ? adapter.map.geoBounds
      : fallback.geoBounds;
    return {
      coordinates,
      geoBounds,
      cad: adapter.appraisalDistrictName,
    };
  } catch {
    return fallback;
  }
}

function texasQueueEntries() {
  const queuePath = path.join(root, "output", "texas-county-verification-queue", "texas-county-verification-queue.json");
  if (!fs.existsSync(queuePath)) return [];
  const queue = JSON.parse(fs.readFileSync(queuePath, "utf8"));
  const entries = [];
  const seen = new Set();
  for (const batch of [queue.activeBatch, ...(queue.batches || [])].filter(Boolean)) {
    for (const entry of Array.isArray(batch.counties) ? batch.counties : []) {
      const id = entry.countyId || entry.adapterId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      entries.push(entry);
    }
  }
  return entries.sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
}

function appendRemainingTexasQueueCounties() {
  const existing = new Set(counties.map((county) => county.id));
  for (const entry of texasQueueEntries()) {
    const id = entry.countyId || entry.adapterId;
    if (!id || existing.has(id) || protectedSpecializedCountyIds.has(id) || id.includes("dallas")) continue;
    const defaults = adapterMapDefaults(entry);
    counties.push({
      sequence: Number(entry.sequence || counties.length + 1),
      id,
      name: entry.countyName || id,
      cad: defaults.cad || `${entry.countyName || id} Appraisal District`,
      coordinates: defaults.coordinates,
      geoBounds: defaults.geoBounds,
    });
    existing.add(id);
  }
}

appendRemainingTexasQueueCounties();

if (counties.some((county) => county.id.includes("dallas"))) {
  throw new Error("Dallas is locked out of this continuation script.");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
}

function rel(file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function sourceManifest(county) {
  return {
    version: "wr-county-source-manifest-v1",
    generatedAt,
    county_id: county.id,
    county_name: county.name,
    state: "TX",
    status,
    officialSourceStatus: "not-verified",
    officialPortal: null,
    parcelGeometrySource: "source-needed",
    appraisalPropertySource: "source-needed",
    permitSource: "source-needed",
    candidateSearchQueries: [
      `${county.name} Appraisal District parcel data official`,
      `${county.name} Texas GIS parcel boundaries official`,
      `${county.name} Texas permits open data parcel address`,
    ],
    sourceRules: [
      "Use official county, assessor/appraiser, GIS, municipal, state, or federal sources first.",
      "Do not activate this county until exact parcel counts and join keys are verified.",
      "Do not infer owner phone/email from permits, contractors, applicants, or scraped pages.",
    ],
    blockingGaps: [
      "official appraisal district site not verified",
      "official parcel geometry bulk source not verified",
      "exact parcel count not verified",
      "exact geometry-to-appraisal join key not verified",
      "viewport/search outputs not built",
    ],
  };
}

function schemaReport(county) {
  return {
    generatedAt,
    county_id: county.id,
    county_name: county.name,
    state: "TX",
    cad_name: county.cad,
    status,
    source_manifest: `data/county-adapters/${county.id}/${county.id}-source-manifest.json`,
    official_portal: null,
    universal_schema_version: "wr-universal-parcel-v1",
    schema_fields: [],
    mapped_source_fields: [],
    verified_counts: {
      parcelGeometryFeatures: 0,
      appraisalPropertyRows: 0,
      status: "not-verified",
    },
    blocking_gaps: [
      "official appraisal district site not verified",
      "exact parcel count not verified",
      "exact geometry-to-appraisal join key not verified",
      "viewport/search outputs not built",
    ],
    activation: {
      safeVisibleActivation: "do-not-activate",
      reason: "Official source discovery is not verified and does not satisfy exact count, join-key, bulk-source, parcel-service, or QC gates.",
    },
  };
}

function schemaReportMd(county) {
  return [
    `# ${county.name} TX Schema Report`,
    "",
    `Generated: ${generatedAt}`,
    "",
    `- Status: ${status}`,
    "- Official portal: not verified",
    `- Source manifest: data/county-adapters/${county.id}/${county.id}-source-manifest.json`,
    "",
    "## Counts",
    "",
    "- Parcel geometry features: not verified",
    "- Appraisal/property rows: not verified",
    "",
    "## Decision",
    "",
    "Do not activate until official source provenance, exact parcel counts, and exact join keys are verified.",
    "",
  ].join("\n");
}

function joinKeyReportMd(county) {
  return [
    `# ${county.name} TX Join-Key Report`,
    "",
    `Generated: ${generatedAt}`,
    "",
    "## Current finding",
    "",
    "No exact official parcel geometry to appraisal/account join key has been verified yet.",
    "",
    "## Required join keys before activation",
    "",
    "- Parcel geometry feature key: source-needed",
    "- Appraisal/property account key: source-needed",
    "- Owner/appraisal join key: source-needed",
    "- Permit join method: source-needed; prefer parcel/account ID, then normalized address plus spatial join",
    "",
    "## Activation gate",
    "",
    "This county remains disabled until exact join keys are documented with official source provenance and counts.",
    "",
  ].join("\n");
}

function fullAccessReportMd(county) {
  return [
    `# ${county.name} TX Full Parcel Access Report`,
    "",
    `Generated: ${generatedAt}`,
    "",
    "## Status",
    "",
    `- County status: ${status}`,
    "- Production parcel access: not built",
    "- Viewport chunks: not built",
    "- Search shards: not built",
    "- PMTiles/vector tiles: not built",
    "- Owner/appraisal fields: not verified",
    "",
    "## Required before DCAD parity",
    "",
    "- Verify official parcel geometry source and exact feature count.",
    "- Verify official appraisal/property source and exact row count.",
    "- Document exact parcel/account join key.",
    "- Build viewport-safe parcel chunks or PMTiles/vector tiles.",
    "- Build search shards and QC report.",
    "- Keep visible app activation disabled until the connection gate passes.",
    "",
  ].join("\n");
}

function updateAdapter(county) {
  const adapterPath = path.join(root, "data", "county-adapters", county.id, "adapter.json");
  const adapter = readJson(adapterPath);
  adapter.gisSource = "official county parcel/GIS source not verified yet";
  adapter.map.coordinates = county.coordinates;
  adapter.map.geoBounds = county.geoBounds;
  adapter.map.boundsStatus = "county approximate bounds only; replace with verified parcel extent during source inspection";
  adapter.publicSourceDiscovery.status = status;
  adapter.verifiedDiscovery = {
    status: "official-source-not-verified",
    officialSite: null,
    propertySearch: null,
    interactiveMap: null,
    candidateBulkOrExportLeads: [],
    remainingBlockers: [
      "official appraisal district site not verified",
      "official parcel geometry bulk source not verified",
      "exact parcel count not verified",
      "exact geometry-to-appraisal join key not verified",
      "viewport/search outputs not built",
    ],
  };
  writeJson(adapterPath, adapter);
}

function writeCountyOutputs(county) {
  updateAdapter(county);
  const manifestPath = path.join(root, "data", "county-adapters", county.id, `${county.id}-source-manifest.json`);
  writeJson(manifestPath, sourceManifest(county));
  const outputDir = path.join(root, "output", county.id);
  writeJson(path.join(outputDir, "schema-report.json"), schemaReport(county));
  writeText(path.join(outputDir, "schema-report.md"), schemaReportMd(county));
  writeText(path.join(outputDir, "join-key-report.md"), joinKeyReportMd(county));
  writeText(path.join(outputDir, "full-parcel-access-report.md"), fullAccessReportMd(county));
}

function updateQueueMd() {
  const queuePath = path.join(root, "output", "texas-county-verification-queue", "texas-county-verification-queue.md");
  const countyNames = new Set(counties.map((county) => county.name));
  const lines = fs
    .readFileSync(queuePath, "utf8")
    .trimEnd()
    .split(/\r?\n/)
    .filter((line) => {
      const match = line.match(/^\|\s*\d+\s*\|\s*([^|]+?)\s*\|/);
      return !match || !countyNames.has(match[1].trim());
    });
  let md = lines.join("\n");
  for (const county of counties) {
    const row = `| ${county.sequence} | ${county.name} | ${status} | official-source-discovery-and-ingest | ${missing} |`;
    if (!md.includes(`| ${county.sequence} | ${county.name} |`)) {
      md += `\n${row}`;
    }
  }
  writeText(queuePath, md);
}

function updateQueueJson() {
  const queuePath = path.join(root, "output", "texas-county-verification-queue", "texas-county-verification-queue.json");
  if (!fs.existsSync(queuePath)) return;
  const queue = readJson(queuePath);
  const byId = new Map(counties.map((county) => [county.id, county]));
  for (const batch of queue.allBatches || []) {
    for (const entry of batch.counties || []) {
      const county = byId.get(entry.countyId);
      if (!county) continue;
      entry.status = status;
      entry.missing = missing.split(", ");
    }
  }
  writeJson(queuePath, queue);
}

function updateAudit() {
  const auditJson = path.join(root, "output", "texas-source-audit", "tx-batch-002-source-audit.json");
  const audit = readJson(auditJson);
  audit.retrievedAt = auditDate;
  audit.generatedAt = generatedAt;
  for (const county of counties) {
    if (!audit.countiesStarted.includes(county.id)) {
      audit.countiesStarted.push(county.id);
    }
  }
  audit.summary.countyCount = audit.countiesStarted.length;
  writeJson(auditJson, audit);

  const auditMd = path.join(root, "output", "texas-source-audit", "tx-batch-002-source-audit.md");
  const lines = [
    "# Texas Source Audit Batch 2",
    "",
    `Generated: ${generatedAt}`,
    "",
    `- Scope: ${audit.scope}`,
    `- Rule: ${audit.rule}`,
    `- Counties started: ${audit.summary.countyCount}`,
    `- Official site verified: ${audit.summary.officialSiteVerified}`,
    `- Promoted to core-complete: ${audit.summary.promotedToCoreComplete}`,
    "",
    "## Counties Started",
    "",
    ...audit.countiesStarted.map((id) => `- ${id}`),
    "",
  ];
  writeText(auditMd, lines.join("\n"));
}

function validateNoDallasWrites() {
  const forbidden = [
    path.join(root, "output", "dallas-county-tx", "schema-report.json"),
    path.join(root, "output", "dallas-county-tx", "schema-report.md"),
    path.join(root, "output", "dallas-county-tx", "join-key-report.md"),
    path.join(root, "output", "dallas-county-tx", "full-parcel-access-report.md"),
  ];
  for (const target of forbidden) {
    if (fs.existsSync(target)) {
      throw new Error(`Forbidden Dallas output path exists: ${rel(target)}`);
    }
  }
}

for (const county of counties) {
  writeCountyOutputs(county);
}
updateQueueMd();
updateQueueJson();
updateAudit();
validateNoDallasWrites();

console.log(JSON.stringify({
  generatedAt,
  counties: counties.map((county) => county.id),
  wroteReportsPerCounty: 4,
  dallasTouched: false,
}, null, 2));

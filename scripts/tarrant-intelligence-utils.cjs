const crypto = require("crypto");

function clean(value) {
  const text = String(value ?? "").trim();
  return !text || text.toLowerCase() === "null" || text.toLowerCase() === "undefined" ? "" : text;
}

function normalizeAddress(value) {
  return clean(value)
    .toUpperCase()
    .replace(/\b(UNIT|SUITE|STE|APT|#)\s*[A-Z0-9-]+.*$/, "")
    .replace(/\bSTREET\b/g, "ST")
    .replace(/\bROAD\b/g, "RD")
    .replace(/\bAVENUE\b/g, "AVE")
    .replace(/\bBOULEVARD\b/g, "BLVD")
    .replace(/\bDRIVE\b/g, "DR")
    .replace(/\bLANE\b/g, "LN")
    .replace(/\bCOURT\b/g, "CT")
    .replace(/\bPLACE\b/g, "PL")
    .replace(/\bPARKWAY\b/g, "PKWY")
    .replace(/\bHIGHWAY\b/g, "HWY")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeId(value) {
  return clean(value).replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function ringBounds(rings) {
  const bounds = { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity };
  let count = 0;
  for (const ring of rings || []) {
    for (const point of ring || []) {
      const lng = Number(point?.[0]);
      const lat = Number(point?.[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      bounds.minLng = Math.min(bounds.minLng, lng);
      bounds.minLat = Math.min(bounds.minLat, lat);
      bounds.maxLng = Math.max(bounds.maxLng, lng);
      bounds.maxLat = Math.max(bounds.maxLat, lat);
      count += 1;
    }
  }
  return count ? bounds : null;
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, rings) {
  let inside = false;
  for (const ring of rings || []) if (ring.length >= 3 && pointInRing(point, ring)) inside = !inside;
  return inside;
}

function makeGrid(bounds, columns = 120, rows = 100) {
  const cells = new Map();
  const cellX = (lng) => Math.max(0, Math.min(columns - 1, Math.floor(((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * columns)));
  const cellY = (lat) => Math.max(0, Math.min(rows - 1, Math.floor(((lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * rows)));
  const key = (x, y) => `${x}:${y}`;
  return {
    add(item, itemBounds) {
      const minX = cellX(itemBounds.minLng);
      const maxX = cellX(itemBounds.maxLng);
      const minY = cellY(itemBounds.minLat);
      const maxY = cellY(itemBounds.maxLat);
      for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) {
        const id = key(x, y);
        if (!cells.has(id)) cells.set(id, []);
        cells.get(id).push(item);
      }
    },
    at(point) { return cells.get(key(cellX(point[0]), cellY(point[1]))) || []; },
    size() { return cells.size; },
  };
}

function first(attributes, names) {
  for (const name of names) {
    const value = clean(attributes?.[name]);
    if (value) return value;
  }
  return "";
}

function dateIso(value) {
  if (value === null || value === undefined || value === "") return "";
  const date = new Date(typeof value === "number" ? value : String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function developmentCategory(record) {
  const text = [record.permitType, record.permitSubtype, record.description].filter(Boolean).join(" ").toLowerCase();
  if (/demoli/.test(text)) return "demolition";
  if (/new construction|new build|new residential|new commercial|ground up/.test(text)) return "new-construction";
  if (/certificate|occupancy|\bco\b/.test(text)) return "occupancy";
  if (/addition|alteration|remodel|renovat|finish out|tenant/.test(text)) return "alteration";
  return "permit-activity";
}

module.exports = { clean, normalizeAddress, normalizeId, sha256, ringBounds, pointInPolygon, makeGrid, first, dateIso, developmentCategory };

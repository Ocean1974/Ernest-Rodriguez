const STREET_TOKEN_ALIASES = new Map([
  ["ALLEY", "ALY"],
  ["AVENUE", "AVE"],
  ["BOULEVARD", "BLVD"],
  ["CIRCLE", "CIR"],
  ["COURT", "CT"],
  ["DRIVE", "DR"],
  ["EXPRESSWAY", "EXPY"],
  ["FREEWAY", "FWY"],
  ["HIGHWAY", "HWY"],
  ["INTERSTATE", "IH"],
  ["LANE", "LN"],
  ["PARKWAY", "PKWY"],
  ["PLACE", "PL"],
  ["PLAZA", "PLZ"],
  ["ROAD", "RD"],
  ["STREET", "ST"],
  ["TERRACE", "TER"],
  ["TRAIL", "TRL"],
  ["TURNPIKE", "TPKE"],
]);

const UNIT_MARKER = /\b(?:APARTMENT|APT|BUILDING|BLDG|FLOOR|FL|ROOM|RM|SUITE|STE|UNIT)\b|#/i;
const LOCALITY = /\b(?:DALLAS|TEXAS|TX|UNITED\s+STATES)\b|\b\d{5}(?:-\d{4})?\b/i;
const STREET_SUFFIXES = new Set(STREET_TOKEN_ALIASES.values());

function normalizeTokens(value) {
  const tokens = String(value || "")
    .normalize("NFKD")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => STREET_TOKEN_ALIASES.get(token) || token);
  return tokens.filter((token, index) => index === 0 || token !== tokens[index - 1] || !STREET_SUFFIXES.has(token)).join(" ");
}

function parseInlineUnit(primary) {
  const match = String(primary || "").match(UNIT_MARKER);
  if (!match || match.index === undefined) return { street: String(primary || "").trim(), unit: "" };
  return {
    street: String(primary).slice(0, match.index).trim(),
    unit: String(primary).slice(match.index + match[0].length).trim(),
  };
}

function addressEvidence(value) {
  const rawAddress = String(value || "").trim();
  if (!rawAddress) return { rawAddress, valid: false, reason: "missing-address", primaryAddress: "", normalizedBase: "", normalizedWithUnit: "", unit: "" };

  const segments = rawAddress.split(",").map((segment) => segment.trim()).filter(Boolean);
  let primaryAddress = segments[0] || "";
  let unit = "";
  const inline = parseInlineUnit(primaryAddress);
  primaryAddress = inline.street;
  unit = inline.unit;

  if (!unit) {
    for (const segment of segments.slice(1)) {
      if (LOCALITY.test(segment)) break;
      unit = segment;
      break;
    }
  }

  primaryAddress = primaryAddress
    .replace(/\s+(?:DALLAS(?:\s+TX)?|TX)\s+\d{5}(?:-\d{4})?(?:\s+UNITED\s+STATES)?\s*$/i, "")
    .replace(/\s+\d{5}(?:-\d{4})?\s+UNITED\s+STATES\s*$/i, "")
    .replace(/\s+UNITED\s+STATES\s*$/i, "")
    .trim();

  const normalizedBase = normalizeTokens(primaryAddress);
  const normalizedUnit = normalizeTokens(unit);
  const leading = normalizedBase.match(/^(\d+[A-Z]?)\s+(.+)$/);
  if (!leading) {
    return { rawAddress, valid: false, reason: "missing-street-number-or-name", primaryAddress, normalizedBase, normalizedWithUnit: "", unit: normalizedUnit };
  }
  const remainderTokens = leading[2].split(" ");
  if (/^\d+[A-Z]?$/.test(remainderTokens[0] || "") && remainderTokens[0] === leading[1]) {
    return { rawAddress, valid: false, reason: "duplicated-street-number", primaryAddress, normalizedBase, normalizedWithUnit: "", unit: normalizedUnit };
  }
  const normalizedWithUnit = normalizedUnit ? `${normalizedBase} UNIT ${normalizedUnit}` : normalizedBase;
  return { rawAddress, valid: true, reason: "", primaryAddress, normalizedBase, normalizedWithUnit, unit: normalizedUnit };
}

function searchShardKey(evidence, length = 2) {
  return String(evidence?.primaryAddress || "").replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, length);
}

function unpackSearchRecord(fields, packed) {
  return Object.fromEntries(fields.map((field, index) => [field, packed[index] ?? ""]));
}

function parcelCandidateKey(record) {
  return String(record.accountNum || record.gisParcelId || `${record.address}|${record.chunkId}|${JSON.stringify(record.centroid || [])}`);
}

function selectParcelCandidates(sourceEvidence, candidates) {
  if (!sourceEvidence.valid) return { partition: "invalid", matchMethod: "none", candidates: [] };
  if (!candidates.length) return { partition: "unmatched", matchMethod: "none", candidates: [] };
  const unitExact = sourceEvidence.unit
    ? candidates.filter((candidate) => candidate.addressEvidence.normalizedWithUnit === sourceEvidence.normalizedWithUnit)
    : [];
  const eligible = unitExact.length ? unitExact : candidates;
  if (eligible.length === 1) {
    return { partition: "exact", matchMethod: unitExact.length ? "normalized-address-and-unit" : "unique-normalized-base-address", candidates: eligible };
  }
  return { partition: "ambiguous", matchMethod: unitExact.length ? "duplicate-normalized-address-and-unit" : "duplicate-normalized-base-address", candidates: eligible };
}

module.exports = {
  addressEvidence,
  normalizeTokens,
  parcelCandidateKey,
  searchShardKey,
  selectParcelCandidates,
  unpackSearchRecord,
};

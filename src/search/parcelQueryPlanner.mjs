export const PARCEL_QUERY_PLAN_VERSION = "wr-parcel-query-plan-v1";

const STOP_WORDS = new Set(["show", "find", "me", "all", "the", "a", "an", "with", "and", "or", "that", "which", "property", "properties", "parcel", "parcels"]);

function amount(value, suffix = "") {
  const base = Number(String(value).replace(/,/g, ""));
  const multiplier = /^k$/i.test(suffix) ? 1e3 : /^m$/i.test(suffix) ? 1e6 : /^(b|bn)$/i.test(suffix) ? 1e9 : 1;
  return base * multiplier;
}

function addFilter(state, match, field, operator, value, unit, label) {
  state.filters.push({ field, operator, value, unit, evidence: match[0], explanation: label });
  state.consumed.push([match.index, match.index + match[0].length]);
}

function unconsumedText(query, consumed) {
  const characters = [...query];
  for (const [start, end] of consumed) for (let index = start; index < end; index += 1) characters[index] = " ";
  return characters.join("");
}

export function planParcelQuery(rawQuery) {
  const query = String(rawQuery || "").trim();
  const state = { filters: [], consumed: [] };
  const matchers = [
    { regex: /\bbetween\s+([\d,.]+)\s+(?:and|to)\s+([\d,.]+)\s*(acres?|ac)\b/gi, run: (m) => {
      const minimum = Math.min(amount(m[1]), amount(m[2]));
      const maximum = Math.max(amount(m[1]), amount(m[2]));
      addFilter(state, m, "landAreaAcres", ">=", minimum, "acres", `Land area is at least ${minimum} acres`);
      state.filters.push({ field: "landAreaAcres", operator: "<=", value: maximum, unit: "acres", evidence: m[0], explanation: `Land area is at most ${maximum} acres` });
    } },
    { regex: /\b(over|more than|greater than|at least|minimum|min)\s+([\d,.]+)\s*(acres?|ac)\b/gi, run: (m) => addFilter(state, m, "landAreaAcres", /at least|minimum|min/i.test(m[1]) ? ">=" : ">", amount(m[2]), "acres", `Land area ${m[1].toLowerCase()} ${m[2]} acres`) },
    { regex: /\b(under|less than|below|at most|maximum|max)\s+([\d,.]+)\s*(acres?|ac)\b/gi, run: (m) => addFilter(state, m, "landAreaAcres", /at most|maximum|max/i.test(m[1]) ? "<=" : "<", amount(m[2]), "acres", `Land area ${m[1].toLowerCase()} ${m[2]} acres`) },
    { regex: /\b(?:buildings?|gross\s+building\s+area|building\s+(?:area|size)|rentable\s+area)\s+(over|above|more than|at least|under|below|less than|at most)\s+([\d,.]+)\s*(k|m|million)?\s*(?:square\s+feet|sq\.?\s*ft|sqft|sf)\b/gi, run: (m) => {
      const suffix = /^million$/i.test(m[3] || "") ? "m" : m[3] || "";
      const operator = /under|below|less than/i.test(m[1]) ? "<" : /at most/i.test(m[1]) ? "<=" : /at least/i.test(m[1]) ? ">=" : ">";
      addFilter(state, m, "grossBuildingArea", operator, amount(m[2], suffix), "square-feet", `Building area ${m[1].toLowerCase()} ${m[2]}${m[3] || ""} square feet`);
    } },
    { regex: /\b(total|land|improvement)\s+value\s+(over|above|more than|at least|under|below|less than|at most)\s+\$?([\d,.]+)\s*(k|m|b|bn|million|billion)?\b/gi, run: (m) => {
      const suffix = /^million$/i.test(m[4] || "") ? "m" : /^billion$/i.test(m[4] || "") ? "b" : m[4] || "";
      const operator = /under|below|less than/i.test(m[2]) ? "<" : /at most/i.test(m[2]) ? "<=" : /at least/i.test(m[2]) ? ">=" : ">";
      addFilter(state, m, `${m[1].toLowerCase()}Value`, operator, amount(m[3], suffix), "usd", `${m[1]} value ${m[2]} ${m[3]}${m[4] || ""}`);
    } },
    { regex: /\b(?:worth|valued)\s+(over|above|more than|at least|under|below|less than|at most)\s+\$?([\d,.]+)\s*(k|m|b|bn|million|billion)?\b/gi, run: (m) => {
      const suffix = /^million$/i.test(m[3] || "") ? "m" : /^billion$/i.test(m[3] || "") ? "b" : m[3] || "";
      const operator = /under|below|less than/i.test(m[1]) ? "<" : /at most/i.test(m[1]) ? "<=" : /at least/i.test(m[1]) ? ">=" : ">";
      addFilter(state, m, "totalValue", operator, amount(m[2], suffix), "usd", `Total value ${m[1].toLowerCase()} ${m[2]}${m[3] || ""}`);
    } },
    { regex: /\b(?:owned by|owner is|owned through)\s+(?:an?\s+)?(llc|corporation|corp|company|partnership|entity)\b/gi, run: (m) => addFilter(state, m, "ownerEntityType", "is-entity", m[1].toLowerCase(), "classification", `Owner is classified as ${m[1].toUpperCase()}`) },
    { regex: /\b(?:owned|held)\s+(?:for\s+)?(?:more than|over|at least)\s+(\d+)\s+years?\b/gi, run: (m) => addFilter(state, m, "ownershipTenureYears", ">=", Number(m[1]), "years", `Ownership tenure is at least ${m[1]} years`) },
    { regex: /\bbuilt\s+(before|after|since)\s+(\d{4})\b/gi, run: (m) => addFilter(state, m, "yearBuilt", /before/i.test(m[1]) ? "<" : ">=", Number(m[2]), "year", `Year built ${m[1].toLowerCase()} ${m[2]}`) },
    { regex: /\bimprovement\s+value\s+(?:below|less than|under)\s+land\s+value\b/gi, run: (m) => addFilter(state, m, "improvementValue", "<field", "landValue", "comparison", "Improvement value is below land value") },
    { regex: /\bno\s+recent\s+permits?\b/gi, run: (m) => addFilter(state, m, "recentPermitCount", "=", 0, "count", "No recent permits are linked to the parcel") },
    { regex: /\b(?:with|has|having)\s+recent\s+permits?\b/gi, run: (m) => addFilter(state, m, "recentPermitCount", ">", 0, "count", "At least one recent permit is linked to the parcel") },
    { regex: /\bvacant\s+(?:land|lots?|parcels?)\b/gi, run: (m) => addFilter(state, m, "vacantLand", "=", true, "classification", "Parcel is classified as vacant land") },
    { regex: /\bzoned\s+(?:for\s+)?([a-z0-9-]{1,20})\b/gi, run: (m) => addFilter(state, m, "zoning", "contains", m[1].toUpperCase(), "code", `Zoning contains ${m[1].toUpperCase()}`) },
  ];
  for (const matcher of matchers) {
    for (const match of query.matchAll(matcher.regex)) matcher.run(match);
  }
  const remainder = unconsumedText(query, state.consumed);
  const keywords = remainder.toLowerCase().split(/[^a-z0-9$.-]+/).filter((token) => token.length > 1 && !STOP_WORDS.has(token));
  const unsupported = [];
  if (/\bnear\b|\bwithin\b.*\b(miles?|minutes?)\b/i.test(remainder)) unsupported.push("spatial-proximity-requires-map-context");
  const confidence = state.filters.length ? Math.max(0.65, Math.min(0.98, 0.72 + state.filters.length * 0.04 - unsupported.length * 0.08)) : 0.4;
  return {
    schemaVersion: PARCEL_QUERY_PLAN_VERSION,
    rawQuery: query,
    filters: state.filters,
    keywords: [...new Set(keywords)],
    unsupported,
    confidence: Number(confidence.toFixed(2)),
    explanation: state.filters.map((filter) => filter.explanation),
    execution: {
      requiresParcelData: true,
      requiresPermitData: state.filters.some((filter) => filter.field === "recentPermitCount"),
      requiresSpatialContext: unsupported.includes("spatial-proximity-requires-map-context"),
    },
  };
}

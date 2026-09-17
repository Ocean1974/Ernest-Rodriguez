const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { load } = require("cheerio");

const root = path.join(__dirname, "..");
const baseUrl = "https://aca-prod.accela.com";
const searchPath = "/DALLASTX/Cap/CapHome.aspx?TabName=Home&module=Building";
const searchUrl = `${baseUrl}${searchPath}`;
const rawRoot = path.join(root, "data", "raw", "dallas-county-dcad", "demand", "supply", "city-of-dallas-dallasnow");
const outputJson = path.join(root, "output", "dallas-city-building-supply-intelligence.json");
const outputMarkdown = path.join(root, "output", "dallas-city-building-supply-intelligence.md");
const defaultTypes = [
  "Certificate of Occupancy",
  "Commercial Accessory Structure Permit",
  "Commercial Alteration Addition Permit",
  "Commercial Demolition Permit",
  "Commercial Foundation Repair",
  "Commercial New Construction Permit",
  "Commercial Pool/Spa Permit",
  "Commercial Roofing Permit",
  "Commercial Solar/PV Permit",
  "Phase - Alteration Addition",
  "Phase - New Construction",
  "Residential Accessory Structure Permit",
  "Residential Alteration Addition Permit",
  "Residential Demolition Permit",
  "Residential Foundation Repair",
  "Residential New Construction Permit",
  "Residential Pool/Spa Permit",
  "Residential Roofing Permit",
  "Residential Solar/PV Permit",
];

function argument(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function isoDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`Invalid ISO date: ${value}`);
  return date;
}

function displayDate(date) {
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}/${date.getUTCFullYear()}`;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function clean(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

class CookieJar {
  constructor() { this.values = new Map(); }
  absorb(headers) {
    const cookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
    for (const cookie of cookies) {
      const pair = cookie.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) this.values.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
  header() { return [...this.values].map(([name, value]) => `${name}=${value}`).join("; "); }
}

async function request(jar, url, options = {}) {
  if (!url.startsWith(baseUrl)) throw new Error(`Unexpected DallasNow host: ${url}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(url, {
      ...options,
      redirect: "error",
      signal: controller.signal,
      headers: {
        "user-agent": "WhiteRabbitDallasNowCapture/1.0",
        accept: "text/html,application/xhtml+xml",
        ...(jar.header() ? { cookie: jar.header() } : {}),
        ...(options.headers || {}),
      },
    });
    jar.absorb(response.headers);
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

function formControls(html) {
  const $ = load(html);
  const params = new URLSearchParams();
  $("form input[name]").each((_, element) => {
    const input = $(element);
    const type = String(input.attr("type") || "text").toLowerCase();
    if (["button", "submit", "file", "image"].includes(type)) return;
    if (["checkbox", "radio"].includes(type) && !input.is(":checked")) return;
    params.append(input.attr("name"), input.val() || "");
  });
  $("form select[name]").each((_, element) => {
    const select = $(element);
    params.append(select.attr("name"), select.val() || "");
  });
  $("form textarea[name]").each((_, element) => params.append($(element).attr("name"), $(element).val() || ""));
  return params;
}

function setParam(params, name, value) {
  params.delete(name);
  params.set(name, value);
}

async function postback(jar, html, eventTarget, overrides = {}) {
  const params = formControls(html);
  setParam(params, "__EVENTTARGET", eventTarget);
  setParam(params, "__EVENTARGUMENT", "");
  for (const [name, value] of Object.entries(overrides)) setParam(params, name, value);
  return request(jar, searchUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", referer: searchUrl },
    body: params.toString(),
  });
}

function recordTypeOptions(html) {
  const $ = load(html);
  const values = new Map();
  $("#ctl00_PlaceHolderMain_generalSearchForm_ddlGSPermitType option").each((_, element) => {
    const option = $(element);
    const label = clean(option.text());
    if (label && option.attr("value")) values.set(label, option.attr("value"));
  });
  return values;
}

function parseResultCount(html) {
  const text = clean(load(html)("body").text());
  const match = text.match(/(100\+|\d+) Record results? matching your search results/i);
  if (!match) {
    if (/No records found|search returned no results/i.test(text)) return 0;
    throw new Error("DallasNow result count was not present.");
  }
  return match[1] === "100+" ? "100+" : Number(match[1]);
}

function parseRows(html) {
  const $ = load(html);
  const table = $("#ctl00_PlaceHolderMain_dgvPermitList_gdvPermitList");
  const records = [];
  table.children("tbody").children("tr").each((_, row) => {
    const cells = $(row).children("td");
    if (cells.length < 9) return;
    const recordDate = clean(cells.eq(1).text());
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(recordDate)) return;
    const recordNumber = clean(cells.eq(2).text());
    const href = cells.eq(2).find("a[href*='CapDetail.aspx']").attr("href") || null;
    records.push({
      recordDate: new Date(`${recordDate} 00:00:00 UTC`).toISOString().slice(0, 10),
      recordNumber,
      recordType: clean(cells.eq(3).text()),
      address: clean(cells.eq(4).text()) || null,
      description: clean(cells.eq(5).text()) || null,
      expirationDate: /^\d{2}\/\d{2}\/\d{4}$/.test(clean(cells.eq(7).text())) ? new Date(`${clean(cells.eq(7).text())} 00:00:00 UTC`).toISOString().slice(0, 10) : null,
      status: clean(cells.eq(8).text()).replace(/Renewal:\s*Deferred Payment.*$/i, "").trim() || null,
      detailUrl: href ? new URL(href, baseUrl).href : null,
    });
  });
  return records;
}

function nextTarget(html) {
  const $ = load(html);
  const href = $("#ctl00_PlaceHolderMain_dgvPermitList_gdvPermitList a").filter((_, element) => clean($(element).text()) === "Next >").attr("href");
  const match = String(href || "").match(/__doPostBack\('([^']+)'/);
  return match ? match[1] : null;
}

function persistRaw(html, query, pageNumber) {
  const digest = sha256(html);
  const directory = path.join(rawRoot, query.start.toISOString().slice(0, 7));
  const filename = `${query.start.toISOString().slice(0, 10)}_${query.end.toISOString().slice(0, 10)}_${slug(query.type)}_p${String(pageNumber).padStart(3, "0")}_${digest.slice(0, 12)}.html.gz`;
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, filename);
  fs.writeFileSync(filePath, zlib.gzipSync(html, { level: 9 }));
  return { path: path.relative(root, filePath).replace(/\\/g, "/"), responseBytes: html.length, responseSha256: digest, storedBytes: fs.statSync(filePath).size, pageNumber };
}

async function search(jar, typeValue, query) {
  const landingHtml = await request(jar, searchUrl);
  const overrides = {
    "ctl00$PlaceHolderMain$ddlSearchType": "0",
    "ctl00$PlaceHolderMain$generalSearchForm$ddlGSPermitType": typeValue,
    "ctl00$PlaceHolderMain$generalSearchForm$txtGSStartDate": displayDate(query.start),
    "ctl00$PlaceHolderMain$generalSearchForm$txtGSEndDate": displayDate(query.end),
  };
  const response = await postback(jar, landingHtml, "ctl00$PlaceHolderMain$btnNewSearch", overrides);
  let count;
  try {
    count = parseResultCount(response);
  } catch (error) {
    const debugPath = path.join(rawRoot, `failed_${query.start.toISOString().slice(0, 10)}_${query.end.toISOString().slice(0, 10)}_${slug(query.type)}_${sha256(response).slice(0, 12)}.html`);
    fs.mkdirSync(path.dirname(debugPath), { recursive: true });
    fs.writeFileSync(debugPath, response);
    throw new Error(`${error.message} Query: ${query.type} ${displayDate(query.start)}-${displayDate(query.end)}. Debug: ${path.relative(root, debugPath)}`);
  }
  return { html: response, count };
}

async function captureLeaf(jar, firstHtml, expectedCount, query) {
  const sourcePages = [];
  const records = [];
  let html = firstHtml;
  let pageNumber = 1;
  for (;;) {
    sourcePages.push(persistRaw(html, query, pageNumber));
    records.push(...parseRows(html));
    const target = nextTarget(html);
    if (!target) break;
    html = await postback(jar, html, target);
    pageNumber += 1;
    if (pageNumber > 10) throw new Error(`DallasNow exceeded ten pages for an uncapped partition: ${query.type} ${displayDate(query.start)}-${displayDate(query.end)}`);
  }
  if (records.length !== expectedCount) throw new Error(`DallasNow count mismatch for ${query.type} ${displayDate(query.start)}-${displayDate(query.end)}: expected ${expectedCount}, parsed ${records.length}.`);
  return { records, sourcePages, partition: { recordType: query.type, startDate: query.start.toISOString().slice(0, 10), endDate: query.end.toISOString().slice(0, 10), exactRecordCount: expectedCount, pageCount: pageNumber } };
}

async function capturePartition(jar, typeValue, query, audit) {
  const result = await search(jar, typeValue, query);
  audit.queryCount += 1;
  if (result.count !== "100+") return captureLeaf(jar, result.html, result.count, query);
  audit.cappedQueryCount += 1;
  if (query.start.getTime() === query.end.getTime()) throw new Error(`DallasNow single-day partition remains capped at 100+: ${query.type} ${displayDate(query.start)}.`);
  const spanDays = Math.floor((query.end - query.start) / 86400000);
  const leftEnd = addDays(query.start, Math.floor(spanDays / 2));
  const rightStart = addDays(leftEnd, 1);
  const left = await capturePartition(jar, typeValue, { ...query, end: leftEnd }, audit);
  const right = await capturePartition(jar, typeValue, { ...query, start: rightStart }, audit);
  return { records: [...left.records, ...right.records], sourcePages: [...left.sourcePages, ...right.sourcePages], partition: [left.partition, right.partition].flat() };
}

(async () => {
  const start = isoDate(argument("start", "2026-08-01"));
  const end = isoDate(argument("end", "2026-08-24"));
  if (start > end) throw new Error("Start date must not be after end date.");
  const selectedTypes = argument("types", defaultTypes.join("|")).split("|").map((value) => value.trim()).filter(Boolean);
  const jar = new CookieJar();
  const landingHtml = await request(jar, searchUrl);
  const typeOptions = recordTypeOptions(landingHtml);
  const missingTypes = selectedTypes.filter((type) => !typeOptions.has(type));
  if (missingTypes.length) throw new Error(`DallasNow record types not found: ${missingTypes.join(", ")}`);
  const records = [];
  const sourcePages = [];
  const partitions = [];
  const audit = { queryCount: 0, cappedQueryCount: 0 };
  for (const type of selectedTypes) {
    const captured = await capturePartition(jar, typeOptions.get(type), { type, start, end }, audit);
    records.push(...captured.records);
    sourcePages.push(...captured.sourcePages);
    partitions.push(...[captured.partition].flat());
  }
  const identityKeys = records.map((record) => record.recordNumber);
  const duplicateRecordNumbers = identityKeys.length - new Set(identityKeys).size;
  const typeCounts = Object.fromEntries([...records.reduce((counts, record) => counts.set(record.recordType, (counts.get(record.recordType) || 0) + 1), new Map())].sort(([a], [b]) => a.localeCompare(b)));
  const statusCounts = Object.fromEntries([...records.reduce((counts, record) => counts.set(record.status || "unknown", (counts.get(record.status || "unknown") || 0) + 1), new Map())].sort(([a], [b]) => a.localeCompare(b)));
  const combinedSnapshotSha256 = sha256(sourcePages.map((page) => `${page.path}:${page.responseSha256}`).join("\n"));
  const sourceResponseBytes = sourcePages.reduce((sum, page) => sum + page.responseBytes, 0);
  const sourceStoredBytes = sourcePages.reduce((sum, page) => sum + page.storedBytes, 0);
  const artifact = {
    schemaVersion: "wr-dallas-city-building-supply-intelligence-v1",
    generatedAt: new Date().toISOString(),
    sourceAuthority: "City of Dallas Planning and Development",
    sourceSystem: "DallasNow (Accela Citizen Access)",
    sourceUrl: searchUrl,
    sourceScope: "Public City of Dallas Building-module records for selected high-signal construction and occupancy record types",
    query: { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), selectedRecordTypes: selectedTypes },
    jurisdictionBoundary: { geographyLevel: "place", geographyId: "16000US4819000", coverage: "city-of-dallas-building-module-selected-record-types", includesAllDallasCountyMunicipalities: false, includesAllBuildingRecordTypes: false },
    exactSummary: { recordCount: records.length, uniqueRecordNumberCount: new Set(identityKeys).size, duplicateRecordNumberCount: duplicateRecordNumbers, sourcePageCount: sourcePages.length, sourceResponseBytes, sourceStoredBytes, partitionCount: partitions.length, queryCount: audit.queryCount, cappedQueryCount: audit.cappedQueryCount },
    combinedSnapshotSha256,
    typeCounts,
    statusCounts,
    partitions,
    sourcePages,
    records,
    activation: { sourceContentPersisted: true, sourceIdentityUnique: duplicateRecordNumbers === 0, rightsReviewCertified: false, parcelAddressJoinCertified: false, visibleUiActivated: false, lockedUiChanged: false },
    blockers: ["Independent reuse-rights review is not recorded.", "Capture covers selected high-signal Building-module record types rather than every DallasNow record type.", "Record dates represent DallasNow search-record dates and must not be described as permit issuance dates.", "Address normalization and parcel-spatial joins are not certified."],
  };
  fs.mkdirSync(path.dirname(outputJson), { recursive: true });
  fs.writeFileSync(outputJson, `${JSON.stringify(artifact, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, [
    "# City of Dallas Building Supply Intelligence",
    "",
    `Generated: ${artifact.generatedAt}`,
    "",
    `DallasNow public Building records from ${artifact.query.startDate} through ${artifact.query.endDate}. This is a City of Dallas, selected-record-type application/pipeline capture—not a permit-issuance count and not countywide municipal coverage.`,
    "",
    "## Exact capture",
    "",
    `- Records: ${records.length}`,
    `- Unique record numbers: ${artifact.exactSummary.uniqueRecordNumberCount}`,
    `- Duplicate record numbers: ${duplicateRecordNumbers}`,
    `- Selected record types: ${selectedTypes.length}`,
    `- Exact uncapped partitions: ${partitions.length}`,
    `- Persisted source pages: ${sourcePages.length}`,
    `- Search queries: ${audit.queryCount}`,
    `- Broad queries split after a 100+ cap: ${audit.cappedQueryCount}`,
    "",
    "## Record types",
    "",
    ...Object.entries(typeCounts).map(([type, count]) => `- ${type}: ${count}`),
    "",
    "## Activation boundary",
    "",
    "Raw public result pages are persisted with SHA-256 lineage. Rights review and certified parcel linkage remain blocked; no visible UI behavior changed.",
    "",
  ].join("\n"));
  console.log(JSON.stringify({ ...artifact.exactSummary, typeCounts, statusCounts }, null, 2));
})().catch((error) => { console.error(error); process.exit(1); });

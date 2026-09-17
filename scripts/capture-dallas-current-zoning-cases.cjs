const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const serviceUrl = "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/AreasOfRequest/FeatureServer/10";
const parcelManifestFile = path.join(root, "public", "data", "parcels", "manifest.json");
const outputJsonFile = path.join(root, "output", "dallas-current-zoning-case-intelligence.json");
const outputMarkdownFile = path.join(root, "output", "dallas-current-zoning-case-intelligence.md");
const publicRoot = path.join(root, "public", "data", "entitlements");
const parcelIndexDir = path.join(publicRoot, "parcel-index");
const publicCasesFile = path.join(publicRoot, "cases.json");
const publicManifestFile = path.join(publicRoot, "manifest.json");
const rawRoot = path.join(root, "data", "raw", "dallas-county-dcad", "development", "zoning-cases");
const SOURCE_COUNTY_ID = "dallas-county-dcad";
const JURISDICTION_ID = "16000US4819000";
const SHARD_KEY_LENGTH = 2;
const MAX_RECORDS_PER_PAGE = 500;
const GRID_SIZE_DEGREES = 0.02;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

async function fetchSnapshot(url) {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "WhiteRabbit/1.0 official-source-capture" } });
  const body = await response.text();
  if (!response.ok) throw new Error(`Official ArcGIS request failed ${response.status}: ${url}`);
  const json = JSON.parse(body);
  if (json.error) throw new Error(`Official ArcGIS error: ${JSON.stringify(json.error)}`);
  return { url, status: response.status, body, json, bytes: Buffer.byteLength(body), sha256: sha256(body) };
}

function queryUrl(parameters) {
  const url = new URL(`${serviceUrl}/query`);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return url.href;
}

function isoFromEpoch(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? new Date(number).toISOString() : "";
}

function flattenRings(geometry) {
  return Array.isArray(geometry?.rings) ? geometry.rings.filter((ring) => Array.isArray(ring) && ring.length >= 4) : [];
}

function geometrySummary(geometry) {
  const rings = flattenRings(geometry);
  const points = rings.flat();
  if (!points.length || points.some((point) => !Array.isArray(point) || !Number.isFinite(Number(point[0])) || !Number.isFinite(Number(point[1])))) return null;
  const bounds = points.reduce((result, point) => ({
    minLng: Math.min(result.minLng, Number(point[0])),
    minLat: Math.min(result.minLat, Number(point[1])),
    maxLng: Math.max(result.maxLng, Number(point[0])),
    maxLat: Math.max(result.maxLat, Number(point[1])),
  }), { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity });
  return { rings, bounds, centroid: [Number(((bounds.minLng + bounds.maxLng) / 2).toFixed(7)), Number(((bounds.minLat + bounds.maxLat) / 2).toFixed(7))] };
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = Number(ring[i][0]);
    const yi = Number(ring[i][1]);
    const xj = Number(ring[j][0]);
    const yj = Number(ring[j][1]);
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, rings) {
  return rings.reduce((inside, ring) => pointInRing(point, ring) ? !inside : inside, false);
}

function gridKey(lngIndex, latIndex) {
  return `${lngIndex}:${latIndex}`;
}

function gridIndex(value) {
  return Math.floor(Number(value) / GRID_SIZE_DEGREES);
}

function buildCaseGrid(cases) {
  const grid = new Map();
  for (const record of cases) {
    if (!record.geometrySummary) continue;
    const { minLng, minLat, maxLng, maxLat } = record.geometrySummary.bounds;
    for (let x = gridIndex(minLng); x <= gridIndex(maxLng); x += 1) {
      for (let y = gridIndex(minLat); y <= gridIndex(maxLat); y += 1) {
        const key = gridKey(x, y);
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(record);
      }
    }
  }
  return grid;
}

function classifyZoneChange(value) {
  const change = String(value || "").toUpperCase();
  if (/\bNEW\s+SUP\b/.test(change)) return "new-special-use-permit-request";
  if (/\bSUP\b/.test(change) && /AMEND|RENEW|EXPAN|EXTEND/.test(change)) return "special-use-permit-change";
  if (/\bNEW\s+PD\b/.test(change)) return "new-planned-development-request";
  if (/\bPD\b/.test(change) && /AMEND|EXPAN|SUBDIST|TRACT/.test(change)) return "planned-development-change";
  if (/\bSUBDIST/.test(change)) return "subdistrict-change";
  if (/\bGZC\b|\bFROM\b.+\bTO\b/.test(change)) return "general-zoning-change";
  return "other-zoning-case";
}

function publicCase(record) {
  return {
    caseId: record.caseId,
    sourceRecordId: record.sourceRecordId,
    objectId: record.objectId,
    caseNumber: record.caseNumber,
    zoneChange: record.zoneChange,
    category: record.category,
    dateVerified: record.dateVerified,
    dateSemantics: record.dateSemantics,
    bounds: record.bounds,
    centroid: record.centroid,
    parcelLinkCount: record.parcelLinks.length,
    parcelLinkStatus: record.parcelLinks.length ? "centroid-spatial-linked" : "unmatched",
    sourceUrl: record.sourceUrl,
  };
}

async function main() {
  const generatedAt = new Date().toISOString();
  const snapshotId = generatedAt.replace(/[:.]/g, "-");
  const rawDir = path.join(rawRoot, snapshotId);
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(parcelIndexDir, { recursive: true });

  const metadata = await fetchSnapshot(`${serviceUrl}?f=pjson`);
  const count = await fetchSnapshot(queryUrl({ where: "1=1", returnCountOnly: "true", f: "json" }));
  const features = await fetchSnapshot(queryUrl({ where: "1=1", outFields: "*", returnGeometry: "true", outSR: "4326", orderByFields: "OBJECTID ASC", resultRecordCount: String(metadata.json.maxRecordCount || 2000), f: "json" }));
  const snapshots = [
    ["metadata.json", metadata],
    ["count.json", count],
    ["features.json", features],
  ].map(([name, snapshot]) => {
    const file = path.join(rawDir, name);
    fs.writeFileSync(file, snapshot.body);
    return { role: name.replace(".json", ""), path: path.relative(root, file).replace(/\\/g, "/"), url: snapshot.url, status: snapshot.status, bytes: snapshot.bytes, sha256: snapshot.sha256 };
  });

  if (metadata.json.name !== "Current Year Zoning Cases") throw new Error(`Unexpected official layer: ${metadata.json.name}`);
  if (metadata.json.geometryType !== "esriGeometryPolygon") throw new Error(`Unexpected zoning-case geometry: ${metadata.json.geometryType}`);
  if (features.json.exceededTransferLimit === true) throw new Error("Official zoning-case capture exceeded the service transfer limit.");
  if (Number(count.json.count) !== (features.json.features || []).length) throw new Error(`Zoning-case capture count mismatch: ${count.json.count} != ${(features.json.features || []).length}`);

  const objectIds = new Set();
  const caseNumbers = new Set();
  let duplicateObjectIdCount = 0;
  let duplicateCaseNumberCount = 0;
  const cases = (features.json.features || []).map((feature) => {
    const attributes = feature.attributes || {};
    const objectId = Number(attributes.OBJECTID);
    const caseNumber = String(attributes.CASE_NUMBER || "").trim();
    if (!Number.isSafeInteger(objectId)) throw new Error("Zoning-case feature lacks a valid OBJECTID.");
    if (objectIds.has(objectId)) duplicateObjectIdCount += 1;
    objectIds.add(objectId);
    if (caseNumber && caseNumbers.has(caseNumber)) duplicateCaseNumberCount += 1;
    if (caseNumber) caseNumbers.add(caseNumber);
    const summary = geometrySummary(feature.geometry);
    return {
      schemaVersion: "wr-dallas-current-zoning-case-v1",
      sourceCountyId: SOURCE_COUNTY_ID,
      jurisdictionId: JURISDICTION_ID,
      caseId: `dallas-current-zoning-case:${objectId}`,
      sourceRecordId: String(objectId),
      sourceRecordSha256: sha256(canonical(feature)),
      objectId,
      caseNumber,
      zoneChange: String(attributes.ZONE_CHANGE || "").trim(),
      category: classifyZoneChange(attributes.ZONE_CHANGE),
      dateVerified: isoFromEpoch(attributes.DATE_VERIFIED),
      dateSemantics: "City of Dallas ArcGIS DATE_VERIFIED field; not an application, hearing, approval, council, ordinance, or effective-zoning date.",
      sourceUrl: serviceUrl,
      geometrySummary: summary,
      bounds: summary?.bounds || null,
      centroid: summary?.centroid || null,
      sourceFields: attributes,
      parcelLinks: [],
    };
  });
  if (duplicateObjectIdCount) throw new Error(`Duplicate zoning-case OBJECTIDs: ${duplicateObjectIdCount}`);

  const caseGrid = buildCaseGrid(cases);
  const parcelManifestBytes = fs.readFileSync(parcelManifestFile);
  const parcelManifest = JSON.parse(parcelManifestBytes.toString("utf8"));
  const parcelCases = new Map();
  let parcelFeatureCount = 0;
  let parcelFeatureWithCenterCount = 0;
  for (const [chunkIndex, chunkMeta] of parcelManifest.chunks.entries()) {
    const payload = JSON.parse(fs.readFileSync(path.join(path.dirname(parcelManifestFile), chunkMeta.file), "utf8"));
    if ((payload.parcels || []).length !== chunkMeta.count) throw new Error(`Parcel chunk count mismatch: ${chunkMeta.id}`);
    for (const parcel of payload.parcels || []) {
      parcelFeatureCount += 1;
      const accountNum = String(parcel.accountNum || "").trim();
      const center = parcel.liveGeometry?.center;
      if (!accountNum || !Array.isArray(center) || center.length !== 2 || !center.every(Number.isFinite)) continue;
      parcelFeatureWithCenterCount += 1;
      const candidates = caseGrid.get(gridKey(gridIndex(center[0]), gridIndex(center[1]))) || [];
      for (const record of candidates) {
        const bounds = record.geometrySummary.bounds;
        if (center[0] < bounds.minLng || center[0] > bounds.maxLng || center[1] < bounds.minLat || center[1] > bounds.maxLat) continue;
        if (!pointInPolygon(center, record.geometrySummary.rings)) continue;
        if (!record.parcelLinks.some((link) => link.accountNum === accountNum)) record.parcelLinks.push({ accountNum, gisParcelId: String(parcel.gisParcelId || ""), parcelChunkIds: [chunkMeta.id], joinMethod: "parcel-centroid-in-case-polygon" });
        else {
          const link = record.parcelLinks.find((item) => item.accountNum === accountNum);
          if (!link.parcelChunkIds.includes(chunkMeta.id)) link.parcelChunkIds.push(chunkMeta.id);
        }
        if (!parcelCases.has(accountNum)) parcelCases.set(accountNum, new Map());
        parcelCases.get(accountNum).set(record.caseId, { caseId: record.caseId, caseNumber: record.caseNumber, zoneChange: record.zoneChange, category: record.category, dateVerified: record.dateVerified, joinMethod: "parcel-centroid-in-case-polygon" });
      }
    }
    if ((chunkIndex + 1) % 300 === 0) console.log(`Checked ${parcelFeatureCount.toLocaleString("en-US")} parcel features against current zoning cases...`);
  }
  if (parcelFeatureCount !== parcelManifest.featureCount) throw new Error("Parcel population did not reconcile during zoning-case linkage.");
  for (const record of cases) record.parcelLinks.sort((a, b) => a.accountNum.localeCompare(b.accountNum));

  const parcelRecords = [...parcelCases.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([accountNum, linkedCases]) => ({ accountNum, cases: [...linkedCases.values()].sort((a, b) => a.caseId.localeCompare(b.caseId)) }));
  for (const file of fs.readdirSync(parcelIndexDir)) fs.rmSync(path.join(parcelIndexDir, file), { force: true });
  const shardGroups = new Map();
  for (const record of parcelRecords) {
    const key = record.accountNum.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, SHARD_KEY_LENGTH) || "__";
    if (!shardGroups.has(key)) shardGroups.set(key, []);
    shardGroups.get(key).push(record);
  }
  const parcelIndexShards = {};
  let parcelIndexPageCount = 0;
  let maximumParcelIndexPageBytes = 0;
  for (const [key, group] of [...shardGroups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const pages = [];
    for (let offset = 0; offset < group.length; offset += MAX_RECORDS_PER_PAGE) {
      const name = `${key}-${String(pages.length).padStart(4, "0")}.json`;
      const body = `${JSON.stringify({ schemaVersion: "wr-dallas-current-zoning-case-parcel-page-v1", sourceCountyId: SOURCE_COUNTY_ID, records: group.slice(offset, offset + MAX_RECORDS_PER_PAGE) })}\n`;
      fs.writeFileSync(path.join(parcelIndexDir, name), body);
      const bytes = Buffer.byteLength(body);
      pages.push({ file: `parcel-index/${name}`, count: Math.min(MAX_RECORDS_PER_PAGE, group.length - offset), bytes, sha256: sha256(body) });
      parcelIndexPageCount += 1;
      maximumParcelIndexPageBytes = Math.max(maximumParcelIndexPageBytes, bytes);
    }
    parcelIndexShards[key] = { count: group.length, pages };
  }

  const publicCasePayload = `${JSON.stringify({ schemaVersion: "wr-dallas-current-zoning-case-service-records-v1", sourceCountyId: SOURCE_COUNTY_ID, records: cases.map(publicCase) })}\n`;
  fs.mkdirSync(publicRoot, { recursive: true });
  fs.writeFileSync(publicCasesFile, publicCasePayload);
  const publicCases = { path: "cases.json", count: cases.length, bytes: Buffer.byteLength(publicCasePayload), sha256: sha256(publicCasePayload) };

  const exactSummary = {
    sourceRecordCount: cases.length,
    uniqueObjectIdCount: objectIds.size,
    duplicateObjectIdCount,
    recordWithCaseNumberCount: cases.filter((record) => record.caseNumber).length,
    uniqueCaseNumberCount: caseNumbers.size,
    duplicateCaseNumberCount,
    recordWithDateVerifiedCount: cases.filter((record) => record.dateVerified).length,
    recordWithoutDateVerifiedCount: cases.filter((record) => !record.dateVerified).length,
    dateVerifiedBefore2025Count: cases.filter((record) => record.dateVerified && record.dateVerified < "2025-01-01T00:00:00.000Z").length,
    dateVerifiedAfterCaptureCount: cases.filter((record) => record.dateVerified && record.dateVerified > generatedAt).length,
    earliestDateVerified: cases.map((record) => record.dateVerified).filter(Boolean).sort()[0] || "",
    latestDateVerified: cases.map((record) => record.dateVerified).filter(Boolean).sort().at(-1) || "",
    validGeometryCount: cases.filter((record) => record.geometrySummary).length,
    invalidGeometryCount: cases.filter((record) => !record.geometrySummary).length,
    linkedCaseCount: cases.filter((record) => record.parcelLinks.length).length,
    unmatchedCaseCount: cases.filter((record) => !record.parcelLinks.length).length,
    parcelMembershipCount: cases.reduce((sum, record) => sum + record.parcelLinks.length, 0),
    uniqueLinkedParcelCount: parcelRecords.length,
    parcelFeatureCount,
    parcelFeatureWithCenterCount,
    parcelIndexPageCount,
    maximumParcelIndexPageBytes,
  };
  if (exactSummary.linkedCaseCount + exactSummary.unmatchedCaseCount !== exactSummary.sourceRecordCount) throw new Error("Zoning-case link partition failed.");

  const sourceSnapshotSha256 = sha256(snapshots.map((snapshot) => snapshot.sha256).join(""));
  const report = {
    schemaVersion: "wr-dallas-current-zoning-case-intelligence-v1",
    generatedAt,
    sourceCountyId: SOURCE_COUNTY_ID,
    jurisdictionBoundary: { geographyLevel: "place", geographyId: JURISDICTION_ID, name: "City of Dallas", countywide: false },
    sourceAuthority: "City of Dallas Planning and Development",
    sourceSystem: "City of Dallas ArcGIS Current Year Zoning Cases",
    sourceLayerUrl: serviceUrl,
    sourceLayerName: metadata.json.name,
    sourceLayerObjectIdField: metadata.json.objectIdField,
    sourceLayerGeometryType: metadata.json.geometryType,
    sourceLayerLastEditAt: isoFromEpoch(metadata.json.editingInfo?.lastEditDate),
    sourceSnapshotSha256,
    sourceSnapshots: snapshots,
    exactSummary,
    categoryCounts: cases.reduce((counts, record) => ({ ...counts, [record.category]: (counts[record.category] || 0) + 1 }), {}),
    joinContract: {
      version: "wr-dallas-zoning-case-centroid-link-v1",
      sourceGeometry: "Official case polygon requested from ArcGIS with outSR=4326.",
      parcelGeometry: "White Rabbit parcel liveGeometry.center in EPSG:4326.",
      method: "Point-in-polygon containment of parcel center; duplicate parcel account memberships within a case are collapsed while all contributing parcel chunk IDs are retained.",
      limitations: ["Centroid containment is conservative and does not identify parcels touched only at an edge or partial overlap.", "A zoning case is an entitlement record, not proof of approval, effective zoning, financing, construction, or project delivery."],
    },
    activation: {
      sourceSnapshotPersisted: true,
      sourceCountReconciled: true,
      sourceIdentityUnique: duplicateObjectIdCount === 0,
      normalizationCertified: true,
      centroidParcelLinksCertified: true,
      independentReuseRightsCertified: false,
      classificationRulesIndependentlyApproved: false,
      featureGate: "countyZoningCaseMonitoring",
      featureGateEnabled: false,
      publicRuntimeActivated: false,
      pageDesignChanged: false,
      earthImageryChanged: false,
    },
    semantics: {
      candidateRecordsAreSignals: false,
      caseNeverEqualsApproval: true,
      caseNeverEqualsConstruction: true,
      dateVerifiedNeverEqualsApplicationOrApprovalDate: true,
    },
    blockers: ["Independent reuse-rights review is not recorded.", "Entitlement classification rules lack two independent approvals.", "The countyZoningCaseMonitoring feature gate remains off."],
    cases: cases.map((record) => ({ ...record, geometrySummary: record.geometrySummary ? { bounds: record.geometrySummary.bounds, centroid: record.geometrySummary.centroid, ringCount: record.geometrySummary.rings.length } : null })),
  };
  fs.writeFileSync(outputJsonFile, `${JSON.stringify(report, null, 2)}\n`);

  const publicManifest = {
    schemaVersion: "wr-dallas-current-zoning-case-service-v1",
    generatedAt,
    sourceCountyId: SOURCE_COUNTY_ID,
    jurisdictionId: JURISDICTION_ID,
    status: "verified-staged-default-off",
    featureGate: "countyZoningCaseMonitoring",
    featureGateEnabled: false,
    defaultVisible: false,
    publicRuntimeActivated: false,
    sourceSnapshotSha256,
    exactSummary,
    cases: publicCases,
    shardKeyLength: SHARD_KEY_LENGTH,
    maximumRecordsPerPage: MAX_RECORDS_PER_PAGE,
    maximumParcelIndexPageBytes,
    parcelIndexShards,
    runtimePolicy: "Fetch the small case catalog and only parcel-prefix pages required for selected parcels after independent activation; never fetch the full audit report in the browser.",
  };
  fs.writeFileSync(publicManifestFile, `${JSON.stringify(publicManifest, null, 2)}\n`);
  fs.writeFileSync(outputMarkdownFile, [
    "# Dallas Current Zoning-Case Intelligence",
    "",
    `Generated: ${generatedAt}`,
    "",
    `- Official current-year case records: ${exactSummary.sourceRecordCount.toLocaleString("en-US")}`,
    `- Unique OBJECTIDs: ${exactSummary.uniqueObjectIdCount.toLocaleString("en-US")}`,
    `- Valid case polygons: ${exactSummary.validGeometryCount.toLocaleString("en-US")}`,
    `- Cases linked by parcel-centroid containment: ${exactSummary.linkedCaseCount.toLocaleString("en-US")}`,
    `- Cases without a parcel-centroid link: ${exactSummary.unmatchedCaseCount.toLocaleString("en-US")}`,
    `- Unique linked DCAD parcels: ${exactSummary.uniqueLinkedParcelCount.toLocaleString("en-US")}`,
    `- Parcel-to-case memberships: ${exactSummary.parcelMembershipCount.toLocaleString("en-US")}`,
    `- Official layer last edit: ${report.sourceLayerLastEditAt || "not published"}`,
    `- Records with DATE_VERIFIED: ${exactSummary.recordWithDateVerifiedCount.toLocaleString("en-US")}`,
    `- DATE_VERIFIED values before 2025: ${exactSummary.dateVerifiedBefore2025Count.toLocaleString("en-US")}`,
    "",
    "DATE_VERIFIED is preserved as the publisher's field and is not described as an application, hearing, approval, council, ordinance, or effective-zoning date.",
    "",
    "A zoning case is entitlement evidence only—not proof of approval, effective zoning, financing, construction, or delivery.",
    "",
    "The service remains default-off pending reuse-rights review, independent classification approval, and feature-gate activation. The approved White Rabbit UI and Earth imagery were not changed.",
    "",
  ].join("\n"));
  console.log(`Wrote ${outputJsonFile}`);
  console.log(`Wrote ${outputMarkdownFile}`);
  console.log(`Wrote ${publicManifestFile}`);
  console.log(JSON.stringify({ sourceLayerLastEditAt: report.sourceLayerLastEditAt, exactSummary, categoryCounts: report.categoryCounts }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

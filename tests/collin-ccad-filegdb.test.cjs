const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const reportPath = path.join(root, "output", "collin-county-tx", "ccad-filegdb-report.json");
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(report.status === "geometry-and-intelligence-aligned-awaiting-service-rebuild-and-qc", "FileGDB refresh must remain activation gated");
assert(report.activationAuthorized === false, "FileGDB refresh must not silently activate the UI");
assert(report.source.format === "Esri File Geodatabase", "Supplied archive must be identified accurately");
assert(report.geometry.featureCount === 441278, "FileGDB parcel feature count must remain exact");
assert(report.geometry.geometryType === "MultiPolygon", "CCAD geometry type must remain MultiPolygon");
assert(report.geometry.crs === "EPSG:2276", "CCAD CRS must remain EPSG:2276");
assert(report.geometry.nullGeometryCount === 1, "Null geometry count must remain explicit");
assert(report.schema.normalizedFieldSetsMatch === true, "FileGDB and CSV normalized schemas must match");
assert(report.reconciliation.gdbGlobalIdDistinct === 441278, "Every FileGDB parcel must have a distinct GlobalID");
assert(report.reconciliation.gdbGlobalIdDuplicates === 0, "FileGDB GlobalID must be duplicate-safe within the refresh");
assert(report.reconciliation.globalIdOverlap === 441278, "Every geometry must match the staged CCAD intelligence refresh");
assert(report.reconciliation.csvOnlyGlobalIds === 0 && report.reconciliation.gdbOnlyGlobalIds === 0, "Geometry and intelligence ID sets must reconcile exactly");
assert(report.reconciliation.rowOrderGlobalIdMatches === 441278, "Geometry and intelligence exports must preserve row identity");
assert(report.activationGate.includes("Rebuild the viewport parcel service"), "Visible activation must require a same-refresh service rebuild");

console.log("Collin CCAD File Geodatabase audit tests passed.");

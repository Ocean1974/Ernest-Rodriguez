const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const shapefile = require("shapefile");

const projectRoot = path.join(__dirname, "..");
const captureRoot = path.join(projectRoot, "data", "raw", "aransas-county-tx", "public-gis-2026-09-12");
const derivedRoot = path.join(captureRoot, "derived");
const envelope = [-97.35, 27.75, -96.85, 28.35];

function hashFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
}

function fileEvidence(relativePath) {
  const file = path.join(captureRoot, relativePath);
  return {
    file: relativePath.replaceAll("\\", "/"),
    bytes: fs.statSync(file).size,
    sha256: hashFile(file),
  };
}

async function readShapefile(relativePath) {
  const source = await shapefile.open(path.join(captureRoot, relativePath));
  const features = [];
  while (true) {
    const item = await source.read();
    if (item.done) return features;
    features.push(item.value);
  }
}

function writeGeojson(name, features) {
  const file = path.join(derivedRoot, name);
  fs.writeFileSync(file, `${JSON.stringify({ type: "FeatureCollection", features })}\n`);
  return fileEvidence(path.join("derived", name));
}

async function main() {
  fs.mkdirSync(derivedRoot, { recursive: true });

  const roads = await readShapefile(path.join("tl_2025_48007_roads", "tl_2025_48007_roads.shp"));
  const places = await readShapefile(path.join("tl_2025_48_place", "tl_2025_48_place.shp"));
  const counties = await readShapefile(path.join("tl_2025_us_county", "tl_2025_us_county.shp"));
  const municipalities = places.filter((feature) =>
    ["4803600", "4827888", "4862804"].includes(feature.properties.GEOID)
  );
  const aransasBoundary = counties.filter((feature) => feature.properties.GEOID === "48007");

  if (aransasBoundary.length !== 1) throw new Error(`Expected one Aransas County boundary; found ${aransasBoundary.length}`);
  if (municipalities.length !== 3) throw new Error(`Expected three Aransas-area Census places; found ${municipalities.length}`);

  const femaPages = fs.readdirSync(captureRoot)
    .filter((name) => /^fema-nfhl-flood-hazard-zones-page-\d{4}\.esri\.json$/.test(name))
    .sort();
  const femaObjectIds = new Set();
  let femaFeatureCount = 0;
  for (const page of femaPages) {
    const document = JSON.parse(fs.readFileSync(path.join(captureRoot, page), "utf8"));
    if (document.error) throw new Error(`${page}: ${document.error.message}`);
    for (const feature of document.features) {
      femaFeatureCount += 1;
      femaObjectIds.add(feature.attributes.OBJECTID);
    }
  }
  if (femaFeatureCount !== femaObjectIds.size) throw new Error("FEMA pages contain duplicate OBJECTIDs");

  const schoolDistricts = JSON.parse(
    fs.readFileSync(path.join(captureRoot, "census-tigerweb-bas-2026-unified-school-districts-aransas-envelope.geojson"), "utf8")
  );
  const politicalJurisdictions = JSON.parse(
    fs.readFileSync(path.join(captureRoot, "fema-nfhl-political-jurisdictions-aransas-envelope.geojson"), "utf8")
  );

  const outputs = {
    countyBoundary: writeGeojson("aransas-county-boundary.geojson", aransasBoundary),
    municipalities: writeGeojson("aransas-area-census-places.geojson", municipalities),
    roads: writeGeojson("aransas-county-roads.geojson", roads),
  };

  const sourceFiles = [
    "tl_2025_48007_roads.zip",
    "tl_2025_48_place.zip",
    "tl_2025_us_county.zip",
    "fema-nfhl-service-metadata.json",
    "fema-nfhl-layer-28-metadata.json",
    "fema-nfhl-political-jurisdictions-aransas-envelope.geojson",
    "census-tigerweb-bas-2026-unified-school-districts-aransas-envelope.geojson",
    ...femaPages,
  ].map(fileEvidence);

  const manifest = {
    schemaVersion: "real-estate-savant-public-gis-capture-v1",
    countyId: "aransas-county-tx",
    countyFips: "48007",
    capturedAt: "2026-09-12",
    activationAuthorized: false,
    captureEnvelopeWgs84: envelope,
    sources: {
      censusTigerLine2025: "https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html",
      censusTigerwebSchoolBas2026: "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/School/MapServer/5",
      femaNfhl: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer",
      bisInteractiveMap: "https://gis.bisclient.com/aransascad/",
    },
    counts: {
      aransasCountyBoundaryFeatures: aransasBoundary.length,
      aransasCountyRoadFeatures: roads.length,
      aransasAreaCensusPlaceFeatures: municipalities.length,
      schoolDistrictEnvelopeFeatures: schoolDistricts.features.length,
      femaPoliticalJurisdictionEnvelopeFeatures: politicalJurisdictions.features.length,
      femaFloodHazardEnvelopeFeatures: femaFeatureCount,
      femaFloodHazardUniqueObjectIds: femaObjectIds.size,
      femaFloodHazardPages: femaPages.length,
    },
    selection: {
      countyBoundary: "TIGER/Line GEOID = 48007",
      roads: "TIGER/Line county file tl_2025_48007_roads",
      municipalities: "TIGER/Line place GEOIDs 4803600 (Aransas Pass), 4827888 (Fulton), and 4862804 (Rockport)",
      femaAndSchools: "Envelope intersection only; exact county clipping is still required before parcel joins or production publication.",
    },
    rights: {
      publicFederalLayers: "captured from official Census and FEMA endpoints",
      bisHostedLayers: "not copied; viewer notice requires consent from the respective data owner",
      eagleViewImagery: "not copied; license and storage scope are unresolved",
    },
    remainingBlockers: [
      "written consent or an approved bulk license for BIS-hosted parcel, abstract, subdivision, lot-line, neighborhood, and imagery layers",
      "authoritative parcel geometry-to-certified-roll join key",
      "exact county clipping for FEMA and school-district envelope captures",
      "Rockport zoning vectors and county/municipal permit feeds",
      "viewport artifacts, search shards, QC, and release evidence",
    ],
    sourceFiles,
    outputs,
  };

  fs.writeFileSync(path.join(captureRoot, "capture-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest.counts, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

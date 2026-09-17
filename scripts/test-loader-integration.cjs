const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const loaderFile = path.join(root, "src", "map", "loadParcels.ts");
const appFile = path.join(root, "src", "App.tsx");
const activeAppFile = path.join(root, "src", "App.tsx");
const manifestFile = path.join(root, "src", "data", "parcelAccessManifest.json");
const parcelServiceManifestFile = path.join(root, "public", "data", "parcels", "manifest.json");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadTypescriptModule(file) {
  const source = fs.readFileSync(file, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (request) => {
    if (request.startsWith(".")) return loadTypescriptModule(path.join(path.dirname(file), `${request}.ts`));
    return require(request);
  };
  const context = vm.createContext({ module, exports: module.exports, require: localRequire, console });
  vm.runInContext(transpiled, context, { filename: file });
  return module.exports;
}

const loader = loadTypescriptModule(loaderFile);
const parcels = [
  {
    accountNum: "008052000B01A0000",
    gisParcelId: "008052000B01A0000",
    address: "10300 SANDEN DR",
    ownerName: "SANDEN INTERNATIONAL USA INC",
    ownerMailingAddress: "10300 SANDEN DR",
    blockId: "B/8052",
    buildingClass: "STORAGE WAREHOUSE",
    totalValue: 40624920,
    points: [
      [88, 9],
      [91, 9],
      [91, 13],
      [88, 13],
    ],
  },
  {
    accountNum: "00000155887000000",
    gisParcelId: "00000155887000000",
    address: "1616 GREENVILLE AVE",
    ownerName: "GREENVILLE RETAIL OWNER LLC",
    businessName: "GREENVILLE RETAIL HOLDINGS",
    blockId: "K/1477",
    buildingClass: "RETAIL",
    totalValue: 1716000,
    points: [
      [10, 88],
      [16, 88],
      [16, 92],
      [10, 92],
    ],
  },
];

const visible = loader.filterParcelRecordsForViewport(parcels, {
  bounds: { minX: 87, minY: 8, maxX: 92, maxY: 14 },
});
assert(visible.length === 1, "viewport loader should return only parcels in bounds");
assert(visible[0].address === "10300 SANDEN DR", "viewport loader returned the wrong parcel");

assert(loader.searchParcelRecords(parcels, "10300 SANDEN").length === 1, "search should find known address");
assert(loader.searchParcelRecords(parcels, "10300 SANDEN DR")[0].accountNum === "008052000B01A0000", "search should rank exact address matches first");
assert(loader.searchParcelRecords(parcels, "008052000B01A0000").length === 1, "search should find account number");
assert(loader.searchParcelRecords(parcels, "8052000B01A").length === 1, "search should find close parcel ID fragments");
assert(loader.searchParcelRecords(parcels, "008052000B01A000").length === 1, "search should find near parcel ID matches");
assert(loader.searchParcelRecords(parcels, "SANDEN INTERNATIONAL")[0].accountNum === "008052000B01A0000", "search should rank owner name matches");
assert(loader.searchParcelRecords(parcels, "GREENVILLE RETAIL OWNER")[0].accountNum === "00000155887000000", "search should find owner names");
assert(loader.searchParcelRecords(parcels, "GREENVILLE RETAIL HOLDINGS")[0].accountNum === "00000155887000000", "search should find business names");
assert(loader.searchParcelRecords(parcels, "B/8052").length === 1, "search should find block ID");
assert(loader.searchParcelRecords(parcels, "STORAGE WAREHOUSE").length === 1, "search should find building class");
assert(loader.searchParcelRecords(parcels, "40624920").length === 1, "search should find value fields");
const countyStamped = loader.searchParcelRecords(
  [
    {
      sourceCountyId: "dallas-county-dcad",
      countyParcelId: "dallas-county-dcad:008052000B01A0000",
      accountNum: "008052000B01A0000",
      address: "10300 SANDEN DR",
      points: [
        [88, 9],
        [91, 9],
        [91, 13],
        [88, 13],
      ],
    },
  ],
  "dallas-county-dcad:008052000B01A0000",
);
assert(countyStamped.length === 1, "search should find county-aware parcel IDs");
assert(loader.countyAwareParcelId(countyStamped[0]) === "dallas-county-dcad:008052000B01A0000", "loader should preserve county-aware parcel IDs");

const loaderSource = fs.readFileSync(loaderFile, "utf8");
assert(loaderSource.includes("sortChunksByViewportCenter"), "parcel viewport loader must sort chunks around the visible map center");
assert(loaderSource.includes("recordDistanceToPoint"), "parcel viewport loader must prioritize records around the visible map center");
assert(loaderSource.includes("distributeRecordsAcrossViewport"), "parcel viewport loader must spread loaded parcels across the whole visible map");
assert(loaderSource.includes("searchShardKeysForQuery") && loaderSource.includes("loadParcelSearchShard"), "parcel search must load prefix shards instead of one full search index");
assert(loaderSource.includes("MAX_CONCURRENT_SEARCH_CHUNK_LOADS = 8") && loaderSource.includes("Promise.all(batch.map"), "parcel search must hydrate result chunks with bounded concurrency instead of serial requests");
assert(loaderSource.includes("MAX_CONCURRENT_VIEWPORT_CHUNK_LOADS = 4"), "viewport tiles must load with bounded parallelism");
assert(loaderSource.includes("MAX_CACHED_PARCEL_CHUNKS = 96") && loaderSource.includes("MAX_CACHED_SEARCH_SHARDS = 48"), "parcel and search caches must stay memory bounded during nationwide roaming");
assert(loaderSource.includes("countyAwareParcelId") && loaderSource.includes("sourceCountyId"), "parcel loader must preserve county-aware parcel identity");
assert(loaderSource.includes("const columns = 12") && loaderSource.includes("const rows = 8"), "parcel viewport loader must use screen-wide distribution buckets");

const appSource = fs.readFileSync(appFile, "utf8");
const activeAppSource = fs.readFileSync(activeAppFile, "utf8");
assert(appSource.includes("filterParcelRecordsForViewport"), "App is not using the viewport loader");
assert(appSource.includes("searchParcelRecords"), "App is not using the parcel search loader");
assert(appSource.includes("loadParcelRecordsForViewport"), "App is not loading live parcels from the full parcel service");
assert(appSource.includes("searchFullParcelRecords"), "App search is not connected to the full parcel service");
assert(activeAppSource.includes("const submitParcelSearch = () =>") && activeAppSource.includes("searchFullParcelRecords(query, SEARCH_RESULT_LOOKUP_LIMIT, activeParcelDataset)"), "Search submit must run a county-aware full parcel lookup before jumping to a parcel");
assert(activeAppSource.includes("activeCountyDataset.map.geoBounds"), "Active map bounds must come from the county config");
assert(activeAppSource.includes("sourceCountyId: activeCountyDataset.id"), "Active map location must carry the active county id");
assert(activeAppSource.includes("setLoadedSearchQuery(sourceQuery)"), "Search submit must mark the complete submitted search, including HBU intent, as the active query for parcel-card selection");
assert(activeAppSource.includes("initialSearchSubmittedRef") && activeAppSource.includes("Real Estate Savant initial parcel search failed."), "Landing search handoff must run a full parcel lookup on page two");
assert(activeAppSource.includes("loadedSearchQuery === currentSearchQuery"), "Search results must not fall back to the Sanden sample fixture while full search is loading or empty");
assert(activeAppSource.includes("useDeferredValue(searchText)"), "Search input should defer expensive parcel-result plumbing so typing stays responsive");
assert(activeAppSource.includes("SEARCH_TYPEAHEAD_DEBOUNCE_MS"), "Search input should debounce parcel-result plumbing while typing");
assert(activeAppSource.includes("SEARCH_MIN_TYPEAHEAD_CHARS"), "Search input should avoid full parcel lookups on very short partial queries");
assert(activeAppSource.includes("debouncedSearchText") && activeAppSource.includes("setDebouncedSearchText"), "Search results should use a debounced lookup value separate from the visible input");
assert(activeAppSource.includes("nextSearchText.length < SEARCH_MIN_TYPEAHEAD_CHARS"), "Type-ahead search should wait until the query is long enough");
assert(activeAppSource.includes("submittedSearchQueryRef"), "Submitted searches should not double-fetch after the debounced value updates");
assert(activeAppSource.includes("const SEARCH_RESULT_LOOKUP_LIMIT = 40"), "Search result lookup limit should stay capped for responsive parcel search");
assert(activeAppSource.includes("searchFullParcelRecords(searchTerm, SEARCH_RESULT_LOOKUP_LIMIT, activeParcelDataset)"), "Type-ahead parcel search should stay capped and county-aware so typing does not hydrate excessive parcel records");
assert(activeAppSource.includes("findPlaceTarget(query)") && activeAppSource.includes("moveToPlaceTarget(placeTarget)"), "Search must route supported place names like Louisville KY before parcel lookup");
assert(activeAppSource.includes("LOUISVILLE_PILOT_LOCATION"), "Louisville KY pilot target must be available for no-button map navigation");
assert(!activeAppSource.includes("setLoadedSearchResults(searchDallasParcels"), "Full search failures must not populate search results from fallback sample fixtures");
assert(activeAppSource.includes("isExactParcelAddressMatch") && activeAppSource.includes("autoSelectedSearchQueryRef"), "Exact typed address searches must auto-select the matching parcel card");
assert(activeAppSource.includes('aria-label="Search results"') && activeAppSource.includes("overflow-y-auto") && activeAppSource.includes("searchResults.map((parcel)"), "Search results should render all loaded parcel options in a scrollable panel");
assert(appSource.includes("fallbackDallasParcels"), "Prototype parcel arrays are not isolated as fallback fixtures");
assert(!appSource.includes("const allDallasParcels = useMemo(() => getDallasRenderableParcels(), [])"), "App still uses the 4 prototype parcels as the live source");
assert(appSource.includes("export default function WhiteRabbitLanding"), "Approved landing page component is missing");
assert(appSource.includes("Explore the Market from Above"), "Approved landing page copy changed or disappeared");
assert(appSource.includes("<span>Enter Map</span>"), "Approved Enter Map landing action changed or disappeared");
assert(appSource.includes("parcelAccessManifest"), "App is not connected to the parcel access manifest");
assert(activeAppSource.includes("ownerMailingAddress") && activeAppSource.includes("ownerPhone") && activeAppSource.includes("ownerEmail"), "Active parcel window is not wired for owner contact fields");
assert(activeAppSource.includes("Permit contractors/applicants are not treated as property owners"), "Active parcel window does not protect owner contacts from permit contractor data");
assert(activeAppSource.includes("permit-party record") && activeAppSource.includes("kept separate"), "Permit parties are not clearly separated from owner contact enrichment");
assert(fs.readFileSync(path.join(root, "scripts", "build-white-rabbit-dallas-parcels.cjs"), "utf8").includes("OWNER_ADDRESS_LINE1"), "Parcel build does not preserve DCAD owner mailing fields");
assert(fs.readFileSync(path.join(root, "scripts", "build-app-parcel-service.cjs"), "utf8").includes("ownerMailingAddress"), "Parcel service build does not expose owner mailing fields to the app");
assert(fs.readFileSync(path.join(root, "scripts", "build-app-parcel-service.cjs"), "utf8").includes("ownerName2") && fs.readFileSync(path.join(root, "scripts", "build-app-parcel-service.cjs"), "utf8").includes("businessName"), "Parcel search index does not expose owner/name fields to the app");
assert(appSource.includes("maplibregl.Map"), "Dallas live map is not using MapLibre GL JS");
assert(!appSource.includes('import L from "leaflet"'), "Dallas live map still imports Leaflet as the map engine");
assert(appSource.includes("World_Imagery/MapServer/tile"), "Dallas live map is not using an aerial/satellite basemap");
assert(appSource.includes('const isDallasParcelMode = !earthIntroActive && mapMode === "parcel"'), "Dallas tile basemap is not limited to explicit parcel mode");
assert(appSource.includes("const baseTiles = isDallasParcelMode ? getDallasTileGrid() : []"), "Dallas tile grid is not restored for parcel mode");
assert(appSource.includes("const dallasTileBlend = isDallasParcelMode ? clamp((safeCamera.zoom - 0.88) / 0.48, 0, 1) : 0"), "Dallas tile opacity does not use the approved parcel-mode blend");
assert(appSource.includes("const earthOpacity = isDallasParcelMode ? clamp(1 - dallasTileBlend * 0.86, 0.14, 1) : 1"), "Earth imagery does not dominate Earth mode and fade during Dallas transition");
assert(appSource.includes("const tileOpacity = dallasTileBlend * 0.92"), "Dallas tile opacity is not blended in during transition/final parcel mode");
assert(appSource.includes('data-dallas-tiles-active={isDallasParcelMode ? "true" : "false"}'), "Dallas tile layer does not expose parcel-mode proof metadata");
assert(appSource.includes("<LiveTileMapBackground mapCamera={mapCamera} earthIntroActive={earthIntroActive} mapMode={mapMode} />"), "Synthetic map scene does not pass map mode into the Dallas tile background");
assert(appSource.includes('data-basemap="esri-world-imagery"'), "Dallas live map does not expose aerial basemap proof metadata");
assert(appSource.includes('data-map-engine="maplibre"'), "Dallas live map does not expose MapLibre proof metadata");
assert(appSource.includes('data-parcel-source="full-viewport-loader"'), "Dallas live map does not expose full parcel loader proof metadata");
assert(appSource.includes('"wr-parcels"'), "Dallas live map does not define a parcel overlay source");
assert(appSource.includes("buildParcelMapFeatureCollection"), "Dallas live map is not adapting loaded parcels into a map source");
assert(activeAppSource.includes("loadDevelopmentRecordsForParcels"), "Active map does not load viewport-bounded development parcel shards");
assert(activeAppSource.includes("searchDevelopmentRecords"), "Active search does not load bounded development search shards");
assert(!activeAppSource.includes("/data/developments/parcel-development-index.json"), "Active map must not load the monolithic development audit index");
assert(activeAppSource.includes("hasDevelopment") && activeAppSource.includes("rgba(34,197,94,0.46)"), "Development parcels are not highlighted green in the active parcel layer");
assert(appSource.includes("liveMapBounds"), "Dallas live map is not driving viewport loading from live map bounds");
assert(appSource.includes("const PARCEL_ZOOM_THRESHOLDS"), "Parcel zoom thresholds are not defined");
assert(appSource.includes("block: 1.12"), "Block-level parcel threshold is missing");
assert(appSource.includes("parcel: 1.42"), "Individual parcel threshold is missing");
assert(appSource.includes("detail: 1.62"), "Detail/dimension threshold is missing");
assert(appSource.includes("function getParcelRenderProfile"), "Zoom-sensitive parcel render profile is missing");
assert(activeAppSource.includes("stage: \"broad\"") && activeAppSource.includes("maxFeatures: 1200"), "Broad parcel context profile is missing");
assert(activeAppSource.includes("stage: \"block\"") && activeAppSource.includes("maxFeatures: 3600"), "Block-level parcel profile is missing");
assert(activeAppSource.includes("stage: \"parcel\"") && activeAppSource.includes("maxFeatures: 7200"), "Individual parcel profile is missing");
assert(activeAppSource.includes("stage: \"detail\"") && activeAppSource.includes("maxFeatures: 10000"), "Detail parcel profile is missing");
assert(appSource.includes('"wr-block-labels"'), "Block label layer is missing");
assert(appSource.includes('"wr-parcel-labels"'), "Parcel label layer is missing");
assert(appSource.includes('"wr-dimension-labels"'), "Dimension label layer is missing");
assert(appSource.includes("minzoom: 10.95"), "Block labels do not have a mid-zoom threshold");
assert(appSource.includes("minzoom: 12.35"), "Parcel labels do not have a close-zoom threshold");
assert(appSource.includes("minzoom: 13.3"), "Dimension labels do not have a very-close zoom threshold");
assert(appSource.includes("parcelRenderProfile.maxFeatures"), "Viewport loading is not driven by zoom-sensitive parcel profile");
assert(appSource.includes("showDimensions && parcelRenderProfile?.showDimensions"), "Dimension labels are not gated by detail zoom");
assert(appSource.includes("EARTH_INTRO_CAMERA"), "Live map does not define a stable manual Earth intro camera");
assert(appSource.includes('useState("earth")'), "Live map should start in Earth mode before explicit parcel entry");
assert(appSource.includes("useState(true)"), "Live map should enter with Earth intro active");
assert(!appSource.includes('data-intro-layer="manual-earth-view"'), "Earth intro overlay should not cover the live globe");
assert(!appSource.includes('filter: earthIntroActive ? "blur(1px)" : "blur(0)"'), "Hidden parcel map should not blur over the live globe");
assert(!appSource.includes("autoDallasZoomStartedRef"), "Enter Map still contains an automatic Dallas zoom guard");
assert(!appSource.includes("enterDallasParcelMode({ auto: true })"), "Enter Map still automatically triggers Dallas parcel mode");
assert(!appSource.includes("dallasTransitionActive"), "Live map still has autonomous Dallas transition state");
assert(!appSource.includes("setDallasTransitionActive"), "Live map still toggles autonomous Dallas transition state");
assert(appSource.includes('function WhiteRabbitMap({ onExit, initialSearch = "", preserveLandingEarth = false, onOpenMarketplace, onOpenCrm })'), "WhiteRabbitMap does not declare a safe Earth-first map shell with marketplace and CRM navigation");
assert(appSource.includes("<WhiteRabbitMap") && appSource.includes("initialSearch={landingSearch}") && appSource.includes("onExit={() => setEnteredMap(false)}"), "WhiteRabbitLanding does not open WhiteRabbitMap from the approved Enter Map handoff");
assert(appSource.includes("onSubmit={() => setEnteredMap(true)}"), "Landing search submit must open the live map without auto-entering Dallas parcel mode");
assert(appSource.includes("<button onClick={() => setEnteredMap(true)}"), "Enter Map must open the live map without redesigning the landing page");
assert(appSource.includes("landingEarthOverlayVisible"), "WhiteRabbitMap must keep support for preserved Earth-image handoff state");
assert(appSource.includes('data-landing-earth-preserved="true"'), "WhiteRabbitMap must expose proof that the landing Earth image can be preserved during handoff");
assert(!appSource.includes("initialMapMode"), "Live map should not carry stale initialMapMode transition plumbing");
assert(!appSource.includes("setInitialMapMode"), "Landing page should not carry stale initial map mode state");
assert(!appSource.includes("isEarthInteractive"), "Landing page should not carry stale interactive Earth gate state");
assert(!appSource.includes("beginDallasParcelZoomFromLanding"), "Landing page should not carry stale wheel-triggered Dallas transition code");
assert(!appSource.includes("isTransitioningToDallas"), "Failed landing transition state was not removed");
assert(!appSource.includes("transitionProgress"), "Failed landing transition progress state was not removed");
assert(!appSource.includes("startDallasParcelTransition"), "Failed staged Dallas transition function was not removed");
assert(!appSource.includes("data-transition-earth-overlay"), "Failed landing image transition overlay was not removed");
assert(appSource.includes("<WhiteRabbitMap") && appSource.includes("initialSearch={landingSearch}") && appSource.includes("onExit={() => setEnteredMap(false)}"), "WhiteRabbitLanding does not open WhiteRabbitMap with the approved search handoff");
assert(appSource.includes('onOpenMarketplace={(listingKind = "cre") => {') && appSource.includes("setActiveListingPage(listingKind)"), "WhiteRabbitMap must be able to open listing pages from the interactive globe");
assert(appSource.includes("earthIntroActive={earthIntroActive}"), "Earth-first intro state is not passed to the live map scene");
assert(appSource.includes('{mapMode === "parcel" ? "Value View" : "Parcel View"}'), "Live map does not expose an explicit parcel-entry action");
assert(appSource.includes("const enterDallasParcelMode = ({ clearSelection = true, focusGlobe = true } = {}) =>"), "Dallas parcel mode is not isolated behind one explicit action handler");
assert(appSource.includes("const parcelCamera = getParcelViewCamera()"), "Explicit parcel entry camera does not use the Dallas parcel camera preset");
assert(appSource.includes('setMapMode("parcel")'), "Explicit parcel entry does not force parcel mode");
assert(appSource.includes("setSelected(DALLAS_LOCATION)"), "Explicit parcel entry does not force Dallas as the selected location");
assert(appSource.includes("setMapCamera(parcelCamera)"), "Explicit parcel entry does not set the Dallas parcel camera");
assert(appSource.includes("setEarthIntroActive(false)"), "Explicit parcel entry does not leave Earth intro after user action");
assert(appSource.includes("setLiveMapBounds(getViewportBounds(parcelCamera))"), "Explicit parcel entry does not force the Dallas viewport bounds for visible parcels");
assert(appSource.includes("setShowParcelLabels(true)"), "Explicit parcel entry does not force parcel labels on");
assert(appSource.includes("setShowGrid(true)"), "Explicit parcel entry does not force parcel boundaries/grid on");
assert(!appSource.includes("setShowDimensions(true)"), "Explicit parcel entry should preserve the existing dimensions setting");
assert(appSource.includes('onClick={mapMode === "parcel" ? onValueView : onParcelView}'), "TopBar Parcel View action is not wired to explicit Dallas parcel entry");
assert(appSource.includes("onParcelView={enterDallasParcelMode}"), "WhiteRabbitMap does not pass the Dallas parcel entry function to TopBar");
assert(appSource.includes("globeLandingMode") && appSource.includes("CRE Listings") && appSource.includes("Resi Listings") && appSource.includes("Rentals"), "Interactive globe landing header does not mirror the three listing links");
assert(appSource.includes("{!earthIntroActive && (\n        <CompactMapControls"), "Map controls should not show on the interactive globe landing page");
assert(appSource.includes("onParcelSelect={jumpToParcel}"), "Synthetic parcel scene is not wired to the current parcel selection handler");
assert(appSource.includes('map.on("click", "wr-parcels-fill", (event) => {'), "MapLibre parcel-layer click handler is not wired");
assert(appSource.includes('map.queryRenderedFeatures(queryPoint, { layers: ["wr-parcels-fill"] })'), "MapLibre parcel click detection does not query parcel fills");
assert(appSource.includes("function parcelPopupSourceLabel") && appSource.includes('return "Jefferson County Parcel"'), "MapLibre parcel popup source labels must be county-aware");
assert(appSource.includes("function parcelPopupPrimaryId"), "MapLibre parcel popup must use parcel IDs as the first visible intelligence");
assert(appSource.includes('data-parcel-roving-popup="true"'), "MapLibre parcel popup must identify the roving parcel intelligence window");
assert(appSource.includes('parcelPopupRow("GIS ID"'), "MapLibre parcel popup must include GIS parcel IDs when present");
assert(appSource.includes('parcelPopupRow("Intel"'), "MapLibre parcel popup must summarize available parcel intelligence");
assert(appSource.includes("rovingPopupParcelKey"), "MapLibre parcel popup must cache popup content while following the cursor");
assert(appSource.includes("parcelPopup.setLngLat(lngLat)"), "MapLibre parcel popup must move with the cursor");
assert(appSource.includes("popupElement.dataset.parcelId"), "MapLibre parcel popup must expose active parcel id metadata");
assert(appSource.includes('addEventListener("pointermove", handleMapSurfacePointerMove, true)'), "MapLibre parcel hover must include the map-surface geometry fallback");
assert(appSource.includes('addEventListener("click", handleMapSurfaceClick, true)'), "MapLibre parcel click detection must include the map-surface geometry fallback");
assert(appSource.includes("findParcelAtLngLat"), "MapLibre parcel interactions must resolve DCAD geometry when rendered feature picking misses");
assert(appSource.includes("map.doubleClickZoom.disable();"), "MapLibre parcel click detection must reserve double-click for parcel selection");
assert(appSource.includes('popupElement.style.pointerEvents = "none"'), "MapLibre parcel popup must not block the parcel beneath it");
assert(appSource.includes("const mapParcelSelectionOptions = { focusCamera: false }"), "MapLibre parcel selection must not move the map camera");
assert(appSource.includes("const selectionOptions = { ...mapParcelSelectionOptions, ...options }"), "MapLibre parcel selection must preserve the no-camera-move default");
assert(!appSource.includes("queueHoverInfoWindow"), "MapLibre parcel selection must not depend on Jefferson-only hover behavior");
assert(appSource.includes("focusSelectedParcel = true"), "MapLibre selected parcel focus must be enabled by default");
assert(appSource.includes("if (!focusSelectedParcel)"), "MapLibre selected parcel focus must be skippable for map-selected cards");
assert(appSource.includes("} else if (focusCamera) {\n      enterDallasParcelMode({ clearSelection: false, focusGlobe: false });"), "Dallas map-selected parcels must not reset the camera when focusCamera is false");
assert(appSource.includes("getVisibleDallasParcels(mapCamera)"), "Fallback visible parcels are not populated from the Dallas camera");
assert(appSource.includes("mapApiRef.current?.flyToCamera?.(parcelCamera)"), "Explicit parcel entry does not hand the camera to Dallas after user action");
assert(!appSource.includes("if (earthIntroActive || !initialSearch.trim() || globalSearchResults.length === 0) return"), "Initial search still contains autonomous Dallas parcel entry logic");
assert(appSource.includes("applyCursorDragToCamera"), "Cursor drag navigation helper is missing");
assert(appSource.includes('mode === "earth-spin"'), "Normal Earth drag spin mode is not implemented");
assert(appSource.includes('mode === "tilt-strong"'), "Shift-drag stronger Earth tilt mode is not implemented");
assert(appSource.includes('mode === "tilt"'), "Shift-drag tilt mode is not implemented");
assert(appSource.includes('mode === "orbit"'), "Alt/Option-drag orbit mode is not implemented");
assert(appSource.includes("getDragNavigationMode"), "Modifier-key drag mode detection is missing");
assert(appSource.includes("event.altKey"), "Alt/Option drag is not detected");
assert(appSource.includes("event.shiftKey"), "Shift drag is not detected");
assert(appSource.includes("setPointerCapture"), "Drag interaction does not capture the pointer for smooth movement");
assert(appSource.includes("dragStateRef"), "Earth drag does not track pointer velocity state");
assert(appSource.includes("startEarthInertia"), "Fast Earth drag does not start inertial motion after release");
assert(appSource.includes("window.requestAnimationFrame"), "Earth drag inertia is not frame-driven");
assert(appSource.includes("window.cancelAnimationFrame"), "Earth drag inertia cannot be cancelled cleanly");
assert(appSource.includes("velocityX") && appSource.includes("velocityY"), "Earth drag inertia does not track x/y velocity");
assert(appSource.includes("getCursorPointInElement"), "Wheel zoom does not use the cursor position");
assert(appSource.includes("cursor-grabbing"), "Dragging cursor state is missing");
assert(appSource.includes("map.dragPan.disable()"), "MapLibre modifier drag does not pause native panning");
assert(appSource.includes("map.setPitch"), "MapLibre Shift-drag tilt is missing");
assert(appSource.includes("map.setBearing"), "MapLibre Alt/Option-drag orbit is missing");
assert(!appSource.includes("DALLAS_FLY_IN_STAGES"), "Live map still contains staged autonomous Dallas fly-in data");
assert(!/setTimeout\(\s*\(\)\s*=>\s*enterDallasParcelMode/.test(appSource), "Live map still contains timer-based automatic Dallas navigation");
assert(!appSource.includes("setFlyInStage"), "Live map still contains autonomous fly-in stage state");

const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
assert(manifest.featureCount > 1000, "parcel access manifest does not expose the full parcel count");
const parcelServiceManifest = JSON.parse(fs.readFileSync(parcelServiceManifestFile, "utf8"));
assert(parcelServiceManifest.featureCount === 696601, "parcel service manifest does not expose all 696,601 parcels");
assert(parcelServiceManifest.searchIndexCount === 696601, "parcel service search index does not expose all 696,601 parcels");
assert(parcelServiceManifest.chunkCount > 1, "parcel service is not chunked for viewport loading");
assert(parcelServiceManifest.gridSize >= 48, "parcel service chunks are too broad for smooth viewport loading");
assert(parcelServiceManifest.searchIndexShards && parcelServiceManifest.searchIndexShards.keyLength === 2, "parcel service search index is not sharded for efficient browser search");

const largestParcelChunkBytes = parcelServiceManifest.chunks.reduce((maxBytes, chunk) => {
  const chunkFile = path.join(root, "public", "data", "parcels", chunk.file);
  return Math.max(maxBytes, fs.statSync(chunkFile).size);
}, 0);
assert(largestParcelChunkBytes < 5_000_000, "parcel service chunks are too large for reliable browser loading");
assert(fs.statSync(path.join(root, "public", "data", "parcels", parcelServiceManifest.searchIndex)).size < 1_000_000, "parcel search manifest is too large for initial browser loading");

console.log("White Rabbit loader integration tests passed.");

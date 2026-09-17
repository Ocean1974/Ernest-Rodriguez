const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const appFile = path.join(root, "src", "App.tsx");
const globeFile = path.join(root, "src", "components", "LiveMapGlobe.tsx");
const mainFile = path.join(root, "src", "main.tsx");
const stylesFile = path.join(root, "src", "styles.css");
const viteConfigFile = path.join(root, "vite.config.mts");
const earthTextureFile = path.join(root, "public", "assets", "earth-blue-marble-2048.png");
const appSource = fs.readFileSync(appFile, "utf8");
const globeSource = fs.readFileSync(globeFile, "utf8");
const mainSource = fs.readFileSync(mainFile, "utf8");
const stylesSource = fs.readFileSync(stylesFile, "utf8");
const viteConfigSource = fs.readFileSync(viteConfigFile, "utf8");
const parcelLoaderSource = fs.readFileSync(path.join(root, "src", "map", "loadParcels.ts"), "utf8");
const addressGeocoderSource = fs.readFileSync(path.join(root, "src", "map", "geocodeAddress.mjs"), "utf8");
const developmentIntelSource = fs.readFileSync(path.join(root, "src", "data", "developmentIntel.json"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function extractFunction(name) {
  const start = appSource.indexOf(`function ${name}`);
  assert(start >= 0, `${name} is missing`);
  const nextFunction = appSource.indexOf("\nfunction ", start + 1);
  const nextExport = appSource.indexOf("\nexport default function ", start + 1);
  const candidates = [nextFunction, nextExport].filter((index) => index > start);
  const end = candidates.length ? Math.min(...candidates) : appSource.length;
  return appSource.slice(start, end);
}

const landingSource = extractFunction("WhiteRabbitLanding");
const marketplaceSource = extractFunction("CommercialMarketplacePage");
const liveGlobeSource = globeSource;
const syntheticMapSource = extractFunction("SyntheticMapScene");
const mapSource = extractFunction("WhiteRabbitMap");
const liveMapEngineSource = extractFunction("LiveMapEngine");
const compactMapControlsSource = extractFunction("CompactMapControls");
const aerialLayerControlsSource = extractFunction("AerialLayerControls");
const focusedParcelCardSource = extractFunction("FocusedParcelCard");
const topBarSource = extractFunction("TopBar");
const parcelGeometryHitTest = new Function(
  `${extractFunction("isMapCoordinatePair")}\n${extractFunction("isRenderableMapGeometry")}\n${extractFunction("parcelMapGeometry")}\n${extractFunction("parcelLngLatPolygons")}\n${extractFunction("lngLatInsideRing")}\n${extractFunction("parcelContainsLngLat")}\nreturn parcelContainsLngLat;`,
)();

assert(mainSource.includes('import App from "./App.tsx"'), "The running app must use src/App.tsx as the source of truth");
assert(parcelLoaderSource.includes("if (parcels.length >= collectionTarget) break"), "Viewport parcel loading must publish DCAD parcels after filling its feature budget instead of waiting for every intersecting chunk");
assert(mapSource.includes('useState(() => getEarthIntroCamera())'), "Enter Map must preserve the interactive globe camera");
assert(mapSource.includes('const [mapMode, setMapMode] = useState("earth")'), "Enter Map must preserve interactive globe mode");
assert(mapSource.includes('const [earthIntroActive, setEarthIntroActive] = useState(true)'), "Enter Map must keep the interactive globe active until the user chooses Parcel View");

assert(appSource.includes("export default function WhiteRabbitLanding"), "WhiteRabbitLanding must remain the first exported screen");
assert(landingSource.includes("Commercial Intelligence"), "Landing panel copy changed or disappeared");
assert(landingSource.includes("Explore the Market from Above"), "Landing headline changed or disappeared");
assert(landingSource.includes("photo-1526772662000-3f88f10405ff"), "Restored hiker/mountain landing image is missing");
assert(landingSource.includes('alt="Mountain overlook"'), "Restored hiker/mountain landing hero is missing");
assert(landingSource.includes("animate-[pulse_20s_ease-in-out_infinite]"), "Landing image motion is missing");
assert(!landingSource.includes("<LandingControls />"), "Landing page must not render live-map control buttons");
assert(landingSource.includes(">CRE Listings</button>"), "Landing header must expose the commercial listing link");
assert(landingSource.includes(">Resi Listings</button>"), "Landing header must expose the residential listing link");
assert(landingSource.includes(">Rentals</button>"), "Landing header must expose the rental listing link");
assert(!landingSource.includes(">Layers</button>") && !landingSource.includes(">Map</button>"), "Landing header must only show the three listing headers");
assert(landingSource.includes('openListingPage("cre")'), "Commercial listing link must open the CRE listing page");
assert(landingSource.includes('openListingPage("resi")'), "Residential listing link must open the residential listing page");
assert(landingSource.includes('openListingPage("rentals")'), "Rental listing link must open the rental listing page");
assert(landingSource.includes('const [landingSearch, setLandingSearch] = useState("")'), "Landing search state must be wired");
assert(landingSource.includes("initialSearch={landingSearch}"), "Landing search must hand off to WhiteRabbitMap");
assert(landingSource.includes("onChange={setLandingSearch}"), "Landing search input must be editable");
assert(landingSource.includes("onSubmit={() => setEnteredMap(true)}"), "Landing search submit must open the live map");
assert(landingSource.includes("What are you looking for"), "Landing search must use the approved question placeholder");
assert(appSource.includes('type="search"') && appSource.includes('enterKeyHint="search"'), "Search fields must expose native search and mobile keyboard behavior");
assert(appSource.includes('event.key === "Escape"') && appSource.includes('aria-label="Clear search"'), "Primary search must support Escape and a visible clear action");
assert(landingSource.includes("<span>Enter Map</span>"), "Enter Map button changed or disappeared");
assert(!landingSource.includes("<LiveMapGlobe />"), "WhiteRabbitLanding must not render the interactive globe");

assert(appSource.includes("const COMMERCIAL_MARKETPLACE_PROPERTIES = ["), "Commercial marketplace property data must be defined");
assert(appSource.includes("const RESIDENTIAL_MARKETPLACE_PROPERTIES = ["), "Residential listing property data must be defined");
assert(appSource.includes("const RENTAL_MARKETPLACE_PROPERTIES = ["), "Rental listing property data must be defined");
assert(appSource.includes("const LISTING_PAGE_CONFIGS = {"), "Listing page configs must be defined");
assert(marketplaceSource.includes('listingKind = "cre"'), "Commercial marketplace page must default to CRE listings");
assert(marketplaceSource.includes('data-page={listingKind === "cre" ? "commercial-marketplace" : "listing-marketplace"}'), "Listing pages must expose stable page hooks");
assert(marketplaceSource.includes("data-listing-kind={listingKind}"), "Listing pages must expose the active listing kind");
assert(marketplaceSource.includes('data-listing-layout="simple-listing-grid"'), "Listing pages must use the simple listing grid layout");
assert(marketplaceSource.includes('data-listing-grid="three-column-cards"'), "Listing pages must render simple three-column listing cards");
assert(marketplaceSource.includes('data-listing-deal-badge="true"'), "Listing cards must expose green deal badges");
assert(marketplaceSource.includes("listingDealBadgeForProperty(property, nearbyDevelopments)"), "Listing card corners must use development-aware deal labels instead of raw status labels");
assert(!marketplaceSource.includes(">{property.status}</span>"), "Listing card corner badges must not show raw status labels such as Watch");
assert(marketplaceSource.includes("listingConfig.coverageLabel"), "Listing pages must render national coverage labels instead of local-only headings");
assert(appSource.includes("Best Commercial Deals"), "Commercial marketplace page must label the nationwide best-deals list");
assert(appSource.includes('pageTitle: "Best Deals Nationwide"'), "Commercial marketplace must be the nationwide best-deals destination");
assert(appSource.includes("Residential Listings") && appSource.includes("Rental Listings"), "Residential and rental listing pages must be configured");
assert(appSource.includes("MARKETPLACE") && appSource.includes("RESI LISTINGS") && appSource.includes("RENTALS"), "Listing pages must keep category headers");
assert(appSource.includes("All U.S. Counties") && appSource.includes("Nationwide Commercial County Network"), "Listing pages must be framed for all U.S. counties");
assert(!marketplaceSource.includes("Dallas and Louisville"), "Listing page headings must not limit the product to Dallas and Louisville");
assert(marketplaceSource.includes("availableStatusFilters.map"), "Commercial marketplace page must expose simple status filtering");
assert(marketplaceSource.includes("listingConfig.searchPlaceholder"), "Listing pages must include category-specific market/parcel search");
assert(marketplaceSource.includes("listingPropertyMatchesQuery(property, query)"), "Listing pages must use consistent token-aware search matching");
assert(marketplaceSource.includes('aria-label="Clear listing search"'), "Listing searches must expose a clear action");
assert(marketplaceSource.includes("Clear search and filters"), "Empty listing searches must offer one-step recovery");
assert(!marketplaceSource.includes("Marketplace Snapshot"), "Listing pages must stay simple without the old selected-property summary panel");
assert(!marketplaceSource.includes("listingConfig.readinessRows.map"), "Listing pages must not render the old readiness side panel");
assert(appSource.includes("Nationwide County Rollout"), "Commercial marketplace page must show nationwide county rollout readiness");
assert(appSource.includes("County owner/appraisal joins") && appSource.includes("County-by-county"), "Marketplace must show county data joins as county-by-county work");
assert(appSource.includes("Open Property Map") && appSource.includes("Open Residential Map") && appSource.includes("Open Rental Map"), "Listing pages must link back into the map without changing map design");

assert(appSource.includes('lazy(() => import("./components/LiveMapGlobe"))'), "LiveMapGlobe must be lazy-loaded from the main app");
assert(globeSource.includes('import { Canvas, useFrame, useThree } from "@react-three/fiber"'), "LiveMapGlobe must use React Three Fiber Canvas");
assert(globeSource.includes('import { OrbitControls, Stars } from "@react-three/drei"'), "LiveMapGlobe must use Drei OrbitControls");
assert(liveGlobeSource.includes("<Canvas"), "LiveMapGlobe must render a Canvas");
assert(liveGlobeSource.includes('data-live-map-globe="three"'), "LiveMapGlobe must expose proof metadata");
assert(liveGlobeSource.includes('data-globe-render-profile="bright-detailed-earth"'), "LiveMapGlobe must expose the bright detailed Earth render profile");
assert(!liveGlobeSource.includes("function CssEarthGlobe") && !liveGlobeSource.includes('data-css-earth-globe="active"'), "LiveMapGlobe must not use a flat CSS picture-scroll globe");
assert(liveGlobeSource.includes("focusLocation") && liveGlobeSource.includes("coordinatesToGlobeRotation"), "LiveMapGlobe must support market search focus targets on the real 3D globe");
assert(liveGlobeSource.includes("useFrame") && liveGlobeSource.includes("holdUntilRef"), "LiveMapGlobe must smooth real globe focus and idle motion");
assert(liveGlobeSource.includes("enablePan={false}"), "LiveMapGlobe controls must disable panning");
assert(liveGlobeSource.includes("enableDamping"), "LiveMapGlobe controls must enable smooth damping");
assert(liveGlobeSource.includes("enableZoom"), "LiveMapGlobe controls must enable wheel/trackpad zoom");
assert(liveGlobeSource.includes("enableRotate"), "LiveMapGlobe controls must enable drag rotation");
assert(liveGlobeSource.includes("autoRotate"), "LiveMapGlobe must slowly auto-rotate while idle");
assert(globeSource.includes("function GlobeZoomControls"), "LiveMapGlobe must expose explicit zoom controls for the plus/minus buttons");
assert(globeSource.includes("controlsApiRef.current = {"), "LiveMapGlobe zoom API must be registered");
assert(globeSource.includes("zoomIn: () => zoomBy(0.84)") && globeSource.includes("zoomOut: () => zoomBy(1.18)"), "Globe plus/minus zoom factors must be wired");
assert(globeSource.includes("function GlobeEarth(") && globeSource.includes("<sphereGeometry"), "LiveMapGlobe must render a real 3D sphere");
assert(globeSource.includes("<meshBasicMaterial") && globeSource.includes("map={displayTexture || undefined}") && globeSource.includes("toneMapped={false}"), "LiveMapGlobe must render the Earth texture without light wash");
assert(globeSource.includes("enhanceEarthTexture(canvas)"), "LiveMapGlobe must enhance the real Earth texture before applying it");
assert(globeSource.includes("createLoadingEarthTexture") && globeSource.includes("earth-loading-texture"), "LiveMapGlobe must use an Earth-like loading texture instead of a plain blue fallback");
assert(globeSource.includes("function getSharedLoadingEarthTexture()"), "LiveMapGlobe must cache its Earth-like loading texture across remounts");
assert(globeSource.includes("const loadingTexture = getSharedLoadingEarthTexture();"), "GlobeEarth must have a textured first render instead of waiting for an effect");
assert(!globeSource.includes("const [loadingTexture, setLoadingTexture] = useState(null)"), "GlobeEarth must not render a white frame while its fallback texture is created");
assert(!globeSource.includes('color={earthTexture ? "#ffffff" : "#285f98"}'), "LiveMapGlobe must not settle into the old plain light-blue fallback sphere");
assert(!globeSource.includes("cloudsRef") && !globeSource.includes("opacity={0.055}"), "LiveMapGlobe must not render the translucent white cloud wash");
assert(globeSource.includes("minDistance={6.6}") && globeSource.includes("maxDistance={11}"), "LiveMapGlobe zoom bounds must prevent gray close-up wash");
assert(globeSource.includes("camera.position.set(0, 0.15, 6.4)") && globeSource.includes("camera.fov = 40"), "LiveMapGlobe must reset camera away from close-up wash");
assert(fs.existsSync(earthTextureFile), "NASA Blue Marble Earth texture asset must exist");
assert(globeSource.includes('image.src = "/assets/earth-blue-marble-2048.png"') && globeSource.includes("new THREE.CanvasTexture(canvas)"), "GlobeEarth must use the real Earth image texture on the 3D sphere");
assert(viteConfigSource.includes("WR_SKIP_PUBLIC_COPY") && viteConfigSource.includes("copyPublicAssetsWhenSkippingData"), "Fast preview builds must still copy public Earth imagery assets");
assert(
  viteConfigSource.includes('"public/assets"') && viteConfigSource.includes('resolve(outputDirectory, "assets")'),
  "Fast preview builds must preserve served public assets for the globe in the selected output directory",
);
assert(!appSource.includes("function createEarthTexture()"), "Procedural canvas Earth texture should not be used");
assert(!stylesSource.includes(".wr-css-earth-globe") && !stylesSource.includes(".wr-css-earth-texture"), "Flat CSS globe image layer must stay removed");

assert(syntheticMapSource.includes("<LiveMapGlobe controlsApiRef={globeControlsRef} />"), "WhiteRabbitMap shell must render LiveMapGlobe in globe mode");
assert(syntheticMapSource.includes('earthIntroActive && mapMode === "earth"'), "LiveMapGlobe must be limited to second-page globe mode");
assert(syntheticMapSource.includes('pointerEvents: earthIntroActive ? "none" : "auto"'), "Hidden MapLibre layer must not block LiveMapGlobe interaction");
assert(syntheticMapSource.includes('visibility: earthIntroActive ? "hidden" : "visible"'), "Hidden MapLibre layer must not visually leak into page two");
assert(syntheticMapSource.includes("onPointerDown={useSyntheticMapControls ? onPointerDown : undefined}"), "MapLibre parcel map must receive plain drag-pan pointer input");
assert(syntheticMapSource.includes("onWheel={useSyntheticMapControls ? onWheel : undefined}"), "MapLibre parcel map must receive its own wheel input");

assert(mapSource.includes("const enterDallasParcelMode ="), "Explicit Dallas/DCAD entry function is missing");
assert(mapSource.includes("const [searchLoading, setSearchLoading] = useState(false)"), "Parcel search must expose in-flight state instead of briefly reporting zero matches");
assert(mapSource.includes("const searchRequestIdRef = useRef(0)"), "Parcel search must prevent stale async responses from replacing newer results");
assert(mapSource.includes("reserveMapControls={!earthIntroActive}"), "Aerial-map search must reserve room for mobile controls");
assert(mapSource.includes("...fallbackSearchParcels") && mapSource.includes("loadedDallasParcels.length || activeCountyParcelPlaceId ? allMapParcels : []"), "Submitted parcel search must exclude the Sanden demo fallback while retaining loaded DCAD matches");
assert(!developmentIntelSource.includes('"id": "dev-watch-sanden"'), "Sanden must not be injected as a static development-search suggestion");
assert(mapSource.includes("searchFullParcelRecords(query, SEARCH_RESULT_LOOKUP_LIMIT, activeParcelDataset)"), "Submitted parcel search must keep Sanden available through the normal DCAD index");
assert(appSource.includes('searchLoading ? `Searching parcels and addresses…'), "Search panel must clearly label combined parcel and address lookup");
assert(mapSource.includes('if (looksLikeUsStreetAddress(query))'), "Submitted street addresses must resolve their county before searching the active parcel dataset");
assert(mapSource.includes('Address located. Showing nearby parcels because no indexed parcel address matched exactly.'), "Connected-county address searches must fall back to nearby viewport parcels without selecting a false fuzzy match");
assert(appSource.includes("const noiseWords = new Set") && appSource.includes('"parcels"') && appSource.includes('"properties"'), "Natural place commands such as Austin parcels must be normalized before place routing");
assert(mapSource.includes("geocodeAddress(query)"), "Submitted search must fall back to nationwide U.S. address geocoding when parcel records do not match");
assert(mapSource.includes("focusGeocodedAddress(addressResult)"), "A geocoded address must fly the live aerial map to its coordinates");
assert(mapSource.includes("const allMapParcels = activePilotPlaceId === NATIONAL_ROAMING_ID"), "National aerial roaming must not render Dallas fallback parcels in another city");
assert(appSource.includes("Aerial location · parcel intelligence appears where verified coverage is available"), "Address results must explain parcel coverage without inventing data");
assert(addressGeocoderSource.includes('DEFAULT_ADDRESS_GEOCODER_ENDPOINT = "/api/geocode"'), "Address geocoding must use the same-origin server route");
assert(viteConfigSource.includes('target: "https://geocoding.geo.census.gov"'), "Local address lookup must proxy to the official U.S. Census geocoder");
assert(appSource.includes("left-4 right-[4.75rem]") && appSource.includes("sm:left-1/2 sm:right-auto"), "Mobile search results must reserve room for the right-side map controls");
assert(appSource.includes("overflow-x-hidden overflow-y-auto"), "Mobile parcel search results must not create a horizontal scrollbar");
const enterDallasParcelModeSource = mapSource.slice(mapSource.indexOf("const enterDallasParcelMode ="), mapSource.indexOf("const jumpToParcel =", mapSource.indexOf("const enterDallasParcelMode =")));
[
  "setSelected(DALLAS_LOCATION)",
  'setMapMode("parcel")',
  "setMapCamera(parcelCamera)",
  "setEarthIntroActive(false)",
  "setShowParcelLabels(true)",
  "setShowGrid(true)",
].forEach((snippet) => assert(enterDallasParcelModeSource.includes(snippet), `enterDallasParcelMode must call ${snippet}`));
assert(mapSource.includes("focusGlobeOnTarget(DALLAS_LOCATION") && mapSource.includes("globeHandoffTimerRef"), "Dallas parcel entry must focus the globe before handoff");
assert(mapSource.includes("focusGlobeOnTarget(target") && mapSource.includes("commitPlaceTarget"), "Place search must focus the globe before market handoff");
assert(appSource.includes('"harris", "harris county"') && appSource.includes('"hcad"'), "Harris county-name and HCAD searches must route to the Harris pilot before parcel-owner search");
assert(appSource.includes('"maricopa", "maricopa county"') && appSource.includes('"mcassessor"'), "Maricopa county-name and assessor searches must route to the Maricopa pilot before parcel-owner search");
assert(appSource.includes('"king", "king county"') && appSource.includes('"kcdoa"'), "King county-name and assessment searches must route to the King County pilot before parcel-owner search");
assert(appSource.includes('"jefferson", "jefferson county"') && appSource.includes('"jcpva"'), "Jefferson county-name and PVA searches must route to the Jefferson pilot before parcel-owner search");

assert(mapSource.includes("<TopBar") && mapSource.includes("onParcelView={enterDallasParcelMode}"), "TopBar Parcel View must enter Dallas parcel mode explicitly");
assert(mapSource.includes('onNationwideDeals={() => onOpenMarketplace?.("cre")}'), "TopBar rabbit must open the nationwide best-deals marketplace");
assert(mapSource.includes("earthIntroActive={earthIntroActive}") && mapSource.includes('onCreListings={() => onOpenMarketplace?.("cre")}'), "Interactive globe CRE Listings link must open the CRE listing page");
assert(mapSource.includes('onResidentialListings={() => onOpenMarketplace?.("resi")}'), "Interactive globe Resi Listings link must open the residential listing page");
assert(mapSource.includes('onRentalListings={() => onOpenMarketplace?.("rentals")}'), "Interactive globe Rentals link must open the rental listing page");
assert(topBarSource.includes("globeLandingMode") && topBarSource.includes('mapMode === "earth"'), "TopBar must detect interactive globe landing mode");
assert(topBarSource.includes(">CRE Listings</button>") && topBarSource.includes(">Resi Listings</button>") && topBarSource.includes(">Rentals</button>"), "Interactive globe header must expose the three listing links");
assert(topBarSource.includes("!globeLandingMode &&") && topBarSource.includes("LIVE MAP"), "Interactive globe must hide the live-map badge until the aerial page");
assert(topBarSource.includes('aria-label="Show best deals nationwide"'), "Top-left map rabbit must expose the nationwide best-deals action accessibly");
assert(topBarSource.includes('data-rabbit-action="nationwide-best-deals"'), "Top-left map rabbit must identify the nationwide best-deals action");
assert(landingSource.includes('onClick={() => openListingPage("cre")}'), "Landing rabbit must open the nationwide best-deals marketplace");
assert(landingSource.includes('data-rabbit-action="nationwide-best-deals"'), "Landing rabbit must identify the nationwide best-deals action");
assert(landingSource.includes("onClick={() => setEnteredMap(true)}"), "Enter Map should use the original map-entry action");
assert(!landingSource.includes("setMapMode(\"parcel\")"), "Enter Map must not switch to parcel mode from the landing page");
assert(!landingSource.includes("setEarthIntroActive(false)"), "Enter Map must not disable Earth mode from the landing page");

assert(appSource.includes('const NATIONAL_ROAMING_ID = "national-us"'), "Map must define a national U.S. roaming context");
assert(appSource.includes("const NATIONAL_US_GEO_BOUNDS"), "Map must define national U.S. bounds for roving");
assert(appSource.includes("NATIONAL_US_LOCATION"), "Map must expose a national source-aware map location");
assert(appSource.includes("function findRovingMapContextByLngLat"), "Map must identify Dallas, pilot, and national roving contexts from coordinates");
assert(appSource.includes("target.id !== NATIONAL_ROAMING_ID && lngLatInsideBounds"), "County detection must exclude the national bounds so Dallas parcels are not cleared after moveend");
assert(appSource.includes("if (placeId === NATIONAL_ROAMING_ID) return null"), "National roaming must not pretend to have a parcel dataset");
assert(appSource.includes("if (placeId === NATIONAL_ROAMING_ID) return NATIONAL_US_LOCATION"), "National roaming must use the national map location");
assert(appSource.includes("setActivePilotPlaceId(nextPlaceId)") && appSource.includes("NATIONAL_ROAMING_ID"), "Viewport movement must be able to enter national roaming context");
assert(appSource.includes("activePilotPlaceId === NATIONAL_ROAMING_ID || !activeParcelDataset"), "National roaming must skip pilot parcel loading");
assert(!appSource.includes("RovingCoverageBadge") && !appSource.includes("data-national-roving-context"), "Map must not render the removed bottom-left county status box");
assert(appSource.includes("function lngLatInsideDallasBounds"), "Dallas bounds helper must remain available for DCAD context detection");
assert(appSource.includes("function geolocationErrorLabel"), "Find-my-location must normalize browser geolocation errors");
assert(mapSource.includes("const findMyLocation ="), "WhiteRabbitMap must expose a find-my-location handler");
assert(mapSource.includes("navigator.geolocation.getCurrentPosition"), "Find-my-location must use the browser geolocation API");
assert(mapSource.includes("findRovingMapContextByLngLat(longitude, latitude)"), "Find-my-location must support U.S.-wide map context instead of staying Dallas-only");
assert(mapSource.includes('queueLocationStatus("Location is outside the U.S. map")'), "Find-my-location must reject coordinates outside U.S. roaming bounds");
assert(mapSource.includes("setActivePilotPlaceId(targetIsDallas ? \"\" : rovingContext.id)"), "Find-my-location must switch to Dallas, pilot, or national context based on coordinates");
assert(mapSource.includes("onFindMyLocation={findMyLocation}"), "Find-my-location must be wired into the existing map controls");
assert(liveMapEngineSource.includes("flyToLngLat: (lngLat, options = {})"), "Live MapLibre API must support flying to a browser geolocation point");
assert(appSource.includes("clamp(map.getZoom() + zoomDelta, 3.4, 17.8)"), "MapLibre wheel zoom must allow national U.S. zoom levels");
assert(appSource.includes("return clamp(4.45 + (safeCamera.zoom - 0.58) * 7.2, 3.4, 17.8)"), "Camera-to-MapLibre zoom conversion must support national zoom");
assert(compactMapControlsSource.includes("LocateFixed"), "Compact map controls must show the find-my-location icon");
assert(compactMapControlsSource.includes("onFindMyLocation"), "Compact map controls must call the find-my-location handler");
assert(compactMapControlsSource.includes('aria-live="polite"'), "Find-my-location status must be exposed accessibly without visual redesign");
assert(mapSource.includes("{!earthIntroActive && (\n        <CompactMapControls"), "Map control stack must stay off the interactive globe landing page");

assert(liveMapEngineSource.includes('"wr-aerial-imagery"'), "Page three must keep the Esri imagery source");
assert(liveMapEngineSource.includes("server.arcgisonline.com/ArcGIS/rest/services/World_Imagery"), "Page three must use Esri World Imagery");
assert(liveMapEngineSource.includes('"wr-parcels"'), "Page three must keep the DCAD parcel GeoJSON source");
assert(liveMapEngineSource.includes('"wr-parcels-fill"') && liveMapEngineSource.includes('"wr-parcels-line"'), "Page three must render DCAD parcel fill and line layers");
assert(liveMapEngineSource.includes("buildParcelPopupHtml(parcel)"), "Page three must render the DCAD parcel popup");
assert(appSource.includes("function parcelPopupSourceLabel") && appSource.includes('return "Jefferson County Parcel"'), "Parcel popup source labels must be county-aware");
assert(appSource.includes("function parcelPopupPrimaryId"), "Parcel popup must choose a parcel-ID-first title");
assert(appSource.includes('data-parcel-roving-popup="true"'), "Parcel hover popup must identify itself as a roving parcel popup");
assert(appSource.includes("wr-parcel-popup-id-label") && appSource.includes("Parcel ID"), "Parcel hover popup must lead with parcel ID intelligence");
assert(appSource.includes('parcelPopupRow("GIS ID"'), "Parcel hover popup must include GIS parcel IDs when present");
assert(appSource.includes('parcelPopupRow("Intel"'), "Parcel hover popup must summarize available parcel intelligence");
assert(liveMapEngineSource.includes("rovingPopupParcelKey"), "Roving parcel popup must cache parcel identity while following the pointer");
assert(liveMapEngineSource.includes("parcelPopup.setLngLat(lngLat)"), "Roving parcel popup must move with the pointer");
assert(liveMapEngineSource.includes("popupElement.dataset.parcelId"), "Roving parcel popup must expose the active parcel id for testing");
assert(liveMapEngineSource.includes("queryRenderedFeatures(queryPoint"), "Page three popup must query rendered parcel features");
assert(liveMapEngineSource.includes("queryParcelFeatureAtPoint"), "Page three must use a tolerant parcel hit test");
assert(liveMapEngineSource.includes("map.getZoom() < 12 ? 64"), "Roving parcel hit testing must remain usable at citywide zoom");
assert(liveMapEngineSource.includes('id: "wr-hovered-parcel-line"'), "DCAD parcel hover must render a visible parcel outline");
assert(liveMapEngineSource.includes("setHoveredParcelFeature(feature)"), "DCAD parcel hover must track the parcel beneath the cursor");
assert(liveMapEngineSource.includes('map.on("mousemove", "wr-parcels-fill", (event)'), "DCAD hover must bind directly to the rendered parcel layer");
assert(liveMapEngineSource.includes('map.on("click", "wr-parcels-fill", (event)'), "DCAD parcel selection must bind directly to the rendered parcel layer");
assert(liveMapEngineSource.includes("event.features?.[0] || queryParcelFeatureAtPoint(event.point)"), "Direct parcel events must use authoritative layer features with tolerant fallback hit testing");
assert(appSource.includes("function parcelContainsLngLat"), "DCAD interactions must have a geometry-based parcel hit fallback");
assert(parcelGeometryHitTest({ realGeometry: { geometry: { type: "Polygon", coordinates: [[[-96.8, 32.77], [-96.79, 32.77], [-96.79, 32.78], [-96.8, 32.78], [-96.8, 32.77]]] } } }, -96.795, 32.775), "Geometry fallback must hit a cursor inside a DCAD parcel polygon");
assert(!parcelGeometryHitTest({ realGeometry: { geometry: { type: "Polygon", coordinates: [[[-96.8, 32.77], [-96.79, 32.77], [-96.79, 32.78], [-96.8, 32.78], [-96.8, 32.77]]] } } }, -96.7, 32.9), "Geometry fallback must reject a cursor outside a DCAD parcel polygon");
assert(parcelGeometryHitTest({ realGeometry: { geometry: { type: "Polygon", coordinates: [["-96.8 32.77", "-96.79 32.77", "-96.79 32.78"]] } }, liveGeometry: { points: [[-96.8, 32.77], [-96.79, 32.77], [-96.79, 32.78], [-96.8, 32.78], [-96.8, 32.77]] } }, -96.795, 32.775), "Malformed encoded DCAD geometry must fall back to the valid live parcel polygon");
assert(liveMapEngineSource.includes("findParcelAtLngLat"), "Live map interactions must resolve parcels by geometry when rendered feature picking misses");
assert(liveMapEngineSource.includes('addEventListener("pointermove", handleMapSurfacePointerMove, true)'), "Live map hover must bind to the map surface in capture phase");
assert(appSource.includes("function isRenderableMapGeometry(geometry)"), "DCAD parcel geometry must be validated before it reaches MapLibre");
assert(appSource.includes("const geometry = parcelMapGeometry(parcel);"), "DCAD map features and hit testing must use renderable parcel geometry");
assert(appSource.includes('if (isRenderableMapGeometry(realGeometry)) return realGeometry;'), "Invalid encoded DCAD geometry must fall back to live parcel polygons");
assert(liveMapEngineSource.includes('addEventListener("click", handleMapSurfaceClick, true)'), "Live map parcel selection must bind to the map surface in capture phase");
assert(syntheticMapSource.includes("key={PARCEL_PIPELINE_REVISION}"), "Parcel pipeline revisions must remount the live map so repaired sources and handlers reach an already-open tab");
assert(liveMapEngineSource.includes("map.doubleClickZoom.disable();"), "Double-click must be reserved for opening parcel intelligence instead of map zoom");
assert(liveMapEngineSource.includes('popupElement.style.pointerEvents = "none"'), "Parcel hover popup must not steal hover or click input from the parcel underneath it");
assert(liveMapEngineSource.includes("const mapParcelSelectionOptions = { focusCamera: false }"), "Map-driven parcel selections must not move the map camera");
assert(liveMapEngineSource.includes("const selectionOptions = { ...mapParcelSelectionOptions, ...options }"), "Map-driven parcel selection options must preserve the no-camera-move default");
assert(!liveMapEngineSource.includes("queueHoverInfoWindow"), "Parcel intelligence windows must open from selection behavior, not Jefferson-only hover behavior");
assert(liveMapEngineSource.includes("focusSelectedParcel = true"), "Selected parcel map focus must remain enabled by default");
assert(liveMapEngineSource.includes("if (!focusSelectedParcel)"), "Map-selected parcels must be able to skip map auto-focus");
assert(mapSource.includes("} else if (focusCamera) {\n      enterDallasParcelMode({ clearSelection: false, focusGlobe: false });"), "Dallas map-selected parcels must not reset the camera when focusCamera is false");
assert(liveMapEngineSource.includes("map.scrollZoom.disable();"), "Native MapLibre scroll zoom must stay disabled when custom wheel zoom owns input");
assert(liveMapEngineSource.includes('addEventListener("wheel", handleMapCanvasWheel, { passive: false })'), "Map canvas wheel listener must prevent page scroll");
assert(liveMapEngineSource.includes("around: cursorLngLat"), "Map canvas wheel zoom must zoom around the cursor");

assert(aerialLayerControlsSource.includes('data-layer-icon-controls="aerial-map"'), "Aerial map must expose the three layer icon buttons");
assert(aerialLayerControlsSource.includes("setShowParcelLabels((v) => !v)"), "Parcel label icon button must toggle parcel labels");
assert(aerialLayerControlsSource.includes("setShowDimensions((v) => !v)"), "Dimension icon button must toggle dimensions");
assert(aerialLayerControlsSource.includes("setShowGrid((v) => !v)"), "Grid icon button must toggle grid");
assert(aerialLayerControlsSource.includes("setShowFloodplain((v) => !v)"), "Floodplain icon button must toggle the floodplain layer");
assert(mapSource.includes("{!earthIntroActive && (\n        <AerialLayerControls"), "Aerial layer buttons must only render on the aerial map page");
assert(aerialLayerControlsSource.includes('data-layer-icon-controls="aerial-map"'), "Aerial layer controls must keep their right-side icon stack hook");
assert(aerialLayerControlsSource.includes('label="Toggle zoning layer"'), "Aerial layer controls must expose the zoning layer toggle");
assert(appSource.includes("data-layer-state={active ? \"on\" : \"off\"}"), "Layer buttons must expose on/off state metadata");
assert(appSource.includes("group-hover:block group-focus-visible:block"), "Layer buttons must expose hover and focus tooltips");

assert(focusedParcelCardSource.includes('data-parcel-info-window="active"'), "Clicking a parcel must show the parcel information window");
assert(focusedParcelCardSource.includes("All Parcel Fields"), "Parcel information window must expose all available parcel fields");
assert(focusedParcelCardSource.includes("Object.entries(parcel)"), "Parcel information window must derive all fields from the selected parcel object");
assert(focusedParcelCardSource.includes("Owner Contact"), "Parcel information window must include owner contact information");
assert(focusedParcelCardSource.includes('DetailRow label="Zoning"'), "Parcel information window must expose parcel zoning");
assert(focusedParcelCardSource.includes('DetailRow label="PD"'), "Parcel information window must expose PD numbers");
assert(focusedParcelCardSource.includes('DetailRow label="SUP"'), "Parcel information window must expose SUP numbers");
assert(focusedParcelCardSource.includes('DetailRow label="Subdistricts"'), "Parcel information window must expose subdistricts");
assert(focusedParcelCardSource.includes('DetailRow label="Floodplain"'), "Parcel information window must expose floodplain status");
assert(focusedParcelCardSource.includes('DetailRow label="Flood Zone"'), "Parcel information window must expose flood zones");
assert(focusedParcelCardSource.includes('DetailRow label="SFHA"'), "Parcel information window must expose SFHA status");
assert(focusedParcelCardSource.includes('DetailRow label="Land Use"'), "Parcel information window must expose DCAD land-use zoning intel");
assert(focusedParcelCardSource.includes('DetailRow label="Pricing Method"'), "Parcel information window must expose DCAD land pricing method");
assert(focusedParcelCardSource.includes('data-parcel-permit-window="active"'), "Parcel information window must include linked permit and CO records");
assert(focusedParcelCardSource.includes("Permits & Certificates"), "Parcel information window must label the permit and certificate section");
assert(focusedParcelCardSource.includes("permitRecords.slice(0, 12)"), "Parcel permit window must cap displayed records in the parcel card");
assert(mapSource.includes("parcelStableAccountId(selectedParcel || {})") && mapSource.includes("loadPermitsForParcel("), "Selecting a parcel must load linked permits by raw parcel account while selection stays county-aware");
assert(mapSource.includes("loadParcelZoningSummary("), "Selecting a parcel must load zoning by parcel ID");
assert(mapSource.includes("loadParcelFloodplainSummary("), "Selecting a parcel must load floodplain by parcel ID");
assert(liveMapEngineSource.includes('id: "wr-floodplain-parcels-fill"'), "Map must include a default-off floodplain parcel layer");
assert(mapSource.includes("{selectedParcel && (\n        <FocusedParcelCard"), "Selected parcels must render the parcel information window");
assert(mapSource.includes('setSelectedParcelAccount("")') && focusedParcelCardSource.includes("onClose"), "Parcel information window must be closable");

assert(stylesSource.includes("html,\nbody,\n#root") && stylesSource.includes("overflow: hidden;"), "App shell must prevent browser page scrolling behind the live map");
assert(stylesSource.includes("overscroll-behavior: none;"), "App shell must disable viewport overscroll drift");

console.log("map entry mode tests passed");

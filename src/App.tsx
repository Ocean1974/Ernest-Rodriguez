import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowLeft, Bot, Building2, ChevronDown, ChevronUp, Eye, Grid3X3, ImagePlus, Landmark, LocateFixed, LogOut, MapPin, Maximize2, Minimize2, Pencil, Plus, Ruler, Send, Tags, Trash2, Upload, UserRound, Users, Waves, X } from "lucide-react";
import dcadOwnerData from "./data/dcadOwnerParcels.json";
import developmentIntel from "./data/developmentIntel.json";
import parcelDimensionLabels from "./data/parcelDimensionLabels.json";
import parcelAccessManifest from "./data/parcelAccessManifest.json";
import selectedParcelGeojson from "./data/selectedParcelGeojson.json";
import { countyAwareParcelId, filterParcelRecordsForViewport, loadParcelRecordsForViewport, parcelStableAccountId, searchFullParcelRecords, searchParcelRecords } from "./map/loadParcels";
import { loadParcelFloodplainSummaries, loadParcelFloodplainSummary } from "./map/loadFloodplain";
import { loadPermitRecordsForViewport, loadPermitsForParcel } from "./map/loadPermits";
import { loadParcelZoningSummaries, loadParcelZoningSummary } from "./map/loadZoning";
import { loadDevelopmentRecordsForParcels, searchDevelopmentRecords } from "./map/loadDevelopments";
import { resolveSelectedDevelopmentRecord, toIndexedDevelopmentPresentation } from "./map/developmentPresentation.mjs";
import { requestJson } from "./map/http";
import { geocodeAddress } from "./map/geocodeAddress.mjs";
import { looksLikeUsStreetAddress, searchNationalParcelAddress } from "./map/nationalParcelSearch.mjs";
import { activeCountyDataset } from "./data/countyConfig";
import { activeCountySelectorOption, availableCountyDatasets } from "./data/countyRegistry";
import { platformFeatureGates } from "./data/platformFeatureGates";
import { buildParcelDecisionToolCatalog, createDecisionToolLaunchRequest } from "./features/decisionToolRegistry.mjs";
import { buildParcelOpportunityBrief, createParcelDecisionDefaults, runHighestBestUseAnalysis, runParcelUnderwriting } from "./features/parcelDecisionRuntime.mjs";
import { parseHighestBestUseSearch, rankParcelsForHighestBestUse } from "./search/highestBestUseSearch.mjs";
import { buildParcelAgentContext, PARCEL_AGENTS, requestParcelAgent } from "./agents/parcelAgentRuntime.mjs";
import CrmPage from "./components/CrmPage";
import { createUserListing, listingsForMember, loadUserListings, memberOwnsListing, removeUserListing, saveUserListings, upsertUserListing } from "./listings/userListings.mjs";
import { importUserListingsFromCsv } from "./listings/importListings.mjs";
import { deleteHostedMemberListing, hostedMemberServiceConfigured, loadHostedListingViews, loadHostedMemberListings, loadHostedMemberProfile, loadHostedPublicListings, recordHostedListingView, requestHostedPasswordReset, saveHostedMemberListing, saveHostedMemberProfile, signInHostedMember, signUpHostedMember, uploadHostedListingMedia } from "./listings/hostedMemberService.mjs";
import { calculateListingDeal, parseListingCoordinates } from "./listings/dealRating.mjs";
import { listingVisitorId, loadListingViews, recordLocalListingView, summarizeListingViews } from "./listings/listingAnalytics.mjs";
import { PLATFORM_IDENTITY } from "./platform/platformIdentity";
import { enqueueSavantEvent } from "./agents/savantEventQueue.mjs";
import SavantToolsPage from "./components/SavantToolsPage";

const LiveMapGlobe = lazy(() => import("./components/LiveMapGlobe"));

const DALLAS_LOCATION = {
  id: activeCountyDataset.map.locationId,
  sourceCountyId: activeCountyDataset.id,
  name: activeCountyDataset.map.locationName,
  type: activeCountyDataset.map.locationType,
  status: activeCountyDataset.map.status,
  coordinates: activeCountyDataset.map.coordinates,
  camera: activeCountyDataset.map.camera,
  geoBounds: activeCountyDataset.map.geoBounds,
  mapZoom: 13.2,
};

const DALLAS_LIVE_GEO_BOUNDS = activeCountyDataset.map.geoBounds;
const NATIONAL_ROAMING_ID = "national-us";
const NATIONAL_US_GEO_BOUNDS = {
  minLng: -124.85,
  minLat: 24.39,
  maxLng: -66.88,
  maxLat: 49.38,
};
const NATIONAL_US_LOCATION = {
  id: NATIONAL_ROAMING_ID,
  sourceCountyId: NATIONAL_ROAMING_ID,
  name: "United States County Pipeline",
  type: "National county adapter network",
  status: "national roaming - source-aware coverage",
  coordinates: [-98.5795, 39.8283],
  camera: { x: 45.3, y: 39.2, zoom: 0.58, pitch: 42, bearing: 0 },
  geoBounds: NATIONAL_US_GEO_BOUNDS,
  mapZoom: 4.45,
  aliases: ["united states", "usa", "us", "national", "all us counties", "all u s counties"],
};
const BLANK_SAFE_PILOT_COUNTY_IDS = new Set(["jefferson-ky", "harris-county-tx", "travis-county-tx", "maricopa-county-az", "king-county-wa"]);
const LOUISVILLE_PILOT_LOCATION = {
  id: "jefferson-ky",
  sourceCountyId: "jefferson-ky",
  name: "Louisville KY",
  type: "Jefferson County PVA Pilot",
  status: "pilot adapter - blank-safe parcel window",
  coordinates: [-85.7585, 38.2527],
  camera: { x: 52, y: 48, zoom: 1.5, pitch: 48, bearing: 0 },
  geoBounds: {
    minLng: -85.95,
    minLat: 38.0,
    maxLng: -85.4,
    maxLat: 38.38,
  },
  mapZoom: 13.2,
  aliases: ["louisville", "louisville ky", "louisville kentucky", "jefferson", "jefferson county", "jefferson county ky", "jefferson county kentucky", "jcpva"],
};
const HARRIS_PILOT_LOCATION = {
  id: "harris-county-tx",
  sourceCountyId: "harris-county-tx",
  name: "Houston TX",
  type: "Harris Central Appraisal District",
  status: "active map/search - blank-safe parcel intelligence",
  coordinates: [-95.3698, 29.7604],
  camera: { x: 50, y: 50, zoom: 1.45, pitch: 48, bearing: 0 },
  geoBounds: {
    minLng: -95.95,
    minLat: 29.45,
    maxLng: -94.9,
    maxLat: 30.2,
  },
  mapZoom: 13.2,
  aliases: ["houston", "houston tx", "houston texas", "harris", "harris county", "harris county tx", "harris county texas", "hcad"],
};
const TRAVIS_PILOT_LOCATION = {
  id: "travis-county-tx",
  sourceCountyId: "travis-county-tx",
  name: "Austin TX",
  type: "Travis Central Appraisal District Pilot",
  status: "pilot full parcel/appraisal service - activation gated",
  coordinates: [-97.7431, 30.2672],
  camera: { x: 50, y: 50, zoom: 1.2, pitch: 48, bearing: 0 },
  geoBounds: {
    minLng: -98.192625,
    minLat: 30.01527,
    maxLng: -97.36306,
    maxLat: 30.644515,
  },
  mapZoom: 13.2,
  aliases: ["austin", "austin tx", "austin texas", "travis", "travis county", "travis county tx", "travis county texas", "tcad"],
};
const MARICOPA_PILOT_LOCATION = {
  id: "maricopa-county-az",
  sourceCountyId: "maricopa-county-az",
  name: "Phoenix AZ",
  type: "Maricopa County Assessor Pilot",
  status: "pilot adapter - blank-safe parcel window",
  coordinates: [-112.074, 33.4484],
  camera: { x: 50, y: 50, zoom: 1.2, pitch: 48, bearing: 0 },
  geoBounds: {
    minLng: -113.3349991,
    minLat: 32.6954607,
    maxLng: -111.0817606,
    maxLat: 34.046868,
  },
  mapZoom: 13.2,
  aliases: ["phoenix", "phoenix az", "phoenix arizona", "maricopa", "maricopa county", "maricopa county az", "maricopa county arizona", "mcassessor"],
};
const KING_PILOT_LOCATION = {
  id: "king-county-wa",
  sourceCountyId: "king-county-wa",
  name: "Seattle WA",
  type: "King County Department of Assessments Pilot",
  status: "pilot adapter - blank-safe parcel window",
  coordinates: [-122.3321, 47.6062],
  camera: { x: 50, y: 50, zoom: 1.2, pitch: 48, bearing: 0 },
  geoBounds: {
    minLng: -122.5503964,
    minLat: 47.0720599,
    maxLng: -121.0843837,
    maxLat: 47.7884468,
  },
  mapZoom: 13.2,
  aliases: ["seattle", "seattle wa", "seattle washington", "king", "king county", "king county wa", "king county washington", "kcdoa"],
};
const PLACE_SEARCH_TARGETS = [
  NATIONAL_US_LOCATION,
  LOUISVILLE_PILOT_LOCATION,
  ...(platformFeatureGates.houstonMapSearch ? [HARRIS_PILOT_LOCATION] : []),
  TRAVIS_PILOT_LOCATION,
  MARICOPA_PILOT_LOCATION,
  KING_PILOT_LOCATION,
];

const EARTH_INTRO_CAMERA = { x: 50, y: 50, zoom: 0.5, pitch: 72, bearing: -28 };
const PARCEL_ZOOM_THRESHOLDS = {
  broad: 0.85,
  block: 1.12,
  parcel: 1.42,
  detail: 1.62,
};
const SEARCH_RESULT_LOOKUP_LIMIT = 40;
const SEARCH_TYPEAHEAD_DEBOUNCE_MS = 320;
const SEARCH_MIN_TYPEAHEAD_CHARS = 3;
const SANDEN_DEMO_ACCOUNT_NUM = "008052000B01A0000";
const PARCEL_PIPELINE_REVISION = "dcad-hover-loader-v7";
const FLOODPLAIN_LAYER_LOOKUP_LIMIT = 750;
const ZONING_LAYER_LOOKUP_LIMIT = 750;
const JEFFERSON_KY_PERMIT_SERVICE_ROOT = "/data/counties/jefferson-ky/permits/";
const JEFFERSON_KY_ZONING_SERVICE_ROOT = "/data/counties/jefferson-ky/zoning/";
const JEFFERSON_KY_FLOODPLAIN_SERVICE_ROOT = "/data/counties/jefferson-ky/floodplain/";
const JEFFERSON_KY_PERMIT_SOURCE_INTEL = {
  activePermitCount: 23543,
  countVerifiedAt: "Jun 10, 2026",
  activePermitSourceName: "Louisville Metro KY - Active Construction Permits",
  activePermitSourceUrl: "https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services/active_construction_permits/FeatureServer/0",
  occupancySourceName: "Louisville Metro KY - Property Maintenance Case Occupancy",
  occupancySourceUrl: "https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services/pm_occupancy/FeatureServer/0",
  availableFields: "permit #, type/status, contractor, occupancy category, work type, zoning, sqft, fee/cost, address, lat/long",
};

const LOCATIONS = [
  NATIONAL_US_LOCATION,
  LOUISVILLE_PILOT_LOCATION,
  ...(platformFeatureGates.houstonMapSearch ? [HARRIS_PILOT_LOCATION] : []),
  TRAVIS_PILOT_LOCATION,
  MARICOPA_PILOT_LOCATION,
  KING_PILOT_LOCATION,
  DALLAS_LOCATION,
  {
    id: 3,
    name: "Urban Hotel Corridor",
    type: "Hospitality",
    status: "Pipeline watch",
    coordinates: [-85.746, 38.246],
    camera: { x: 58, y: 44, zoom: 1.42, pitch: 68, bearing: -8 },
  },
];

const DCAD_DALLAS_SAMPLE = [
  {
    accountNum: "008052000B01A0000",
    propertyName: "65% OF SPLIT JURISDICTION ACCT 535,380 SF TOTAL",
    address: "10300 SANDEN DR",
    city: "DALLAS",
    propertyZip: "752381734",
    gisParcelId: "008052000B01A0000",
    buildingClass: "STORAGE WAREHOUSE",
    yearBuilt: "2007",
    grossBuildingArea: "352860",
    stories: "1",
    totalValue: "40624920.00",
    improvementValue: "37382530.00",
    landValue: "3242390.00",
    landAreaSqFt: "535380",
    cityJurisdiction: "DALLAS",
    isdJurisdiction: "RICHARDSON ISD",
    quality: "AVERAGE",
    condition: "GOOD",
  },
  {
    accountNum: "00000155887000000",
    propertyName: "U HAUL RENTALS AND SELF STORAGE",
    address: "1616 GREENVILLE AVE",
    city: "DALLAS",
    propertyZip: "752067415",
    gisParcelId: "00000155887000000",
    buildingClass: "FREE STANDING RETAIL STORE",
    yearBuilt: "1961",
    grossBuildingArea: "7150",
    stories: "1",
    totalValue: "1716000.00",
    improvementValue: "24720.00",
    landValue: "1691280.00",
    landAreaSqFt: "28188",
    cityJurisdiction: "DALLAS",
    isdJurisdiction: "DALLAS ISD",
    quality: "GOOD",
    condition: "AVERAGE",
  },
  {
    accountNum: "00000182602000000",
    propertyName: "LAKEWOOD CONVENIENCE STORE/TEXACO/THE CAVE",
    address: "1701 SKILLMAN ST",
    city: "DALLAS",
    propertyZip: "752067949",
    gisParcelId: "00000182602000000",
    buildingClass: "CONVENIENCE STORE",
    yearBuilt: "2000",
    grossBuildingArea: "3304",
    stories: "1",
    totalValue: "2062830.00",
    improvementValue: "664830.00",
    landValue: "1398000.00",
    landAreaSqFt: "23320",
    cityJurisdiction: "DALLAS",
    isdJurisdiction: "DALLAS ISD",
    quality: "GOOD",
    condition: "GOOD",
  },
  {
    accountNum: "00000156442000000",
    propertyName: "BONOBOS",
    address: "1901 N HENDERSON AVE",
    city: "DALLAS",
    propertyZip: "752067319",
    gisParcelId: "00000156442000000",
    buildingClass: "FREE STANDING RETAIL STORE",
    yearBuilt: "1937",
    grossBuildingArea: "1224",
    stories: "1",
    totalValue: "819580.00",
    improvementValue: "507580.00",
    landValue: "312000.00",
    landAreaSqFt: "5200",
    cityJurisdiction: "DALLAS",
    isdJurisdiction: "DALLAS ISD",
    quality: "GOOD",
    condition: "AVERAGE",
  },
];

const DCAD_SOURCE_META = {
  sourceLabel: "Dallas County Appraisal District",
  extractLabel: "DCAD 2026 CURRENT.ZIP + PARCEL_GEOM.zip + BLKID.zip + ParcelDimension.zip",
  tables: ["ACCOUNT_INFO.CSV", "ACCOUNT_APPRL_YEAR.CSV", "COM_DETAIL.CSV", "LAND.CSV", "PARCEL_GEOM", "BLKID", "ParcelDimension"],
  note: "Dallas County is using uploaded DCAD appraisal, parcel geometry, block-ID, and parcel-dimension source files.",
  geometryStatus: "Parcel geometry, block IDs, and dimension-layer support are available for the Dallas County / DCAD map engine.",
};

const COMMERCIAL_MARKETPLACE_PROPERTIES = [
  {
    id: "wr-market-national-county-rollout",
    market: "United States",
    county: "All U.S. Counties",
    status: "Watch",
    assetType: "Nationwide Coverage",
    propertyName: "Nationwide Commercial County Network",
    address: "All county and county-equivalent markets",
    city: "United States",
    sizeLabel: "Nationwide county rollout",
    landLabel: "County adapter pipeline",
    priceLabel: "Listing feeds pending",
    capRate: "National expansion",
    yearBuilt: "County source dependent",
    zoning: "County-by-county joins",
    sourceLabel: "Real Estate Savant universal parcel schema",
    parcelId: "county_id / parcel_id",
    coordinates: "United States coverage",
    tags: ["Nationwide", "County adapters", "Universal schema"],
    highlight: "Real Estate Savant is meant to cover every U.S. county through county adapters. Dallas and Jefferson are current loaded examples, not the boundary of the product.",
  },
  {
    id: "wr-market-sanden-industrial",
    market: "Dallas",
    county: "Dallas County",
    status: "For Sale",
    assetType: "Industrial",
    propertyName: "Sanden Drive Industrial",
    address: "10300 SANDEN DR",
    city: "Dallas",
    sizeLabel: "352,860 SF",
    landLabel: "535,380 SF land",
    priceLabel: "$40.6M assessed",
    capRate: "Owner-user / logistics",
    yearBuilt: "2007",
    zoning: "Industrial",
    sourceLabel: "DCAD appraisal + parcel geometry",
    parcelId: "008052000B01A0000",
    coordinates: "32.8906, -96.6972",
    tags: ["Warehouse", "Large site", "DCAD-rich"],
    highlight: "Large warehouse parcel with owner, value, building, land, and geometry intel loaded.",
  },
  {
    id: "wr-market-greenville-retail",
    market: "Dallas",
    county: "Dallas County",
    status: "For Lease",
    assetType: "Retail",
    propertyName: "Greenville Ave Retail",
    address: "1616 GREENVILLE AVE",
    city: "Dallas",
    sizeLabel: "7,150 SF",
    landLabel: "28,188 SF land",
    priceLabel: "$1.72M assessed",
    capRate: "Neighborhood retail",
    yearBuilt: "1961",
    zoning: "Free standing retail",
    sourceLabel: "DCAD owner + permits",
    parcelId: "00000155887000000",
    coordinates: "32.8160, -96.7706",
    tags: ["Retail", "Permits", "Owner intel"],
    highlight: "Small commercial site with appraisal, ownership, permits, and parcel dimension samples connected.",
  },
  {
    id: "wr-market-lakewood-corner",
    market: "Dallas",
    county: "Dallas County",
    status: "Watch",
    assetType: "Retail",
    propertyName: "Lakewood Corner Store",
    address: "1701 SKILLMAN ST",
    city: "Dallas",
    sizeLabel: "3,304 SF",
    landLabel: "23,320 SF land",
    priceLabel: "$2.06M assessed",
    capRate: "Corner retail",
    yearBuilt: "2000",
    zoning: "Convenience store",
    sourceLabel: "DCAD + zoning",
    parcelId: "00000182602000000",
    coordinates: "32.8128, -96.7612",
    tags: ["Corner", "Zoning", "CO intel"],
    highlight: "Commercial corner parcel with zoning and permit intelligence available in the map card.",
  },
  {
    id: "wr-market-louisville-pilot",
    market: "Louisville",
    county: "Jefferson County",
    status: "Pilot Intel",
    assetType: "Parcel Foundation",
    propertyName: "Louisville Parcel Foundation",
    address: "Jefferson County Parcel Foundation",
    city: "Louisville",
    sizeLabel: "284,428 exportable parcels",
    landLabel: "Area/length loaded",
    priceLabel: "PVA value pending",
    capRate: "PVA join needed",
    yearBuilt: "Pending PVA",
    zoning: "Zoning layer pending",
    sourceLabel: "County parcel IDs + geometry",
    parcelId: "LRSN / PARCELID",
    coordinates: "38.2527, -85.7585",
    tags: ["Louisville", "PVA pending"],
    highlight: "Louisville has parcel geometry, LRSN, PARCELID, GeoJSON, KML, shapefile, search shards, and viewport chunks. Owner/appraisal data is the next major marketplace gap.",
  },
];

const MARKETPLACE_FILTERS = ["All", "For Sale", "For Lease", "Watch", "Pilot Intel"];

const RESIDENTIAL_MARKETPLACE_PROPERTIES = [
  {
    id: "wr-resi-national-county-rollout",
    market: "United States",
    county: "All U.S. Counties",
    status: "Watch",
    assetType: "Nationwide Residential",
    propertyName: "Nationwide Residential County Network",
    address: "Residential listings across U.S. county markets",
    city: "United States",
    sizeLabel: "All county markets",
    landLabel: "Parcel-led residential search",
    priceLabel: "MLS/resale feeds pending",
    capRate: "Demand and migration watch",
    yearBuilt: "County source dependent",
    zoning: "County zoning joins",
    sourceLabel: "Real Estate Savant universal parcel schema",
    parcelId: "county_id / parcel_id",
    coordinates: "United States coverage",
    tags: ["Nationwide", "Residential", "Demand signals"],
    highlight: "Residential listings should not be limited to Dallas or Louisville. The page is now framed for all U.S. counties as the county data adapters come online.",
  },
  {
    id: "wr-resi-dallas-parcel-search",
    market: "Dallas",
    county: "Dallas County",
    status: "Watch",
    assetType: "Single Family",
    propertyName: "Dallas Residential Parcel Watch",
    address: "Dallas residential parcel search",
    city: "Dallas",
    sizeLabel: "Parcel-led inventory",
    landLabel: "Lot size from parcel layer",
    priceLabel: "Listing feed pending",
    capRate: "Owner / resale watch",
    yearBuilt: "County record when matched",
    zoning: "Residential layer hook",
    sourceLabel: "DCAD parcel + appraisal foundation",
    parcelId: "Address / account search",
    coordinates: "Dallas County viewport",
    tags: ["Single family", "Parcel intel", "Demand watch"],
    highlight: "Residential listings can now sit on top of the same parcel intelligence window without changing the live map behavior.",
  },
  {
    id: "wr-resi-dallas-high-value",
    market: "Dallas",
    county: "Dallas County",
    status: "Watch",
    assetType: "Residential",
    propertyName: "High-Value Residential Signals",
    address: "Dallas appraisal and permit watch",
    city: "Dallas",
    sizeLabel: "Value + permit signals",
    landLabel: "Parcel dimensions connected",
    priceLabel: "Comp feed pending",
    capRate: "Demand signal",
    yearBuilt: "County record when matched",
    zoning: "Residential / mixed use checks",
    sourceLabel: "Parcel value + permits + dimensions",
    parcelId: "County-aware parcel IDs",
    coordinates: "Dallas County viewport",
    tags: ["Value change", "Permits", "Dimensions"],
    highlight: "This channel is ready for residential comps, sale velocity, permit activity, and demand scoring once listing feeds are connected.",
  },
  {
    id: "wr-resi-louisville-foundation",
    market: "Louisville",
    county: "Jefferson County",
    status: "Pilot Intel",
    assetType: "Residential Parcels",
    propertyName: "Louisville Residential Foundation",
    address: "Jefferson County residential parcel search",
    city: "Louisville",
    sizeLabel: "Parcel polygons loaded",
    landLabel: "Area/length available",
    priceLabel: "PVA value pending",
    capRate: "PVA join needed",
    yearBuilt: "Pending PVA",
    zoning: "Zoning join pending",
    sourceLabel: "County parcel IDs + geometry",
    parcelId: "LRSN / PARCELID",
    coordinates: "38.2527, -85.7585",
    tags: ["Louisville", "Residential", "PVA pending"],
    highlight: "Louisville residential listings have the county parcel foundation ready; owner, value, and comps are the next data joins.",
  },
];

const RENTAL_MARKETPLACE_PROPERTIES = [
  {
    id: "wr-rentals-national-county-rollout",
    market: "United States",
    county: "All U.S. Counties",
    status: "Watch",
    assetType: "Nationwide Rentals",
    propertyName: "Nationwide Rental County Network",
    address: "Rental demand across U.S. county markets",
    city: "United States",
    sizeLabel: "All county markets",
    landLabel: "Parcel-led rental search",
    priceLabel: "Rent feeds pending",
    capRate: "Migration and demand watch",
    yearBuilt: "County source dependent",
    zoning: "County zoning joins",
    sourceLabel: "Real Estate Savant universal parcel schema",
    parcelId: "county_id / parcel_id",
    coordinates: "United States coverage",
    tags: ["Nationwide", "Rentals", "Migration"],
    highlight: "Rental intelligence is now positioned as a national county-by-county system, with demand and migration signals layered in as the data expands.",
  },
  {
    id: "wr-rentals-dallas-multifamily",
    market: "Dallas",
    county: "Dallas County",
    status: "Watch",
    assetType: "Multifamily",
    propertyName: "Dallas Multifamily Rental Watch",
    address: "Dallas rental corridor search",
    city: "Dallas",
    sizeLabel: "Multifamily parcel search",
    landLabel: "Parcel area + dimensions",
    priceLabel: "Rent feed pending",
    capRate: "Rent growth watch",
    yearBuilt: "County record when matched",
    zoning: "Multifamily / mixed use",
    sourceLabel: "Parcel, permit, and development signals",
    parcelId: "Address / account search",
    coordinates: "Dallas County viewport",
    tags: ["Rentals", "Multifamily", "Demand watch"],
    highlight: "Rental listings can use the existing parcel engine for multifamily sites, nearby permits, zoning, and demand overlays.",
  },
  {
    id: "wr-rentals-dallas-lease-up",
    market: "Dallas",
    county: "Dallas County",
    status: "Watch",
    assetType: "Rental Pipeline",
    propertyName: "Lease-Up and Development Signals",
    address: "Dallas development activity watch",
    city: "Dallas",
    sizeLabel: "Development-linked parcels",
    landLabel: "Green demand highlights",
    priceLabel: "Rent comps pending",
    capRate: "Lease-up watch",
    yearBuilt: "Permit-derived when available",
    zoning: "Use check pending by parcel",
    sourceLabel: "Development index + permits",
    parcelId: "County-aware parcel IDs",
    coordinates: "Dallas County viewport",
    tags: ["Lease-up", "Development", "Permits"],
    highlight: "This rental channel is ready to show parcels with development movement and future rent-demand signals on the aerial map.",
  },
  {
    id: "wr-rentals-louisville-foundation",
    market: "Louisville",
    county: "Jefferson County",
    status: "Pilot Intel",
    assetType: "Rental Parcels",
    propertyName: "Louisville Rental Foundation",
    address: "Jefferson County multifamily parcel search",
    city: "Louisville",
    sizeLabel: "Parcel polygons loaded",
    landLabel: "Area/length available",
    priceLabel: "Rent feed pending",
    capRate: "Rental demand join needed",
    yearBuilt: "Pending PVA",
    zoning: "Zoning join pending",
    sourceLabel: "County parcel IDs + geometry",
    parcelId: "LRSN / PARCELID",
    coordinates: "38.2527, -85.7585",
    tags: ["Louisville", "Rentals", "PVA pending"],
    highlight: "Louisville rental listings now have a destination page while the deeper PVA, rent, and zoning joins are completed.",
  },
];

const LISTING_PAGE_CONFIGS = {
  cre: {
    headerBadge: "MARKETPLACE",
    sidebarEyebrow: "Best Commercial Deals",
    pageTitle: "Best Deals Nationwide",
    heroImage: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=2000&q=80",
    heroAlt: "Commercial skyline",
    properties: COMMERCIAL_MARKETPLACE_PROPERTIES,
    liveMetricLabel: "Live Deals",
    searchTabs: ["For Lease", "For Sale", "Auctions", "Businesses"],
    searchPlaceholder: "Search assets, counties, parcel IDs, or markets",
    emptyLabel: "No commercial property records match the current filters.",
    readinessTitle: "Nationwide County Rollout",
    coverageLabel: "across U.S. counties",
    mapSearch: "commercial",
    mapButtonLabel: "Open Property Map",
    readinessRows: [
      ["All U.S. counties", "Target", "text-cyan-100"],
      ["Universal county adapter", "Ready", "text-emerald-100"],
      ["Active examples", "Dallas + Jefferson", "text-emerald-100"],
      ["County owner/appraisal joins", "County-by-county", "text-amber-100"],
      ["Listings feeds", "Next", "text-amber-100"],
    ],
  },
  resi: {
    headerBadge: "RESI LISTINGS",
    sidebarEyebrow: "Residential Listings",
    pageTitle: "Resi Listings",
    heroImage: "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=2000&q=80",
    heroAlt: "Residential neighborhood",
    properties: RESIDENTIAL_MARKETPLACE_PROPERTIES,
    liveMetricLabel: "Watch Lists",
    searchTabs: ["For Sale", "New To Market", "Investment", "Off Market"],
    searchPlaceholder: "Search homes, counties, parcel IDs, or markets",
    emptyLabel: "No residential listing records match the current filters.",
    readinessTitle: "Nationwide Residential Rollout",
    coverageLabel: "across U.S. counties",
    mapSearch: "single family",
    mapButtonLabel: "Open Residential Map",
    readinessRows: [
      ["All U.S. counties", "Target", "text-cyan-100"],
      ["Residential parcel cards", "Ready", "text-emerald-100"],
      ["County adapters", "Expandable", "text-emerald-100"],
      ["MLS/resale feed", "Needed", "text-amber-100"],
      ["Comps and demand scoring", "Next", "text-cyan-100"],
    ],
  },
  rentals: {
    headerBadge: "RENTALS",
    sidebarEyebrow: "Rental Listings",
    pageTitle: "Rentals",
    heroImage: "https://images.unsplash.com/photo-1460317442991-0ec209397118?auto=format&fit=crop&w=2000&q=80",
    heroAlt: "Apartment building",
    properties: RENTAL_MARKETPLACE_PROPERTIES,
    liveMetricLabel: "Rental Signals",
    searchTabs: ["For Rent", "Multifamily", "Lease-Up", "Tenant Demand"],
    searchPlaceholder: "Search rentals, counties, parcels, or markets",
    emptyLabel: "No rental listing records match the current filters.",
    readinessTitle: "Nationwide Rental Rollout",
    coverageLabel: "across U.S. counties",
    mapSearch: "multi family",
    mapButtonLabel: "Open Rental Map",
    readinessRows: [
      ["All U.S. counties", "Target", "text-cyan-100"],
      ["Multifamily parcel search", "Expandable", "text-emerald-100"],
      ["Development highlights", "Ready", "text-emerald-100"],
      ["Rent feed", "Needed", "text-amber-100"],
      ["Migration demand layer", "Next", "text-cyan-100"],
    ],
  },
};

function getListingPageConfig(listingKind) {
  return LISTING_PAGE_CONFIGS[listingKind] || LISTING_PAGE_CONFIGS.cre;
}

const LISTING_ASSET_IMAGES = {
  Industrial: "https://images.unsplash.com/photo-1581092921461-39b9d08a9b21?auto=format&fit=crop&w=900&q=80",
  Retail: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=900&q=80",
  "Parcel Foundation": "https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=900&q=80",
  "Nationwide Coverage": "https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?auto=format&fit=crop&w=900&q=80",
  "Single Family": "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=900&q=80",
  "Nationwide Residential": "https://images.unsplash.com/photo-1449824913935-59a10b8d2000?auto=format&fit=crop&w=900&q=80",
  Residential: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=900&q=80",
  "Residential Parcels": "https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?auto=format&fit=crop&w=900&q=80",
  Multifamily: "https://images.unsplash.com/photo-1460317442991-0ec209397118?auto=format&fit=crop&w=900&q=80",
  "Nationwide Rentals": "https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=900&q=80",
  "Rental Pipeline": "https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=900&q=80",
  "Rental Parcels": "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=900&q=80",
};

function listingImageForProperty(property, fallbackImage, listingKind = property.listingKind) {
  if (listingKind === "cre" && String(property.propertyName || "").trim().toLowerCase().includes("rose building")) {
    return "/images/listings/rose-building.png";
  }
  return property.image || LISTING_ASSET_IMAGES[property.assetType] || fallbackImage;
}

function listingDealBadgeForProperty(property, nearbyDevelopments = []) {
  return calculateListingDeal(property, { nearbyDevelopments }).label;
}

function listingDealBadgeClass(score) {
  if (score >= 80) return "bg-emerald-600";
  if (score >= 65) return "bg-blue-600";
  if (score >= 45) return "bg-amber-500";
  return "bg-red-600";
}

let listingZoningCasesPromise = null;

function loadListingZoningCases() {
  if (!listingZoningCasesPromise) {
    listingZoningCasesPromise = requestJson("/data/entitlements/cases.json").then(async (response) => {
      if (!response.ok) return [];
      return (await response.json()).records || [];
    }).catch(() => []);
  }
  return listingZoningCasesPromise;
}

function isDallasListingCoordinate(coordinates) {
  return coordinates && coordinates[0] >= DALLAS_LIVE_GEO_BOUNDS.minLng && coordinates[0] <= DALLAS_LIVE_GEO_BOUNDS.maxLng && coordinates[1] >= DALLAS_LIVE_GEO_BOUNDS.minLat && coordinates[1] <= DALLAS_LIVE_GEO_BOUNDS.maxLat;
}

async function loadNearbyListingDevelopments(property) {
  const coordinates = parseListingCoordinates(property.coordinates);
  if (!isDallasListingCoordinate(coordinates)) return [];
  const [longitude, latitude] = coordinates;
  const bounds = { minLng: longitude - 0.009, maxLng: longitude + 0.009, minLat: latitude - 0.008, maxLat: latitude + 0.008 };
  const [cases, permits] = await Promise.all([
    loadListingZoningCases(),
    loadPermitRecordsForViewport({ bounds, maxFeatures: 250 }).catch(() => []),
  ]);
  const caseSignals = cases.map((record) => ({
    id: record.caseId,
    title: record.caseNumber || "Zoning case",
    type: record.category || "zoning-case",
    centroid: record.centroid,
    scale: Number(record.parcelLinkCount || 0) >= 20 ? "major" : Number(record.parcelLinkCount || 0) >= 5 ? "medium" : "small",
    evidenceStrength: "planning",
    impact: "positive",
    source: "City of Dallas zoning case",
  }));
  const permitSignals = permits
    .filter((record) => /new construction|alteration|addition|demolition|certificate of occupancy/i.test(`${record.permitType || ""} ${record.permitSubtype || ""} ${record.description || ""}`))
    .map((record) => {
      const description = `${record.permitType || ""} ${record.permitSubtype || ""} ${record.description || ""}`;
      const status = String(record.permitStatus || "");
      return {
        id: record.permitRecordId || record.permitNumber,
        title: record.permitType || record.permitNumber || "Development permit",
        type: record.permitType || "permit",
        longitude: record.longitude,
        latitude: record.latitude,
        scale: /commercial new construction|multifamily|mixed.use|high.rise/i.test(description) ? "major" : /new construction|alteration|addition/i.test(description) ? "medium" : "small",
        evidenceStrength: /issued|complete|final|approved/i.test(status) ? "issued-permit" : "planning",
        impact: /demolition/i.test(description) && !/new construction|addition/i.test(description) ? "negative" : "positive",
        source: record.sourceDataset || "City of Dallas permit",
      };
    });
  return [...caseSignals, ...permitSignals];
}

const DALLAS_PARCEL_FEATURES = [
  {
    accountNum: "008052000B01A0000",
    blockId: "B/8052",
    areaLabel: "14.8865 Acre",
    centroid: [88.97, 11.0],
    points: [[88.45, 9.69], [90.29, 9.68], [90.32, 12.74], [88.45, 12.75], [88.41, 12.72], [88.4, 9.73], [88.45, 9.69]],
  },
  {
    accountNum: "00000156442000000",
    blockId: "C/1491",
    areaLabel: "0.1194 Acre",
    centroid: [9.85, 89.68],
    points: [[9.86, 89.56], [10.01, 89.69], [9.83, 89.85], [9.68, 89.72], [9.86, 89.56]],
  },
  {
    accountNum: "00000182602000000",
    blockId: "A/1877",
    areaLabel: "0.5349 Acre",
    centroid: [22.1, 89.15],
    points: [[22.01, 89.2], [22.01, 89.19], [22.0, 88.82], [22.46, 88.82], [22.46, 89.08], [22.11, 89.4], [22.1, 89.39], [21.9, 89.22], [21.9, 89.2], [22.01, 89.2]],
  },
  {
    accountNum: "00000155887000000",
    blockId: "K/1477",
    areaLabel: "0.6471 Acre",
    centroid: [14.79, 90.15],
    points: [[14.89, 90.32], [14.67, 90.32], [14.51, 90.32], [14.51, 89.92], [15.14, 89.92], [15.16, 90.31], [14.89, 90.32]],
  },
];

const PARCEL_DIMENSION_SOURCE = {
  fileName: "ParcelDimension (1).zip",
  layerName: "ParcelDimension",
  detectedFiles: ["ParcelDimension.shp", "ParcelDimension.dbf", "ParcelDimension.shx", "ParcelDimension.prj", "ParcelDimension.sbn", "ParcelDimension.sbx"],
  renderStrategy: "viewport-loaded dimension labels and measurement overlays",
};

const DALLAS_PARCEL_DIMENSIONS = {
  "008052000B01A0000": {
    dimensionId: "PDIM-B8052-001",
    frontageFt: 1842,
    depthFt: 1328,
    perimeterFt: 6340,
    dimensionLabel: "Approx. 1,842 ft frontage × 1,328 ft depth",
    bearingLabel: "Industrial block dimension layer",
    sourceLayer: "ParcelDimension",
  },
  "00000155887000000": {
    dimensionId: "PDIM-K1477-001",
    frontageFt: 286,
    depthFt: 98,
    perimeterFt: 768,
    dimensionLabel: "Approx. 286 ft frontage × 98 ft depth",
    bearingLabel: "Greenville Ave retail dimension",
    sourceLayer: "ParcelDimension",
  },
  "00000182602000000": {
    dimensionId: "PDIM-A1877-001",
    frontageFt: 214,
    depthFt: 109,
    perimeterFt: 646,
    dimensionLabel: "Approx. 214 ft frontage × 109 ft depth",
    bearingLabel: "Skillman corner dimension",
    sourceLayer: "ParcelDimension",
  },
  "00000156442000000": {
    dimensionId: "PDIM-C1491-001",
    frontageFt: 65,
    depthFt: 80,
    perimeterFt: 290,
    dimensionLabel: "Approx. 65 ft frontage × 80 ft depth",
    bearingLabel: "Henderson frontage dimension",
    sourceLayer: "ParcelDimension",
  },
};

const DCAD_OWNER_BY_ACCOUNT = new Map(dcadOwnerData.parcels.map((parcel) => [parcel.accountNum, parcel]));
const DEVELOPMENT_SOURCE_BY_ID = new Map(developmentIntel.sources.map((source) => [source.id, source]));
const PARCEL_DIMENSION_LABELS_BY_ACCOUNT = new Map(parcelDimensionLabels.parcels.map((parcel) => [parcel.accountNum, parcel]));
const REAL_PARCEL_GEOMETRY_BY_ACCOUNT = new Map(selectedParcelGeojson.features.map((feature) => [feature.properties.accountNum, feature]));
const FULL_PARCEL_ACCESS_META = parcelAccessManifest;

function parcelMatchesSelection(parcel, selectedParcelId) {
  if (!parcel || !selectedParcelId) return false;
  const selected = String(selectedParcelId);
  const selectedLocal = selected.split(":").pop();
  return [
    countyAwareParcelId(parcel),
    parcel.countyParcelId,
    parcel.accountNum,
    parcel.accountNumber,
    parcel.gisParcelId,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .some((value) => value === selected || value === selectedLocal || value.split(":").pop() === selectedLocal);
}

const DALLAS_LIVE_PARCEL_GEOMETRY = {
  "008052000B01A0000": {
    center: [-96.6972, 32.8906],
    points: [
      [-96.7045, 32.8872],
      [-96.6904, 32.8874],
      [-96.6902, 32.8941],
      [-96.7041, 32.8942],
      [-96.7045, 32.8872],
    ],
  },
  "00000155887000000": {
    center: [-96.7707, 32.8119],
    points: [
      [-96.7716, 32.8112],
      [-96.7696, 32.8113],
      [-96.7695, 32.8127],
      [-96.7714, 32.8128],
      [-96.7716, 32.8112],
    ],
  },
  "00000182602000000": {
    center: [-96.7614, 32.8061],
    points: [
      [-96.7625, 32.8052],
      [-96.7604, 32.8054],
      [-96.7603, 32.8068],
      [-96.7621, 32.8071],
      [-96.7625, 32.8052],
    ],
  },
  "00000156442000000": {
    center: [-96.7847, 32.8144],
    points: [
      [-96.7854, 32.8138],
      [-96.7841, 32.8139],
      [-96.7840, 32.8149],
      [-96.7852, 32.8150],
      [-96.7854, 32.8138],
    ],
  },
};

const LIVE_MAP_TILES = [
  { col: 0, row: 0 },
  { col: 1, row: 0 },
  { col: 2, row: 0 },
  { col: 0, row: 1 },
  { col: 1, row: 1 },
  { col: 2, row: 1 },
  { col: 0, row: 2 },
  { col: 1, row: 2 },
  { col: 2, row: 2 },
];

function clamp(value, min, max) {
  const safeValue = Number.isFinite(value) ? value : min;
  return Math.min(Math.max(safeValue, min), max);
}

function smoothStep(value) {
  const progress = clamp(value, 0, 1);
  return progress * progress * (3 - 2 * progress);
}

function safePoint(point, fallback = [0, 0]) {
  if (!Array.isArray(point) || point.length < 2) return fallback;
  const x = Number(point[0]);
  const y = Number(point[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return fallback;
  return [x, y];
}

function normalizeBearing(bearing) {
  let next = Number.isFinite(bearing) ? bearing % 360 : 0;
  if (next > 180) next -= 360;
  if (next < -180) next += 360;
  return next;
}

function getCameraForLocation(location) {
  const camera = location && location.camera ? location.camera : DALLAS_LOCATION.camera;
  return { ...camera };
}

function getParcelViewCamera() {
  return getCameraForLocation(DALLAS_LOCATION);
}

function getEarthIntroCamera() {
  return { ...EARTH_INTRO_CAMERA };
}

function interpolateCamera(startCamera, endCamera, progress) {
  const start = startCamera || getEarthIntroCamera();
  const end = endCamera || getParcelViewCamera();
  const eased = clamp(progress, 0, 1);
  return {
    x: start.x + (end.x - start.x) * eased,
    y: start.y + (end.y - start.y) * eased,
    zoom: start.zoom + (end.zoom - start.zoom) * eased,
    pitch: start.pitch + (end.pitch - start.pitch) * eased,
    bearing: normalizeBearing(start.bearing + (end.bearing - start.bearing) * eased),
  };
}

function screenPointToLngLat(point, geoBounds = DALLAS_LIVE_GEO_BOUNDS, fallbackCamera = DALLAS_LOCATION.camera) {
  const bounds = geoBounds || DALLAS_LIVE_GEO_BOUNDS;
  const fallback = fallbackCamera || DALLAS_LOCATION.camera;
  const [x, y] = safePoint(point, [fallback.x, fallback.y]);
  const lng = bounds.minLng + (x / 100) * (bounds.maxLng - bounds.minLng);
  const lat = bounds.minLat + (1 - y / 100) * (bounds.maxLat - bounds.minLat);
  return [lng, lat];
}

function lngLatToScreenPoint(lng, lat, geoBounds = DALLAS_LIVE_GEO_BOUNDS, fallbackCoordinates = DALLAS_LOCATION.coordinates) {
  const bounds = geoBounds || DALLAS_LIVE_GEO_BOUNDS;
  const fallback = Array.isArray(fallbackCoordinates) ? fallbackCoordinates : DALLAS_LOCATION.coordinates;
  const safeLng = Number.isFinite(lng) ? lng : fallback[0];
  const safeLat = Number.isFinite(lat) ? lat : fallback[1];
  const x = ((safeLng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100;
  const y = (1 - (safeLat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 100;
  return [clamp(x, 0, 100), clamp(y, 0, 100)];
}

function lngLatInsideDallasBounds(lng, lat) {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= DALLAS_LIVE_GEO_BOUNDS.minLng &&
    lng <= DALLAS_LIVE_GEO_BOUNDS.maxLng &&
    lat >= DALLAS_LIVE_GEO_BOUNDS.minLat &&
    lat <= DALLAS_LIVE_GEO_BOUNDS.maxLat
  );
}

function lngLatInsideBounds(lng, lat, bounds) {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    bounds &&
    lng >= bounds.minLng &&
    lng <= bounds.maxLng &&
    lat >= bounds.minLat &&
    lat <= bounds.maxLat
  );
}

function normalizePlaceSearch(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findPlaceTarget(query) {
  const normalized = normalizePlaceSearch(query);
  if (!normalized) return null;
  const noiseWords = new Set(["show", "me", "find", "search", "open", "view", "map", "maps", "parcel", "parcels", "property", "properties", "in", "for", "the"]);
  const placeQuery = normalized.split(" ").filter((word) => !noiseWords.has(word)).join(" ");
  return PLACE_SEARCH_TARGETS.find((target) => target.aliases.some((alias) => {
    const normalizedAlias = normalizePlaceSearch(alias);
    return normalized === normalizedAlias || placeQuery === normalizedAlias;
  })) || null;
}

function findPlaceTargetByLngLat(lng, lat) {
  const namedTarget = PLACE_SEARCH_TARGETS.find((target) => target.id !== NATIONAL_ROAMING_ID && lngLatInsideBounds(lng, lat, target.geoBounds));
  if (namedTarget) return namedTarget;
  const countyDataset = availableCountyDatasets.find((dataset) => dataset.id !== activeCountyDataset.id && lngLatInsideBounds(lng, lat, dataset.map.geoBounds));
  return countyDataset ? mapLocationForPlaceId(countyDataset.id) : null;
}

function findRovingMapContextByLngLat(lng, lat) {
  const placeTarget = findPlaceTargetByLngLat(lng, lat);
  if (placeTarget) return placeTarget;
  if (lngLatInsideDallasBounds(lng, lat)) return DALLAS_LOCATION;
  if (lngLatInsideBounds(lng, lat, NATIONAL_US_GEO_BOUNDS)) return NATIONAL_US_LOCATION;
  return null;
}

function parcelDatasetForPlaceId(placeId) {
  if (placeId === NATIONAL_ROAMING_ID) return null;
  return availableCountyDatasets.find((county) => county.id === placeId) || activeCountyDataset;
}

function parcelDatasetForRecord(parcel, fallbackDataset = activeCountyDataset) {
  const sourceCountyId = String(parcel?.sourceCountyId || "").trim();
  return availableCountyDatasets.find((county) => county.id === sourceCountyId) || fallbackDataset || activeCountyDataset;
}

function mapLocationForPlaceId(placeId) {
  if (placeId === NATIONAL_ROAMING_ID) return NATIONAL_US_LOCATION;
  const knownTarget = PLACE_SEARCH_TARGETS.find((target) => target.id === placeId);
  if (knownTarget) return knownTarget;
  const dataset = availableCountyDatasets.find((county) => county.id === placeId);
  if (!dataset) return DALLAS_LOCATION;
  return {
    id: dataset.id,
    sourceCountyId: dataset.id,
    name: dataset.map.locationName,
    type: dataset.map.locationType,
    status: dataset.map.status,
    coordinates: dataset.map.coordinates,
    camera: dataset.map.camera,
    geoBounds: dataset.map.geoBounds,
    mapZoom: 13.2,
  };
}

function geolocationErrorLabel(error) {
  if (error?.code === 1) return "Location permission denied";
  if (error?.code === 2) return "Location unavailable";
  if (error?.code === 3) return "Location request timed out";
  return "Location could not be found";
}

function screenBoundsFromMapBounds(bounds, geoBounds = DALLAS_LIVE_GEO_BOUNDS) {
  const activeBounds = geoBounds || DALLAS_LIVE_GEO_BOUNDS;
  if (!bounds) return getViewportBounds(DALLAS_LOCATION.camera);
  const west = typeof bounds.getWest === "function" ? bounds.getWest() : activeBounds.minLng;
  const east = typeof bounds.getEast === "function" ? bounds.getEast() : activeBounds.maxLng;
  const south = typeof bounds.getSouth === "function" ? bounds.getSouth() : activeBounds.minLat;
  const north = typeof bounds.getNorth === "function" ? bounds.getNorth() : activeBounds.maxLat;
  const [minX, maxY] = lngLatToScreenPoint(west, south, activeBounds);
  const [maxX, minY] = lngLatToScreenPoint(east, north, activeBounds);
  return { minX, minY, maxX, maxY };
}

function mapLibreZoomFromCamera(camera) {
  const safeCamera = camera || DALLAS_LOCATION.camera;
  return clamp(4.45 + (safeCamera.zoom - 0.58) * 7.2, 3.4, 17.8);
}

function cameraZoomFromMapLibreZoom(zoom) {
  return clamp((zoom - 4.45) / 7.2 + 0.58, 0.42, 1.8);
}

function formatCurrency(value) {
  const numericValue = Number.parseFloat(value || 0);
  return Number.isFinite(numericValue)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(numericValue)
    : "$0";
}

function formatCurrencyIfPresent(value) {
  if (value === undefined || value === null || value === "") return "";
  const numericValue = Number.parseFloat(value);
  return Number.isFinite(numericValue) ? formatCurrency(numericValue) : "";
}

function formatInteger(value) {
  const numericValue = Number.parseInt(value || 0, 10);
  return Number.isFinite(numericValue) ? new Intl.NumberFormat("en-US").format(numericValue) : "0";
}

function getParcelRenderProfile(camera) {
  const zoom = Number.isFinite(camera?.zoom) ? camera.zoom : DALLAS_LOCATION.camera.zoom;
  if (zoom >= PARCEL_ZOOM_THRESHOLDS.detail) {
    return { stage: "detail", maxFeatures: 10000, showBlockLabels: true, showLabels: true, showDimensions: true, lineWeight: 2.2 };
  }
  if (zoom >= PARCEL_ZOOM_THRESHOLDS.parcel) {
    return { stage: "parcel", maxFeatures: 7200, showBlockLabels: true, showLabels: true, showDimensions: false, lineWeight: 1.55 };
  }
  if (zoom >= PARCEL_ZOOM_THRESHOLDS.block) {
    return { stage: "block", maxFeatures: 3600, showBlockLabels: true, showLabels: false, showDimensions: false, lineWeight: 0.95 };
  }
  return { stage: "broad", maxFeatures: 1200, showBlockLabels: false, showLabels: false, showDimensions: false, lineWeight: 0.45 };
}

function getDallasFeaturedProperty() {
  return DCAD_DALLAS_SAMPLE[0];
}

function hasDallasParcelGeometry() {
  return true;
}

function getParcelDimensionRecord(accountNum) {
  return DALLAS_PARCEL_DIMENSIONS[accountNum] || null;
}

function getDallasRenderableParcels() {
  return DALLAS_PARCEL_FEATURES.map((feature) => {
    const record = DCAD_DALLAS_SAMPLE.find((item) => item.accountNum === feature.accountNum);
    if (!record) return null;
    const ownerRecord = DCAD_OWNER_BY_ACCOUNT.get(feature.accountNum);
    const centroid = safePoint(feature.centroid, [50, 50]);
    const points = Array.isArray(feature.points) ? feature.points.map((point) => safePoint(point, centroid)) : [];
    const dimensions = getParcelDimensionRecord(feature.accountNum);
    const dimensionLabels = PARCEL_DIMENSION_LABELS_BY_ACCOUNT.get(feature.accountNum)?.labels || [];
    const liveGeometry = DALLAS_LIVE_PARCEL_GEOMETRY[feature.accountNum] || null;
    const realGeometry = REAL_PARCEL_GEOMETRY_BY_ACCOUNT.get(feature.accountNum) || null;
    return {
      ...record,
      ...feature,
      ...(ownerRecord || {}),
      propertyName: ownerRecord?.businessName || record.propertyName,
      address: ownerRecord?.propertyAddress || record.address,
      buildingClass: ownerRecord?.buildingClassCode || record.buildingClass,
      totalValue: ownerRecord?.totalValue ?? record.totalValue,
      improvementValue: ownerRecord?.improvementValue ?? record.improvementValue,
      landValue: ownerRecord?.landValue ?? record.landValue,
      landAreaSqFt: ownerRecord?.landArea ?? record.landAreaSqFt,
      cityJurisdiction: ownerRecord?.cityJurisdiction || record.cityJurisdiction,
      isdJurisdiction: ownerRecord?.isdJurisdiction || record.isdJurisdiction,
      centroid,
      points,
      dimensions,
      dimensionLabels,
      liveGeometry,
      realGeometry,
    };
  }).filter((parcel) => parcel && parcel.points.length >= 3);
}

function getViewportBounds(viewCamera) {
  const safeCamera = viewCamera || DALLAS_LOCATION.camera;
  const span = clamp(38 / clamp(safeCamera.zoom, 0.75, 1.8), 16, 46);
  return {
    minX: clamp(safeCamera.x - span / 2, 0, 100),
    maxX: clamp(safeCamera.x + span / 2, 0, 100),
    minY: clamp(safeCamera.y - span / 2, 0, 100),
    maxY: clamp(safeCamera.y + span / 2, 0, 100),
  };
}

function getVisibleDallasParcels(viewCamera) {
  const bounds = getViewportBounds(viewCamera);
  const parcels = getDallasRenderableParcels();
  const visible = filterParcelRecordsForViewport(parcels, { bounds });
  return visible.length ? visible : getDallasRenderableParcels();
}

function getSearchableDallasParcels() {
  return getDallasRenderableParcels();
}

function filterParcels(parcels, searchText) {
  return filterParcelRecordsForViewport(parcels, { search: searchText });
}

function searchDallasParcels(searchText) {
  const query = String(searchText || "").trim();
  if (!query) return [];
  return searchParcelRecords(getSearchableDallasParcels(), query);
}

function mergeParcelSearchResults(maxResults, ...collections) {
  const seen = new Set();
  return collections
    .flat()
    .filter((parcel) => {
      const id = countyAwareParcelId(parcel);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, maxResults);
}

function getDevelopmentSearchText(record) {
  const sources = (record.sourceIds || []).map((sourceId) => DEVELOPMENT_SOURCE_BY_ID.get(sourceId)).filter(Boolean);
  return [
    record.title,
    record.address,
    record.type,
    record.stage,
    record.summary,
    record.linkedAccount,
    ...(record.keywords || []),
    ...sources.flatMap((source) => [source.name, source.type, source.description]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function searchDevelopmentIntel(searchText) {
  const query = String(searchText || "").trim().toLowerCase();
  if (!query) return [];
  return developmentIntel.records
    .filter((record) => getDevelopmentSearchText(record).includes(query))
    .map((record) => ({
      ...record,
      sources: (record.sourceIds || []).map((sourceId) => DEVELOPMENT_SOURCE_BY_ID.get(sourceId)).filter(Boolean),
    }));
}

function getIndexedDevelopmentSearchText(record) {
  return [
    record.title,
    record.parcelPropertyName,
    record.parcelAddress,
    record.parcelId,
    record.parcelGisId,
    record.latestActivityDate,
    ...(record.signalTypes || []),
    ...(record.stages || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function searchIndexedDevelopments(records, searchText, maxResults = 7) {
  const query = String(searchText || "").trim().toLowerCase();
  if (!query) return [];
  return Array.from(records || [])
    .filter((record) => getIndexedDevelopmentSearchText(record).includes(query))
    .sort((a, b) => (Number(b.score || 0) - Number(a.score || 0)) || (Number(b.signalCount || 0) - Number(a.signalCount || 0)))
    .slice(0, maxResults)
    .map(toIndexedDevelopmentPresentation)
    .filter(Boolean);
}

function normalizeSearchAddress(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\b(street)\b/g, "st")
    .replace(/\b(avenue)\b/g, "ave")
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(drive)\b/g, "dr")
    .replace(/\b(boulevard)\b/g, "blvd")
    .replace(/\b(lane)\b/g, "ln")
    .replace(/\b(court)\b/g, "ct")
    .replace(/\b(place)\b/g, "pl")
    .replace(/\b(parkway)\b/g, "pkwy")
    .replace(/\s+/g, " ");
}

function isExactParcelAddressMatch(parcel, query) {
  const normalizedQuery = normalizeSearchAddress(query);
  if (!normalizedQuery) return false;
  return [parcel?.address, parcel?.propertyAddress].some((address) => normalizeSearchAddress(address) === normalizedQuery);
}

function projectRealParcelGeometry(featureCollection, bounds) {
  if (!featureCollection?.geometry) return null;
  const coords = [];
  flattenLngLat(featureCollection.geometry.coordinates, coords);
  if (!coords.length) return null;
  const projected = coords.map(([lng, lat]) => {
    const x = ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng || 1)) * 100;
    const y = (1 - (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat || 1)) * 100;
    return [x, y];
  });
  return projected;
}

function flattenLngLat(coordinates, points = []) {
  if (!Array.isArray(coordinates)) return points;
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    points.push(coordinates);
    return points;
  }
  coordinates.forEach((child) => flattenLngLat(child, points));
  return points;
}

function getRealGeometryBounds(parcels) {
  const points = [];
  parcels.forEach((parcel) => {
    if (parcel.realGeometry?.geometry) flattenLngLat(parcel.realGeometry.geometry.coordinates, points);
  });
  if (!points.length) return null;
  return points.reduce(
    (bounds, [lng, lat]) => ({
      minLng: Math.min(bounds.minLng, lng),
      maxLng: Math.max(bounds.maxLng, lng),
      minLat: Math.min(bounds.minLat, lat),
      maxLat: Math.max(bounds.maxLat, lat),
    }),
    { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity },
  );
}

function applyPanToCamera(camera, deltaX, deltaY) {
  const safeCamera = camera || DALLAS_LOCATION.camera;
  const panFactor = 0.038 / clamp(safeCamera.zoom, 0.9, 1.8);
  return {
    ...safeCamera,
    x: clamp(safeCamera.x - deltaX * panFactor, 0, 100),
    y: clamp(safeCamera.y - deltaY * panFactor, 0, 100),
  };
}

function applyTiltToCamera(camera, deltaY) {
  const safeCamera = camera || DALLAS_LOCATION.camera;
  return {
    ...safeCamera,
    pitch: clamp(safeCamera.pitch - deltaY * 0.16, 24, 78),
  };
}

function applyOrbitToCamera(camera, deltaX) {
  const safeCamera = camera || DALLAS_LOCATION.camera;
  return {
    ...safeCamera,
    bearing: normalizeBearing(safeCamera.bearing + deltaX * 0.22),
  };
}

function applyCursorDragToCamera(camera, drag) {
  const mode = drag?.mode || "pan";
  if (mode === "earth-spin") {
    const safeCamera = camera || DALLAS_LOCATION.camera;
    return {
      ...safeCamera,
      bearing: normalizeBearing(safeCamera.bearing + (drag.deltaX || 0) * 0.24),
      pitch: clamp(safeCamera.pitch - (drag.deltaY || 0) * 0.12, 24, 78),
    };
  }
  if (mode === "tilt-strong") return applyTiltToCamera(camera, (drag.deltaY || 0) * 1.7);
  if (mode === "tilt") return applyTiltToCamera(camera, drag.deltaY || 0);
  if (mode === "orbit") return applyOrbitToCamera(camera, drag.deltaX || 0);
  return applyPanToCamera(camera, drag?.deltaX || 0, drag?.deltaY || 0);
}

function applyWheelZoom(camera, deltaY, cursorPoint = [50, 50]) {
  const safeCamera = camera || DALLAS_LOCATION.camera;
  const zoomDelta = clamp(-deltaY / 720, -0.16, 0.16);
  const cursor = safePoint(cursorPoint, [safeCamera.x, safeCamera.y]);
  const nextZoom = clamp(safeCamera.zoom + zoomDelta, 0.42, 1.8);
  const zoomPull = Math.max(0, zoomDelta) * 0.42;
  return {
    ...safeCamera,
    x: clamp(safeCamera.x + (cursor[0] - safeCamera.x) * zoomPull, 0, 100),
    y: clamp(safeCamera.y + (cursor[1] - safeCamera.y) * zoomPull, 0, 100),
    zoom: nextZoom,
  };
}

function getCursorPointInElement(event) {
  const rect = event.currentTarget?.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return [50, 50];
  return [clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100), clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100)];
}

function getDragNavigationMode(event) {
  if (event.altKey) return "orbit";
  if (event.shiftKey) return "tilt-strong";
  return "earth-spin";
}

function lonLatToTile(lon, lat, zoom) {
  const safeLon = Number.isFinite(lon) ? lon : -96.797;
  const safeLat = Number.isFinite(lat) ? lat : 32.7767;
  const safeZoom = Number.isFinite(zoom) ? zoom : 13;
  const latRad = (safeLat * Math.PI) / 180;
  const n = 2 ** safeZoom;
  const x = Math.floor(((safeLon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y, z: safeZoom };
}

function getDallasTileGrid() {
  const center = lonLatToTile(-96.797, 32.7767, 13);
  return LIVE_MAP_TILES.map((tile) => {
    const col = Number.isFinite(tile.col) ? tile.col : 0;
    const row = Number.isFinite(tile.row) ? tile.row : 0;
    return {
      x: center.x + col - 1,
      y: center.y + row - 1,
      z: center.z,
      left: `${col * 33.3333}%`,
      top: `${row * 33.3333}%`,
    };
  });
}

function runSelfTests() {
  const dallasParcels = getDallasRenderableParcels();
  const defaultVisibleDallasParcels = getVisibleDallasParcels(DALLAS_LOCATION.camera);
  const sandenCamera = { ...DALLAS_LOCATION.camera, x: 89, y: 11, zoom: 1.6 };
  const sandenVisibleParcels = getVisibleDallasParcels(sandenCamera);
  const filteredParcels = filterParcels(dallasParcels, "SANDEN");
  const globalSearchResults = searchDallasParcels("SANDEN");
  const dimensionSearchResults = searchDallasParcels("frontage");
  const parcelViewCamera = getParcelViewCamera();
  const dallasTiles = getDallasTileGrid();
  const dallasTileCenter = lonLatToTile(-96.797, 32.7767, 13);
  const draggedCamera = applyPanToCamera(DALLAS_LOCATION.camera, 40, -20);
  const wheelZoomInCamera = applyWheelZoom(DALLAS_LOCATION.camera, -100);
  const wheelZoomOutCamera = applyWheelZoom(DALLAS_LOCATION.camera, 100);
  const tiltDragCamera = applyCursorDragToCamera(DALLAS_LOCATION.camera, { mode: "tilt", deltaX: 0, deltaY: -30 });
  const orbitDragCamera = applyCursorDragToCamera(DALLAS_LOCATION.camera, { mode: "orbit", deltaX: 30, deltaY: 0 });
  const earthSpinCamera = applyCursorDragToCamera(DALLAS_LOCATION.camera, { mode: "earth-spin", deltaX: 30, deltaY: -20 });
  const strongTiltCamera = applyCursorDragToCamera(DALLAS_LOCATION.camera, { mode: "tilt-strong", deltaX: 0, deltaY: -30 });
  const cursorZoomCamera = applyWheelZoom(DALLAS_LOCATION.camera, -120, [80, 20]);
  const earthIntroCamera = getEarthIntroCamera();
  const halfwayParcelCamera = interpolateCamera(earthIntroCamera, parcelViewCamera, 0.5);
  const broadProfile = getParcelRenderProfile({ ...DALLAS_LOCATION.camera, zoom: 0.95 });
  const blockProfile = getParcelRenderProfile({ ...DALLAS_LOCATION.camera, zoom: PARCEL_ZOOM_THRESHOLDS.block });
  const parcelProfile = getParcelRenderProfile({ ...DALLAS_LOCATION.camera, zoom: PARCEL_ZOOM_THRESHOLDS.parcel });
  const detailProfile = getParcelRenderProfile({ ...DALLAS_LOCATION.camera, zoom: PARCEL_ZOOM_THRESHOLDS.detail });
  const tests = [
    [LOCATIONS.some((location) => location.id === NATIONAL_ROAMING_ID) && LOCATIONS.length >= 6 && LOCATIONS.every(Boolean), "locations are fully initialized"],
    [Array.isArray(DALLAS_LOCATION.coordinates) && DALLAS_LOCATION.coordinates.length === 2, "Dallas coordinates are valid"],
    [safePoint(undefined, [7, 8])[0] === 7 && safePoint(undefined, [7, 8])[1] === 8, "safePoint handles undefined geometry"],
    [clamp(5, 0, 10) === 5, "clamp keeps in-range values"],
    [clamp(-5, 0, 10) === 0, "clamp floors low values"],
    [clamp(15, 0, 10) === 10, "clamp caps high values"],
    [normalizeBearing(190) === -170, "normalizeBearing wraps positive overflow"],
    [normalizeBearing(-190) === 170, "normalizeBearing wraps negative overflow"],
    [Math.abs(getCameraForLocation(DALLAS_LOCATION).x - 46.6) < 0.1, "camera lookup returns downtown Dallas preset"],
    [DCAD_DALLAS_SAMPLE.length >= 4, "DCAD sample contains multiple Dallas records"],
    [getDallasFeaturedProperty().buildingClass === "STORAGE WAREHOUSE", "featured Dallas property is loaded"],
    [formatCurrency("40624920.00") === "$40,624,920", "currency formatter works"],
    [formatInteger("352860") === "352,860", "integer formatter works"],
    [DCAD_SOURCE_META.tables.includes("ACCOUNT_INFO.CSV"), "DCAD metadata tracks source tables"],
    [dallasParcels.length === 4, "Dallas parcel overlays are connected to DCAD records"],
    [dallasParcels.every((parcel) => Array.isArray(parcel.points) && parcel.points.length >= 4), "parcel overlays have polygon points"],
    [dallasParcels.every((parcel) => typeof parcel.blockId === "string" && parcel.blockId.length > 0), "parcel overlays include block ids"],
    [dallasParcels.every((parcel) => typeof parcel.address === "string" && parcel.address.length > 0), "parcels include addresses"],
    [hasDallasParcelGeometry() === true, "geometry status reflects uploaded parcel geometry"],
    [defaultVisibleDallasParcels.length >= 1, "default viewport opens on at least one Dallas parcel"],
    [sandenVisibleParcels.some((parcel) => parcel.address === "10300 SANDEN DR"), "viewport loader can show Sanden parcel"],
    [filteredParcels.length === 1 && filteredParcels[0].address === "10300 SANDEN DR", "parcel search filters by address"],
    [globalSearchResults.some((parcel) => parcel.address === "10300 SANDEN DR"), "global search finds uploaded DCAD records by address"],
    [dallasParcels.every((parcel) => parcel.dimensions && parcel.dimensions.sourceLayer === "ParcelDimension"), "parcel dimensions are joined to parcel records"],
    [dimensionSearchResults.length >= 1, "global search finds parcel dimension metadata"],
    [PARCEL_DIMENSION_SOURCE.detectedFiles.includes("ParcelDimension.shp"), "parcel dimension shapefile source is registered"],
    [parcelViewCamera.x === DALLAS_LOCATION.camera.x && parcelViewCamera.y === DALLAS_LOCATION.camera.y, "parcel view camera resets to Dallas parcel cluster"],
    [FULL_PARCEL_ACCESS_META.featureCount > 1000, "full parcel access manifest is connected"],
    [dallasTiles.length === 9, "live map tile grid creates nine tiles"],
    [dallasTiles.every((tile) => typeof tile.left === "string" && typeof tile.top === "string"), "live map tiles have screen placement"],
    [Number.isInteger(dallasTileCenter.x) && Number.isInteger(dallasTileCenter.y), "live map tile conversion returns valid tile coordinates"],
    [draggedCamera.x !== DALLAS_LOCATION.camera.x && draggedCamera.y !== DALLAS_LOCATION.camera.y, "drag pan changes camera center"],
    [wheelZoomInCamera.zoom > DALLAS_LOCATION.camera.zoom, "mouse wheel up zooms in"],
    [wheelZoomOutCamera.zoom < DALLAS_LOCATION.camera.zoom, "mouse wheel down zooms out"],
    [tiltDragCamera.pitch > DALLAS_LOCATION.camera.pitch, "shift drag tilts camera"],
    [orbitDragCamera.bearing !== DALLAS_LOCATION.camera.bearing, "alt drag rotates camera bearing"],
    [earthSpinCamera.bearing !== DALLAS_LOCATION.camera.bearing && earthSpinCamera.pitch > DALLAS_LOCATION.camera.pitch, "earth drag spins and tilts the intro camera"],
    [strongTiltCamera.pitch > tiltDragCamera.pitch, "shift drag applies stronger Earth tilt"],
    [cursorZoomCamera.x !== DALLAS_LOCATION.camera.x && cursorZoomCamera.zoom > DALLAS_LOCATION.camera.zoom, "wheel zoom moves toward cursor"],
    [earthIntroCamera.zoom < DALLAS_LOCATION.camera.zoom && earthIntroCamera.pitch > DALLAS_LOCATION.camera.pitch, "earth intro camera starts wide and tilted"],
    [halfwayParcelCamera.x !== earthIntroCamera.x && halfwayParcelCamera.x !== parcelViewCamera.x, "parcel entry camera can animate between Earth and Dallas"],
    [broadProfile.stage === "broad" && broadProfile.maxFeatures === 1200 && !broadProfile.showLabels, "broad zoom keeps parcel rendering light"],
    [blockProfile.stage === "block" && blockProfile.showBlockLabels && !blockProfile.showLabels, "block zoom shows block context without parcel-label clutter"],
    [parcelProfile.stage === "parcel" && parcelProfile.showLabels && !parcelProfile.showDimensions, "parcel zoom shows individual parcel labels"],
    [detailProfile.stage === "detail" && detailProfile.showDimensions && detailProfile.maxFeatures > parcelProfile.maxFeatures, "detail zoom enables dimension labels and denser parcels"],
  ];

  tests.forEach(([passed, label]) => {
    if (!passed) throw new Error(`Real Estate Savant self-test failed: ${label}`);
  });
}

function RabbitLogo() {
  return <div className="flex h-9 w-9 items-center justify-center text-sm" aria-label={PLATFORM_IDENTITY.name}>🐇</div>;
}

function SearchBar({ value = "", onChange, onSubmit, onClear, placeholder = "Search address, parcel, development...", readOnly = false, loading = false, reserveMapControls = false }) {
  const displayValue = readOnly ? placeholder : String(value || "").trimStart();
  const hasValue = !readOnly && displayValue.trim().length > 0;
  const clearSearch = () => onClear ? onClear() : onChange?.("");
  return (
    <form
      role="search"
      aria-label="Property search"
      aria-busy={loading}
      onSubmit={(event) => {
        event.preventDefault();
        if (hasValue && onSubmit) onSubmit();
      }}
      className={`absolute left-4 top-[calc(5rem+2in)] z-30 sm:left-1/2 sm:right-auto sm:w-[90%] sm:max-w-2xl sm:-translate-x-1/2 ${reserveMapControls ? "right-[4.75rem]" : "right-4"}`}
    >
      <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/80 px-4 py-3 shadow-2xl transition focus-within:border-cyan-100/35 focus-within:ring-2 focus-within:ring-cyan-100/15 sm:gap-3 sm:px-5">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5 text-white/70">
          <circle cx="11" cy="11" r="6" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          readOnly={readOnly}
          value={displayValue}
          onChange={(event) => onChange && onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && hasValue) {
              event.preventDefault();
              clearSearch();
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          type="search"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          className="min-w-0 flex-1 bg-transparent text-sm text-white/85 outline-none placeholder:text-white/40 [&::-webkit-search-cancel-button]:hidden"
        />
        {hasValue && (
          <button type="button" onClick={clearSearch} aria-label="Clear search" className="shrink-0 rounded-full p-1 text-white/55 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100/60">
            <X aria-hidden="true" size={15} />
          </button>
        )}
        {!readOnly && (
          <button type="submit" disabled={!hasValue} className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-black transition hover:bg-cyan-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100 disabled:cursor-not-allowed disabled:opacity-45">
            {loading ? "Searching" : "Search"}
          </button>
        )}
      </div>
    </form>
  );
}

const MEMBER_ACCESS_SESSION_KEY = "white-rabbit-member-access-v1";
const HOSTED_MEMBER_SERVICE = {
  url: String(import.meta.env.VITE_SUPABASE_URL || ""),
  anonKey: String(import.meta.env.VITE_SUPABASE_ANON_KEY || ""),
};

function normalizeMemberUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function getMemberAccessCredentials() {
  return {
    enabled: String(import.meta.env.VITE_ENABLE_DEMO_MEMBER_ACCESS || "").toLowerCase() === "true",
    username: normalizeMemberUsername(import.meta.env.VITE_WHITE_RABBIT_MEMBER_USERNAME || ""),
    password: String(import.meta.env.VITE_WHITE_RABBIT_MEMBER_PASSWORD || ""),
  };
}

function memberCredentialsAreValid(username, password) {
  const credentials = getMemberAccessCredentials();
  return credentials.enabled && credentials.username && credentials.password.length >= 12 && normalizeMemberUsername(username) === credentials.username && String(password) === credentials.password;
}

function readMemberAccessSession() {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(MEMBER_ACCESS_SESSION_KEY);
    if (!stored) return null;
    if (stored === "active") {
      window.localStorage.removeItem(MEMBER_ACCESS_SESSION_KEY);
      return null;
    }
    const session = JSON.parse(stored);
    if (session?.expiresAt && Number(session.expiresAt) <= Date.now()) {
      window.localStorage.removeItem(MEMBER_ACCESS_SESSION_KEY);
      return null;
    }
    return session?.memberId && session?.username ? session : null;
  } catch {
    return null;
  }
}

function storeMemberAccessSession(session) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MEMBER_ACCESS_SESSION_KEY, JSON.stringify(session));
  } catch {
    // The member can continue in the current tab even if browser storage is blocked.
  }
}

function clearMemberAccessSession() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(MEMBER_ACCESS_SESSION_KEY);
  } catch {
    // The in-memory session is still cleared by the caller.
  }
}

function MemberAccessGate({ onAccessGranted, onCancel, initialMode = "login" }) {
  const [mode, setMode] = useState(initialMode === "signup" ? "signup" : "login");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [signupStatus, setSignupStatus] = useState("");

  const [loginPending, setLoginPending] = useState(false);

  const submitMemberAccess = async (event) => {
    event.preventDefault();
    setLoginError("");
    setSignupStatus("");
    if (mode === "signup") {
      if (!hostedMemberServiceConfigured(HOSTED_MEMBER_SERVICE)) {
        setLoginError("Account registration is not connected yet. Configure the hosted member service to enable sign up.");
        return;
      }
      if (!username.includes("@") || password.length < 8) {
        setLoginError("Enter a valid email and a password with at least 8 characters.");
        return;
      }
      setLoginPending(true);
      try {
        const result = await signUpHostedMember(HOSTED_MEMBER_SERVICE, username, password, displayName);
        if (result.verificationRequired) {
          setSignupStatus(`Check ${result.email} to confirm your account, then return here to log in.`);
          return;
        }
        storeMemberAccessSession(result);
        onAccessGranted(result);
      } catch (error) {
        setLoginError(error instanceof Error ? error.message : "Member account could not be created.");
      } finally {
        setLoginPending(false);
      }
      return;
    }
    if (hostedMemberServiceConfigured(HOSTED_MEMBER_SERVICE)) {
      setLoginPending(true);
      try {
        const session = await signInHostedMember(HOSTED_MEMBER_SERVICE, username, password);
        storeMemberAccessSession(session);
        setLoginError("");
        onAccessGranted(session);
      } catch (error) {
        setLoginError(error instanceof Error ? error.message : "Member login not recognized.");
      } finally {
        setLoginPending(false);
      }
      return;
    }
    if (memberCredentialsAreValid(username, password)) {
      const normalizedUsername = normalizeMemberUsername(username);
      const session = {
        memberId: normalizedUsername,
        username: normalizedUsername,
        displayName: normalizedUsername.includes("@") ? normalizedUsername.split("@")[0] : normalizedUsername,
        email: normalizedUsername.includes("@") ? normalizedUsername : "",
      };
      storeMemberAccessSession(session);
      setLoginError("");
      onAccessGranted(session);
      return;
    }
    setLoginError(getMemberAccessCredentials().enabled ? "Member login not recognized. Check the username and password." : "Member accounts are not connected in this environment yet.");
  };

  const requestPasswordReset = async () => {
    setLoginError("");
    setSignupStatus("");
    if (!hostedMemberServiceConfigured(HOSTED_MEMBER_SERVICE)) { setLoginError("Password recovery is not connected in this environment yet."); return; }
    if (!username.includes("@")) { setLoginError("Enter your account email first."); return; }
    setLoginPending(true);
    try {
      await requestHostedPasswordReset(HOSTED_MEMBER_SERVICE, username, typeof window === "undefined" ? "" : window.location.origin);
      setSignupStatus(`Password recovery instructions were sent to ${normalizeMemberUsername(username)}.`);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Password recovery could not be started.");
    } finally {
      setLoginPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] overflow-hidden bg-black text-white" data-member-access-gate="white-rabbit">
      <div className="absolute inset-0" aria-hidden="true">
        <img
          src="https://images.unsplash.com/photo-1526772662000-3f88f10405ff?auto=format&fit=crop&w=2000&q=80"
          alt=""
          className="h-full w-full object-cover scale-110 animate-[pulse_20s_ease-in-out_infinite]"
          draggable="false"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/55 to-black/90" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,rgba(34,197,94,0.15),transparent_25%),radial-gradient(circle_at_70%_50%,rgba(59,130,246,0.12),transparent_25%)]" />
      </div>
      <header className="absolute top-0 z-20 flex w-full items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <RabbitLogo />
          <span className="text-xs font-semibold tracking-[0.08em] text-white/85">{PLATFORM_IDENTITY.name}</span>
        </div>
      </header>
      <main className="relative z-10 flex h-full items-center justify-center px-4">
        <form
          onSubmit={submitMemberAccess}
          className="w-full max-w-sm rounded-2xl border border-white/10 bg-black/60 p-6 shadow-2xl backdrop-blur-xl"
          data-member-login-form="true"
          data-member-access-mode={mode}
        >
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-xs uppercase tracking-[0.3em] text-white/50">Member Access</p><h1 className="mt-2 text-2xl font-semibold">{mode === "signup" ? "Create your profile" : "Sign in to your profile"}</h1></div>
            {onCancel && <button type="button" onClick={onCancel} className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close member login"><X size={18} /></button>}
          </div>
          <p className="mt-2 text-sm leading-6 text-white/65">{mode === "signup" ? "Create an account to save and manage your real estate listings." : "Access the residential, rental, and commercial listings owned by your member account."}</p>
          <div className="mt-5 grid grid-cols-2 rounded-xl border border-white/10 bg-black/45 p-1" aria-label="Member access options">
            <button type="button" onClick={() => { setMode("login"); setLoginError(""); setSignupStatus(""); }} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${mode === "login" ? "bg-white text-black" : "text-white/60 hover:text-white"}`} data-member-mode-login="true">Log in</button>
            <button type="button" onClick={() => { setMode("signup"); setLoginError(""); setSignupStatus(""); }} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${mode === "signup" ? "bg-white text-black" : "text-white/60 hover:text-white"}`} data-member-mode-signup="true">Sign up</button>
          </div>
          <div className="mt-5 space-y-3">
            {mode === "signup" && (
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-white/50">Display name</span>
                <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" className="mt-2 w-full rounded-xl border border-white/10 bg-black/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-cyan-100/45 focus:ring-2 focus:ring-cyan-100/15" placeholder="Your name" data-member-signup-display-name="true" />
              </label>
            )}
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-white/50">{mode === "signup" ? "Email" : "Username or email"}</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-cyan-100/45 focus:ring-2 focus:ring-cyan-100/15"
                placeholder={mode === "signup" ? "you@example.com" : "Member username or email"}
                data-member-login-username="true"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-white/50">Password</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-cyan-100/45 focus:ring-2 focus:ring-cyan-100/15"
                placeholder="Member password"
                data-member-login-password="true"
              />
            </label>
          </div>
          {loginError && <p className="mt-3 rounded-xl border border-red-300/20 bg-red-300/10 px-3 py-2 text-xs text-red-100" role="alert">{loginError}</p>}
          {signupStatus && <p className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs text-emerald-100" role="status">{signupStatus}</p>}
          <button
            type="submit"
            disabled={loginPending}
            className="mt-5 flex w-full items-center justify-center rounded-xl bg-white py-3 text-sm font-medium text-black transition hover:scale-[1.01]"
            data-member-login-submit="true"
          >
            {loginPending ? (mode === "signup" ? "Creating Account…" : "Signing In…") : (mode === "signup" ? "Create Account" : "Log In")}
          </button>
          {mode === "login" && <button type="button" onClick={requestPasswordReset} disabled={loginPending} className="mt-3 w-full text-center text-xs font-semibold text-white/60 transition hover:text-white" data-member-password-reset="true">Forgot your password?</button>}
        </form>
      </main>
    </div>
  );
}

function CompactMapControls({ onZoomIn, onZoomOut, onReset, onFindMyLocation, locating, locationStatus }) {
  const locateLabel = locationStatus || "Find my location";
  return (
    <div className="absolute right-6 top-32 z-30 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/72 shadow-2xl">
      <button onClick={onZoomIn} className="h-11 w-11 border-b border-white/10 text-lg text-white hover:bg-white/10" title="Zoom in">+</button>
      <button onClick={onZoomOut} className="h-11 w-11 border-b border-white/10 text-lg text-white hover:bg-white/10" title="Zoom out">-</button>
      <button
        type="button"
        onClick={onFindMyLocation}
        disabled={locating}
        aria-label={locateLabel}
        className="flex h-11 w-11 items-center justify-center border-b border-white/10 text-white/80 transition hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:text-white/35"
        title={locateLabel}
      >
        <LocateFixed aria-hidden="true" size={17} strokeWidth={1.9} />
      </button>
      <button onClick={onReset} className="h-11 w-11 text-[11px] font-semibold text-white/80 hover:bg-white/10" title="Reset bearing">N</button>
      <span className="sr-only" aria-live="polite">{locationStatus}</span>
    </div>
  );
}

function LayerIconButton({ active, onClick, label, children }) {
  const stateLabel = active ? "On" : "Off";
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      data-layer-button={label}
      data-layer-state={active ? "on" : "off"}
      className={`group relative flex h-11 w-11 items-center justify-center border-b border-white/10 last:border-b-0 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/80 ${
        active ? "bg-white text-black shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)]" : "bg-black/72 text-white/75 hover:bg-white/10 hover:text-white"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-400" : "bg-white/20"}`}
      />
      {children}
      <span className="sr-only">{stateLabel}</span>
      <span className="pointer-events-none absolute right-[calc(100%+0.5rem)] top-1/2 hidden -translate-y-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-black/82 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-white/80 shadow-xl group-hover:block group-focus-visible:block">
        {label.replace(/^Toggle\s+/i, "")} {stateLabel}
      </span>
    </button>
  );
}

function AerialLayerControls({ showParcelLabels, setShowParcelLabels, showGrid, setShowGrid, showDimensions, setShowDimensions, showFloodplain, setShowFloodplain, showZoning, setShowZoning }) {
  return (
    <div className="absolute right-6 top-[20.5rem] z-30 flex flex-col overflow-visible rounded-2xl border border-white/10 bg-black/72 shadow-2xl" data-layer-icon-controls="aerial-map">
      <LayerIconButton active={showParcelLabels} onClick={() => setShowParcelLabels((v) => !v)} label="Toggle parcel labels">
        <Tags aria-hidden="true" size={18} strokeWidth={1.8} />
      </LayerIconButton>
      <LayerIconButton active={showZoning} onClick={() => setShowZoning((v) => !v)} label="Toggle zoning layer">
        <Landmark aria-hidden="true" size={18} strokeWidth={1.8} />
      </LayerIconButton>
      <LayerIconButton active={showDimensions} onClick={() => setShowDimensions((v) => !v)} label="Toggle dimension labels">
        <Ruler aria-hidden="true" size={18} strokeWidth={1.8} />
      </LayerIconButton>
      <LayerIconButton active={showGrid} onClick={() => setShowGrid((v) => !v)} label="Toggle grid layer">
        <Grid3X3 aria-hidden="true" size={18} strokeWidth={1.8} />
      </LayerIconButton>
      <LayerIconButton active={showFloodplain} onClick={() => setShowFloodplain((v) => !v)} label="Toggle floodplain layer">
        <Waves aria-hidden="true" size={18} strokeWidth={1.8} />
      </LayerIconButton>
    </div>
  );
}

function LandingControls() {
  return (
    <div className="absolute right-6 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-3">
      <button className="h-10 w-10 rounded-full border border-white/10 bg-black/70 text-white">+</button>
      <button className="h-10 w-10 rounded-full border border-white/10 bg-black/70 text-white">-</button>
      <button className="h-10 w-10 rounded-full border border-white/10 bg-black/70 text-white">N</button>
    </div>
  );
}

function listingPropertyMatchesQuery(property, rawQuery) {
  const queryTerms = String(rawQuery || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!queryTerms.length) return true;
  const searchable = [
    property.market,
    property.county,
    property.status,
    property.assetType,
    property.propertyName,
    property.address,
    property.city,
    property.parcelId,
    property.zoning,
    ...(property.tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return queryTerms.every((term) => searchable.includes(term));
}

function emptyListingDraft(listingKind) {
  return {
    propertyName: "",
    status: listingKind === "rentals" ? "For Rent" : "For Sale",
    assetType: listingKind === "cre" ? "Commercial" : listingKind === "rentals" ? "Rental" : "Single Family",
    priceLabel: "",
    address: "",
    city: "",
    state: "",
    county: "",
    market: "",
    sizeLabel: "",
    landLabel: "",
    capRate: "",
    yearBuilt: "",
    zoning: "",
    parcelId: "",
    coordinates: "",
    tags: "",
    highlight: "",
    image: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    askingPrice: "",
    estimatedMarketValue: "",
    annualNoi: "",
    monthlyRent: "",
    marketMonthlyRent: "",
    monthlyExpenses: "",
    publicationStatus: "published",
  };
}

function CommercialMarketplacePage({ onBack, onOpenMap, onOpenListingKind, listingKind = "cre", memberSession, onMemberLogout, onMemberUpdate }) {
  const listingConfig = getListingPageConfig(listingKind);
  const supportsUserListings = ["cre", "resi", "rentals"].includes(listingKind);
  const [userListings, setUserListings] = useState(() => loadUserListings());
  const [listingEditor, setListingEditor] = useState(null);
  const [memberProfileOpen, setMemberProfileOpen] = useState(false);
  const [selectedListing, setSelectedListing] = useState(null);
  const [listingShareStatus, setListingShareStatus] = useState("");
  const [listingViews, setListingViews] = useState(() => loadListingViews());
  const [analyticsStatus, setAnalyticsStatus] = useState("");
  const [memberProfileDraft, setMemberProfileDraft] = useState({ displayName: "", company: "", phone: "" });
  const [profileStatus, setProfileStatus] = useState("");
  const [listingImportStatus, setListingImportStatus] = useState("");
  const [isDraggingListingCsv, setIsDraggingListingCsv] = useState(false);
  const listingImportInputRef = useRef(null);
  const [nearbyDevelopmentByListing, setNearbyDevelopmentByListing] = useState({});
  const listingProperties = useMemo(
    () => [...userListings.filter((property) => property.listingKind === listingKind), ...listingConfig.properties],
    [listingConfig.properties, listingKind, userListings],
  );
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  useEffect(() => {
    setQuery("");
    setStatusFilter("All");
    setListingEditor(null);
    setListingImportStatus("");
    setIsDraggingListingCsv(false);
  }, [listingKind]);

  useEffect(() => {
    if (!hostedMemberServiceConfigured(HOSTED_MEMBER_SERVICE)) saveUserListings(userListings);
  }, [userListings]);

  useEffect(() => {
    if (!hostedMemberServiceConfigured(HOSTED_MEMBER_SERVICE)) return;
    let cancelled = false;
    Promise.all([
      loadHostedPublicListings(HOSTED_MEMBER_SERVICE, memberSession),
      memberSession?.provider === "supabase" ? loadHostedMemberListings(HOSTED_MEMBER_SERVICE, memberSession) : Promise.resolve([]),
    ])
      .then(([published, owned]) => {
        if (cancelled) return;
        setUserListings(Array.from(new Map([...published, ...owned].map((listing) => [listing.id, listing])).values()));
      })
      .catch(() => { if (!cancelled) setListingImportStatus("Hosted listings could not be loaded right now."); });
    return () => { cancelled = true; };
  }, [memberSession]);

  useEffect(() => {
    if (!memberProfileOpen || memberSession?.provider !== "supabase") return;
    let cancelled = false;
    setAnalyticsStatus("Loading listing activity…");
    loadHostedListingViews(HOSTED_MEMBER_SERVICE, memberSession)
      .then((records) => { if (!cancelled) { setListingViews(records); setAnalyticsStatus(""); } })
      .catch(() => { if (!cancelled) setAnalyticsStatus("Listing activity could not be loaded right now."); });
    return () => { cancelled = true; };
  }, [memberProfileOpen, memberSession]);

  useEffect(() => {
    if (!memberProfileOpen || !memberSession) return;
    setMemberProfileDraft({ displayName: memberSession.displayName || "", company: memberSession.company || "", phone: memberSession.phone || "" });
    setProfileStatus("");
    if (memberSession.provider !== "supabase") return;
    let cancelled = false;
    loadHostedMemberProfile(HOSTED_MEMBER_SERVICE, memberSession)
      .then((profile) => { if (!cancelled && profile) setMemberProfileDraft(profile); })
      .catch(() => { if (!cancelled) setProfileStatus("Profile details could not be loaded right now."); });
    return () => { cancelled = true; };
  }, [memberProfileOpen, memberSession]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(listingProperties.map(async (property) => [property.id, await loadNearbyListingDevelopments(property)]))
      .then((entries) => { if (!cancelled) setNearbyDevelopmentByListing(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
  }, [listingProperties]);

  const memberListings = useMemo(() => listingsForMember(userListings, memberSession?.memberId), [memberSession?.memberId, userListings]);
  const memberListingAnalytics = useMemo(() => summarizeListingViews(listingViews, memberListings), [listingViews, memberListings]);
  const openListingDetails = async (property) => {
    setSelectedListing(property);
    setListingShareStatus("");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("listing", property.id);
      url.searchParams.set("type", property.listingKind || listingKind);
      window.history.replaceState({}, "", url);
    }
    if (property.submissionType !== "user-submitted" || !property.ownerMemberId || memberOwnsListing(property, memberSession?.memberId)) return;
    const visitorSessionId = listingVisitorId();
    if (hostedMemberServiceConfigured(HOSTED_MEMBER_SERVICE)) {
      try { await recordHostedListingView(HOSTED_MEMBER_SERVICE, memberSession, property.id, visitorSessionId); } catch { /* Viewing must remain available when analytics is offline. */ }
      return;
    }
    const result = recordLocalListingView(property, memberSession, globalThis.localStorage, { viewerSessionId: visitorSessionId });
    setListingViews(result.events);
  };
  const closeListingDetails = () => {
    setSelectedListing(null);
    setListingShareStatus("");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("listing");
      url.searchParams.delete("type");
      window.history.replaceState({}, "", url);
    }
  };
  const copyListingLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setListingShareStatus("Listing link copied.");
    } catch {
      setListingShareStatus("Copy the address from your browser to share this listing.");
    }
  };

  useEffect(() => {
    if (typeof window === "undefined" || selectedListing) return;
    const listingId = new URLSearchParams(window.location.search).get("listing");
    if (!listingId) return;
    const property = listingProperties.find((item) => item.id === listingId);
    if (property) openListingDetails(property);
  }, [listingProperties, selectedListing]);
  const openNewListing = () => {
    if (!memberSession) return;
    setListingEditor({ mode: "create", draft: { ...emptyListingDraft(listingKind), id: memberSession.provider === "supabase" ? crypto.randomUUID() : "", contactName: memberSession.displayName, contactEmail: memberSession.email } });
  };
  const updateMemberProfile = async (event) => {
    event.preventDefault();
    setProfileStatus("Saving profile…");
    try {
      const profile = memberSession?.provider === "supabase"
        ? await saveHostedMemberProfile(HOSTED_MEMBER_SERVICE, memberSession, memberProfileDraft)
        : memberProfileDraft;
      const updatedSession = { ...memberSession, displayName: profile.displayName || memberSession.displayName, company: profile.company || "", phone: profile.phone || "" };
      storeMemberAccessSession(updatedSession);
      onMemberUpdate?.(updatedSession);
      setProfileStatus("Profile saved.");
    } catch (error) {
      setProfileStatus(error instanceof Error ? error.message : "Profile could not be saved.");
    }
  };
  const openEditListing = (property) => {
    if (!memberOwnsListing(property, memberSession?.memberId)) return;
    setListingEditor({
      mode: "edit",
      draft: { ...emptyListingDraft(listingKind), ...property, tags: (property.tags || []).join(", ") },
    });
  };
  const updateListingDraft = (field, value) => setListingEditor((current) => ({ ...current, draft: { ...current.draft, [field]: value } }));
  const submitUserListing = async (event) => {
    event.preventDefault();
    const current = listingEditor?.draft;
    if (!current) return;
    let geocodedDraft = current;
    if (!parseListingCoordinates(current.coordinates)) {
      try {
        const match = await geocodeAddress([current.address, current.city, current.state].filter(Boolean).join(", "));
        if (match?.coordinates) geocodedDraft = { ...current, coordinates: `${match.coordinates[1]}, ${match.coordinates[0]}` };
      } catch {
        // A listing can still be saved; nearby development remains unavailable until it has coordinates.
      }
    }
    const listing = createUserListing(geocodedDraft, listingKind, {
      id: current.id || undefined,
      now: new Date().toISOString(),
      ownerMemberId: memberSession?.memberId,
      ownerDisplayName: memberSession?.displayName,
    });
    if (memberSession?.provider === "supabase") {
      try {
        await saveHostedMemberListing(HOSTED_MEMBER_SERVICE, memberSession, listing);
      } catch (error) {
        setListingImportStatus(error instanceof Error ? error.message : "The listing could not be saved.");
        return;
      }
    }
    setUserListings((items) => upsertUserListing(items, listing));
    enqueueSavantEvent({ eventId: listing.id, eventType: "listing.uploaded", createdAt: new Date().toISOString() });
    setListingEditor(null);
  };
  const deleteUserListing = async (property) => {
    if (!memberOwnsListing(property, memberSession?.memberId)) return;
    if (!window.confirm(`Remove “${property.propertyName}” from your listings?`)) return;
    if (memberSession?.provider === "supabase") {
      try {
        await deleteHostedMemberListing(HOSTED_MEMBER_SERVICE, memberSession, property.id);
      } catch (error) {
        setListingImportStatus(error instanceof Error ? error.message : "The listing could not be removed.");
        return;
      }
    }
    setUserListings((items) => removeUserListing(items, property.id));
  };
  const loadListingPhoto = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
      window.alert("Choose a JPG, PNG, or WebP image smaller than 10 MB.");
      return;
    }
    if (memberSession?.provider === "supabase") {
      try {
        setListingImportStatus("Uploading listing photo…");
        const media = await uploadHostedListingMedia(HOSTED_MEMBER_SERVICE, memberSession, listingEditor?.draft?.id, file);
        updateListingDraft("image", media.publicUrl);
        updateListingDraft("imageStoragePath", media.path);
        setListingImportStatus("Listing photo uploaded.");
      } catch (error) {
        setListingImportStatus(error instanceof Error ? error.message : "Listing photo could not be uploaded.");
      }
      return;
    }
    const reader = new FileReader();
    reader.onload = () => updateListingDraft("image", String(reader.result || ""));
    reader.readAsDataURL(file);
  };
  const importListingCsv = async (file) => {
    if (!file) return;
    const isCsv = file.name.toLowerCase().endsWith(".csv") || ["text/csv", "application/vnd.ms-excel"].includes(file.type);
    if (!isCsv) { setListingImportStatus("Please choose a CSV file."); return; }
    if (file.size > 10 * 1024 * 1024) { setListingImportStatus("The CSV is larger than 10 MB. Split it into smaller files and try again."); return; }
    try {
      if (!memberSession) return;
      const result = importUserListingsFromCsv(await file.text(), listingKind, userListings, { now: new Date().toISOString(), ownerMemberId: memberSession.memberId, ownerDisplayName: memberSession.displayName });
      if (result.error) { setListingImportStatus(result.error); return; }
      const records = memberSession.provider === "supabase"
        ? result.records.map((listing, index) => index < result.imported ? { ...listing, id: crypto.randomUUID() } : listing)
        : result.records;
      if (memberSession.provider === "supabase") await Promise.all(records.slice(0, result.imported).map((listing) => saveHostedMemberListing(HOSTED_MEMBER_SERVICE, memberSession, listing)));
      setUserListings(records);
      records.slice(0, result.imported).forEach((listing) => enqueueSavantEvent({ eventId: listing.id, eventType: "listing.uploaded", createdAt: new Date().toISOString() }));
      setListingImportStatus(`${result.imported} listing${result.imported === 1 ? "" : "s"} imported${result.skipped ? ` · ${result.skipped} duplicate${result.skipped === 1 ? "" : "s"} skipped` : ""}${result.invalid ? ` · ${result.invalid} invalid row${result.invalid === 1 ? "" : "s"} ignored` : ""}`);
    } catch {
      setListingImportStatus("The CSV could not be read. Check the file and try again.");
    } finally {
      if (listingImportInputRef.current) listingImportInputRef.current.value = "";
    }
  };
  const dropListingCsv = (event) => {
    event.preventDefault();
    setIsDraggingListingCsv(false);
    importListingCsv(event.dataTransfer.files?.[0]);
  };

  const availableStatusFilters = useMemo(() => {
    const statuses = new Set(["All"]);
    listingProperties.forEach((property) => statuses.add(property.status));
    return Array.from(statuses);
  }, [listingProperties]);

  const filteredProperties = useMemo(() => {
    return listingProperties.filter((property) => {
      const matchesStatus = statusFilter === "All" || property.status === statusFilter;
      return matchesStatus && listingPropertyMatchesQuery(property, query);
    });
  }, [listingProperties, query, statusFilter]);

  const liveCount = listingProperties.filter((property) => ["For Sale", "For Lease", "For Rent", "Watch"].includes(property.status)).length;
  const marketCount = new Set(listingProperties.map((property) => property.market)).size;
  const resultCountLabel = `${filteredProperties.length} ${filteredProperties.length === 1 ? "result" : "results"}`;
  const editorDealRating = listingEditor
    ? calculateListingDeal(listingEditor.draft, {
        nearbyDevelopments: nearbyDevelopmentByListing[listingEditor.draft.id] || [],
      })
    : null;

  return (
    <div
      className="relative flex h-screen w-full flex-col overflow-hidden bg-[#f4f5f7] text-slate-950"
      data-page={listingKind === "cre" ? "commercial-marketplace" : "listing-marketplace"}
      data-listing-kind={listingKind}
      data-listing-layout="simple-listing-grid"
    >
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 shadow-sm">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
          aria-label="Back to Real Estate Savant"
        >
          <ArrowLeft aria-hidden="true" size={15} />
        </button>
        <div className="flex min-w-0 items-center gap-3">
          <RabbitLogo />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-950">Real Estate Savant Listings</p>
            <p className="truncate text-[11px] font-semibold uppercase text-slate-500">{listingConfig.headerBadge}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onOpenMap(listingConfig.mapSearch)} className="hidden px-2 text-xs font-bold uppercase tracking-normal text-[#0b5cab] hover:underline sm:inline-flex">Map</button>
          {memberSession && <button type="button" onClick={() => setMemberProfileOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 transition hover:border-[#0b5cab] hover:text-[#0b5cab]" data-action="member-profile"><UserRound aria-hidden="true" size={15} /> {memberSession.displayName}</button>}
        </div>
      </header>

      <section className="shrink-0 border-b border-slate-200 bg-white px-5 py-5">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase text-slate-500">{listingConfig.sidebarEyebrow}</p>
              <h1 className="mt-1 text-2xl font-bold tracking-normal text-slate-950">{listingConfig.pageTitle}</h1>
              <p className="mt-1 text-sm font-semibold text-slate-500">{listingConfig.coverageLabel}</p>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm font-semibold text-slate-600">
              <span aria-live="polite">{resultCountLabel}</span>
              <span>{marketCount} markets</span>
              <span>{liveCount} active</span>
              {supportsUserListings && memberSession && (
                <>
                  <input ref={listingImportInputRef} type="file" accept=".csv,text/csv" className="hidden" aria-label="Choose listing CSV file" onChange={(event) => importListingCsv(event.target.files?.[0])} />
                  <button type="button" onClick={() => listingImportInputRef.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-xs font-bold text-slate-700 shadow-sm transition hover:border-[#0b5cab] hover:text-[#0b5cab]" data-action="import-listings"><Upload aria-hidden="true" size={16} /> Import CSV</button>
                  <button type="button" onClick={openNewListing} className="inline-flex h-10 items-center gap-2 rounded-md bg-[#0b5cab] px-4 text-xs font-bold text-white shadow-sm transition hover:bg-[#084a89]" data-action="add-listing">
                    <Plus aria-hidden="true" size={16} /> Add Listing
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <div role="search" className="flex min-h-[46px] items-center gap-3 rounded-md border border-slate-300 bg-white px-4 shadow-sm transition focus-within:border-[#0b5cab] focus-within:ring-2 focus-within:ring-blue-100">
              <MapPin aria-hidden="true" size={18} className="text-[#0b5cab]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && query) {
                    event.preventDefault();
                    setQuery("");
                  }
                }}
                placeholder={listingConfig.searchPlaceholder}
                aria-label={listingConfig.searchPlaceholder}
                type="search"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="search"
                className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} aria-label="Clear listing search" className="shrink-0 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
                  <X aria-hidden="true" size={16} />
                </button>
              )}
            </div>
            <label className="flex min-h-[46px] items-center gap-3 rounded-md border border-slate-300 bg-white px-4 shadow-sm">
              <span className="shrink-0 text-xs font-bold uppercase text-slate-500">Status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-900 outline-none"
                aria-label="Filter listings by status"
              >
                {availableStatusFilters.map((filter) => (
                  <option key={filter} value={filter}>{filter}</option>
                ))}
              </select>
            </label>
          </div>
          {supportsUserListings && memberSession && (
            <div>
              <div
                className={`flex cursor-pointer items-center justify-center gap-3 rounded-md border border-dashed px-4 py-3 text-center transition ${isDraggingListingCsv ? "border-[#0b5cab] bg-blue-50 text-[#0b5cab]" : "border-slate-300 bg-slate-50/70 text-slate-600 hover:border-[#0b5cab] hover:bg-blue-50/50"}`}
                role="button"
                tabIndex={0}
                aria-label={`Drag and drop a CSV file to import ${listingConfig.pageTitle} listings`}
                data-listing-csv-dropzone="true"
                onClick={() => listingImportInputRef.current?.click()}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); listingImportInputRef.current?.click(); } }}
                onDragEnter={(event) => { event.preventDefault(); setIsDraggingListingCsv(true); }}
                onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setIsDraggingListingCsv(true); }}
                onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setIsDraggingListingCsv(false); }}
                onDrop={dropListingCsv}
              >
                <Upload aria-hidden="true" size={17} className="shrink-0 text-[#0b5cab]" />
                <div><p className="text-xs font-bold">Drop a CSV here to load listings</p><p className="mt-0.5 text-[10px] text-slate-400">Required: Property Name, Address, County · Common price, rent, property, contact, and location columns are recognized</p></div>
              </div>
              {listingImportStatus && <div className="mt-2 flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-[#084a89]" role="status"><span>{listingImportStatus}</span><button type="button" onClick={() => setListingImportStatus("")} className="rounded p-1 hover:bg-blue-100" aria-label="Dismiss listing import status"><X size={13} /></button></div>}
            </div>
          )}
        </div>
      </section>

      <main className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <section className="mx-auto max-w-[1500px]">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3" data-listing-grid="three-column-cards">
            {filteredProperties.map((property) => {
              const nearbyDevelopments = nearbyDevelopmentByListing[property.id] || [];
              const dealRating = calculateListingDeal(property, { nearbyDevelopments });
              const propertyAnalytics = memberListingAnalytics.byListing[property.id];
              return (
              <article key={property.id} className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
                <div className="relative aspect-[16/10] bg-slate-200">
                  <img
                    src={listingImageForProperty(property, listingConfig.heroImage, listingKind)}
                    alt={property.propertyName}
                    className="absolute inset-0 h-full w-full object-cover"
                    draggable="false"
                  />
                  <span
                    className={`absolute left-3 top-3 rounded-md px-2.5 py-1.5 text-xs font-bold text-white shadow-sm ${listingDealBadgeClass(dealRating.score)}`}
                    data-listing-deal-badge="true"
                  >
                    {listingDealBadgeForProperty(property, nearbyDevelopments)}
                  </span>
                  {memberOwnsListing(property, memberSession?.memberId) && (
                    <span className="absolute right-3 top-3 rounded-md bg-white/95 px-2.5 py-1.5 text-xs font-bold text-[#0b5cab] shadow-sm">{property.publicationStatus && property.publicationStatus !== "published" ? property.publicationStatus[0].toUpperCase() + property.publicationStatus.slice(1) : "Owner submitted"}</span>
                  )}
                </div>
                <div className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase text-[#0b5cab]">{property.market} / {property.assetType}</p>
                      <h2 className="mt-1 text-lg font-bold leading-snug text-slate-950">{property.propertyName}</h2>
                    </div>
                    <p className="shrink-0 text-right text-sm font-bold text-slate-950">{property.priceLabel}</p>
                  </div>

                  <div className="mt-3 flex items-start gap-2 text-sm leading-5 text-slate-600">
                    <MapPin aria-hidden="true" size={15} className="mt-0.5 shrink-0 text-slate-400" />
                    <p className="min-w-0">
                      <span className="block">{property.address}</span>
                      <span className="block text-xs font-semibold uppercase text-slate-400">{property.county}</span>
                    </p>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-100 pt-4 text-sm">
                    {[
                      ["Size", property.sizeLabel],
                      ["Use", property.capRate],
                      ["Parcel ID", property.parcelId],
                      ["Zoning", property.zoning],
                    ].map(([label, value]) => (
                      <div key={label} className="min-w-0">
                        <p className="text-[11px] font-bold uppercase text-slate-400">{label}</p>
                        <p className="mt-1 break-words font-semibold text-slate-900">{value}</p>
                      </div>
                    ))}
                  </div>

                  <p className="mt-4 text-sm leading-6 text-slate-600">{property.highlight}</p>

                  <div className="mt-4 rounded-md bg-slate-50 px-3 py-2" data-deal-score={dealRating.score}>
                    <div className="flex items-center justify-between gap-3 text-xs font-bold">
                      <span className="text-slate-600">Deal score · {dealRating.label}</span>
                      <span className="text-slate-950">{dealRating.score}/100</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{dealRating.basis}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">Nearby development: {dealRating.development.basis}</p>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {(property.tags || []).slice(0, 3).map((tag) => (
                      <span key={tag} className="rounded-md bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600">{tag}</span>
                    ))}
                  </div>
                  <button type="button" onClick={() => openListingDetails(property)} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#0b5cab] px-3 py-2.5 text-xs font-bold text-white transition hover:bg-[#084a89]" data-action="view-listing">
                    <Eye aria-hidden="true" size={15} /> View listing
                  </button>
                  {memberOwnsListing(property, memberSession?.memberId) && propertyAnalytics && (
                    <div className="mt-3 flex items-center gap-4 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-semibold text-[#084a89]">
                      <span className="inline-flex items-center gap-1"><Eye size={13} /> {propertyAnalytics.totalViews} views</span>
                      <span className="inline-flex items-center gap-1"><Users size={13} /> {propertyAnalytics.uniqueVisitors} visitors</span>
                    </div>
                  )}
                  {memberOwnsListing(property, memberSession?.memberId) && (
                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                      <p className="min-w-0 truncate text-xs text-slate-500">{property.contactEmail || property.contactPhone || "Contact details not provided"}</p>
                      <div className="flex shrink-0 gap-2">
                        <button type="button" onClick={() => openEditListing(property)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50" aria-label={`Edit ${property.propertyName}`}><Pencil aria-hidden="true" size={13} /> Edit</button>
                        <button type="button" onClick={() => deleteUserListing(property)} className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50" aria-label={`Remove ${property.propertyName}`}><Trash2 aria-hidden="true" size={13} /> Remove</button>
                      </div>
                    </div>
                  )}
                </div>
              </article>
              );
            })}
          </div>

          {!filteredProperties.length && (
            <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-600">
              <p>{listingConfig.emptyLabel}</p>
              <button type="button" onClick={() => { setQuery(""); setStatusFilter("All"); }} className="mt-3 font-bold text-[#0b5cab] hover:underline">
                Clear search and filters
              </button>
            </div>
          )}
        </section>
      </main>

      {selectedListing && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="listing-detail-title" data-listing-detail="true">
          <article className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white shadow-2xl">
            <div className="relative aspect-[16/7] min-h-56 bg-slate-200">
              <img src={listingImageForProperty(selectedListing, listingConfig.heroImage, selectedListing.listingKind || listingKind)} alt={selectedListing.propertyName} className="absolute inset-0 h-full w-full object-cover" />
              <button type="button" onClick={closeListingDetails} className="absolute right-4 top-4 rounded-full bg-white/95 p-2 text-slate-700 shadow" aria-label="Close listing details"><X size={18} /></button>
            </div>
            <div className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div><p className="text-xs font-bold uppercase text-[#0b5cab]">{selectedListing.market} · {selectedListing.assetType}</p><h2 id="listing-detail-title" className="mt-1 text-2xl font-bold text-slate-950">{selectedListing.propertyName}</h2><p className="mt-2 text-sm text-slate-600">{selectedListing.address}{selectedListing.county ? ` · ${selectedListing.county}` : ""}</p></div>
                <p className="text-xl font-bold text-slate-950">{selectedListing.priceLabel}</p>
              </div>
              <p className="mt-5 text-sm leading-7 text-slate-600">{selectedListing.highlight}</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[["Size", selectedListing.sizeLabel], ["Use", selectedListing.capRate], ["Parcel ID", selectedListing.parcelId], ["Zoning", selectedListing.zoning]].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 p-3"><p className="text-[11px] font-bold uppercase text-slate-400">{label}</p><p className="mt-1 text-sm font-semibold text-slate-900">{value || "Not provided"}</p></div>)}
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5">
                <div><p className="text-xs font-bold uppercase text-slate-400">Listing contact</p><p className="mt-1 text-sm font-semibold text-slate-900">{selectedListing.contactName || selectedListing.ownerDisplayName || "Listing representative"}</p><p className="text-sm text-slate-600">{selectedListing.contactEmail || selectedListing.contactPhone || "Contact information available from the listing representative"}</p></div>
                <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={copyListingLink} className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50" data-action="copy-listing-link">Copy listing link</button><button type="button" onClick={() => onOpenMap(selectedListing.address)} className="inline-flex items-center gap-2 rounded-md border border-[#0b5cab] px-4 py-2 text-sm font-bold text-[#0b5cab] hover:bg-blue-50"><MapPin size={15} /> View parcel on map</button></div>
              </div>
              {listingShareStatus && <p className="mt-3 text-right text-xs font-semibold text-slate-500" role="status">{listingShareStatus}</p>}
            </div>
          </article>
        </div>
      )}

      {memberProfileOpen && memberSession && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="member-profile-title" data-member-profile="true">
          <section className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white shadow-2xl" data-member-dashboard="true">
            <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div><p className="text-xs font-bold uppercase tracking-wide text-[#0b5cab]">Member Performance Center</p><h2 id="member-profile-title" className="mt-1 text-xl font-bold">{memberSession.displayName}</h2><p className="mt-1 text-xs text-slate-500">{memberSession.email || memberSession.username}</p></div>
              <button type="button" onClick={() => setMemberProfileOpen(false)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Close member profile"><X size={18} /></button>
            </header>
            <div className="p-5">
              <form onSubmit={updateMemberProfile} className="mb-5 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-[1fr_1fr_1fr_auto]" data-member-profile-form="true">
                <label className="text-xs font-bold text-slate-500">Display name<input required value={memberProfileDraft.displayName} onChange={(event) => setMemberProfileDraft((profile) => ({ ...profile, displayName: event.target.value }))} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-[#0b5cab]" /></label>
                <label className="text-xs font-bold text-slate-500">Company<input value={memberProfileDraft.company} onChange={(event) => setMemberProfileDraft((profile) => ({ ...profile, company: event.target.value }))} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-[#0b5cab]" /></label>
                <label className="text-xs font-bold text-slate-500">Phone<input type="tel" value={memberProfileDraft.phone} onChange={(event) => setMemberProfileDraft((profile) => ({ ...profile, phone: event.target.value }))} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-[#0b5cab]" /></label>
                <button type="submit" className="h-10 self-end rounded-md bg-[#0b5cab] px-4 text-xs font-bold text-white hover:bg-[#084a89]">Save profile</button>
                {profileStatus && <p className="text-xs font-semibold text-slate-500 md:col-span-4" role="status">{profileStatus}</p>}
              </form>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-listing-analytics-summary="true">
                {[
                  [memberListings.filter((listing) => (listing.publicationStatus || "published") === "published").length, "Published listings", Building2],
                  [memberListingAnalytics.totalViews, "Total views", Eye],
                  [memberListingAnalytics.uniqueVisitors, "Unique visitors", Users],
                  [memberListingAnalytics.viewedListings, "Listings viewed", Activity],
                ].map(([value, label, Icon]) => <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-4"><Icon size={17} className="text-[#0b5cab]" /><span className="mt-3 block text-2xl font-bold text-slate-950">{value}</span><span className="text-xs font-semibold text-slate-500">{label}</span></div>)}
              </div>
              {analyticsStatus && <p className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-xs font-semibold text-[#084a89]" role="status">{analyticsStatus}</p>}
              <div className="mt-5 grid grid-cols-3 gap-3">
                {[["resi", "Residential"], ["rentals", "Rentals"], ["cre", "CRE"]].map(([kind, label]) => {
                  const count = memberListings.filter((listing) => listing.listingKind === kind).length;
                  return <button key={kind} type="button" onClick={() => { setMemberProfileOpen(false); onOpenListingKind(kind); }} className={`rounded-lg border p-3 text-left transition hover:border-[#0b5cab] ${kind === listingKind ? "border-blue-300 bg-blue-50" : "border-slate-200"}`}><span className="block text-2xl font-bold text-slate-950">{count}</span><span className="text-xs font-semibold text-slate-500">{label}</span></button>;
                })}
              </div>
              <div className="mt-6 flex items-center justify-between"><div><h3 className="text-sm font-bold">Your listings</h3><p className="mt-1 text-xs text-slate-500">Performance updates when a visitor opens a listing.</p></div><button type="button" onClick={() => { setMemberProfileOpen(false); openNewListing(); }} className="inline-flex items-center gap-1.5 rounded-md bg-[#0b5cab] px-3 py-2 text-xs font-bold text-white"><Plus size={14} /> Add listing</button></div>
              <div className="mt-3 space-y-3">
                {memberListings.length ? memberListings.map((listing) => {
                  const stats = memberListingAnalytics.byListing[listing.id] || { totalViews: 0, uniqueVisitors: 0, lastViewedAt: "", recentViewers: [] };
                  return <article key={listing.id} className="rounded-lg border border-slate-200 p-4" data-member-listing-analytics={listing.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0"><p className="truncate text-sm font-bold">{listing.propertyName}</p><p className="truncate text-xs text-slate-500">{listing.listingKind.toUpperCase()} · {(listing.publicationStatus || "published").toUpperCase()} · {listing.address}</p></div>
                      <div className="flex items-center gap-4 text-xs font-bold text-slate-700"><span className="inline-flex items-center gap-1"><Eye size={13} className="text-[#0b5cab]" />{stats.totalViews} views</span><span className="inline-flex items-center gap-1"><Users size={13} className="text-[#0b5cab]" />{stats.uniqueVisitors} unique</span><button type="button" onClick={() => { if (listing.listingKind !== listingKind) { setMemberProfileOpen(false); onOpenListingKind(listing.listingKind); return; } setMemberProfileOpen(false); openEditListing(listing); }} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700"><Pencil size={13} className="mr-1 inline" />{listing.listingKind === listingKind ? "Edit" : "Open"}</button></div>
                    </div>
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Who viewed it</p>
                      {stats.recentViewers.length ? <div className="mt-2 flex flex-wrap gap-2">{stats.recentViewers.map((viewer) => <span key={viewer.key} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{viewer.label} · {viewer.count} {viewer.count === 1 ? "view" : "views"}</span>)}</div> : <p className="mt-2 text-xs text-slate-500">No recorded visitors yet.</p>}
                      {stats.lastViewedAt && <p className="mt-2 text-[11px] text-slate-400">Last viewed {new Date(stats.lastViewedAt).toLocaleString()}</p>}
                    </div>
                  </article>;
                }) : <p className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">You have not published any listings yet.</p>}
              </div>
            </div>
            <footer className="flex justify-end border-t border-slate-200 px-5 py-4"><button type="button" onClick={() => { clearMemberAccessSession(); onMemberLogout(); setMemberProfileOpen(false); }} className="inline-flex items-center gap-2 rounded-md border border-red-200 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50"><LogOut size={14} /> Sign out</button></footer>
          </section>
        </div>
      )}

      {listingEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="listing-editor-title">
          <form onSubmit={submitUserListing} className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[#0b5cab]">{listingKind === "cre" ? "Commercial listing" : listingKind === "rentals" ? "Rental listing" : "Residential listing"}</p>
                <h2 id="listing-editor-title" className="mt-1 text-xl font-bold text-slate-950">{listingEditor.mode === "edit" ? "Edit your listing" : "Add your listing"}</h2>
              </div>
              <button type="button" onClick={() => setListingEditor(null)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Close listing form"><X aria-hidden="true" size={19} /></button>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
              <section className="rounded-lg border border-slate-200 bg-slate-50 p-4 sm:col-span-2 lg:col-span-3" data-listing-deal-preview="true" aria-live="polite">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Automatic deal formula</p>
                    <p className="mt-1 text-sm text-slate-600">Enter asking price plus estimated market value or income. The result updates immediately.</p>
                  </div>
                  <span className={`rounded-md px-3 py-2 text-sm font-bold text-white ${listingDealBadgeClass(editorDealRating.score)}`}>
                    {editorDealRating.label} · {editorDealRating.score}/100
                  </span>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-600">{editorDealRating.basis}</p>
                {!editorDealRating.hasPricingEvidence && <p className="mt-1 text-xs font-semibold text-amber-700">Preliminary rating: add market value, market rent, or NOI for a supported result.</p>}
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-bold sm:grid-cols-4">
                  <span className="rounded bg-emerald-100 px-2 py-1.5 text-emerald-800">80–100 Great Deal</span>
                  <span className="rounded bg-blue-100 px-2 py-1.5 text-blue-800">65–79 Good Deal</span>
                  <span className="rounded bg-amber-100 px-2 py-1.5 text-amber-800">45–64 Fair Deal</span>
                  <span className="rounded bg-red-100 px-2 py-1.5 text-red-800">0–44 Not Ready to Sell</span>
                </div>
                <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer font-semibold text-[#0b5cab]">How the formula works</summary><p className="mt-2 leading-5">{editorDealRating.equation}. Verified development activity within 0.5 mile can adjust the score by up to 20 points.</p></details>
              </section>
              {[
                ["propertyName", "Property name *", "Oak Street Property"],
                ["priceLabel", "Price", "$1,250,000 or Contact for price"],
                ["assetType", "Property type", listingKind === "cre" ? "Retail, office, industrial" : listingKind === "rentals" ? "Apartment, house, multifamily" : "Single family, condo"],
                ["address", "Street address *", "123 Main Street"],
                ["city", "City", "Louisville"],
                ["state", "State", "KY"],
                ["county", "County *", "Jefferson County"],
                ["market", "Market", "Louisville"],
                ["sizeLabel", "Building size", "12,500 SF"],
                ["landLabel", "Land or lot size", "2.4 acres"],
                ["capRate", listingKind === "cre" ? "Use / cap rate" : listingKind === "rentals" ? "Lease terms" : "Property use", listingKind === "cre" ? "6.5% cap rate" : listingKind === "rentals" ? "12-month lease" : "Owner occupied"],
                ["yearBuilt", "Year built", "2005"],
                ["zoning", "Zoning", "C-2"],
                ["parcelId", "Parcel ID", "County parcel identifier"],
                ["coordinates", "Coordinates", "38.2527, -85.7585"],
                ["contactName", "Contact name", "Owner or listing agent"],
                ["contactEmail", "Contact email", "agent@example.com"],
                ["contactPhone", "Contact phone", "(555) 555-0123"],
                ["tags", "Tags", "Investment, renovated, corner lot"],
                ["askingPrice", "Asking price", "1250000"],
                ["estimatedMarketValue", "Estimated market value", "1500000"],
                ["annualNoi", "Annual NOI", "90000"],
                ["monthlyRent", "Monthly rent", "2200"],
                ["marketMonthlyRent", "Market monthly rent", "2500"],
                ["monthlyExpenses", "Monthly operating expenses", "500"],
              ].map(([field, label, placeholder]) => (
                <label key={field} className="block">
                  <span className="text-xs font-bold text-slate-600">{label}</span>
                  <input required={["propertyName", "address", "county"].includes(field)} type={field === "contactEmail" ? "email" : ["askingPrice", "estimatedMarketValue", "annualNoi", "monthlyRent", "marketMonthlyRent", "monthlyExpenses"].includes(field) ? "number" : "text"} min={["askingPrice", "estimatedMarketValue", "annualNoi", "monthlyRent", "marketMonthlyRent", "monthlyExpenses"].includes(field) ? "0" : undefined} step={["askingPrice", "estimatedMarketValue", "annualNoi", "monthlyRent", "marketMonthlyRent", "monthlyExpenses"].includes(field) ? "0.01" : undefined} value={listingEditor.draft[field] || ""} onChange={(event) => updateListingDraft(field, event.target.value)} placeholder={placeholder} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-[#0b5cab] focus:ring-2 focus:ring-blue-100" />
                </label>
              ))}
              <label className="block">
                <span className="text-xs font-bold text-slate-600">Status</span>
                <select value={listingEditor.draft.status} onChange={(event) => updateListingDraft("status", event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-[#0b5cab]">
                  {(listingKind === "cre" ? ["For Sale", "For Lease", "Watch"] : listingKind === "rentals" ? ["For Rent", "Coming Soon", "Leased", "Watch"] : ["For Sale", "Coming Soon", "Watch"]).map((status) => <option key={status}>{status}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-bold text-slate-600">Publication</span>
                <select value={listingEditor.draft.publicationStatus || "published"} onChange={(event) => updateListingDraft("publicationStatus", event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-[#0b5cab]" data-listing-publication-status="true">
                  <option value="draft">Draft — only you can see it</option>
                  <option value="published">Published — visible in marketplace</option>
                  <option value="pending">Pending — visible, under contract</option>
                  <option value="sold">Sold — visible as closed</option>
                  <option value="leased">Leased — visible as closed</option>
                  <option value="expired">Expired — removed from marketplace</option>
                  <option value="archived">Archived — removed from marketplace</option>
                </select>
              </label>
              <label className="block sm:col-span-2 lg:col-span-3">
                <span className="text-xs font-bold text-slate-600">Description</span>
                <textarea value={listingEditor.draft.highlight} onChange={(event) => updateListingDraft("highlight", event.target.value)} rows={3} placeholder="Describe the property and opportunity." className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#0b5cab] focus:ring-2 focus:ring-blue-100" />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-bold text-slate-600">Photo URL</span>
                <input type="url" value={listingEditor.draft.image?.startsWith("data:") ? "" : listingEditor.draft.image || ""} onChange={(event) => updateListingDraft("image", event.target.value)} placeholder="https://example.com/property.jpg" className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-[#0b5cab]" />
              </label>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <ImagePlus aria-hidden="true" size={17} /> Upload photo
                <input type="file" accept="image/*" className="sr-only" onChange={(event) => loadListingPhoto(event.target.files?.[0])} />
              </label>
              {listingEditor.draft.image && <img src={listingEditor.draft.image} alt="Listing preview" className="h-32 w-full rounded-md object-cover sm:col-span-2 lg:col-span-3" />}
            </div>
            <div className="sticky bottom-0 flex justify-end gap-3 border-t border-slate-200 bg-white px-5 py-4">
              <button type="button" onClick={() => setListingEditor(null)} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" className="rounded-md bg-[#0b5cab] px-5 py-2 text-sm font-bold text-white hover:bg-[#084a89]">{listingEditor.mode === "edit" ? "Save Changes" : listingEditor.draft.publicationStatus === "published" ? "Publish Listing" : "Save Listing"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function LiveTileMapBackground({ mapCamera, earthIntroActive, mapMode }) {
  const safeCamera = mapCamera || DALLAS_LOCATION.camera;
  const isDallasParcelMode = !earthIntroActive && mapMode === "parcel";
  const baseTiles = isDallasParcelMode ? getDallasTileGrid() : [];
  const offsetX = (50 - safeCamera.x) * 1.4;
  const offsetY = (50 - safeCamera.y) * 1.4;
  const zoomScale = clamp(safeCamera.zoom, 0.5, 2.1);
  const dallasTileBlend = isDallasParcelMode ? clamp((safeCamera.zoom - 0.88) / 0.48, 0, 1) : 0;
  const earthOpacity = isDallasParcelMode ? clamp(1 - dallasTileBlend * 0.86, 0.14, 1) : 1;
  const tileOpacity = dallasTileBlend * 0.92;
  const earthScale = clamp(0.86 + zoomScale * 0.44, 1.02, 1.62);
  const earthOffsetX = (50 - safeCamera.x) * 1.04;
  const earthOffsetY = (50 - safeCamera.y) * 0.82;

  return (
    <div className="absolute inset-0 overflow-hidden bg-black" data-dallas-tiles-active={isDallasParcelMode ? "true" : "false"}>
      <img
        src="https://images.unsplash.com/photo-1614730321146-b6fa6a46bcb4?auto=format&fit=crop&w=2200&q=90"
        alt="Earth from space"
        className="absolute inset-0 h-full w-full object-cover transition-all duration-[1400ms] ease-out"
        style={{
          opacity: earthOpacity,
          transform: `translate(${earthOffsetX}%, ${earthOffsetY}%) scale(${earthScale}) rotate(${safeCamera.bearing * 0.12}deg)`,
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,transparent_22%,rgba(0,0,0,0.08)_38%,rgba(0,0,0,0.48)_76%,rgba(0,0,0,0.82)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_22%,rgba(96,165,250,0.20),transparent_24%),radial-gradient(circle_at_68%_52%,rgba(34,197,94,0.14),transparent_28%)]" />

      <div
        className="absolute inset-[-12%] transition-all duration-700"
        style={{
          opacity: tileOpacity,
          transform: `translate(${offsetX}px, ${offsetY}px) scale(${zoomScale})`,
          transformOrigin: "center center",
        }}
      >
        {baseTiles.map((tile) => (
          <img
            key={`${tile.z}-${tile.x}-${tile.y}`}
            src={`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${tile.z}/${tile.y}/${tile.x}`}
            alt=""
            className="absolute h-1/3 w-1/3 object-cover"
            style={{ left: tile.left, top: tile.top }}
            draggable="false"
          />
        ))}
      </div>

      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,6,23,0.10),rgba(2,6,23,0.20),rgba(0,0,0,0.45))]" />
    </div>
  );
}

function screenPointsToMapGeometry(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const coordinates = points.map((point) => screenPointToLngLat(safePoint(point, [DALLAS_LOCATION.camera.x, DALLAS_LOCATION.camera.y])));
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) coordinates.push(first);
  return { type: "Polygon", coordinates: [coordinates] };
}

function parcelFloodplainRecordForParcel(parcel, floodplainParcelMap = new Map()) {
  const accountNum = parcel.accountNum || parcel.accountNumber || "";
  const keys = [countyAwareParcelId(parcel), accountNum, parcel.gisParcelId].map((value) => String(value || "").trim()).filter(Boolean);
  for (const key of keys) {
    const record = floodplainParcelMap.get(key);
    if (record) return record;
  }
  return null;
}

function parcelZoningRecordForParcel(parcel, zoningParcelMap = new Map()) {
  const accountNum = parcel.accountNum || parcel.accountNumber || "";
  const keys = [countyAwareParcelId(parcel), accountNum, parcel.gisParcelId].map((value) => String(value || "").trim()).filter(Boolean);
  for (const key of keys) {
    const record = zoningParcelMap.get(key);
    if (record) return record;
  }
  return null;
}

function isFloodplainSfha(summary = {}) {
  const flags = Array.isArray(summary.sfha) ? summary.sfha : [];
  return flags.some((value) => ["T", "TRUE", "Y", "YES", "1", "SFHA"].includes(String(value || "").trim().toUpperCase()));
}

function parcelMapLabelText(parcel) {
  return parcel.address || parcel.propertyAddress || "";
}

function isMapCoordinatePair(point) {
  return Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]));
}

function isRenderableMapGeometry(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return false;
  if (geometry.type === "Polygon") {
    return geometry.coordinates.some((ring) => Array.isArray(ring) && ring.length >= 3 && ring.every(isMapCoordinatePair));
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) => Array.isArray(polygon)
      && polygon.some((ring) => Array.isArray(ring) && ring.length >= 3 && ring.every(isMapCoordinatePair)));
  }
  return false;
}

function parcelMapGeometry(parcel) {
  const realGeometry = parcel?.realGeometry?.geometry;
  if (isRenderableMapGeometry(realGeometry)) return realGeometry;
  const livePoints = parcel?.liveGeometry?.points;
  if (Array.isArray(livePoints) && livePoints.length >= 3 && livePoints.every(isMapCoordinatePair)) {
    return { type: "Polygon", coordinates: [livePoints] };
  }
  return screenPointsToMapGeometry(parcel?.points);
}

function parcelRecordToMapFeature(parcel, developmentIndex = new Map(), floodplainParcelMap = new Map(), zoningParcelMap = new Map()) {
  const geometry = parcelMapGeometry(parcel);
  if (!geometry) return null;
  const accountNum = parcel.accountNum || parcel.accountNumber || "";
  const developmentRecord = developmentIndex.get(String(accountNum));
  const parcelKey = countyAwareParcelId(parcel);
  const floodplainRecord = parcelFloodplainRecordForParcel(parcel, floodplainParcelMap);
  const floodplainSummary = floodplainRecord?.floodplainSummary || {};
  const zoningRecord = parcelZoningRecordForParcel(parcel, zoningParcelMap);
  const zoningSummary = zoningRecord?.zoningSummary || {};
  const zoningLabel = zoningSummary.label || zoningRecord?.existingParcelZoning || parcel.zoning || "";
  return {
    type: "Feature",
    properties: {
      sourceCountyId: parcel.sourceCountyId || activeCountyDataset.id,
      countyParcelId: parcelKey,
      accountNum,
      accountNumber: parcel.accountNumber || parcel.accountNum || "",
      gisParcelId: parcel.gisParcelId || "",
      address: parcel.address || parcel.propertyAddress || "",
      propertyName: parcel.propertyName || parcel.ownerPropertyName || "",
      ownerName: parcel.ownerName || "",
      blockId: parcel.blockId || "",
      buildingClass: parcel.buildingClass || "",
      totalValue: Number.parseFloat(parcel.totalValue || 0) || 0,
      labelText: parcelMapLabelText(parcel),
      dimensionText: parcel.dimensions?.dimensionLabel || parcel.dimensionLabel || "",
      hasDevelopment: Boolean(developmentRecord),
      developmentSignalCount: developmentRecord?.signalCount || 0,
      developmentScore: developmentRecord?.score || 0,
      developmentLatestActivity: developmentRecord?.latestActivityDate || "",
      hasFloodplain: Boolean(floodplainRecord),
      floodplainLabel: floodplainSummary.label || "",
      floodplainSfha: isFloodplainSfha(floodplainSummary),
      hasZoning: Boolean(zoningRecord),
      zoningLabel,
      zoningBaseDistrict: Array.isArray(zoningSummary.baseDistricts) ? zoningSummary.baseDistricts[0] || "" : "",
      zoningPdNumber: Array.isArray(zoningSummary.pdNumbers) ? zoningSummary.pdNumbers[0] || "" : "",
      zoningSupNumber: Array.isArray(zoningSummary.supNumbers) ? zoningSummary.supNumbers[0] || "" : "",
    },
    geometry,
  };
}

function buildParcelMapFeatureCollection(parcels, developmentIndex = new Map(), floodplainParcelMap = new Map(), zoningParcelMap = new Map()) {
  return { type: "FeatureCollection", features: parcels.map((parcel) => parcelRecordToMapFeature(parcel, developmentIndex, floodplainParcelMap, zoningParcelMap)).filter(Boolean) };
}

function parcelLngLatPolygons(parcel) {
  const geometry = parcelMapGeometry(parcel);
  if (geometry?.type === "Polygon" && Array.isArray(geometry.coordinates)) return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) return geometry.coordinates;
  if (Array.isArray(parcel?.liveGeometry?.points)) return [[parcel.liveGeometry.points]];
  return [];
}

function lngLatInsideRing(lng, lat, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    const currentLng = Number(currentPoint?.[0]);
    const currentLat = Number(currentPoint?.[1]);
    const previousLng = Number(previousPoint?.[0]);
    const previousLat = Number(previousPoint?.[1]);
    if (![currentLng, currentLat, previousLng, previousLat].every(Number.isFinite)) continue;
    const crossesLatitude = currentLat > lat !== previousLat > lat;
    const edgeLng = ((previousLng - currentLng) * (lat - currentLat)) / ((previousLat - currentLat) || Number.EPSILON) + currentLng;
    if (crossesLatitude && lng < edgeLng) inside = !inside;
  }
  return inside;
}

function parcelContainsLngLat(parcel, lng, lat) {
  return parcelLngLatPolygons(parcel).some((polygon) => {
    const outerRing = polygon?.[0];
    if (!lngLatInsideRing(lng, lat, outerRing)) return false;
    return !polygon.slice(1).some((hole) => lngLatInsideRing(lng, lat, hole));
  });
}

function parcelFillColorExpression(mapMode, selectedParcelAccount) {
  const selected = selectedParcelAccount || "";
  return [
    "case",
    ["any", ["==", ["get", "countyParcelId"], selected], ["==", ["get", "accountNum"], selected]],
    "rgba(110,231,183,0.48)",
    ["==", ["get", "hasDevelopment"], true],
    "rgba(34,197,94,0.46)",
    mapMode === "value" ? "rgba(250,204,21,0.18)" : "rgba(187,247,208,0.26)",
  ];
}

function parcelLineColorExpression(mapMode, selectedParcelAccount) {
  const selected = selectedParcelAccount || "";
  if (mapMode === "value") {
    return [
      "case",
      ["any", ["==", ["get", "countyParcelId"], selected], ["==", ["get", "accountNum"], selected]],
      "#6ee7b7",
      [">=", ["to-number", ["get", "totalValue"]], 10000000],
      "#facc15",
      [">=", ["to-number", ["get", "totalValue"]], 1000000],
      "#fef3c7",
      "#ffffff",
    ];
  }
  return ["case", ["any", ["==", ["get", "countyParcelId"], selected], ["==", ["get", "accountNum"], selected]], "#6ee7b7", ["==", ["get", "hasDevelopment"], true], "#22c55e", "#86efac"];
}

function selectedParcelMapFilter(selectedParcelAccount) {
  const selected = selectedParcelAccount || "";
  return ["any", ["==", ["get", "countyParcelId"], selected], ["==", ["get", "accountNum"], selected]];
}

function escapePopupHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hasPopupValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function parcelPopupRow(label, value) {
  if (!hasPopupValue(value)) return "";
  return `<div class="wr-parcel-popup-row"><span>${escapePopupHtml(label)}</span><strong>${escapePopupHtml(value)}</strong></div>`;
}

function parcelPopupSourceLabel(parcel) {
  if (parcel?.sourceCountyId === "jefferson-ky") return "Jefferson County Parcel";
  if (parcel?.sourceCountyId && parcel.sourceCountyId !== activeCountyDataset.id) return "County Parcel";
  return "DCAD Parcel";
}

function parcelPopupPrimaryId(parcel) {
  return parcel?.accountNum || parcel?.accountNumber || parcel?.sourceParcelId || parcel?.gisParcelId || parcel?.countyParcelId || "";
}

function parcelPopupCountyId(parcel) {
  return countyAwareParcelId(parcel || {});
}

function parcelPopupAddress(parcel) {
  return parcel?.address || parcel?.propertyAddress || "";
}

function parcelPopupIntelStatus(parcel) {
  return [
    parcel?.hasZoning || parcel?.zoning || parcel?.zoningLabel ? "Zoning" : "",
    parcel?.hasFloodplain || parcel?.floodplain || parcel?.floodplainLabel ? "Floodplain" : "",
    parcel?.hasDevelopment || Number(parcel?.developmentSignalCount || 0) > 0 ? "Development" : "",
    parcel?.dimensions || parcel?.dimensionText || parcel?.dimensionLabel ? "Dimensions" : "",
  ].filter(Boolean).join(" / ");
}

function buildParcelPopupHtml(parcel) {
  const dimensions = parcel?.dimensions || {};
  const parcelSourceLabel = parcelPopupSourceLabel(parcel);
  const parcelId = parcelPopupPrimaryId(parcel);
  const countyParcelId = parcelPopupCountyId(parcel);
  const title = parcelId || parcelSourceLabel;
  const address = parcelPopupAddress(parcel);
  const owner = parcel?.ownerName || parcel?.propertyName || parcel?.ownerPropertyName || "";
  const frontage = dimensions.frontageFt || parcel?.frontage;
  const depth = dimensions.depthFt || parcel?.depth;
  const dimensionText = dimensions.dimensionLabel || parcel?.dimensionLabel || [frontage && `${formatInteger(frontage)} ft frontage`, depth && `${formatInteger(depth)} ft depth`].filter(Boolean).join(" / ");
  const intelStatus = parcelPopupIntelStatus(parcel);

  return `
    <div class="wr-parcel-popup-body" data-parcel-roving-popup="true">
      <p class="wr-parcel-popup-kicker">${escapePopupHtml(parcelSourceLabel)}</p>
      <p class="wr-parcel-popup-id-label">Parcel ID</p>
      <h3>${escapePopupHtml(title)}</h3>
      ${countyParcelId && countyParcelId !== parcelId ? `<p class="wr-parcel-popup-county-id">${escapePopupHtml(countyParcelId)}</p>` : ""}
      ${address ? `<p class="wr-parcel-popup-address">${escapePopupHtml(address)}</p>` : ""}
      ${owner ? `<p class="wr-parcel-popup-owner">${escapePopupHtml(owner)}</p>` : ""}
      <div class="wr-parcel-popup-grid">
        ${parcelPopupRow("Account", parcel?.accountNum || parcel?.accountNumber)}
        ${parcelPopupRow("GIS ID", parcel?.gisParcelId)}
        ${parcelPopupRow("Intel", intelStatus)}
        ${parcelPopupRow("Value", hasPopupValue(parcel?.totalValue) ? formatCurrency(parcel.totalValue) : "")}
        ${parcelPopupRow("Land", hasPopupValue(parcel?.landValue) ? formatCurrency(parcel.landValue) : "")}
        ${parcelPopupRow("Improvement", hasPopupValue(parcel?.improvementValue) ? formatCurrency(parcel.improvementValue) : "")}
        ${parcelPopupRow("Land Area", hasPopupValue(parcel?.landAreaSqFt) ? `${formatInteger(parcel.landAreaSqFt)} SF` : parcel?.areaLabel)}
        ${parcelPopupRow("Block", parcel?.blockId)}
        ${parcelPopupRow("Class", parcel?.buildingClass)}
        ${parcelPopupRow("Dimensions", dimensionText)}
      </div>
    </div>
  `;
}

function LiveMapEngine({ selectedParcelAccount, focusSelectedParcel = true, visibleParcels, developmentIndex, floodplainParcelMap, zoningParcelMap, onParcelSelect, mapMode, showGrid, showParcelLabels, showDimensions, showFloodplain, showZoning, parcelRenderProfile, mapApiRef, mapCamera, mapGeoBounds, mapLocation, onViewportChange }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [maplibregl, setMaplibregl] = useState(null);
  const parcelsRef = useRef([]);
  const developmentIndexRef = useRef(new Map());
  const floodplainParcelMapRef = useRef(new Map());
  const zoningParcelMapRef = useRef(new Map());
  const mapGeoBoundsRef = useRef(mapGeoBounds || DALLAS_LIVE_GEO_BOUNDS);
  const mapLocationRef = useRef(mapLocation || DALLAS_LOCATION);
  const lastFocusedParcelAccountRef = useRef("");
  const onParcelSelectRef = useRef(onParcelSelect);
  const onViewportChangeRef = useRef(onViewportChange);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import("maplibre-gl"),
      import("maplibre-gl/dist/maplibre-gl.css"),
    ]).then(([module]) => {
      if (!cancelled) setMaplibregl(module.default || module);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    parcelsRef.current = visibleParcels;
    developmentIndexRef.current = developmentIndex || new Map();
    floodplainParcelMapRef.current = floodplainParcelMap || new Map();
    zoningParcelMapRef.current = zoningParcelMap || new Map();
    mapGeoBoundsRef.current = mapGeoBounds || DALLAS_LIVE_GEO_BOUNDS;
    mapLocationRef.current = mapLocation || DALLAS_LOCATION;
    onParcelSelectRef.current = onParcelSelect;
    onViewportChangeRef.current = onViewportChange;
  }, [developmentIndex, floodplainParcelMap, mapGeoBounds, mapLocation, onParcelSelect, onViewportChange, visibleParcels, zoningParcelMap]);

  useEffect(() => {
    if (!maplibregl || !containerRef.current || mapRef.current) return;
    const initialLocation = mapLocationRef.current || DALLAS_LOCATION;
    const initialBounds = mapGeoBoundsRef.current || DALLAS_LIVE_GEO_BOUNDS;

    const map = new maplibregl.Map({
      container: containerRef.current,
      center: screenPointToLngLat([mapCamera?.x ?? initialLocation.camera.x, mapCamera?.y ?? initialLocation.camera.y], initialBounds, initialLocation.camera),
      zoom: mapLibreZoomFromCamera(mapCamera),
      pitch: clamp(mapCamera?.pitch || 48, 0, 72),
      bearing: normalizeBearing(mapCamera?.bearing || initialLocation.camera.bearing),
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          "wr-aerial-imagery": {
            type: "raster",
            tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
            attribution: "Tiles © Esri",
          },
          "wr-parcels": {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          },
        },
        layers: [
          { id: "wr-aerial-imagery", type: "raster", source: "wr-aerial-imagery", paint: { "raster-saturation": -0.08, "raster-contrast": 0.08 } },
          {
            id: "wr-parcels-fill",
            type: "fill",
            source: "wr-parcels",
            paint: {
              "fill-color": parcelFillColorExpression(mapMode, selectedParcelAccount),
              "fill-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.24, 14, 0.38, 17, 0.48],
            },
          },
          {
            id: "wr-parcels-line",
            type: "line",
            source: "wr-parcels",
            paint: {
              "line-color": parcelLineColorExpression(mapMode, selectedParcelAccount),
              "line-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0.68, 12, 0.9, 16, 1],
              "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.55, 12, 1.05, 15, 1.8, 18, 2.7],
            },
          },
          {
            id: "wr-zoning-parcels-fill",
            type: "fill",
            source: "wr-parcels",
            filter: ["==", ["get", "hasZoning"], true],
            layout: {
              visibility: showZoning ? "visible" : "none",
            },
            paint: {
              "fill-color": [
                "case",
                ["!=", ["get", "zoningPdNumber"], ""],
                "rgba(168,85,247,0.34)",
                ["!=", ["get", "zoningSupNumber"], ""],
                "rgba(249,115,22,0.3)",
                "rgba(250,204,21,0.22)",
              ],
              "fill-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.2, 14, 0.34, 17, 0.46],
            },
          },
          {
            id: "wr-zoning-parcels-line",
            type: "line",
            source: "wr-parcels",
            filter: ["==", ["get", "hasZoning"], true],
            layout: {
              visibility: showZoning ? "visible" : "none",
            },
            paint: {
              "line-color": [
                "case",
                ["!=", ["get", "zoningPdNumber"], ""],
                "#c084fc",
                ["!=", ["get", "zoningSupNumber"], ""],
                "#fb923c",
                "#fde68a",
              ],
              "line-opacity": 0.92,
              "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.85, 14, 1.45, 17, 2.2],
            },
          },
          {
            id: "wr-floodplain-parcels-fill",
            type: "fill",
            source: "wr-parcels",
            filter: ["==", ["get", "hasFloodplain"], true],
            layout: {
              visibility: showFloodplain ? "visible" : "none",
            },
            paint: {
              "fill-color": ["case", ["==", ["get", "floodplainSfha"], true], "rgba(14,165,233,0.46)", "rgba(125,211,252,0.28)"],
              "fill-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.22, 14, 0.36, 17, 0.5],
            },
          },
          {
            id: "wr-floodplain-parcels-line",
            type: "line",
            source: "wr-parcels",
            filter: ["==", ["get", "hasFloodplain"], true],
            layout: {
              visibility: showFloodplain ? "visible" : "none",
            },
            paint: {
              "line-color": ["case", ["==", ["get", "floodplainSfha"], true], "#38bdf8", "#bae6fd"],
              "line-opacity": 0.95,
              "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.1, 14, 1.8, 17, 2.6],
            },
          },
          {
            id: "wr-selected-parcel-line",
            type: "line",
            source: "wr-parcels",
            filter: selectedParcelMapFilter(selectedParcelAccount),
            paint: {
              "line-color": "#6ee7b7",
              "line-opacity": 1,
              "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.8, 15, 3.2, 18, 4.4],
            },
          },
          {
            id: "wr-hovered-parcel-line",
            type: "line",
            source: "wr-parcels",
            filter: ["==", ["get", "countyParcelId"], ""],
            paint: {
              "line-color": "#f8fafc",
              "line-opacity": 1,
              "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 15, 2.8, 18, 3.8],
            },
          },
          {
            id: "wr-block-labels",
            type: "symbol",
            source: "wr-parcels",
            minzoom: 10.95,
            maxzoom: 13.2,
            layout: {
              "text-field": ["get", "blockId"],
              "text-size": ["interpolate", ["linear"], ["zoom"], 11, 9, 13, 12],
              "text-anchor": "center",
              "text-allow-overlap": false,
              "visibility": showParcelLabels ? "visible" : "none",
            },
            paint: {
              "text-color": "rgba(255,255,255,0.82)",
              "text-halo-color": "rgba(0,0,0,0.72)",
              "text-halo-width": 1.2,
              "text-opacity": ["interpolate", ["linear"], ["zoom"], 10.95, 0, 11.5, 0.78, 13.2, 0.42],
            },
          },
          {
            id: "wr-parcel-labels",
            type: "symbol",
            source: "wr-parcels",
            minzoom: 12.35,
            layout: {
              "text-field": ["get", "labelText"],
              "text-size": ["interpolate", ["linear"], ["zoom"], 12.35, 9, 15.5, 12],
              "text-anchor": "center",
              "text-allow-overlap": false,
              "visibility": showParcelLabels ? "visible" : "none",
            },
            paint: {
              "text-color": "rgba(255,255,255,0.9)",
              "text-halo-color": "rgba(0,0,0,0.76)",
              "text-halo-width": 1.1,
              "text-opacity": ["interpolate", ["linear"], ["zoom"], 12.35, 0, 13.2, 0.78, 16, 0.95],
            },
          },
          {
            id: "wr-dimension-labels",
            type: "symbol",
            source: "wr-parcels",
            minzoom: 13.3,
            layout: {
              "text-field": ["get", "dimensionText"],
              "text-size": ["interpolate", ["linear"], ["zoom"], 13.3, 8, 16, 11],
              "text-offset": [0, 1.2],
              "text-anchor": "top",
              "text-allow-overlap": false,
              "visibility": showDimensions ? "visible" : "none",
            },
            paint: {
              "text-color": "rgba(186,230,253,0.92)",
              "text-halo-color": "rgba(0,0,0,0.8)",
              "text-halo-width": 1,
              "text-opacity": ["interpolate", ["linear"], ["zoom"], 13.3, 0, 14.2, 0.72, 16, 0.94],
            },
          },
        ],
      },
    });

    const parcelPopup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 14,
      className: "wr-parcel-popup",
    });
    let rovingPopupParcelKey = "";
    const mapParcelSelectionOptions = { focusCamera: false };

    const setHoveredParcelFeature = (feature = null) => {
      if (!map.getLayer("wr-hovered-parcel-line")) return;
      const countyParcelId = String(feature?.properties?.countyParcelId || "");
      const accountNum = String(feature?.properties?.accountNum || feature?.properties?.accountNumber || "");
      map.setFilter("wr-hovered-parcel-line", countyParcelId
        ? ["==", ["get", "countyParcelId"], countyParcelId]
        : accountNum
          ? ["any", ["==", ["get", "accountNum"], accountNum], ["==", ["get", "accountNumber"], accountNum]]
          : ["==", ["get", "countyParcelId"], ""]);
    };

    const findParcelForFeature = (feature) => {
      const countyParcelId = feature?.properties?.countyParcelId;
      const accountNum = feature?.properties?.accountNum || feature?.properties?.accountNumber;
      return parcelsRef.current.find((record) => String(countyAwareParcelId(record)) === String(countyParcelId) || String(record.accountNum || record.accountNumber) === String(accountNum)) || feature?.properties || null;
    };

    const findParcelAtLngLat = (lngLat) => {
      const lng = Number(lngLat?.lng ?? lngLat?.[0]);
      const lat = Number(lngLat?.lat ?? lngLat?.[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
      for (let index = parcelsRef.current.length - 1; index >= 0; index -= 1) {
        const parcel = parcelsRef.current[index];
        if (parcelContainsLngLat(parcel, lng, lat)) return parcel;
      }
      return null;
    };

    const openParcelInfoWindow = (parcel, options = mapParcelSelectionOptions) => {
      if (!parcel) return false;
      const selectionOptions = { ...mapParcelSelectionOptions, ...options };
      parcelPopup.remove();
      window.__whiteRabbitLastSelectedParcel = parcel;
      onParcelSelectRef.current(parcel, selectionOptions);
      return true;
    };

    const queryParcelFeatureAtPoint = (point) => {
      if (!point || !map.getLayer("wr-parcels-fill")) return null;
      const queryPoint = Array.isArray(point) ? point : [point.x, point.y];
      const directHit = map.queryRenderedFeatures(queryPoint, { layers: ["wr-parcels-fill"] })[0];
      if (directHit) return directHit;
      const hitRadius = map.getZoom() < 12 ? 64 : map.getZoom() < 15 ? 32 : 18;
      const hitLayers = ["wr-parcels-fill", "wr-parcels-line", "wr-selected-parcel-line"].filter((layerId) => map.getLayer(layerId));
      return map.queryRenderedFeatures(
        [
          [queryPoint[0] - hitRadius, queryPoint[1] - hitRadius],
          [queryPoint[0] + hitRadius, queryPoint[1] + hitRadius],
        ],
        { layers: hitLayers },
      )[0] || null;
    };

    const selectParcelFeature = (feature) => {
      const parcel = findParcelForFeature(feature);
      return parcel ? openParcelInfoWindow(parcel) : false;
    };

    const showParcelPopupForFeature = (feature, lngLat) => {
      const parcel = findParcelForFeature(feature);
      if (!parcel) return;
      showParcelPopupForParcel(parcel, lngLat);
    };

    const showParcelPopupForParcel = (parcel, lngLat) => {
      const popupKey = String(parcelPopupCountyId(parcel) || parcelPopupPrimaryId(parcel));
      map.getCanvas().style.cursor = "pointer";
      parcelPopup.setLngLat(lngLat);
      if (rovingPopupParcelKey !== popupKey) {
        rovingPopupParcelKey = popupKey;
        parcelPopup.setHTML(buildParcelPopupHtml(parcel));
      }
      parcelPopup.addTo(map);
      const popupElement = parcelPopup.getElement?.();
      if (popupElement) {
        popupElement.style.pointerEvents = "none";
        popupElement.dataset.parcelId = parcelPopupPrimaryId(parcel);
        popupElement.dataset.countyParcelId = parcelPopupCountyId(parcel);
      }
    };

    const showParcelPopupAtPointer = (event) => {
      if (!event?.point || !map.getLayer("wr-parcels-fill")) return;
      const feature = queryParcelFeatureAtPoint(event.point);
      if (!feature) {
        if (!modifierDrag) map.getCanvas().style.cursor = "";
        setHoveredParcelFeature();
        parcelPopup.remove();
        rovingPopupParcelKey = "";
        return;
      }
      setHoveredParcelFeature(feature);
      showParcelPopupForFeature(feature, event.lngLat || map.unproject(event.point));
    };

    const handleMapCanvasWheel = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = map.getCanvas().getBoundingClientRect();
      const point = [event.clientX - rect.left, event.clientY - rect.top];
      const cursorLngLat = map.unproject(point);
      const wheelScale = event.deltaMode === 1 ? 0.12 : 0.0032;
      const zoomDelta = clamp(-event.deltaY * wheelScale, -0.85, 0.85);
      const nextZoom = clamp(map.getZoom() + zoomDelta, 3.4, 17.8);
      map.easeTo({ zoom: nextZoom, around: cursorLngLat, duration: 120 });
      showParcelPopupAtPointer({ point, lngLat: cursorLngLat });
    };

    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    mapRef.current = map;
    window.__whiteRabbitMap = map;
    window.__whiteRabbitParcelsRef = parcelsRef;
    map.scrollZoom.disable();
    map.doubleClickZoom.disable();
    map.getCanvas().addEventListener("wheel", handleMapCanvasWheel, { passive: false });
    map.on("load", () => {
      map.getSource("wr-parcels")?.setData(buildParcelMapFeatureCollection(parcelsRef.current, developmentIndexRef.current, floodplainParcelMapRef.current, zoningParcelMapRef.current));
    });
    map.on("mousemove", "wr-parcels-fill", (event) => {
      const feature = event.features?.[0] || queryParcelFeatureAtPoint(event.point);
      if (!feature) return;
      setHoveredParcelFeature(feature);
      showParcelPopupForFeature(feature, event.lngLat || map.unproject(event.point));
    });
    map.on("click", "wr-parcels-fill", (event) => {
      const feature = event.features?.[0] || queryParcelFeatureAtPoint(event.point);
      selectParcelFeature(feature);
    });
    map.on("mouseenter", "wr-parcels-fill", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "wr-parcels-fill", () => {
      map.getCanvas().style.cursor = "";
      setHoveredParcelFeature();
      parcelPopup.remove();
      rovingPopupParcelKey = "";
    });
    let modifierDrag = null;
    let surfaceHoverFrame = null;
    let pendingSurfaceHover = null;
    const clearParcelHover = () => {
      map.getCanvas().style.cursor = "";
      setHoveredParcelFeature();
      parcelPopup.remove();
      rovingPopupParcelKey = "";
    };
    const handleMapSurfacePointerMove = (event) => {
      if (modifierDrag) return;
      const rect = map.getCanvas().getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
        clearParcelHover();
        return;
      }
      pendingSurfaceHover = [event.clientX - rect.left, event.clientY - rect.top];
      if (surfaceHoverFrame) return;
      surfaceHoverFrame = window.requestAnimationFrame(() => {
        surfaceHoverFrame = null;
        const point = pendingSurfaceHover;
        pendingSurfaceHover = null;
        if (!point) return;
        const lngLat = map.unproject(point);
        const feature = queryParcelFeatureAtPoint(point);
        const parcel = feature ? findParcelForFeature(feature) : findParcelAtLngLat(lngLat);
        if (!parcel) {
          clearParcelHover();
          return;
        }
        setHoveredParcelFeature({ properties: {
          countyParcelId: countyAwareParcelId(parcel),
          accountNum: parcel.accountNum || parcel.accountNumber || "",
        } });
        showParcelPopupForParcel(parcel, lngLat);
      });
    };
    const handleMapSurfaceClick = (event) => {
      if (event.shiftKey || event.altKey) return;
      const rect = map.getCanvas().getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
      const interactiveUi = event.target instanceof Element
        ? event.target.closest("button, a, input, textarea, select, [role='button']")
        : null;
      if (interactiveUi && !map.getCanvasContainer().contains(interactiveUi)) return;
      const point = [event.clientX - rect.left, event.clientY - rect.top];
      const feature = queryParcelFeatureAtPoint(point);
      const parcel = feature ? findParcelForFeature(feature) : findParcelAtLngLat(map.unproject(point));
      if (parcel) openParcelInfoWindow(parcel);
    };
    window.addEventListener("pointermove", handleMapSurfacePointerMove, true);
    window.addEventListener("click", handleMapSurfaceClick, true);
    map.on("mousedown", (event) => {
      if (!event.originalEvent.shiftKey && !event.originalEvent.altKey) return;
      event.preventDefault();
      map.dragPan.disable();
      modifierDrag = { x: event.originalEvent.clientX, y: event.originalEvent.clientY, mode: getDragNavigationMode(event.originalEvent) };
      map.getCanvas().style.cursor = "grabbing";
    });
    map.on("mousemove", (event) => {
      if (!modifierDrag) {
        showParcelPopupAtPointer(event);
        return;
      }
      parcelPopup.remove();
      const deltaX = event.originalEvent.clientX - modifierDrag.x;
      const deltaY = event.originalEvent.clientY - modifierDrag.y;
      if (modifierDrag.mode === "tilt" || modifierDrag.mode === "tilt-strong") map.setPitch(clamp(map.getPitch() - deltaY * 0.24, 0, 72));
      if (modifierDrag.mode === "orbit") map.setBearing(normalizeBearing(map.getBearing() + deltaX * 0.28));
      modifierDrag = { ...modifierDrag, x: event.originalEvent.clientX, y: event.originalEvent.clientY };
    });
    map.on("mouseup", () => {
      if (!modifierDrag) return;
      modifierDrag = null;
      map.dragPan.enable();
      map.getCanvas().style.cursor = "";
    });
    map.on("wheel", showParcelPopupAtPointer);
    map.on("moveend", () => {
      const center = map.getCenter();
      const activeLocation = mapLocationRef.current || DALLAS_LOCATION;
      const activeBounds = mapGeoBoundsRef.current || DALLAS_LIVE_GEO_BOUNDS;
      const [x, y] = lngLatToScreenPoint(center.lng, center.lat, activeBounds, activeLocation.coordinates);
      onViewportChangeRef.current?.({
        x,
        y,
        zoom: cameraZoomFromMapLibreZoom(map.getZoom()),
        bearing: normalizeBearing(map.getBearing()),
        pitch: clamp(map.getPitch(), 24, 78),
        center: [center.lng, center.lat],
        bounds: screenBoundsFromMapBounds(map.getBounds(), activeBounds),
      });
    });

    if (mapApiRef) {
      mapApiRef.current = {
        zoomIn: () => map.easeTo({ zoom: map.getZoom() + 0.75, duration: 650 }),
        zoomOut: () => map.easeTo({ zoom: map.getZoom() - 0.75, duration: 650 }),
        reset: () => {
          const activeLocation = mapLocationRef.current || DALLAS_LOCATION;
          map.easeTo({ center: activeLocation.coordinates, zoom: activeLocation.mapZoom ?? 13.2, pitch: activeLocation.camera?.pitch ?? 48, bearing: 0, duration: 900 });
        },
        flyToCamera: (camera) => {
          const activeLocation = mapLocationRef.current || DALLAS_LOCATION;
          const activeBounds = mapGeoBoundsRef.current || DALLAS_LIVE_GEO_BOUNDS;
          map.easeTo({
            center: screenPointToLngLat([camera?.x ?? activeLocation.camera.x, camera?.y ?? activeLocation.camera.y], activeBounds, activeLocation.camera),
            zoom: mapLibreZoomFromCamera(camera || activeLocation.camera),
            pitch: clamp(camera?.pitch || activeLocation.camera?.pitch || 48, 0, 72),
            bearing: normalizeBearing(camera?.bearing || activeLocation.camera?.bearing || 0),
            duration: 1200,
          });
        },
        flyToLngLat: (lngLat, options = {}) =>
          map.easeTo({
            center: lngLat,
            zoom: options.zoom ?? Math.max(map.getZoom(), 15.2),
            pitch: clamp(options.pitch ?? map.getPitch(), 0, 72),
            bearing: normalizeBearing(options.bearing ?? map.getBearing()),
            duration: options.duration ?? 1100,
          }),
      };
    }

    return () => {
      if (mapApiRef) mapApiRef.current = null;
      map.getCanvas().removeEventListener("wheel", handleMapCanvasWheel);
      window.removeEventListener("pointermove", handleMapSurfacePointerMove, true);
      window.removeEventListener("click", handleMapSurfaceClick, true);
      if (surfaceHoverFrame) window.cancelAnimationFrame(surfaceHoverFrame);
      parcelPopup.remove();
      map.remove();
      delete window.__whiteRabbitMap;
      delete window.__whiteRabbitParcelsRef;
      delete window.__whiteRabbitLastSelectedParcel;
      mapRef.current = null;
    };
  }, [mapApiRef, maplibregl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("wr-parcels")) return;

    map.getSource("wr-parcels").setData(buildParcelMapFeatureCollection(visibleParcels, developmentIndex, floodplainParcelMap, zoningParcelMap));
    if (map.getLayer("wr-parcels-line")) map.setPaintProperty("wr-parcels-line", "line-color", parcelLineColorExpression(mapMode, selectedParcelAccount));
    if (map.getLayer("wr-parcels-line")) map.setPaintProperty("wr-parcels-line", "line-width", ["interpolate", ["linear"], ["zoom"], 9, 0.55, 11, Math.max(parcelRenderProfile?.lineWeight || 0.75, 1.05), 15, 1.8, 18, 2.7]);
    if (map.getLayer("wr-selected-parcel-line")) map.setFilter("wr-selected-parcel-line", selectedParcelMapFilter(selectedParcelAccount));
    if (map.getLayer("wr-parcels-fill")) {
      map.setPaintProperty("wr-parcels-fill", "fill-color", parcelFillColorExpression(mapMode, selectedParcelAccount));
      map.setPaintProperty("wr-parcels-fill", "fill-opacity", ["interpolate", ["linear"], ["zoom"], 10, 0.24, 14, 0.38, 17, 0.48]);
    }
    if (map.getLayer("wr-block-labels")) map.setLayoutProperty("wr-block-labels", "visibility", showParcelLabels && parcelRenderProfile?.showBlockLabels ? "visible" : "none");
    if (map.getLayer("wr-parcel-labels")) map.setLayoutProperty("wr-parcel-labels", "visibility", showParcelLabels && parcelRenderProfile?.showLabels ? "visible" : "none");
    if (map.getLayer("wr-dimension-labels")) map.setLayoutProperty("wr-dimension-labels", "visibility", showDimensions && parcelRenderProfile?.showDimensions ? "visible" : "none");
    if (map.getLayer("wr-zoning-parcels-fill")) map.setLayoutProperty("wr-zoning-parcels-fill", "visibility", showZoning ? "visible" : "none");
    if (map.getLayer("wr-zoning-parcels-line")) map.setLayoutProperty("wr-zoning-parcels-line", "visibility", showZoning ? "visible" : "none");
    if (map.getLayer("wr-floodplain-parcels-fill")) map.setLayoutProperty("wr-floodplain-parcels-fill", "visibility", showFloodplain ? "visible" : "none");
    if (map.getLayer("wr-floodplain-parcels-line")) map.setLayoutProperty("wr-floodplain-parcels-line", "visibility", showFloodplain ? "visible" : "none");
  }, [developmentIndex, floodplainParcelMap, mapMode, parcelRenderProfile?.lineWeight, parcelRenderProfile?.showBlockLabels, parcelRenderProfile?.showDimensions, parcelRenderProfile?.showLabels, selectedParcelAccount, showDimensions, showFloodplain, showParcelLabels, showZoning, visibleParcels, zoningParcelMap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("wr-parcels")) return;
    if (!selectedParcelAccount) {
      lastFocusedParcelAccountRef.current = "";
      return;
    }
    if (!focusSelectedParcel) {
      lastFocusedParcelAccountRef.current = String(selectedParcelAccount);
      return;
    }
    if (lastFocusedParcelAccountRef.current === String(selectedParcelAccount)) return;
    const active = selectedParcelAccount
      ? visibleParcels.find((parcel) => parcelMatchesSelection(parcel, selectedParcelAccount) && parcel.liveGeometry?.center)
      : null;
    if (active?.liveGeometry?.center) {
      lastFocusedParcelAccountRef.current = String(selectedParcelAccount);
      map.easeTo({ center: active.liveGeometry.center, zoom: Math.max(map.getZoom(), 14.2), pitch: clamp(map.getPitch(), 0, 72), bearing: normalizeBearing(map.getBearing()), duration: 900 });
    }
  }, [focusSelectedParcel, selectedParcelAccount, visibleParcels]);

  return (
    <div className="absolute inset-0 bg-black" data-basemap="esri-world-imagery" data-parcel-source="full-viewport-loader" data-map-engine="maplibre">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_50%,rgba(0,0,0,0.18)_78%,rgba(0,0,0,0.42)_100%)]" />
      {showGrid && <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.055)_1px,transparent_1px)] bg-[length:120px_120px]" />}
    </div>
  );
}

function SyntheticMapScene({
  mapCamera,
  mapGeoBounds,
  mapLocation,
  selectedParcelAccount,
  focusSelectedParcel,
  visibleParcels,
  developmentIndex,
  floodplainParcelMap,
  zoningParcelMap,
  onParcelSelect,
  mapMode,
  showParcelLabels,
  showGrid,
  showDimensions,
  showFloodplain,
  showZoning,
  onPointerDown,
  onWheel,
  isDragging,
  earthIntroActive,
  parcelRenderProfile,
  mapApiRef,
  onViewportChange,
  globeControlsRef,
}) {
  const useSyntheticMapControls = !earthIntroActive && mapMode === "earth";

  return (
    <div
      className={`absolute inset-0 select-none overflow-hidden bg-slate-950 ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
      style={{ touchAction: earthIntroActive ? "none" : "auto" }}
      onPointerDown={useSyntheticMapControls ? onPointerDown : undefined}
      onWheel={useSyntheticMapControls ? onWheel : undefined}
    >
      {earthIntroActive && mapMode === "earth" ? (
        <Suspense fallback={<div className="absolute inset-0 bg-black" data-live-map-globe-loading="true" />}>
          <LiveMapGlobe controlsApiRef={globeControlsRef} />
        </Suspense>
      ) : (
        <LiveTileMapBackground mapCamera={mapCamera} earthIntroActive={earthIntroActive} mapMode={mapMode} />
      )}
      <div
        className="absolute inset-0 transition-[opacity,transform] duration-[1400ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{
          opacity: earthIntroActive ? 0 : 1,
          visibility: earthIntroActive ? "hidden" : "visible",
          transform: `scale(${earthIntroActive ? 1.018 : 1})`,
          pointerEvents: earthIntroActive ? "none" : "auto",
        }}
      >
        <LiveMapEngine
          key={PARCEL_PIPELINE_REVISION}
          selectedParcelAccount={selectedParcelAccount}
          focusSelectedParcel={focusSelectedParcel}
          visibleParcels={visibleParcels}
          developmentIndex={developmentIndex}
          floodplainParcelMap={floodplainParcelMap}
          zoningParcelMap={zoningParcelMap}
          onParcelSelect={onParcelSelect}
          mapMode={mapMode}
          showParcelLabels={showParcelLabels}
          showGrid={showGrid}
          showDimensions={showDimensions}
          showFloodplain={showFloodplain}
          showZoning={showZoning}
          parcelRenderProfile={parcelRenderProfile}
          mapApiRef={mapApiRef}
          mapCamera={mapCamera}
          mapGeoBounds={mapGeoBounds}
          mapLocation={mapLocation}
          onViewportChange={onViewportChange}
        />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_40%,rgba(0,0,0,0.08)_72%,rgba(0,0,0,0.24)_100%)]" />
    </div>
  );
}

function CountySelectorField() {
  return (
    <div className="hidden sr-only" data-county-selector="white-rabbit" aria-hidden="true">
      <span>County</span>
      <select value={activeCountySelectorOption.id} onChange={() => {}} tabIndex={-1} aria-label="County adapter">
        {availableCountyDatasets.map((county) => (
          <option key={county.id} value={county.id} disabled={!county.enabled}>
            {county.countyName} - {county.appraisalDistrictAcronym}
          </option>
        ))}
      </select>
    </div>
  );
}

function TopBar({ mapMode, earthIntroActive, onOpenTools, onParcelView, onValueView, onExit, onCreListings, onResidentialListings, onRentalListings, onOpenCrm }) {
  const globeLandingMode = earthIntroActive && mapMode === "earth";
  return (
    <header className="absolute top-0 z-20 flex w-full items-center justify-between px-6 py-4">
      <CountySelectorField />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenTools}
          aria-label="Open Savant Tools"
          title="Open Savant Tools"
          className="transition hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-white/50"
          data-rabbit-action="open-savant-tools"
        >
          <RabbitLogo />
        </button>
        <span className="hidden text-xs font-semibold tracking-[0.08em] text-white/85 sm:inline">Real Estate Savant</span>
        {!globeLandingMode && <div className="rounded-full border border-white/10 bg-black/60 px-4 py-2 text-xs tracking-[0.2em] text-white/70">LIVE MAP</div>}
      </div>
      <div className="flex items-center gap-3">
        {globeLandingMode ? (
          <>
            <button onClick={onOpenCrm} className="px-3 py-2 text-xs text-white/80 transition hover:text-white">CRM</button>
            <button onClick={onCreListings} className="px-3 py-2 text-xs text-white/80 transition hover:text-white">CRE Listings</button>
            <button onClick={onResidentialListings} className="px-3 py-2 text-xs text-white/80 transition hover:text-white">Resi Listings</button>
            <button onClick={onRentalListings} className="px-3 py-2 text-xs text-white/80 transition hover:text-white">Rentals</button>
          </>
        ) : (
          <>
            <button onClick={onOpenCrm} className="rounded-full border border-white/10 bg-black/45 px-3 py-2 text-xs text-white/80 hover:bg-white/10">CRM</button>
            <button
              onClick={mapMode === "parcel" ? onValueView : onParcelView}
              className="rounded-full border border-white/10 bg-black/45 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
            >
              {mapMode === "parcel" ? "Value View" : "Parcel View"}
            </button>
            <button onClick={onExit} className="rounded-full border border-white/10 bg-white px-4 py-2 text-xs font-medium text-black">
              Exit Map
            </button>
          </>
        )}
      </div>
    </header>
  );
}

function DetailRow({ label, value }) {
  if (value === undefined || value === null || value === "") return null;
  const displayValue = typeof value === "object" ? JSON.stringify(value) : value;
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 py-1.5 last:border-b-0">
      <span className="shrink-0 font-semibold text-white/70">{label}</span>
      <span className="break-words text-right text-white">{displayValue}</span>
    </div>
  );
}

function EmptyDetailRow({ label }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 py-1.5 last:border-b-0">
      <span className="shrink-0 font-semibold text-white/70">{label}</span>
      <span className="min-h-[1rem] text-right text-white">&nbsp;</span>
    </div>
  );
}

function DetailLinkRow({ label, href, value }) {
  if (!href || !value) return null;
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 py-1.5 last:border-b-0">
      <span className="shrink-0 font-semibold text-white/70">{label}</span>
      <a className="break-words text-right text-cyan-100 underline decoration-cyan-100/30 underline-offset-2 hover:text-white" href={href} target="_blank" rel="noreferrer">
        {value}
      </a>
    </div>
  );
}

function formatParcelFieldLabel(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const MAX_PARCEL_FIELD_DISPLAY_LENGTH = 2000;

function formatParcelFieldValue(value, key = "") {
  if (value === undefined || value === null || value === "") return "";
  if (key === "realGeometry" && typeof value === "object") {
    const geometryType = value?.geometry?.type || value?.type || "parcel";
    return `${geometryType} loaded for map display`;
  }
  const formatted = Array.isArray(value)
    ? value.map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item))).join(", ")
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  return formatted.length > MAX_PARCEL_FIELD_DISPLAY_LENGTH
    ? `${formatted.slice(0, MAX_PARCEL_FIELD_DISPLAY_LENGTH)}… [display truncated]`
    : formatted;
}

function formatPermitDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function isLikelyBusinessOwner(name) {
  return /\b(LLC|L\.L\.C\.|LP|L\.P\.|LTD|INC|CORP|CORPORATION|CO|COMPANY|TRUST|BANK|ASSOCIATION|PARTNERS|HOLDINGS|PROPERTIES|VENTURES|INVESTMENTS|REAL ESTATE)\b/i.test(String(name || ""));
}

function uniqueCompactValues(values, limit = 4) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean))).slice(0, limit);
}

function isJeffersonCountyParcel(parcel) {
  return parcel?.sourceCountyId === "jefferson-ky";
}

function isBlankSafePilotParcel(parcel) {
  return BLANK_SAFE_PILOT_COUNTY_IDS.has(String(parcel?.sourceCountyId || ""));
}

function isDallasCountyParcel(parcel) {
  return !parcel?.sourceCountyId || parcel.sourceCountyId === activeCountyDataset.id;
}

function isLojicPlaceholderOwner(parcel, value) {
  return isJeffersonCountyParcel(parcel) && /^LOJIC Parcel\b/i.test(String(value || "").trim());
}

function firstParcelOwnerName(parcel) {
  const ownerName = firstParcelValue(parcel, ["ownerName", "ownerPropertyName"]);
  if (isLojicPlaceholderOwner(parcel, ownerName)) return "";
  if (ownerName) return ownerName;
  return isBlankSafePilotParcel(parcel) ? "" : firstParcelValue(parcel, ["propertyName"]);
}

function parcelDisplayTitle(parcel) {
  const candidates = [parcel.ownerName, parcel.ownerPropertyName, parcel.propertyName, parcel.accountNum, parcel.gisParcelId]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value) => !isLojicPlaceholderOwner(parcel, value));
  if (candidates.length) return candidates[0];
  if (isJeffersonCountyParcel(parcel) && parcel.accountNum) return `Jefferson County Parcel ${parcel.accountNum}`;
  return parcel.propertyName || parcel.accountNum || "Selected parcel";
}

function parcelSearchResultTitle(parcel) {
  return parcel.address || parcelDisplayTitle(parcel);
}

function parcelSearchResultLabel(parcel) {
  const candidates = [parcel.ownerName, parcel.ownerPropertyName, parcel.propertyName]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value) => !isLojicPlaceholderOwner(parcel, value));
  if (candidates.length) return candidates[0];
  if (isJeffersonCountyParcel(parcel) && parcel.accountNum) return `County Parcel ${parcel.accountNum}`;
  return "";
}

function parcelPermitSourceIntel(parcel) {
  if (!isJeffersonCountyParcel(parcel)) return [];
  return [];
}

function buildPublicContactIntel(parcel, ownerContact, permitRecords) {
  const isBlankSafePilot = isBlankSafePilotParcel(parcel);
  const rawOwnerName = ownerContact.name || parcel.ownerName || (isBlankSafePilot ? "" : parcel.propertyName) || "";
  const ownerName = isLojicPlaceholderOwner(parcel, rawOwnerName) ? "" : rawOwnerName;
  const permitPartyCount = permitRecords.filter((permit) => permit.contractor || permit.businessName || permit.raw?.business_name || permit.raw?.contractor_name || permit.raw?.applicant || permit.raw?.applicant_name).length;
  const isJeffersonKy = isJeffersonCountyParcel(parcel);
  const hasOwnerName = Boolean(String(ownerName || "").trim());
  if (isBlankSafePilot && !hasOwnerName) {
    return {
      ownerType: "",
      entitySearchName: "",
      publicMailingContact: [ownerContact.mailingAddress, ownerContact.mailingAddress2, [ownerContact.city, ownerContact.state, ownerContact.zip].filter(Boolean).join(", ")].filter(Boolean).join(" | "),
      appraisalStatus: "",
      businessRecordsStatus: "",
      registeredAgentStatus: "",
      deedLienStatus: "",
      publicWebStatus: "",
      permitPartyStatus: permitPartyCount > 0 ? `${permitPartyCount} permit-party record${permitPartyCount === 1 ? "" : "s"} kept separate` : "",
      permitPartyCount,
    };
  }
  if (isJeffersonKy) {
    return {
      ownerType: hasOwnerName ? (isLikelyBusinessOwner(ownerName) ? "Business/entity candidate" : "Private owner or unclassified") : "Owner source pending",
      entitySearchName: hasOwnerName ? ownerName : "Waiting on PVA owner/appraisal export",
      publicMailingContact: [ownerContact.mailingAddress, ownerContact.mailingAddress2, [ownerContact.city, ownerContact.state, ownerContact.zip].filter(Boolean).join(", ")].filter(Boolean).join(" | ") || "PVA mailing address source pending",
      appraisalStatus: parcel.accountNum ? "County parcel IDs loaded; PVA owner/value export join pending" : "No parcel ID loaded",
      businessRecordsStatus: hasOwnerName && isLikelyBusinessOwner(ownerName) ? "Entity records ready for owner/entity match" : "Entity source waits for owner/entity name",
      registeredAgentStatus: hasOwnerName && isLikelyBusinessOwner(ownerName) ? "Registered agent source linked; entity match not loaded" : "Not linked until owner/entity name is loaded",
      deedLienStatus: "Land-record source identified; deed/lien join pending",
      publicWebStatus: "Public source links kept internal; no phone/email inferred",
      permitPartyStatus: permitPartyCount > 0 ? `${permitPartyCount} permit-party record${permitPartyCount === 1 ? "" : "s"} kept separate` : `${formatInteger(JEFFERSON_KY_PERMIT_SOURCE_INTEL.activePermitCount)} active permit records available; parcel join pending`,
      permitPartyCount,
    };
  }
  return {
    ownerType: isLikelyBusinessOwner(ownerName) ? "Business/entity candidate" : "Private owner or unclassified",
    entitySearchName: ownerName,
    publicMailingContact: [ownerContact.mailingAddress, ownerContact.mailingAddress2, [ownerContact.city, ownerContact.state, ownerContact.zip].filter(Boolean).join(", ")].filter(Boolean).join(" | "),
    appraisalStatus: parcel.accountNum ? (isJeffersonKy ? "County parcel geometry and IDs loaded; PVA owner/appraisal join pending" : "DCAD parcel/account data loaded") : "No account loaded",
    businessRecordsStatus: isLikelyBusinessOwner(ownerName) ? (isJeffersonKy ? "Ready for Kentucky entity/DBA match" : "Ready for Texas SOS/DBA match") : "Only business-relevant public records should be linked",
    registeredAgentStatus: "Not linked yet",
    deedLienStatus: "Not linked yet",
    publicWebStatus: "Not linked yet",
    permitPartyStatus: permitPartyCount > 0 ? `${permitPartyCount} permit-party record${permitPartyCount === 1 ? "" : "s"} kept separate` : "",
    permitPartyCount,
  };
}

function buildParcelWebCompletionIntel({
  parcel,
  ownerContact,
  developmentRecord,
  parcelZoning,
  parcelZoningLoading,
  parcelZoningLoaded,
  parcelZoningError,
  parcelFloodplain,
  parcelFloodplainLoading,
  parcelFloodplainLoaded,
  parcelFloodplainError,
  permitRecords,
  permitsLoading,
  permitsError,
}) {
  const isJeffersonKy = isJeffersonCountyParcel(parcel);
  const isBlankSafePilot = isBlankSafePilotParcel(parcel);
  const ownerName = ownerContact.name || "";
  const hasOwner = Boolean(ownerName);
  const hasMailing = Boolean(ownerContact.mailingAddress || ownerContact.city || ownerContact.state || ownerContact.zip);
  const hasPhone = Boolean(ownerContact.phone);
  const hasEmail = Boolean(ownerContact.email);
  const loadedValues = uniqueCompactValues([
    parcel.totalValue ? `total ${formatCurrencyIfPresent(parcel.totalValue)}` : "",
    parcel.landValue ? `land ${formatCurrencyIfPresent(parcel.landValue)}` : "",
    parcel.improvementValue ? `improvement ${formatCurrencyIfPresent(parcel.improvementValue)}` : "",
  ]);
  const loadedLandBuilding = uniqueCompactValues([
    parcel.buildingClass,
    parcel.yearBuilt ? `built ${parcel.yearBuilt}` : "",
    parcel.grossBuildingArea ? `${formatInteger(parcel.grossBuildingArea)} SF building` : "",
    parcel.landUseDescription,
  ]);
  const loadedDimensions = uniqueCompactValues([
    parcel.frontage || parcel.dimensions?.frontageFt ? `${formatInteger(parcel.frontage || parcel.dimensions?.frontageFt)} ft frontage` : "",
    parcel.depth || parcel.dimensions?.depthFt ? `${formatInteger(parcel.depth || parcel.dimensions?.depthFt)} ft depth` : "",
    parcel.dimensions?.perimeterFt ? `${formatInteger(parcel.dimensions.perimeterFt)} ft perimeter` : "",
    parcel.shapeArea ? `area ${formatInteger(parcel.shapeArea)}` : "",
    parcel.shapeLength ? `length ${formatInteger(parcel.shapeLength)}` : "",
  ]);
  const parcelKeys = uniqueCompactValues([
    parcel.accountNum ? `parcel ${parcel.accountNum}` : "",
    parcel.gisParcelId ? `GIS ${parcel.gisParcelId}` : "",
    parcel.countyParcelId ? "county key loaded" : "",
  ]);

  const zoningValue = parcelZoningLoading
    ? "Loading parcel zoning lookup"
    : parcelZoningError || parcelZoning?.zoningSummary?.label || (parcelZoningLoaded ? (isBlankSafePilot ? "" : "No parcel zoning match") : isBlankSafePilot ? "" : "Parcel zoning lookup ready");
  const floodplainValue = parcelFloodplainLoading
    ? "Loading parcel floodplain lookup"
    : parcelFloodplainError || sanitizeFloodplainLabel(parcelFloodplain?.floodplainSummary?.label) || (parcelFloodplainLoaded ? (isBlankSafePilot ? "" : "No parcel floodplain match") : isBlankSafePilot ? "" : "Parcel floodplain lookup ready");
  const permitValue = permitsLoading
    ? "Loading parcel-linked permit records"
    : permitsError || (permitRecords.length > 0
      ? `${permitRecords.length} parcel-linked permit/CO record${permitRecords.length === 1 ? "" : "s"}`
      : isBlankSafePilot
        ? ""
      : isJeffersonKy
        ? `${formatInteger(JEFFERSON_KY_PERMIT_SOURCE_INTEL.activePermitCount)} official active permit records available; parcel join pending`
        : `${formatInteger(activeCountyDataset.verifiedCounts.sourcePermitRecords)} official permit/CO records loaded; no records linked to this parcel`);
  const entityValue = hasOwner
    ? isLikelyBusinessOwner(ownerName)
      ? "Owner name is entity-ready; registered-agent match not loaded"
      : "Owner is not a business/entity candidate"
    : isBlankSafePilot
      ? ""
      : "Owner name needed before entity lookup";

  return [
    {
      label: "Parcel Foundation",
      value: parcelKeys.length ? `Loaded - ${parcelKeys.join(" | ")}` : isBlankSafePilot ? "" : "Parcel key not loaded",
    },
    {
      label: "Owner/Appraisal",
      value: hasOwner
        ? loadedValues.length
          ? "Owner and appraisal values loaded"
          : "Owner loaded; appraisal values not listed"
        : isBlankSafePilot
          ? ""
        : isJeffersonKy
          ? "PVA owner/appraisal export needed"
          : "No owner loaded for this parcel record",
    },
    {
      label: "Mailing Contact",
      value: hasMailing ? "Loaded from appraisal fields" : isBlankSafePilot ? "" : isJeffersonKy ? "PVA mailing export needed" : "Not present in loaded appraisal fields",
    },
    {
      label: "Phone / Email",
      value: hasPhone || hasEmail || !isBlankSafePilot ? `${hasPhone ? "phone loaded" : "phone not present"} | ${hasEmail ? "email loaded" : "email not present"} | no contact details inferred` : "",
    },
    {
      label: "Values",
      value: loadedValues.length ? loadedValues.join(" | ") : isBlankSafePilot ? "" : isJeffersonKy ? "PVA value export needed" : "No appraisal value loaded",
    },
    {
      label: "Land / Building",
      value: loadedLandBuilding.length ? loadedLandBuilding.join(" | ") : isBlankSafePilot ? "" : isJeffersonKy ? "Building/use details need PVA export or permit join" : "Not listed in loaded parcel fields",
    },
    {
      label: "Parcel Dimensions",
      value: loadedDimensions.length ? loadedDimensions.join(" | ") : isBlankSafePilot ? "" : isJeffersonKy ? "Geometry area/length loaded when source fields are present; frontage/depth not loaded" : "Not listed",
    },
    {
      label: "Zoning",
      value: zoningValue,
    },
    {
      label: "Floodplain",
      value: floodplainValue,
    },
    {
      label: "Permits / CO",
      value: permitValue,
    },
    {
      label: "Deeds / Liens",
      value: isBlankSafePilot ? "" : isJeffersonKy ? "Land records source identified; parcel document join pending" : "County document join not loaded yet",
    },
    {
      label: "Entity Records",
      value: entityValue,
    },
    {
      label: "Development Signals",
      value: developmentRecord ? "Parcel development signal loaded" : isBlankSafePilot ? "" : isJeffersonKy ? "Development signal index not built for this county yet" : "No development signal matched",
    },
  ];
}

function parcelPublicSourceLinks(parcel) {
  if (!isDallasCountyParcel(parcel)) {
    return [];
  }
  return [
    { label: "DCAD", href: "https://www.dallascad.org/", value: "Appraisal district" },
    { label: "County Records", href: "https://dallas.tx.ds.search.govos.com/", value: "Deeds, liens, mortgages" },
    { label: "Texas SOS", href: "https://www.sos.state.tx.us/corp/sosda/index.shtml", value: "Entity filings" },
    { label: "Dallas Open Data", href: "https://www.dallasopendata.com/", value: "Permits, zoning, code" },
  ];
}

function getPermitColorCode(permit) {
  const text = [
    permit?.sourceName,
    permit?.sourceDataset,
    permit?.permitType,
    permit?.permitSubtype,
    permit?.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (text.includes("certificate") || text.includes("occupancy")) {
    return {
      label: "CO",
      className: "border-blue-300/25 bg-blue-400/15 text-blue-50",
      cardClassName: "border-blue-300/20 bg-blue-400/10",
    };
  }
  if (text.includes("zoning")) {
    return {
      label: "Zoning",
      className: "border-orange-300/25 bg-orange-400/15 text-orange-50",
      cardClassName: "border-orange-300/20 bg-orange-400/10",
    };
  }
  return {
    label: "Permit",
    className: "border-white/15 bg-white/10 text-white/70",
    cardClassName: "border-white/10 bg-black/25",
  };
}

function permitValue(permit, keys) {
  for (const key of keys) {
    const value = permit?.[key] ?? permit?.raw?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function getPermitIntelKind(permit) {
  const text = [
    permit?.sourceDataset,
    permit?.sourceName,
    permit?.permitType,
    permit?.permitSubtype,
    permit?.raw?.type_of_co,
    permit?.raw?.occupancy,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (text.includes("9qet-qt9e") || text.includes("certificate") || text.includes("occupancy")) return "co";
  if (text.includes("zoning")) return "zoning";
  return "permit";
}

function getPermitActivityTime(permit) {
  const value = permitValue(permit, ["finalDate", "issueDate", "applicationDate", "date_issued", "issued_date"]);
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : 0;
}

function formatJoinMethod(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text === "address_match") return "Address match";
  if (text === "parcel_id_match") return "Parcel ID match";
  if (text === "spatial_join") return "Spatial join";
  return formatParcelFieldLabel(text);
}

function formatIntelList(values, prefix = "") {
  if (!Array.isArray(values) || !values.length) return "";
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .map((value) => (prefix && !value.toUpperCase().startsWith(prefix.toUpperCase()) ? `${prefix} ${value}` : value))
    .join(", ");
}

function isPlaceholderFloodplainMetric(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  const numeric = Number(text.replace(/,/g, ""));
  return Number.isFinite(numeric) && numeric <= -9990 && numeric >= -10000;
}

function sanitizeFloodplainLabel(value) {
  return String(value || "")
    .split("|")
    .map((part) => part.trim())
    .map((part) => {
      if (!/^BFE\b/i.test(part)) return part;
      const bfeValues = part
        .replace(/^BFE\s*/i, "")
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item && !isPlaceholderFloodplainMetric(item));
      return bfeValues.length ? `BFE ${bfeValues.join(", ")}` : "";
    })
    .filter(Boolean)
    .join(" | ");
}

function formatFloodplainList(values) {
  if (!Array.isArray(values) || !values.length) return "";
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => value && !isPlaceholderFloodplainMetric(value))
    .join(", ");
}

function formatSfhaStatus(values) {
  if (!Array.isArray(values) || !values.length) return "";
  const normalized = values.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean);
  if (normalized.some((value) => ["T", "TRUE", "Y", "YES", "1", "SFHA"].includes(value))) return "Yes";
  if (normalized.some((value) => ["F", "FALSE", "N", "NO", "0"].includes(value))) return "No";
  return normalized.join(", ");
}

function buildPermitIntelSummary(permitRecords) {
  const counts = permitRecords.reduce(
    (acc, permit) => {
      const kind = getPermitIntelKind(permit);
      acc.total += 1;
      if (kind === "co") acc.certificates += 1;
      else if (kind === "zoning") acc.zoning += 1;
      else acc.permits += 1;
      const status = String(permit.permitStatus || "").trim() || "Status not listed";
      acc.statusCounts.set(status, (acc.statusCounts.get(status) || 0) + 1);
      const valuation = Number.parseFloat(permit.valuation ?? permit.raw?.value ?? "");
      if (Number.isFinite(valuation) && valuation > 0) acc.valuation += valuation;
      const activityTime = getPermitActivityTime(permit);
      if (activityTime > acc.latestTime) {
        acc.latestTime = activityTime;
        acc.latestPermit = permit;
      }
      return acc;
    },
    { total: 0, permits: 0, certificates: 0, zoning: 0, valuation: 0, statusCounts: new Map(), latestTime: 0, latestPermit: null },
  );
  const statusSummary = Array.from(counts.statusCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([status, count]) => `${status}: ${count}`)
    .join(", ");
  return {
    ...counts,
    latestDate: counts.latestPermit ? formatPermitDate(permitValue(counts.latestPermit, ["finalDate", "issueDate", "applicationDate", "date_issued", "issued_date"])) : "",
    latestType: counts.latestPermit?.permitType || counts.latestPermit?.raw?.type_of_co || counts.latestPermit?.sourceName || "",
    statusSummary,
  };
}

function firstParcelValue(parcel, keys) {
  for (const key of keys) {
    const value = parcel?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function DecisionInput({ label, value, onChange, prefix = "", suffix = "", step = "any" }) {
  return (
    <label className="block">
      <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/45">{label}</span>
      <span className="mt-1 flex items-center rounded-lg border border-white/10 bg-black/30 focus-within:border-cyan-200/45">
        {prefix && <span className="pl-2.5 text-[10px] text-white/35">{prefix}</span>}
        <input
          type="number"
          inputMode="decimal"
          step={step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent px-2.5 py-2 text-xs text-white outline-none"
        />
        {suffix && <span className="pr-2.5 text-[10px] text-white/35">{suffix}</span>}
      </span>
    </label>
  );
}

function DecisionSelect({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/45">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-white/10 bg-black/60 px-2.5 py-2 text-xs text-white outline-none focus:border-cyan-200/45"
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function DecisionMetric({ label, value, tone = "default" }) {
  return (
    <div className={`rounded-lg border p-2.5 ${tone === "positive" ? "border-emerald-300/20 bg-emerald-300/10" : tone === "negative" ? "border-rose-300/20 bg-rose-300/10" : "border-white/10 bg-black/25"}`}>
      <p className="text-[9px] uppercase tracking-[0.12em] text-white/40">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function ParcelAgentWorkspace({ parcel, zoning, floodplain, permits, highestBestUse, underwriting, opportunityBrief }) {
  const [activeAgentId, setActiveAgentId] = useState("acquisition");
  const [agentInput, setAgentInput] = useState("");
  const [agentMessages, setAgentMessages] = useState([]);
  const [agentRunning, setAgentRunning] = useState(false);
  const agentContext = useMemo(() => buildParcelAgentContext({
    parcel,
    zoning,
    floodplain,
    permits,
    highestBestUse,
    underwriting,
    opportunityBrief,
  }), [parcel, zoning, floodplain, permits, highestBestUse, underwriting, opportunityBrief]);
  const activeAgent = PARCEL_AGENTS.find((agent) => agent.id === activeAgentId) || PARCEL_AGENTS[0];

  useEffect(() => {
    setAgentMessages([]);
    setAgentInput("");
    setAgentRunning(false);
  }, [parcel.accountNum, parcel.countyParcelId, parcel.gisParcelId]);

  const submitAgentMessage = async (override = "") => {
    const message = String(override || agentInput).trim();
    if (!message || agentRunning) return;
    const selectedAgent = activeAgent;
    setAgentMessages((current) => [...current, { id: `user-${Date.now()}`, role: "user", text: message }]);
    setAgentInput("");
    setAgentRunning(true);
    try {
      const result = await requestParcelAgent({ agentId: selectedAgent.id, message, context: agentContext });
      setAgentMessages((current) => [...current, { id: `agent-${Date.now()}`, role: "agent", result }]);
    } catch (error) {
      setAgentMessages((current) => [...current, { id: `error-${Date.now()}`, role: "agent", result: {
        agentName: selectedAgent.name,
        mode: "error",
        summary: "The agent could not complete this request. The loaded parcel tools remain available in Decision Tools.",
        findings: [],
        nextActions: [],
        sources: [],
        disclaimer: String(error?.message || "Agent request failed"),
      } }]);
    } finally {
      setAgentRunning(false);
    }
  };

  return (
    <div className="mt-3 space-y-3" data-parcel-agent-workspace="active">
      <div className="rounded-xl border border-violet-300/20 bg-violet-300/10 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-100/85"><Bot aria-hidden="true" size={14} /> Real Estate Savant agents</p>
            <p className="mt-1 text-[10px] leading-4 text-white/55">Parcel-aware analysts use the currently loaded evidence and calculation tools. They identify missing evidence instead of inventing facts.</p>
          </div>
          <span className="shrink-0 rounded-full border border-emerald-200/20 bg-emerald-200/10 px-2 py-1 text-[9px] text-emerald-100/80">Tools online</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2" aria-label="Parcel agents">
          {PARCEL_AGENTS.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => setActiveAgentId(agent.id)}
              className={`rounded-lg border p-2.5 text-left transition ${activeAgentId === agent.id ? "border-violet-200/45 bg-violet-200/15" : "border-white/10 bg-black/20 hover:bg-white/5"}`}
              aria-pressed={activeAgentId === agent.id}
            >
              <span className="text-[10px] font-semibold text-white">{agent.shortName}</span>
              <span className="mt-1 block text-[9px] leading-4 text-white/45">{agent.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/30 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-white">{activeAgent.name}</p>
            <p className="mt-0.5 text-[9px] text-white/40">Selected parcel: {parcel.address || parcel.accountNum}</p>
          </div>
          <span className="rounded-full border border-white/10 px-2 py-1 text-[9px] text-white/50">Evidence scoped</span>
        </div>

        {agentMessages.length === 0 && (
          <button type="button" onClick={() => submitAgentMessage(activeAgent.starter)} className="mt-3 w-full rounded-lg border border-violet-200/20 bg-violet-200/10 p-3 text-left text-[10px] leading-4 text-violet-50/80 hover:bg-violet-200/15">
            {activeAgent.starter}
          </button>
        )}

        {agentMessages.length > 0 && (
          <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1" aria-live="polite">
            {agentMessages.map((message) => message.role === "user" ? (
              <div key={message.id} className="ml-8 rounded-xl bg-white px-3 py-2 text-[10px] leading-4 text-black">{message.text}</div>
            ) : (
              <div key={message.id} className="mr-3 rounded-xl border border-violet-200/15 bg-violet-200/10 p-3 text-[10px] leading-4 text-white/70">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-violet-50">{message.result.agentName}</span>
                  <span className="text-[8px] uppercase tracking-[0.12em] text-violet-100/45">{message.result.mode === "openai-responses" ? "AI + tools" : "Local tools"}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-white/80">{message.result.summary}</p>
                {message.result.findings?.length > 0 && (
                  <div className="mt-2">
                    <p className="font-semibold uppercase tracking-[0.12em] text-white/45">Evidence read</p>
                    <ul className="mt-1 space-y-1">{message.result.findings.map((finding) => <li key={finding}>• {finding}</li>)}</ul>
                  </div>
                )}
                {message.result.nextActions?.length > 0 && (
                  <div className="mt-2">
                    <p className="font-semibold uppercase tracking-[0.12em] text-white/45">Next actions</p>
                    <ol className="mt-1 space-y-1">{message.result.nextActions.map((action, index) => <li key={action}>{index + 1}. {action}</li>)}</ol>
                  </div>
                )}
                {message.result.sources?.length > 0 && <p className="mt-2 text-[9px] text-cyan-100/55">Sources: {message.result.sources.map((source) => source.label).join(" · ")}</p>}
                <p className="mt-2 text-[9px] text-white/35">{message.result.disclaimer}</p>
              </div>
            ))}
            {agentRunning && <div className="mr-16 rounded-xl border border-violet-200/15 bg-violet-200/10 px-3 py-2 text-[10px] text-violet-50/65">{activeAgent.name} is reading the parcel tools…</div>}
          </div>
        )}

        <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); submitAgentMessage(); }}>
          <input
            value={agentInput}
            onChange={(event) => setAgentInput(event.target.value)}
            placeholder={`Ask ${activeAgent.shortName.toLowerCase()} about this parcel`}
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-[10px] text-white outline-none placeholder:text-white/30 focus:border-violet-200/45"
            aria-label={`Ask ${activeAgent.name}`}
          />
          <button type="submit" disabled={!agentInput.trim() || agentRunning} className="rounded-lg border border-violet-200/25 bg-violet-200/15 px-3 text-violet-50 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Send to parcel agent">
            <Send aria-hidden="true" size={14} />
          </button>
        </form>
      </div>
    </div>
  );
}

function FocusedParcelCard({
  parcel,
  developmentRecord,
  parcelZoning,
  parcelZoningLoading = false,
  parcelZoningLoaded = false,
  parcelZoningError = "",
  parcelFloodplain,
  parcelFloodplainLoading = false,
  parcelFloodplainLoaded = false,
  parcelFloodplainError = "",
  permitRecords = [],
  permitsLoading = false,
  permitsError = "",
  decisionToolIntent = null,
  onClose,
}) {
  const [workspaceView, setWorkspaceView] = useState("profile");
  const [parcelIdExpanded, setParcelIdExpanded] = useState(false);
  const [parcelIntelligenceExpanded, setParcelIntelligenceExpanded] = useState(false);
  const [activeDecisionTool, setActiveDecisionTool] = useState("");
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  const parcelDecisionDefaults = useMemo(() => createParcelDecisionDefaults(parcel), [parcel]);
  const [underwritingInputs, setUnderwritingInputs] = useState(() => parcelDecisionDefaults.underwriting);
  const [highestBestUseInputs, setHighestBestUseInputs] = useState(() => parcelDecisionDefaults.highestBestUse);
  const [activeHighestBestUseId, setActiveHighestBestUseId] = useState("multifamily");
  const dimensions = {
    frontage: parcel.frontage || parcel.dimensions?.frontageFt,
    depth: parcel.depth || parcel.dimensions?.depthFt,
    perimeter: parcel.dimensions?.perimeterFt,
  };
  const cityHallZoning = parcelZoning?.zoningSummary || {};
  const cityHallZoningLabel = parcelZoningLoading
    ? "Loading zoning"
    : parcelZoningError || cityHallZoning.label || (parcelZoningLoaded && !parcelZoning ? "No zoning match" : "");
  const cityHallZoningSources = Array.isArray(parcelZoning?.sourceLayerIds) ? parcelZoning.sourceLayerIds.length : 0;
  const floodplain = parcelFloodplain?.floodplainSummary || {};
  const floodplainLabel = parcelFloodplainLoading
    ? "Loading floodplain"
    : parcelFloodplainError || sanitizeFloodplainLabel(floodplain.label) || (parcelFloodplainLoaded && !parcelFloodplain ? "No floodplain match" : "");
  const floodplainSources = Array.isArray(parcelFloodplain?.sourceLayerIds) ? parcelFloodplain.sourceLayerIds.length : 0;
  const isBlankSafePilot = isBlankSafePilotParcel(parcel);
  const rawOwnerName = firstParcelOwnerName(parcel);
  const ownerContact = {
    name: isLojicPlaceholderOwner(parcel, rawOwnerName) ? "" : rawOwnerName,
    careOf: firstParcelValue(parcel, ["ownerName2", "careOf", "ownerCareOf", "attention", "attn"]),
    company: firstParcelValue(parcel, ["businessName", "bizName", "companyName"]),
    mailingAddress: firstParcelValue(parcel, ["ownerMailingAddress", "mailingAddress", "ownerAddress", "ownerAddressLine1"]),
    mailingAddress2: firstParcelValue(parcel, ["ownerMailingAddress2", "ownerAddressLine2"]),
    city: firstParcelValue(parcel, ["ownerCity", "mailingCity"]),
    state: firstParcelValue(parcel, ["ownerState", "mailingState"]),
    zip: firstParcelValue(parcel, ["ownerZip", "ownerZipcode", "mailingZip"]),
    phone: firstParcelValue(parcel, ["ownerPhone", "phone", "phoneNumber", "contactPhone"]),
    email: firstParcelValue(parcel, ["ownerEmail", "email", "emailAddress", "contactEmail"]),
  };
  const ownerCityStateZip = [ownerContact.city, ownerContact.state, ownerContact.zip].filter(Boolean).join(", ");
  const hiddenRawParcelFields = new Set(isBlankSafePilot ? ["sourceReferences"] : []);
  const parcelFields = Object.entries(parcel)
    .filter(([key]) => !(isJeffersonCountyParcel(parcel) && key === "sourceReferences"))
    .filter(([key]) => !hiddenRawParcelFields.has(key))
    .map(([key, value]) => ({
      key,
      label: formatParcelFieldLabel(key),
      value: (key === "ownerName" || key === "propertyName") && isLojicPlaceholderOwner(parcel, value) ? "" : formatParcelFieldValue(value, key),
    }))
    .filter((field) => field.value !== "");
  const permitIntel = buildPermitIntelSummary(permitRecords);
  const publicContactIntel = buildPublicContactIntel(parcel, ownerContact, permitRecords);
  const parcelWebCompletionIntel = buildParcelWebCompletionIntel({
    parcel,
    ownerContact,
    developmentRecord,
    parcelZoning,
    parcelZoningLoading,
    parcelZoningLoaded,
    parcelZoningError,
    parcelFloodplain,
    parcelFloodplainLoading,
    parcelFloodplainLoaded,
    parcelFloodplainError,
    permitRecords,
    permitsLoading,
    permitsError,
  });
  const publicSourceLinks = parcelPublicSourceLinks(parcel);
  const permitSourceIntel = parcelPermitSourceIntel(parcel);
  const title = parcelDisplayTitle(parcel);
  const primaryParcelId = parcelPopupPrimaryId(parcel);
  const expandedParcelIds = [
    ["County Parcel ID", countyAwareParcelId(parcel)],
    ["Account", parcel.accountNum || parcel.accountNumber],
    ["GIS ID", parcel.gisParcelId],
    ["Source Parcel ID", parcel.sourceParcelId],
  ].filter(([, value], index, values) => value && values.findIndex(([, candidate]) => String(candidate) === String(value)) === index);
  const profileCoverageCount = parcelWebCompletionIntel.filter((item) => String(item.value || "").trim()).length;
  const activityTimeline = useMemo(() => {
    const events = [];
    if (parcel.deedTransferDate) {
      events.push({
        id: `deed-${parcel.deedTransferDate}`,
        date: parcel.deedTransferDate,
        category: "Ownership",
        title: "Recorded deed transfer date",
        detail: "Date supplied by the loaded appraisal parcel record.",
        source: parcel.dataLineage?.sourceDatasetId || "County appraisal parcel record",
      });
    }
    for (const permit of permitRecords) {
      const dateCandidates = [
        ["Issue date", permit.issueDate],
        ["Final date", permit.finalDate],
        ["Application date", permit.applicationDate],
        ["Record date", permit.recordDate],
      ];
      const dated = dateCandidates.find(([, value]) => value && Number.isFinite(Date.parse(String(value))));
      if (!dated) continue;
      const [dateKind, date] = dated;
      events.push({
        id: permit.permitRecordId || `${permit.sourceDataset || "permit"}-${permit.permitNumber || date}`,
        date,
        category: /certificate|\bco\b/i.test(String(permit.permitType || permit.sourceName || "")) ? "Certificate" : "Permit",
        title: permit.permitType || permit.sourceName || "Permit activity",
        detail: [permit.permitNumber, permit.permitStatus, dateKind].filter(Boolean).join(" · "),
        source: permit.sourceName || permit.sourceDataset || "Linked permit source",
      });
    }
    if (developmentRecord?.latestActivityDate && Number.isFinite(Date.parse(String(developmentRecord.latestActivityDate)))) {
      events.push({
        id: `development-${developmentRecord.id || developmentRecord.latestActivityDate}`,
        date: developmentRecord.latestActivityDate,
        category: "Development",
        title: developmentRecord.title || "Development signal",
        detail: developmentRecord.summary || "Parcel-linked development activity.",
        source: (developmentRecord.sources || []).map((source) => source.name).filter(Boolean).join(", ") || "Development intelligence index",
      });
    }
    return events.sort((a, b) => Date.parse(String(b.date)) - Date.parse(String(a.date)));
  }, [developmentRecord, parcel.dataLineage?.sourceDatasetId, parcel.deedTransferDate, permitRecords]);

  useEffect(() => {
    setWorkspaceView("profile");
    setParcelIdExpanded(false);
    setParcelIntelligenceExpanded(false);
    setActiveDecisionTool("");
    setShowAdvancedTools(false);
    const defaults = createParcelDecisionDefaults(parcel);
    setUnderwritingInputs(defaults.underwriting);
    setHighestBestUseInputs(defaults.highestBestUse);
    setActiveHighestBestUseId("multifamily");
  }, [parcel.accountNum, parcel.countyParcelId, parcel.gisParcelId]);

  useEffect(() => {
    if (!decisionToolIntent?.requestKey) return;
    setWorkspaceView("decisions");
    setActiveDecisionTool("feasibility");
    setParcelIntelligenceExpanded(true);
    if (decisionToolIntent.useId) setActiveHighestBestUseId(decisionToolIntent.useId);
  }, [decisionToolIntent?.requestKey, decisionToolIntent?.useId, parcel.accountNum, parcel.countyParcelId, parcel.gisParcelId]);

  useEffect(() => {
    if (!parcelIntelligenceExpanded) return undefined;
    const collapseOnEscape = (event) => {
      if (event.key === "Escape") setParcelIntelligenceExpanded(false);
    };
    window.addEventListener("keydown", collapseOnEscape);
    return () => window.removeEventListener("keydown", collapseOnEscape);
  }, [parcelIntelligenceExpanded]);

  const capabilityPreviews = buildParcelDecisionToolCatalog(platformFeatureGates);
  const primaryCapabilityIds = new Set(["feasibility", "underwriting", "opportunity-briefs"]);
  const presentedCapabilities = showAdvancedTools
    ? capabilityPreviews
    : capabilityPreviews.filter((capability) => primaryCapabilityIds.has(capability.id));
  const underwritingResult = useMemo(() => runParcelUnderwriting(underwritingInputs), [underwritingInputs]);
  const highestBestUseResult = useMemo(() => runHighestBestUseAnalysis({
    site: highestBestUseInputs.site,
    candidates: highestBestUseInputs.candidates,
    zoning: cityHallZoning,
    floodplain,
    allowedUses: Object.fromEntries(highestBestUseInputs.candidates.map((candidate) => [candidate.id, candidate.permission || "unknown"])),
  }), [highestBestUseInputs, cityHallZoning, floodplain]);
  const activeHighestBestUseScenario = highestBestUseResult.scenarios.find((scenario) => scenario.id === activeHighestBestUseId) || highestBestUseResult.scenarios[0] || null;
  const activeHighestBestUseCandidate = highestBestUseInputs.candidates.find((candidate) => candidate.id === activeHighestBestUseId) || highestBestUseInputs.candidates[0] || null;
  const opportunityBrief = useMemo(() => buildParcelOpportunityBrief({
    parcel,
    underwriting: underwritingResult,
    permitCount: permitsLoading || permitsError ? null : permitRecords.length,
    zoning: parcelZoningError || parcelZoningLoading ? null : cityHallZoning,
    floodplain: parcelFloodplainError || parcelFloodplainLoading ? null : floodplain,
    developmentSignalCount: developmentRecord ? Number(developmentRecord.signalCount || developmentRecord.signals?.length || 1) : null,
  }), [parcel, permitRecords.length, permitsLoading, permitsError, parcelZoningError, parcelZoningLoading, cityHallZoning, parcelFloodplainError, parcelFloodplainLoading, floodplain, developmentRecord, underwritingResult]);
  const updateDecisionInput = (setter, key) => (value) => setter((current) => ({ ...current, [key]: value }));
  const updateHighestBestUseSite = (key) => (value) => setHighestBestUseInputs((current) => ({ ...current, site: { ...current.site, [key]: value } }));
  const updateHighestBestUseCandidate = (key) => (value) => setHighestBestUseInputs((current) => ({
    ...current,
    candidates: current.candidates.map((candidate) => candidate.id === activeHighestBestUseId ? { ...candidate, [key]: value } : candidate),
  }));

  return (
    <div
      className={`${parcelIntelligenceExpanded ? "fixed inset-4 z-50 max-h-none w-auto max-w-none sm:inset-6 lg:bottom-4 lg:left-auto lg:right-4 lg:top-4 lg:w-[min(900px,calc(100vw-2rem))]" : "absolute right-4 top-28 z-40 max-h-[calc(100vh-9rem)] w-[420px] max-w-[calc(100vw-2rem)] sm:right-20"} overflow-auto rounded-2xl border border-white/12 bg-black/16 p-5 text-[11px] text-white/70 shadow-2xl backdrop-blur-[2px] transition-[background-color,backdrop-filter,border-color] duration-200 hover:border-white/18 hover:bg-black/78 hover:backdrop-blur-xl focus-within:border-white/18 focus-within:bg-black/78 focus-within:backdrop-blur-xl`}
      data-parcel-info-window="active"
      data-parcel-intelligence-size={parcelIntelligenceExpanded ? "expanded" : "compact"}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/60">Parcel Intelligence</p>
          <h3 className="mt-2 text-base font-semibold text-white">{title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setParcelIntelligenceExpanded((expanded) => !expanded)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/60"
            aria-label={parcelIntelligenceExpanded ? "Collapse parcel intelligence" : "Expand parcel intelligence"}
            aria-expanded={parcelIntelligenceExpanded}
            title={parcelIntelligenceExpanded ? "Collapse parcel intelligence" : "Expand parcel intelligence"}
          >
            {parcelIntelligenceExpanded ? <Minimize2 aria-hidden="true" size={17} strokeWidth={1.9} /> : <Maximize2 aria-hidden="true" size={17} strokeWidth={1.9} />}
          </button>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:bg-white/10 hover:text-white" aria-label="Close parcel information" title="Close parcel information">
            <X aria-hidden="true" size={17} strokeWidth={1.9} />
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-cyan-100/80">{parcel.address} · {parcel.propertyCity || parcel.city}</p>

      <div className="mt-3 rounded-xl border border-white/10 bg-black/25" data-parcel-id-disclosure={parcelIdExpanded ? "expanded" : "collapsed"}>
        <button
          type="button"
          onClick={() => setParcelIdExpanded((expanded) => !expanded)}
          className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/60"
          aria-expanded={parcelIdExpanded}
          aria-controls="focused-parcel-identifiers"
        >
          <span className="min-w-0">
            <span className="block text-[9px] font-bold uppercase tracking-[0.18em] text-white/45">Parcel ID</span>
            <span className="mt-0.5 block break-all text-xs font-semibold text-cyan-50">{primaryParcelId || countyAwareParcelId(parcel) || "Not listed"}</span>
          </span>
          {parcelIdExpanded ? <ChevronUp aria-hidden="true" size={16} className="shrink-0 text-cyan-100/75" /> : <ChevronDown aria-hidden="true" size={16} className="shrink-0 text-cyan-100/75" />}
        </button>
        {parcelIdExpanded && (
          <div id="focused-parcel-identifiers" className="border-t border-white/10 px-3 py-2" data-expanded-parcel-identifiers="active">
            {expandedParcelIds.map(([label, value]) => (
              <DetailRow key={label} label={label} value={value} />
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-4 gap-1 rounded-xl border border-white/10 bg-black/30 p-1" data-property-intelligence-workspace="active">
        {[
          ["profile", "Profile"],
          ["timeline", "Timeline"],
          ["decisions", "Decision tools"],
          ["agents", "Agents"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setWorkspaceView(id)}
            className={`rounded-lg px-2 py-2 text-[10px] font-bold uppercase tracking-[0.12em] transition ${workspaceView === id ? "bg-white text-black" : "text-white/55 hover:bg-white/10 hover:text-white"}`}
            aria-pressed={workspaceView === id}
          >
            {label}
          </button>
        ))}
      </div>

      {workspaceView === "agents" && (
        <ParcelAgentWorkspace
          parcel={parcel}
          zoning={parcelZoning}
          floodplain={parcelFloodplain}
          permits={permitRecords}
          highestBestUse={highestBestUseResult}
          underwriting={underwritingResult}
          opportunityBrief={opportunityBrief}
        />
      )}

      {workspaceView === "timeline" && (
        <div className="mt-3 rounded-xl border border-cyan-300/15 bg-cyan-300/10 p-3" data-property-activity-timeline="active">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-100/80">Trusted Activity Timeline</p>
              <p className="mt-1 text-[10px] leading-4 text-cyan-50/55">Only dated, parcel-linked records already loaded from approved sources are shown.</p>
            </div>
            <span className="rounded-full border border-cyan-100/15 bg-black/25 px-2 py-1 text-[9px] text-cyan-50/70">{activityTimeline.length} events</span>
          </div>
          {activityTimeline.length > 0 ? (
            <ol className="mt-3 space-y-2">
              {activityTimeline.map((event) => (
                <li key={event.id} className="relative rounded-xl border border-white/10 bg-black/25 p-3 pl-4">
                  <span className="absolute bottom-3 left-0 top-3 w-0.5 bg-cyan-200/55" />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-cyan-100/70">{event.category}</span>
                    <time className="text-[9px] text-white/45" dateTime={String(event.date)}>{formatPermitDate(event.date)}</time>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-white">{event.title}</p>
                  {event.detail && <p className="mt-1 text-[10px] leading-4 text-white/60">{event.detail}</p>}
                  <p className="mt-1 text-[9px] text-white/40">Source: {event.source}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3 text-[10px] leading-4 text-white/55">No trusted dated events are linked to this parcel yet. Real Estate Savant does not manufacture missing activity.</p>
          )}
        </div>
      )}

      {workspaceView === "decisions" && (
        <div className="mt-3 space-y-3" data-property-decision-tools="active">
          {activeDecisionTool && (
            <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-3" data-local-decision-runtime={activeDecisionTool}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-100/80">Operating decision workspace</p>
                  <p className="mt-1 text-[10px] leading-4 text-white/55">County facts and analyst assumptions are kept separate. Edit any assumption to recalculate instantly.</p>
                </div>
                <button type="button" onClick={() => setActiveDecisionTool("")} className="shrink-0 rounded-lg border border-white/10 bg-black/25 px-2.5 py-1.5 text-[9px] font-semibold text-white/70 hover:bg-white/10">All tools</button>
              </div>

              {activeDecisionTool === "underwriting" && (
                <div className="mt-3" data-underwriting-workspace="operating">
                  <div className="grid grid-cols-2 gap-2">
                    <DecisionInput label="Purchase price" prefix="$" value={underwritingInputs.purchasePrice} onChange={updateDecisionInput(setUnderwritingInputs, "purchasePrice")} />
                    <DecisionInput label="Annual gross rent" prefix="$" value={underwritingInputs.grossPotentialRentAnnual} onChange={updateDecisionInput(setUnderwritingInputs, "grossPotentialRentAnnual")} />
                    <DecisionInput label="Vacancy" suffix="%" value={underwritingInputs.vacancyPct} onChange={updateDecisionInput(setUnderwritingInputs, "vacancyPct")} />
                    <DecisionInput label="Operating expenses" suffix="%" value={underwritingInputs.operatingExpensePct} onChange={updateDecisionInput(setUnderwritingInputs, "operatingExpensePct")} />
                    <DecisionInput label="Loan to cost" suffix="%" value={underwritingInputs.loanToCostPct} onChange={updateDecisionInput(setUnderwritingInputs, "loanToCostPct")} />
                    <DecisionInput label="Interest rate" suffix="%" value={underwritingInputs.interestRatePct} onChange={updateDecisionInput(setUnderwritingInputs, "interestRatePct")} />
                    <DecisionInput label="Hold" suffix="years" step="1" value={underwritingInputs.holdYears} onChange={updateDecisionInput(setUnderwritingInputs, "holdYears")} />
                    <DecisionInput label="Exit cap" suffix="%" value={underwritingInputs.exitCapRatePct} onChange={updateDecisionInput(setUnderwritingInputs, "exitCapRatePct")} />
                  </div>
                  {underwritingResult.metrics ? (
                    <>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <DecisionMetric label="First-year NOI" value={formatCurrency(underwritingResult.metrics.firstYearNoi)} />
                        <DecisionMetric label="Cap rate" value={`${underwritingResult.metrics.capRatePct}%`} />
                        <DecisionMetric label="Levered IRR" value={underwritingResult.metrics.irrPct === null ? "Not solved" : `${underwritingResult.metrics.irrPct}%`} />
                        <DecisionMetric label="Equity multiple" value={underwritingResult.metrics.equityMultiple === null ? "Not solved" : `${underwritingResult.metrics.equityMultiple}x`} />
                        <DecisionMetric label="DSCR" value={underwritingResult.metrics.debtServiceCoverageRatio === null ? "No debt" : `${underwritingResult.metrics.debtServiceCoverageRatio}x`} />
                        <DecisionMetric label="Exit value" value={formatCurrency(underwritingResult.metrics.grossExitValue)} />
                      </div>
                      <p className="mt-2 text-[9px] leading-4 text-white/45">Model status: {underwritingResult.status}. Real Estate Savant defaults are starting assumptions, not county facts.</p>
                    </>
                  ) : (
                    <p className="mt-3 rounded-lg border border-amber-200/15 bg-amber-200/10 p-2.5 text-[10px] leading-4 text-amber-50/75">Enter annual gross rent to run the model. {underwritingResult.warnings.join(" · ")}</p>
                  )}
                </div>
              )}

              {activeDecisionTool === "feasibility" && (
                <div className="mt-3" data-feasibility-workspace="operating" data-highest-best-use-engine="active">
                  <div className="rounded-xl border border-cyan-200/15 bg-black/25 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100/80">Instant highest &amp; best use</p>
                        <p className="mt-1 text-[10px] leading-4 text-white/50">Compares legal, physical, financial, and maximum-productivity screens across six use strategies.</p>
                      </div>
                      <span className="shrink-0 rounded-full border border-cyan-100/15 bg-cyan-100/10 px-2 py-1 text-[9px] text-cyan-50/75">{highestBestUseResult.status === "highest-best-use-supported" ? "Supported" : "Evidence required"}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[9px] text-white/50">
                      <p><span className="text-white/35">Zoning</span><br /><span className="text-white/75">{highestBestUseResult.zoningLabel || "Not verified"}</span></p>
                      <p><span className="text-white/35">Financial leader</span><br /><span className="text-white/75">{highestBestUseResult.scenarios[0]?.name || "Pending site area"}</span></p>
                    </div>
                  </div>

                  <div className="mt-3">
                    <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/45">Site and verified limits</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <DecisionInput label="Land area" suffix="SF" value={highestBestUseInputs.site.landAreaSqFt} onChange={updateHighestBestUseSite("landAreaSqFt")} />
                      <DecisionInput label="Acquisition basis" prefix="$" value={highestBestUseInputs.site.acquisitionPrice} onChange={updateHighestBestUseSite("acquisitionPrice")} />
                      <DecisionInput label="Maximum FAR" suffix="FAR" value={highestBestUseInputs.site.maximumFar} onChange={updateHighestBestUseSite("maximumFar")} />
                      <DecisionInput label="Maximum coverage" suffix="%" value={highestBestUseInputs.site.maximumCoveragePct} onChange={updateHighestBestUseSite("maximumCoveragePct")} />
                      <DecisionInput label="Maximum height" suffix="FT" value={highestBestUseInputs.site.maximumHeightFt} onChange={updateHighestBestUseSite("maximumHeightFt")} />
                      <DecisionInput label="Usable site area" suffix="%" value={highestBestUseInputs.site.usableSitePct} onChange={updateHighestBestUseSite("usableSitePct")} />
                    </div>
                    <p className="mt-2 text-[9px] leading-4 text-white/40">Leave an unverified zoning limit blank. The engine will report an indeterminate legal conclusion instead of inventing a restriction.</p>
                  </div>

                  {highestBestUseResult.scenarios.length > 0 ? (
                    <>
                      <div className="mt-3 grid grid-cols-2 gap-2" aria-label="Highest and best use alternatives">
                        {highestBestUseResult.scenarios.map((scenario) => (
                          <button
                            key={scenario.id}
                            type="button"
                            onClick={() => setActiveHighestBestUseId(scenario.id)}
                            className={`rounded-lg border p-2.5 text-left transition ${activeHighestBestUseId === scenario.id ? "border-cyan-200/40 bg-cyan-200/10" : "border-white/10 bg-black/20 hover:bg-white/5"}`}
                            data-highest-best-use-scenario={scenario.id}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-semibold text-white">{scenario.name}</span>
                              <span className="text-[9px] text-cyan-100/60">{scenario.rank ? `#${scenario.rank}` : "Not ranked"}</span>
                            </div>
                            <p className="mt-1 text-[9px] text-white/45">Residual land {formatCurrency(scenario.metrics.residualLandValue)}</p>
                            <p className={`mt-0.5 text-[9px] ${scenario.tests.financiallyFeasible === "pass" ? "text-emerald-200/70" : "text-rose-200/65"}`}>Yield {scenario.metrics.yieldOnCostPct}% · {scenario.tests.financiallyFeasible === "pass" ? "financial pass" : "financial fail"}</p>
                          </button>
                        ))}
                      </div>

                      {activeHighestBestUseScenario?.metrics && activeHighestBestUseCandidate && (
                        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3" data-highest-best-use-active-scenario={activeHighestBestUseScenario.id}>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold text-white">{activeHighestBestUseScenario.name}</p>
                              <p className="mt-0.5 text-[9px] text-white/40">{activeHighestBestUseScenario.rank ? `Rank #${activeHighestBestUseScenario.rank} under current assumptions` : "Excluded by the supplied use-permission evidence"}</p>
                            </div>
                            <span className="rounded-full border border-white/10 px-2 py-1 text-[9px] text-white/60">{activeHighestBestUseScenario.bindingConstraints.join(" + ") || "target program"}</span>
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <DecisionSelect
                              label="Permitted-use evidence"
                              value={activeHighestBestUseCandidate.permission || "unknown"}
                              onChange={updateHighestBestUseCandidate("permission")}
                              options={[
                                { value: "unknown", label: "Unknown / verify" },
                                { value: "allowed", label: "Verified allowed" },
                                { value: "conditional", label: "Conditional" },
                                { value: "prohibited", label: "Prohibited" },
                              ]}
                            />
                            <DecisionInput label="Target FAR" suffix="FAR" value={activeHighestBestUseCandidate.targetFar} onChange={updateHighestBestUseCandidate("targetFar")} />
                            <DecisionInput label="Stories" value={activeHighestBestUseCandidate.stories} onChange={updateHighestBestUseCandidate("stories")} step="1" />
                            <DecisionInput label="Net efficiency" suffix="%" value={activeHighestBestUseCandidate.efficiencyPct} onChange={updateHighestBestUseCandidate("efficiencyPct")} />
                            <DecisionInput label="Hard cost / SF" prefix="$" value={activeHighestBestUseCandidate.hardCostPerSqFt} onChange={updateHighestBestUseCandidate("hardCostPerSqFt")} />
                            <DecisionInput label="Annual rent / SF" prefix="$" value={activeHighestBestUseCandidate.rentPerSqFtAnnual} onChange={updateHighestBestUseCandidate("rentPerSqFtAnnual")} />
                            <DecisionInput label="Vacancy" suffix="%" value={activeHighestBestUseCandidate.vacancyPct} onChange={updateHighestBestUseCandidate("vacancyPct")} />
                            <DecisionInput label="Operating expense" suffix="%" value={activeHighestBestUseCandidate.operatingExpensePct} onChange={updateHighestBestUseCandidate("operatingExpensePct")} />
                            <DecisionInput label="Exit cap" suffix="%" value={activeHighestBestUseCandidate.exitCapRatePct} onChange={updateHighestBestUseCandidate("exitCapRatePct")} />
                            <DecisionInput label="Parking / 1,000 SF" value={activeHighestBestUseCandidate.parkingSpacesPer1000SqFt} onChange={updateHighestBestUseCandidate("parkingSpacesPer1000SqFt")} />
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-2" data-highest-best-use-tests="active">
                            {[
                              ["Legally permissible", activeHighestBestUseScenario.tests.legallyPermissible],
                              ["Physically possible", activeHighestBestUseScenario.tests.physicallyPossible],
                              ["Financially feasible", activeHighestBestUseScenario.tests.financiallyFeasible],
                              ["Maximum productivity", activeHighestBestUseScenario.tests.maximallyProductive],
                            ].map(([label, status]) => (
                              <div key={label} className="rounded-lg border border-white/10 bg-black/25 p-2">
                                <p className="text-[8px] uppercase tracking-[0.1em] text-white/35">{label}</p>
                                <p className={`mt-1 text-[10px] font-semibold ${status === "pass" || status === "financial-leader" ? "text-emerald-200/80" : status === "fail" ? "text-rose-200/75" : "text-amber-100/70"}`}>{String(status).replaceAll("-", " ")}</p>
                              </div>
                            ))}
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <DecisionMetric label="Buildable area" value={`${formatInteger(activeHighestBestUseScenario.metrics.grossBuildableSqFt)} SF`} />
                            <DecisionMetric label="Net rentable" value={`${formatInteger(activeHighestBestUseScenario.metrics.netRentableSqFt)} SF`} />
                            <DecisionMetric label="Stories / height" value={`${activeHighestBestUseScenario.metrics.modeledStories} / ${activeHighestBestUseScenario.metrics.modeledHeightFt} FT`} />
                            <DecisionMetric label="Parking" value={`${formatInteger(activeHighestBestUseScenario.metrics.parkingSpaces)} spaces`} />
                            {activeHighestBestUseScenario.metrics.estimatedUnits !== null && <DecisionMetric label="Estimated units" value={formatInteger(activeHighestBestUseScenario.metrics.estimatedUnits)} />}
                            <DecisionMetric label="Total project cost" value={formatCurrency(activeHighestBestUseScenario.metrics.totalProjectCost)} />
                            <DecisionMetric label="Stabilized NOI" value={formatCurrency(activeHighestBestUseScenario.metrics.stabilizedNoi)} />
                            <DecisionMetric label="Stabilized value" value={formatCurrency(activeHighestBestUseScenario.metrics.stabilizedValue)} />
                            <DecisionMetric label="Yield on cost" value={`${activeHighestBestUseScenario.metrics.yieldOnCostPct}%`} />
                            <DecisionMetric label="Break-even rent" value={`${formatCurrency(activeHighestBestUseScenario.metrics.breakEvenRentPerSqFtAnnual)} / SF`} />
                            <DecisionMetric label="Residual land value" value={formatCurrency(activeHighestBestUseScenario.metrics.residualLandValue)} tone={activeHighestBestUseScenario.metrics.residualLandValue >= 0 ? "positive" : "negative"} />
                            <DecisionMetric label="Value / cost spread" value={formatCurrency(activeHighestBestUseScenario.metrics.valueCostSpread)} tone={activeHighestBestUseScenario.metrics.valueCostSpread >= 0 ? "positive" : "negative"} />
                          </div>

                          <div className="mt-3 rounded-lg border border-amber-200/15 bg-amber-200/10 p-2.5 text-[9px] leading-4 text-amber-50/70">
                            <p className="font-semibold uppercase tracking-[0.12em]">Evidence still required</p>
                            <p className="mt-1">{activeHighestBestUseScenario.missingEvidence.join(" · ") || "All modeled evidence supplied"}</p>
                          </div>
                        </div>
                      )}
                      <p className="mt-2 text-[9px] leading-4 text-white/45">{highestBestUseResult.disclaimer}</p>
                    </>
                  ) : (
                    <p className="mt-3 rounded-lg border border-amber-200/15 bg-amber-200/10 p-2.5 text-[10px] leading-4 text-amber-50/75">A valid parcel land area is required to run the comparison.</p>
                  )}
                </div>
              )}

              {activeDecisionTool === "opportunity-briefs" && (
                <div className="mt-3" data-opportunity-brief-workspace="operating">
                  <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/25 p-3">
                    <div>
                      <p className="text-xs font-semibold text-white">{opportunityBrief.exportModel.title}</p>
                      <p className="mt-1 text-[10px] text-white/45">Evidence completeness {opportunityBrief.evidenceSummary.completenessPct}%</p>
                    </div>
                    <span className="rounded-full border border-cyan-100/15 px-2 py-1 text-[9px] text-cyan-50/70">{opportunityBrief.status}</span>
                  </div>
                  <div className="mt-2 grid gap-2">
                    {opportunityBrief.sections.map((section) => (
                      <div key={section.id} className="rounded-lg border border-white/10 bg-black/20 p-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[10px] font-semibold text-white/80">{section.title}</p>
                          <span className="text-[9px] text-white/35">{section.facts.filter((fact) => fact.status === "observed").length}/{section.facts.length}</span>
                        </div>
                        {section.facts.filter((fact) => fact.status === "observed").map((fact) => <DetailRow key={fact.id} label={fact.label} value={typeof fact.value === "number" && /value|noi/i.test(fact.id) ? formatCurrency(fact.value) : fact.value} />)}
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[9px] leading-4 text-white/45">{opportunityBrief.exportModel.disclaimer}</p>
                </div>
              )}
            </div>
          )}
          <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3" data-opportunity-score-gate={platformFeatureGates.opportunitySignals ? "active" : "blocked"}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-100/80">Explainable Opportunity Score</p>
                <p className="mt-1 text-[10px] leading-4 text-white/60">Factor-level evidence, confidence, missing evidence, and source lineage are staged for this workflow.</p>
              </div>
              <span className="shrink-0 rounded-full border border-amber-100/20 bg-black/25 px-2 py-1 text-[9px] font-semibold text-amber-50/75">
                {platformFeatureGates.opportunitySignals ? "Active" : "Gated"}
              </span>
            </div>
            {!platformFeatureGates.opportunitySignals && (
              <p className="mt-2 rounded-lg border border-white/10 bg-black/20 p-2 text-[10px] leading-4 text-white/55">No score is displayed because production historical validation, calibration, and signed activation are incomplete.</p>
            )}
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3" data-progressive-tool-disclosure={showAdvancedTools ? "expanded" : "simple"}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">{showAdvancedTools ? "All property tools" : "Start here"}</p>
                <p className="mt-1 text-[10px] leading-4 text-white/50">{showAdvancedTools ? "Explore the complete evidence-gated intelligence roadmap." : "Three clear actions cover the most common parcel decisions."}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdvancedTools((expanded) => !expanded)}
                className="shrink-0 rounded-lg border border-white/10 bg-black/25 px-2.5 py-1.5 text-[9px] font-semibold text-white/70 hover:bg-white/10"
                aria-expanded={showAdvancedTools}
                aria-controls="parcel-decision-tool-catalog"
              >
                {showAdvancedTools ? "Show less" : `More tools (${capabilityPreviews.length - presentedCapabilities.length})`}
              </button>
            </div>
          </div>
          <div id="parcel-decision-tool-catalog" className="grid gap-2" aria-label="Property decision capability previews" data-decision-tool-catalog="active">
            {presentedCapabilities.map((capability) => (
              <button
                key={capability.id}
                type="button"
                disabled={!capability.ready}
                onClick={() => {
                  if (capability.action === "open-property-timeline") {
                    setWorkspaceView("timeline");
                    return;
                  }
                  const request = createDecisionToolLaunchRequest(capability, parcel);
                  if (["underwriting", "feasibility", "opportunity-briefs"].includes(capability.id)) {
                    if (capability.id === "feasibility" && highestBestUseResult.leadingScenarioId) setActiveHighestBestUseId(highestBestUseResult.leadingScenarioId);
                    setActiveDecisionTool(capability.id);
                    setParcelIntelligenceExpanded(true);
                  }
                  window.dispatchEvent(new CustomEvent("white-rabbit:open-decision-tool", { detail: request }));
                }}
                className="rounded-xl border border-white/10 bg-white/5 p-3 text-left disabled:cursor-not-allowed disabled:opacity-75"
                title={capability.ready ? `Open ${capability.name}` : `${capability.name} is not activation-authorized`}
                data-decision-tool-id={capability.id}
                data-capability-id={capability.capabilityId}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-white">{capability.name}</span>
                  <span className={`rounded-full border px-2 py-1 text-[9px] ${capability.status === "Planned" ? "border-violet-200/20 text-violet-100/70" : capability.ready ? "border-emerald-200/20 text-emerald-100/80" : "border-white/10 text-white/45"}`}>{capability.status}</span>
                </div>
                <p className="mt-1 text-[10px] leading-4 text-white/50">{capability.detail}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {workspaceView === "profile" && (
        <>
          <div className="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2" data-unified-property-profile="active">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/65">Unified evidence profile</span>
            <span className="text-[9px] text-white/45">{profileCoverageCount}/{parcelWebCompletionIntel.length} evidence groups available</span>
          </div>

      <div className="mt-4 rounded-xl border border-emerald-300/15 bg-emerald-300/10 p-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-100/80">Owner Contact</p>
        <div className="mt-2">
          <DetailRow label="Owner" value={ownerContact.name} />
          <DetailRow label="Care Of" value={ownerContact.careOf} />
          <DetailRow label="Business" value={ownerContact.company} />
          <DetailRow label="Mailing Address" value={ownerContact.mailingAddress} />
          <DetailRow label="Mailing Address 2" value={ownerContact.mailingAddress2} />
          <DetailRow label="City / State / ZIP" value={ownerCityStateZip} />
          {ownerContact.phone ? <DetailRow label="Phone" value={ownerContact.phone} /> : <EmptyDetailRow label="Phone" />}
          {ownerContact.email ? <DetailRow label="Email" value={ownerContact.email} /> : <EmptyDetailRow label="Email" />}
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-cyan-300/15 bg-cyan-300/10 p-3" data-parcel-contact-intelligence="active">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-100/80">Public Contact Intelligence</p>
        <div className="mt-2">
          <DetailRow label="Owner Type" value={publicContactIntel.ownerType} />
          <DetailRow label="Entity Search" value={publicContactIntel.entitySearchName} />
          <DetailRow label="Mailing Contact" value={publicContactIntel.publicMailingContact} />
          <DetailRow label="Appraisal Records" value={publicContactIntel.appraisalStatus} />
          <DetailRow label="Business Filings" value={publicContactIntel.businessRecordsStatus} />
          <DetailRow label="Registered Agent" value={publicContactIntel.registeredAgentStatus} />
          <DetailRow label="Deeds / Liens" value={publicContactIntel.deedLienStatus} />
          <DetailRow label="Permit Parties" value={publicContactIntel.permitPartyStatus || (isBlankSafePilot ? "" : permitsLoading ? "Loading linked permits" : "No linked parties loaded")} />
          <DetailRow label="Owner Contact Rule" value={isBlankSafePilot && !ownerContact.name ? "" : "Permit contractors/applicants are not treated as property owners"} />
          <DetailRow label="Public Web" value={publicContactIntel.publicWebStatus} />
        </div>
        {publicSourceLinks.length > 0 && (
          <div className="mt-3 border-t border-cyan-100/10 pt-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100/70">Source Links</p>
            <div className="mt-2">
              {publicSourceLinks.map((source) => (
                <DetailLinkRow key={source.label} label={source.label} href={source.href} value={source.value} />
              ))}
            </div>
          </div>
        )}
        <p className="mt-2 text-[10px] leading-4 text-cyan-50/55">Business-relevant public sources only. Contractor, applicant, and permit-party contacts stay separate from property-owner contacts.</p>
      </div>

      <div className="mt-3 rounded-xl border border-lime-300/15 bg-lime-300/10 p-3" data-parcel-web-completion="active">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-lime-100/80">Public Web Completion</p>
        <div className="mt-2">
          {parcelWebCompletionIntel.map((item) => (
            <DetailRow key={item.label} label={item.label} value={item.value} />
          ))}
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/65">Property</p>
        <div className="mt-2">
          <DetailRow label="Account" value={parcel.accountNum} />
          <DetailRow label="GIS ID" value={parcel.gisParcelId} />
          <DetailRow label="Block" value={parcel.blockId} />
          <DetailRow label="Class" value={parcel.buildingClass} />
          <DetailRow label="Zoning" value={parcel.zoning} />
          <DetailRow label="Zoning" value={cityHallZoningLabel} />
          <DetailRow label="Base Zoning" value={formatIntelList(cityHallZoning.baseDistricts)} />
          <DetailRow label="PD" value={formatIntelList(cityHallZoning.pdNumbers, "PD")} />
          <DetailRow label="PDS" value={formatIntelList(cityHallZoning.pdsNumbers, "PDS")} />
          <DetailRow label="SUP" value={formatIntelList(cityHallZoning.supNumbers, "SUP")} />
          <DetailRow label="Subdistricts" value={formatIntelList(cityHallZoning.subdistricts)} />
          <DetailRow label="Overlays" value={formatIntelList(cityHallZoning.overlays)} />
          <DetailRow label="Zoning Cases" value={formatIntelList(cityHallZoning.caseNumbers)} />
          <DetailRow label="Zoning Sources" value={cityHallZoningSources ? `${cityHallZoningSources} layer(s)` : ""} />
          <DetailRow label="Floodplain" value={floodplainLabel} />
          <DetailRow label="Flood Zone" value={formatFloodplainList(floodplain.floodZones)} />
          <DetailRow label="Zone Subtype" value={formatFloodplainList(floodplain.zoneSubtypes)} />
          <DetailRow label="SFHA" value={formatSfhaStatus(floodplain.sfha)} />
          <DetailRow label="BFE" value={formatFloodplainList(floodplain.baseFloodElevations)} />
          <DetailRow label="Flood Depth" value={formatFloodplainList(floodplain.depths)} />
          <DetailRow label="Flood Velocity" value={formatFloodplainList(floodplain.velocities)} />
          <DetailRow label="Flood Source" value={floodplainSources ? `${floodplainSources} layer(s)` : ""} />
          <DetailRow label="Land Use" value={parcel.landUseDescription} />
          <DetailRow label="Land Use Code" value={parcel.landUseCode} />
          <DetailRow label="Land Section" value={parcel.landSection} />
          <DetailRow label="Pricing Method" value={parcel.landPricingMethod} />
          <DetailRow label="Land Cost / Unit" value={parcel.landCostPerUnit ? formatCurrency(parcel.landCostPerUnit) : ""} />
          <DetailRow label="Land Valuation" value={parcel.landValuationAmount ? formatCurrency(parcel.landValuationAmount) : ""} />
          <DetailRow label="Legal" value={parcel.legal} />
          <DetailRow label="Deed Date" value={parcel.deedTransferDate} />
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/65">Values</p>
        <div className="mt-2">
          <DetailRow label="Total" value={formatCurrencyIfPresent(parcel.totalValue)} />
          <DetailRow label="Land" value={formatCurrencyIfPresent(parcel.landValue)} />
          <DetailRow label="Improvement" value={formatCurrencyIfPresent(parcel.improvementValue)} />
          <DetailRow label="Land Area" value={parcel.landAreaSqFt ? `${formatInteger(parcel.landAreaSqFt)} SF` : ""} />
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-sky-300/15 bg-sky-300/10 p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-sky-100/80">Parcel Dimensions</p>
        <div className="mt-2">
          <DetailRow label="Frontage" value={dimensions.frontage ? `${formatInteger(dimensions.frontage)} ft` : isBlankSafePilot ? "" : "Not listed"} />
          <DetailRow label="Depth" value={dimensions.depth ? `${formatInteger(dimensions.depth)} ft` : isBlankSafePilot ? "" : "Not listed"} />
          <DetailRow label="Perimeter" value={dimensions.perimeter ? `${formatInteger(dimensions.perimeter)} ft` : isBlankSafePilot ? "" : "Not listed"} />
          <DetailRow label="Area Unit" value={parcel.landAreaUnit} />
        </div>
        {parcel.dimensionLabels?.length > 0 && (
          <div className="mt-3 border-t border-sky-100/10 pt-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sky-100/70">ParcelDimension Labels</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {parcel.dimensionLabels.slice(0, 10).map((label) => (
                <span key={`${label.text}-${label.distanceFt}`} className="rounded-full border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-white/75">
                  {label.text} ft
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      {developmentRecord && (
        <div className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/10 p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-100/80">Development Intel</p>
          <h4 className="mt-2 text-xs font-semibold text-white">{developmentRecord.title}</h4>
          <p className="mt-1 text-[11px] leading-5 text-white/70">{developmentRecord.summary}</p>
          <div className="mt-2">
            <DetailRow label="Stage" value={developmentRecord.stage} />
            <DetailRow label="Sources" value={(developmentRecord.sources || []).map((source) => source.name).join(", ")} />
          </div>
        </div>
      )}

      <div className="mt-3 rounded-xl border border-fuchsia-300/15 bg-fuchsia-300/10 p-3" data-parcel-permit-window="active">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-fuchsia-100/80">Permits & Certificates</p>
          <span className="rounded-full border border-fuchsia-100/15 bg-black/25 px-2 py-1 text-[10px] text-fuchsia-50/75">
            {permitsLoading ? "Loading" : `${permitRecords.length} linked`}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="rounded-full border border-blue-300/25 bg-blue-400/15 px-2 py-1 text-[10px] text-blue-50">Blue: Certificate of Occupancy</span>
          <span className="rounded-full border border-orange-300/25 bg-orange-400/15 px-2 py-1 text-[10px] text-orange-50">Orange: Zoning Permit</span>
        </div>
        {permitSourceIntel.length > 0 && (
          <div className="mt-3 border-t border-fuchsia-100/10 pt-3" data-jefferson-permit-source-intel="active">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fuchsia-50/70">Official Jefferson Sources</p>
            <div className="mt-2">
              {permitSourceIntel.map((item) => (
                <DetailRow key={item.label} label={item.label} value={item.value} />
              ))}
            </div>
          </div>
        )}
        {!permitsLoading && !permitsError && permitRecords.length > 0 && (
          <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3" data-parcel-permit-intel-summary="active">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fuchsia-50/70">Linked Activity</p>
            <div className="mt-2">
              <DetailRow label="Permits" value={permitIntel.permits} />
              <DetailRow label="CO Records" value={permitIntel.certificates} />
              <DetailRow label="Zoning" value={permitIntel.zoning} />
              <DetailRow label="Latest Activity" value={[permitIntel.latestDate, permitIntel.latestType].filter(Boolean).join(" - ")} />
              <DetailRow label="Status Mix" value={permitIntel.statusSummary} />
              <DetailRow label="Declared Value" value={permitIntel.valuation > 0 ? formatCurrency(permitIntel.valuation) : ""} />
            </div>
          </div>
        )}
        {permitsError && <p className="mt-2 rounded-lg border border-red-300/20 bg-red-300/10 px-2 py-1.5 text-[10px] text-red-100/80">{permitsError}</p>}
        {!permitsLoading && !permitsError && permitRecords.length === 0 && !isBlankSafePilot && (
          <p className="mt-2 text-[11px] leading-5 text-white/55">
            {isJeffersonCountyParcel(parcel)
              ? "No parcel-linked permit or Certificate of Occupancy records are loaded for this Jefferson parcel yet. Official active permits are source-verified; parcel join is pending."
              : "No parcel-linked permit or Certificate of Occupancy records are loaded for this account yet."}
          </p>
        )}
        <div className="mt-2 grid gap-2">
          {permitRecords.slice(0, 12).map((permit) => {
            const colorCode = getPermitColorCode(permit);
            const title = permit.permitType || permit.raw?.type_of_co || permit.sourceName || permit.sourceDataset || "Permit record";
            const subtitle = [permit.permitNumber, permit.permitStatus, formatPermitDate(permit.issueDate || permit.finalDate || permit.applicationDate)].filter(Boolean).join(" - ");
            const valuation = Number.parseFloat(permit.valuation ?? permit.raw?.value ?? "");
            return (
              <div key={permit.permitRecordId || `${permit.sourceDataset}-${permit.permitNumber}-${permit.address}`} className={`rounded-xl border p-3 ${colorCode.cardClassName}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-white">{title}</p>
                    {subtitle && <p className="mt-1 text-[10px] text-fuchsia-50/70">{subtitle}</p>}
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-1 text-[9px] uppercase tracking-[0.12em] ${colorCode.className}`}>{colorCode.label}</span>
                </div>
                <div className="mt-2">
                  <DetailRow label="CO Number" value={permitValue(permit, ["co", "certificate_number", "co_number"])} />
                  <DetailRow label="Address" value={permit.address || permit.parcelAddress} />
                  <DetailRow label="Business" value={permitValue(permit, ["businessName", "business_name"])} />
                  <DetailRow label="Land Use" value={permitValue(permit, ["landUse", "land_use"])} />
                  <DetailRow label="Occupancy" value={permitValue(permit, ["occupancy"])} />
                  <DetailRow label="Code District" value={permitValue(permit, ["codeDistrict", "code_district"])} />
                  <DetailRow label="Valuation" value={Number.isFinite(valuation) && valuation > 0 ? formatCurrency(valuation) : ""} />
                  <DetailRow label="Contractor" value={permit.contractor} />
                  <DetailRow label="Description" value={permit.description} />
                  <DetailRow label="Parcel Address" value={permit.parcelAddress} />
                  <DetailRow label="GIS ID" value={permit.parcelGisId} />
                  <DetailRow label="Source" value={permit.sourceName || permit.sourceDataset} />
                  <DetailRow label="Join" value={formatJoinMethod(permit.joinMethod)} />
                </div>
              </div>
            );
          })}
        </div>
        {permitRecords.length > 12 && <p className="mt-2 text-[10px] text-white/45">Showing 12 of {permitRecords.length} linked permit records.</p>}
      </div>

      <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/65">All Parcel Fields</p>
        <div className="mt-2 max-h-[260px] overflow-auto pr-1">
          {parcelFields.map((field) => (
            <DetailRow key={field.key} label={field.label} value={field.value} />
          ))}
        </div>
      </div>
        </>
      )}
    </div>
  );
}

function SearchStatusPanel({ searchText, searchResults, developmentResults, geocodedAddress, geocodingError, searchLoading, highestBestUseIntent, onClear, onSelectParcel, onSelectDevelopment, onSelectGeocodedAddress }) {
  const hasQuery = searchText.trim().length > 0;
  if (!hasQuery) return null;
  const totalResults = searchResults.length + developmentResults.length + (geocodedAddress ? 1 : 0);

  return (
    <div className="absolute left-4 right-[4.75rem] top-[calc(5rem+2in+4rem)] z-30 sm:left-1/2 sm:right-auto sm:w-[90%] sm:max-w-2xl sm:-translate-x-1/2">
      <div className="rounded-2xl border border-white/10 bg-black/78 px-4 py-3 shadow-2xl" aria-busy={searchLoading}>
        <div className="flex items-center justify-between gap-3 text-[11px] text-white/55">
          <span aria-live="polite">{searchLoading ? `Searching parcels and addresses…${totalResults ? ` · ${totalResults} shown` : ""}` : highestBestUseIntent?.mode === "viewport-ranking" ? `${searchResults.length} HBU candidate(s) · ${highestBestUseIntent.scopeLabel}` : highestBestUseIntent ? `${totalResults} match(es) · HBU parcel search` : `${totalResults} match(es) · Parcels + addresses`}</span>
          <button onClick={onClear} className="shrink-0 text-cyan-100/80 hover:text-white">
            Clear
          </button>
        </div>
        <div className="mt-3 grid min-w-0 max-h-[min(52vh,28rem)] gap-2 overflow-x-hidden overflow-y-auto overscroll-contain pr-1" aria-label="Search results">
          {searchResults.map((parcel) => {
            const resultLabel = parcelSearchResultLabel(parcel);
            const selectSearchParcel = (event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelectParcel(parcel);
            };
            return (
              <button
                type="button"
                key={countyAwareParcelId(parcel) || parcel.accountNum}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  selectSearchParcel(event);
                }}
                onMouseDown={(event) => {
                  if (event.button !== 0) return;
                  selectSearchParcel(event);
                }}
                onClick={selectSearchParcel}
                className="min-w-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left transition hover:border-cyan-200/30 hover:bg-cyan-300/10"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 break-words text-xs font-medium text-white">{parcelSearchResultTitle(parcel)}</span>
                  <span className="shrink-0 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[10px] text-emerald-100/80">
                    {parcel.highestBestUseSearch ? `#${parcel.highestBestUseSearch.rank} ${parcel.highestBestUseSearch.scenarioName}` : parcel.blockId}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/55">
                  {resultLabel && <span>{resultLabel}</span>}
                  <span>{formatCurrency(parcel.totalValue)}</span>
                  {parcel.zoning && <span>{parcel.zoning}</span>}
                  {parcel.dimensions && <span>{formatInteger(parcel.dimensions.frontageFt)} ft frontage</span>}
                  {parcel.highestBestUseSearch && <span>Residual land {formatCurrency(parcel.highestBestUseSearch.residualLandValue)} · Yield {parcel.highestBestUseSearch.yieldOnCostPct}%</span>}
                </div>
              </button>
            );
          })}
          {geocodedAddress && (
            <button
              type="button"
              onClick={() => onSelectGeocodedAddress(geocodedAddress)}
              className="min-w-0 rounded-xl border border-cyan-200/20 bg-cyan-300/10 px-3 py-2 text-left transition hover:border-cyan-100/40 hover:bg-cyan-300/15"
            >
              <div className="flex items-center gap-2 text-xs font-medium text-white">
                <MapPin aria-hidden="true" size={14} className="shrink-0 text-cyan-100" />
                <span className="min-w-0 break-words">{geocodedAddress.matchedAddress}</span>
              </div>
              <p className="mt-1 text-[11px] text-white/55">Aerial location · parcel intelligence appears where verified coverage is available</p>
            </button>
          )}
          {!searchLoading && searchResults.length === 0 && developmentResults.length === 0 && !geocodedAddress && (
            <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/55">
              {geocodingError || "No parcel or U.S. address match was found."}
            </p>
          )}
          {developmentResults.map((record) => (
            <button
              key={record.id}
              onClick={() => onSelectDevelopment(record)}
              className="min-w-0 rounded-xl border border-amber-300/15 bg-amber-300/10 px-3 py-2 text-left transition hover:border-amber-200/35 hover:bg-amber-300/15"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-white">{record.title}</span>
                <span className="rounded-full border border-amber-200/20 bg-black/30 px-2 py-1 text-[10px] text-amber-100/80">
                  {record.stage}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-white/60">{record.address}</p>
              <p className="mt-1 text-[11px] text-amber-50/70">{record.summary}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function WhiteRabbitMap({ onExit, initialSearch = "", initialDatasetId = "", preserveLandingEarth = false, onOpenMarketplace, onOpenCrm, onOpenTools }) {
  const initialMapLocation = mapLocationForPlaceId(initialDatasetId);
  const initialPilotPlaceId = initialDatasetId && initialDatasetId !== activeCountyDataset.id ? initialDatasetId : "";
  const [selected, setSelected] = useState(initialMapLocation);
  const [mapCamera, setMapCamera] = useState(() => initialDatasetId ? getCameraForLocation(initialMapLocation) : getEarthIntroCamera());
  const [selectedParcelAccount, setSelectedParcelAccount] = useState("");
  const [selectedParcelSnapshot, setSelectedParcelSnapshot] = useState(null);
  const [selectedParcelMapFocusEnabled, setSelectedParcelMapFocusEnabled] = useState(true);
  const [showParcelLabels, setShowParcelLabels] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showDimensions, setShowDimensions] = useState(true);
  const [showFloodplain, setShowFloodplain] = useState(false);
  const [showZoning, setShowZoning] = useState(false);
  const [mapMode, setMapMode] = useState(initialDatasetId ? "parcel" : "earth");
  const [searchText, setSearchText] = useState(initialSearch);
  const deferredSearchText = useDeferredValue(searchText);
  const [debouncedSearchText, setDebouncedSearchText] = useState(initialSearch);
  const [activePilotPlaceId, setActivePilotPlaceId] = useState(initialPilotPlaceId);
  const [selectedDevelopmentId, setSelectedDevelopmentId] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [earthIntroActive, setEarthIntroActive] = useState(!initialDatasetId);
  const [landingEarthOverlayVisible, setLandingEarthOverlayVisible] = useState(preserveLandingEarth);
  const [landingEarthOverlayFading, setLandingEarthOverlayFading] = useState(false);
  const [liveMapBounds, setLiveMapBounds] = useState(() => getViewportBounds(initialMapLocation.camera));
  const mapApiRef = useRef(null);
  const dragStateRef = useRef(null);
  const inertiaFrameRef = useRef(null);
  const parcelEntryFrameRef = useRef(null);
  const landingEarthOverlayFrameRef = useRef(null);
  const globeHandoffTimerRef = useRef(null);
  const globeControlsRef = useRef(null);
  const initialSearchSubmittedRef = useRef(false);
  const autoSelectedSearchQueryRef = useRef("");
  const submittedSearchQueryRef = useRef("");
  const searchRequestIdRef = useRef(0);
  const activeCountyParcelPlaceId = activePilotPlaceId === NATIONAL_ROAMING_ID ? "" : activePilotPlaceId;
  const activeParcelDataset = useMemo(() => parcelDatasetForPlaceId(activePilotPlaceId), [activePilotPlaceId]);
  const activeMapLocation = useMemo(() => mapLocationForPlaceId(activePilotPlaceId), [activePilotPlaceId]);
  const activeMapGeoBounds = activeMapLocation.geoBounds || DALLAS_LIVE_GEO_BOUNDS;
  const fallbackDallasParcels = useMemo(() => getDallasRenderableParcels(), []);
  const fallbackSearchParcels = useMemo(
    () => fallbackDallasParcels.filter((parcel) => String(parcel.accountNum || parcel.accountNumber || "") !== SANDEN_DEMO_ACCOUNT_NUM),
    [fallbackDallasParcels],
  );
  const [loadedDallasParcels, setLoadedDallasParcels] = useState([]);
  const [loadedPilotParcels, setLoadedPilotParcels] = useState([]);
  const [loadedSearchResults, setLoadedSearchResults] = useState([]);
  const [loadedSearchQuery, setLoadedSearchQuery] = useState("");
  const [highestBestUseSearchIntent, setHighestBestUseSearchIntent] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [geocodedAddress, setGeocodedAddress] = useState(null);
  const [geocodingError, setGeocodingError] = useState("");
  const [developmentParcelIndex, setDevelopmentParcelIndex] = useState(new Map());
  const [selectedParcelPermits, setSelectedParcelPermits] = useState([]);
  const [selectedParcelPermitsLoading, setSelectedParcelPermitsLoading] = useState(false);
  const [selectedParcelPermitsError, setSelectedParcelPermitsError] = useState("");
  const [selectedParcelZoning, setSelectedParcelZoning] = useState(null);
  const [selectedParcelZoningLoading, setSelectedParcelZoningLoading] = useState(false);
  const [selectedParcelZoningLoaded, setSelectedParcelZoningLoaded] = useState(false);
  const [selectedParcelZoningError, setSelectedParcelZoningError] = useState("");
  const highestBestUseIntentSequenceRef = useRef(0);

  const queueHighestBestUseIntent = (intent) => {
    if (!intent) {
      setHighestBestUseSearchIntent(null);
      return null;
    }
    const queuedIntent = {
      ...intent,
      requestKey: `hbu-search-${++highestBestUseIntentSequenceRef.current}`,
    };
    setHighestBestUseSearchIntent(queuedIntent);
    return queuedIntent;
  };
  const [selectedParcelFloodplain, setSelectedParcelFloodplain] = useState(null);
  const [selectedParcelFloodplainLoading, setSelectedParcelFloodplainLoading] = useState(false);
  const [selectedParcelFloodplainLoaded, setSelectedParcelFloodplainLoaded] = useState(false);
  const [selectedParcelFloodplainError, setSelectedParcelFloodplainError] = useState("");
  const [visibleParcelFloodplainMap, setVisibleParcelFloodplainMap] = useState(new Map());
  const [visibleParcelZoningMap, setVisibleParcelZoningMap] = useState(new Map());
  const [locating, setLocating] = useState(false);
  const [locationStatus, setLocationStatus] = useState("");
  const locationStatusTimerRef = useRef(null);

  const clearGlobeHandoffTimer = () => {
    if (!globeHandoffTimerRef.current) return;
    window.clearTimeout(globeHandoffTimerRef.current);
    globeHandoffTimerRef.current = null;
  };

  const focusGlobeOnTarget = (target, options = {}) => {
    if (!target?.coordinates) return false;
    globeControlsRef.current?.focusLocation?.(target.coordinates, {
      scale: Number.isFinite(options.scale) ? options.scale : 1.1,
      holdMs: Number.isFinite(options.holdMs) ? options.holdMs : 1200,
    });
    return Boolean(globeControlsRef.current?.focusLocation);
  };

  const moveMap = (dx, dy) => setMapCamera((current) => ({ ...current, x: clamp(current.x + dx, 0, 100), y: clamp(current.y + dy, 0, 100) }));
  const zoomIn = () => {
    if (earthIntroActive && mapMode === "earth") {
      globeControlsRef.current?.zoomIn?.();
      return;
    }
    mapApiRef.current?.zoomIn();
    setMapCamera((current) => {
      const next = { ...current, zoom: clamp(current.zoom + 0.18, 0.5, 1.8) };
      return next;
    });
  };
  const zoomOut = () => {
    if (earthIntroActive && mapMode === "earth") {
      globeControlsRef.current?.zoomOut?.();
      return;
    }
    mapApiRef.current?.zoomOut();
    setMapCamera((current) => {
      const next = { ...current, zoom: clamp(current.zoom - 0.18, 0.5, 1.8) };
      return next;
    });
  };
  const resetCompass = () => {
    mapApiRef.current?.reset();
    setMapCamera((current) => ({ ...current, bearing: 0 }));
  };
  const clearSelectedParcelState = () => {
    setSelectedParcelAccount("");
    setSelectedParcelSnapshot(null);
    setSelectedDevelopmentId("");
  };
  const clearGeocodedAddressState = () => {
    setGeocodedAddress(null);
    setGeocodingError("");
  };
  const handleLiveMapViewportChange = (viewport) => {
    if (viewport?.bounds) setLiveMapBounds(viewport.bounds);
    const [centerLng, centerLat] = Array.isArray(viewport?.center) ? viewport.center : [];
    const rovingContext = findRovingMapContextByLngLat(centerLng, centerLat);
    if (rovingContext && rovingContext.id !== DALLAS_LOCATION.id) {
      const nextPlaceId = rovingContext.id === NATIONAL_ROAMING_ID ? NATIONAL_ROAMING_ID : rovingContext.id;
      const placeChanged = nextPlaceId !== activePilotPlaceId;
      setActivePilotPlaceId(nextPlaceId);
      setSelected(rovingContext);
      if (placeChanged) clearSelectedParcelState();
    } else if (rovingContext === DALLAS_LOCATION || lngLatInsideDallasBounds(centerLng, centerLat)) {
      if (activePilotPlaceId) clearSelectedParcelState();
      setActivePilotPlaceId("");
      setSelected(DALLAS_LOCATION);
    }
    setMapCamera((current) => ({
      ...current,
      x: Number.isFinite(viewport?.x) ? viewport.x : current.x,
      y: Number.isFinite(viewport?.y) ? viewport.y : current.y,
      zoom: Number.isFinite(viewport?.zoom) ? viewport.zoom : current.zoom,
      bearing: Number.isFinite(viewport?.bearing) ? viewport.bearing : current.bearing,
      pitch: Number.isFinite(viewport?.pitch) ? viewport.pitch : current.pitch,
    }));
  };
  const parcelRenderProfile = useMemo(() => getParcelRenderProfile(mapCamera), [mapCamera.zoom]);

  const stopEarthInertia = () => {
    if (!inertiaFrameRef.current) return;
    window.cancelAnimationFrame(inertiaFrameRef.current);
    inertiaFrameRef.current = null;
  };

  const startEarthInertia = (releasedDrag) => {
    if (!releasedDrag || !["earth-spin", "tilt-strong", "orbit", "tilt"].includes(releasedDrag.mode)) return;
    let velocityX = Number.isFinite(releasedDrag.velocityX) ? releasedDrag.velocityX : 0;
    let velocityY = Number.isFinite(releasedDrag.velocityY) ? releasedDrag.velocityY : 0;
    if (Math.hypot(velocityX, velocityY) < 0.18) return;
    stopEarthInertia();
    let lastTime = window.performance?.now?.() || Date.now();
    const step = (timestamp) => {
      const elapsed = clamp(timestamp - lastTime, 8, 32);
      lastTime = timestamp;
      setMapCamera((camera) => applyCursorDragToCamera(camera, {
        mode: releasedDrag.mode,
        deltaX: velocityX * elapsed,
        deltaY: velocityY * elapsed,
      }));
      velocityX *= 0.9;
      velocityY *= 0.9;
      if (Math.hypot(velocityX, velocityY) > 0.012) {
        inertiaFrameRef.current = window.requestAnimationFrame(step);
      } else {
        inertiaFrameRef.current = null;
      }
    };
    inertiaFrameRef.current = window.requestAnimationFrame(step);
  };

  const stopParcelEntryAnimation = () => {
    if (!parcelEntryFrameRef.current) return;
    window.cancelAnimationFrame(parcelEntryFrameRef.current);
    parcelEntryFrameRef.current = null;
  };

  const animateMapCameraToParcel = (parcelCamera, onComplete) => {
    stopParcelEntryAnimation();
    const startCamera = mapCamera || getEarthIntroCamera();
    const startedAt = window.performance?.now?.() || Date.now();
    const duration = 1100;
    const step = (timestamp) => {
      const progress = clamp((timestamp - startedAt) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setMapCamera(interpolateCamera(startCamera, parcelCamera, eased));
      if (progress < 1) {
        parcelEntryFrameRef.current = window.requestAnimationFrame(step);
      } else {
        parcelEntryFrameRef.current = null;
        setMapCamera(parcelCamera);
        onComplete?.();
      }
    };
    parcelEntryFrameRef.current = window.requestAnimationFrame(step);
  };

  const queueLocationStatus = (message) => {
    setLocationStatus(message);
    if (locationStatusTimerRef.current) window.clearTimeout(locationStatusTimerRef.current);
    if (message) {
      locationStatusTimerRef.current = window.setTimeout(() => {
        setLocationStatus("");
        locationStatusTimerRef.current = null;
      }, 4500);
    }
  };

  useEffect(() => {
    try {
      runSelfTests();
    } catch (error) {
      console.warn("Real Estate Savant startup self-check failed.", error);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (locationStatusTimerRef.current) window.clearTimeout(locationStatusTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (activePilotPlaceId) {
      setLoadedDallasParcels([]);
      return () => {
        cancelled = true;
      };
    }
    loadParcelRecordsForViewport({
      bounds: liveMapBounds,
      maxFeatures: parcelRenderProfile.maxFeatures,
    })
      .then((parcels) => {
        if (!cancelled && parcels.length) setLoadedDallasParcels(parcels);
      })
      .catch((error) => {
        console.warn("Real Estate Savant full parcel viewport load failed; using emergency DCAD map-shell fallback fixtures only.", error);
      });
    return () => {
      cancelled = true;
    };
  }, [activePilotPlaceId, liveMapBounds, parcelRenderProfile.maxFeatures, PARCEL_PIPELINE_REVISION]);

  useEffect(() => {
    let cancelled = false;
    if (activePilotPlaceId === NATIONAL_ROAMING_ID || !activeParcelDataset || !activeCountyParcelPlaceId) {
      setLoadedPilotParcels([]);
      return () => {
        cancelled = true;
      };
    }
    loadParcelRecordsForViewport({
      bounds: liveMapBounds,
      maxFeatures: parcelRenderProfile.maxFeatures,
    }, activeParcelDataset)
      .then((parcels) => {
        if (!cancelled) setLoadedPilotParcels(parcels);
      })
      .catch((error) => {
        console.warn("Real Estate Savant pilot parcel viewport load failed.", error);
        if (!cancelled) setLoadedPilotParcels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeParcelDataset, activeCountyParcelPlaceId, liveMapBounds, parcelRenderProfile.maxFeatures]);

  useEffect(() => {
    const nextSearchText = deferredSearchText.trim();
    if (!nextSearchText) {
      setDebouncedSearchText("");
      return undefined;
    }
    if (!findPlaceTarget(nextSearchText) && nextSearchText.length < SEARCH_MIN_TYPEAHEAD_CHARS) {
      setDebouncedSearchText("");
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setDebouncedSearchText(deferredSearchText);
    }, SEARCH_TYPEAHEAD_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [deferredSearchText]);

  useEffect(() => {
    let cancelled = false;
    const searchTerm = debouncedSearchText.trim();
    if (!searchTerm) {
      searchRequestIdRef.current += 1;
      setLoadedSearchResults([]);
      setLoadedSearchQuery("");
      setSearchLoading(false);
      return () => {
        cancelled = true;
      };
    }
    if (submittedSearchQueryRef.current === searchTerm) {
      submittedSearchQueryRef.current = "";
      return () => {
        cancelled = true;
      };
    }
    if (findPlaceTarget(searchTerm)) {
      searchRequestIdRef.current += 1;
      setLoadedSearchResults([]);
      setLoadedSearchQuery(searchTerm);
      setSearchLoading(false);
      return () => {
        cancelled = true;
      };
    }
    if (parseHighestBestUseSearch(searchTerm)) {
      searchRequestIdRef.current += 1;
      setLoadedSearchResults([]);
      setLoadedSearchQuery(searchTerm);
      setSearchLoading(false);
      return () => {
        cancelled = true;
      };
    }
    if (looksLikeUsStreetAddress(searchTerm)) {
      const requestId = ++searchRequestIdRef.current;
      setLoadedSearchResults([]);
      setLoadedSearchQuery(searchTerm);
      clearGeocodedAddressState();
      setSearchLoading(true);
      searchNationalParcelAddress(searchTerm, {
        maxFeatures: SEARCH_RESULT_LOOKUP_LIMIT,
        searchDataset: searchFullParcelRecords,
      })
        .then((nationalResult) => {
          if (cancelled || searchRequestIdRef.current !== requestId) return;
          if (nationalResult?.status === "parcel-found") {
            submittedSearchQueryRef.current = searchTerm;
            if (focusNationalParcelResult(nationalResult)) return;
          }
          setLoadedSearchResults([]);
          setLoadedSearchQuery(searchTerm);
          if (nationalResult?.geocoded) {
            setGeocodedAddress(nationalResult.geocoded);
            setGeocodingError(
              nationalResult.status === "county-not-connected"
                ? `${nationalResult.geography?.countyName || "This county"} is located, but its parcel service is not connected yet.`
                : "Address located, but no indexed parcel address matched exactly.",
            );
          } else {
            setGeocodingError("No U.S. address match was found.");
          }
        })
        .catch((error) => {
          console.warn("Real Estate Savant national address typeahead failed.", error);
          if (!cancelled && searchRequestIdRef.current === requestId) setGeocodingError("Address lookup is temporarily unavailable.");
        })
        .finally(() => {
          if (!cancelled && searchRequestIdRef.current === requestId) setSearchLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    const instantParcels = searchParcelRecords([
      ...fallbackSearchParcels,
      ...(loadedDallasParcels.length || activeCountyParcelPlaceId ? allMapParcels : []),
    ], searchTerm)
      .slice(0, SEARCH_RESULT_LOOKUP_LIMIT);
    const requestId = ++searchRequestIdRef.current;
    setLoadedSearchResults(instantParcels);
    setLoadedSearchQuery(searchTerm);
    setSearchLoading(true);
    searchFullParcelRecords(searchTerm, SEARCH_RESULT_LOOKUP_LIMIT, activeParcelDataset)
      .then((parcels) => {
        if (!cancelled && searchRequestIdRef.current === requestId) {
          const mergedParcels = mergeParcelSearchResults(SEARCH_RESULT_LOOKUP_LIMIT, instantParcels, parcels);
          setLoadedSearchResults(mergedParcels);
          setLoadedSearchQuery(searchTerm);
          setSearchLoading(false);
          if (
            mergedParcels[0] &&
            autoSelectedSearchQueryRef.current !== searchTerm &&
            isExactParcelAddressMatch(mergedParcels[0], searchTerm)
          ) {
            autoSelectedSearchQueryRef.current = searchTerm;
            setSelectedDevelopmentId("");
            jumpToParcel(mergedParcels[0]);
          }
        }
      })
      .catch((error) => {
        console.warn("Real Estate Savant full parcel search failed.", error);
        if (!cancelled && searchRequestIdRef.current === requestId) {
          setLoadedSearchResults(instantParcels);
          setLoadedSearchQuery(searchTerm);
          setSearchLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeCountyParcelPlaceId, activeParcelDataset, debouncedSearchText, fallbackSearchParcels, loadedDallasParcels]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      setDragStart((current) => {
        if (!current) return current;
        const deltaX = event.clientX - current.x;
        const deltaY = event.clientY - current.y;
        const now = window.performance?.now?.() || Date.now();
        const elapsed = Math.max(8, now - (current.time || now));
        setMapCamera((camera) => applyCursorDragToCamera(camera, { mode: current.mode, deltaX, deltaY }));
        const next = {
          ...current,
          x: event.clientX,
          y: event.clientY,
          time: now,
          velocityX: deltaX / elapsed,
          velocityY: deltaY / elapsed,
        };
        dragStateRef.current = next;
        return next;
      });
    };

    const stopDragging = (event) => {
      const releasedDrag = dragStateRef.current;
      setIsDragging(false);
      setDragStart(null);
      dragStateRef.current = null;
      if (event?.type !== "pointercancel") startEarthInertia(releasedDrag);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
      if (inertiaFrameRef.current) window.cancelAnimationFrame(inertiaFrameRef.current);
      if (parcelEntryFrameRef.current) window.cancelAnimationFrame(parcelEntryFrameRef.current);
      if (globeHandoffTimerRef.current) window.clearTimeout(globeHandoffTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const targetTag = event.target && event.target.tagName ? event.target.tagName : "";
      if (["INPUT", "TEXTAREA"].includes(targetTag)) return;
      if (event.key === "ArrowUp") moveMap(0, -4);
      if (event.key === "ArrowDown") moveMap(0, 4);
      if (event.key === "ArrowLeft") moveMap(-4, 0);
      if (event.key === "ArrowRight") moveMap(4, 0);
      if (event.key === "+" || event.key === "=") zoomIn();
      if (event.key === "-" || event.key === "_") zoomOut();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const enterDallasParcelMode = ({ clearSelection = true, focusGlobe = true } = {}) => {
    const parcelCamera = getParcelViewCamera();
    stopEarthInertia();
    stopParcelEntryAnimation();
    clearGlobeHandoffTimer();

    const commitDallasParcelMode = () => {
      setActivePilotPlaceId("");
      setSelected(DALLAS_LOCATION);
      setMapMode("parcel");
      if (clearSelection) {
        clearSelectedParcelState();
      }
      setMapCamera(parcelCamera);
      setLiveMapBounds(getViewportBounds(parcelCamera));
      setEarthIntroActive(false);
      setShowParcelLabels(true);
      setShowGrid(true);
      mapApiRef.current?.flyToCamera?.(parcelCamera);
    };

    if (focusGlobe && earthIntroActive && mapMode === "earth" && focusGlobeOnTarget(DALLAS_LOCATION, { scale: 1.08, holdMs: 900 })) {
      setActivePilotPlaceId("");
      setSelected(DALLAS_LOCATION);
      if (clearSelection) {
        clearSelectedParcelState();
      }
      globeHandoffTimerRef.current = window.setTimeout(() => {
        globeHandoffTimerRef.current = null;
        commitDallasParcelMode();
      }, 780);
      return;
    }

    commitDallasParcelMode();
  };

  const findMyLocation = () => {
    if (locating) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      queueLocationStatus("Location unavailable");
      return;
    }

    setLocating(true);
    queueLocationStatus("Finding location");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const longitude = Number(position?.coords?.longitude);
        const latitude = Number(position?.coords?.latitude);
        const rovingContext = findRovingMapContextByLngLat(longitude, latitude);
        if (!rovingContext) {
          setLocating(false);
          queueLocationStatus("Location is outside the U.S. map");
          return;
        }

        const targetIsDallas = rovingContext === DALLAS_LOCATION;
        const targetIsNational = rovingContext.id === NATIONAL_ROAMING_ID;
        const targetBounds = rovingContext.geoBounds || DALLAS_LIVE_GEO_BOUNDS;
        const [x, y] = lngLatToScreenPoint(longitude, latitude, targetBounds, rovingContext.coordinates);
        const parcelCamera = targetIsDallas ? getParcelViewCamera() : getCameraForLocation(rovingContext);
        const targetCamera = {
          ...parcelCamera,
          x,
          y,
          zoom: targetIsNational ? Math.max(parcelCamera.zoom, 0.68) : Math.max(parcelCamera.zoom, mapCamera?.zoom || parcelCamera.zoom, PARCEL_ZOOM_THRESHOLDS.detail),
          pitch: clamp(mapCamera?.pitch ?? parcelCamera.pitch, 24, 78),
          bearing: normalizeBearing(mapCamera?.bearing ?? parcelCamera.bearing),
        };

        stopEarthInertia();
        stopParcelEntryAnimation();
        clearGlobeHandoffTimer();
        setActivePilotPlaceId(targetIsDallas ? "" : rovingContext.id);
        setSelected(rovingContext);
        setMapMode("parcel");
        clearSelectedParcelState();
        setMapCamera(targetCamera);
        setLiveMapBounds(getViewportBounds(targetCamera));
        setEarthIntroActive(false);
        setShowParcelLabels(true);
        setShowGrid(true);
        if (mapApiRef.current?.flyToLngLat) {
          mapApiRef.current.flyToLngLat([longitude, latitude], {
            zoom: targetIsNational ? 6.2 : 15.6,
            pitch: targetCamera.pitch,
            bearing: targetCamera.bearing,
            duration: 1100,
          });
        } else {
          mapApiRef.current?.flyToCamera?.(targetCamera);
        }
        setLocating(false);
        queueLocationStatus("Location found");
      },
      (error) => {
        setLocating(false);
        queueLocationStatus(geolocationErrorLabel(error));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  useEffect(() => {
    if (!preserveLandingEarth) return;
    setLandingEarthOverlayVisible(true);
    setLandingEarthOverlayFading(false);
    landingEarthOverlayFrameRef.current = window.requestAnimationFrame(() => {
      setLandingEarthOverlayFading(true);
    });
    return () => {
      if (landingEarthOverlayFrameRef.current) window.cancelAnimationFrame(landingEarthOverlayFrameRef.current);
    };
  }, [preserveLandingEarth]);

  const jumpToParcel = (parcel, options = {}) => {
    const focusCamera = options?.focusCamera !== false;
    const targetLocation = activeCountyParcelPlaceId ? activeMapLocation : DALLAS_LOCATION;
    const centroid = safePoint(parcel && parcel.centroid, [targetLocation.camera.x, targetLocation.camera.y]);
    const parcelCamera = getCameraForLocation(targetLocation);
    const targetCamera = { ...parcelCamera, x: centroid[0], y: centroid[1], zoom: Math.max(parcelCamera.zoom, 1.62) };
    clearGlobeHandoffTimer();
    if (activeCountyParcelPlaceId) {
      setSelected(targetLocation);
      setMapMode("parcel");
      setEarthIntroActive(false);
      setShowParcelLabels(true);
      setShowGrid(true);
    } else if (focusCamera) {
      enterDallasParcelMode({ clearSelection: false, focusGlobe: false });
    } else {
      setSelected(DALLAS_LOCATION);
      setMapMode("parcel");
      setEarthIntroActive(false);
      setShowParcelLabels(true);
      setShowGrid(true);
    }
    setSelectedParcelAccount(countyAwareParcelId(parcel));
    setSelectedParcelSnapshot(parcel || null);
    setSelectedParcelMapFocusEnabled(focusCamera);
    if (focusCamera) {
      setMapCamera(targetCamera);
      setLiveMapBounds(getViewportBounds(targetCamera));
      mapApiRef.current?.flyToCamera?.(targetCamera);
    }
  };

  const moveToPlaceTarget = (target) => {
    if (!target) return;
    stopEarthInertia();
    stopParcelEntryAnimation();
    clearGlobeHandoffTimer();
    clearGeocodedAddressState();

    const commitPlaceTarget = () => {
      setActivePilotPlaceId(target.id);
      setSelected(target);
      setMapMode("parcel");
      clearSelectedParcelState();
      setLoadedDallasParcels([]);
      setLoadedSearchResults([]);
      setLoadedSearchQuery("");
      setMapCamera(target.camera);
      setLiveMapBounds(getViewportBounds(target.camera));
      setEarthIntroActive(false);
      setShowParcelLabels(true);
      setShowGrid(true);
      mapApiRef.current?.flyToLngLat?.(target.coordinates, {
        zoom: target.mapZoom,
        pitch: target.camera.pitch,
        bearing: target.camera.bearing,
        duration: 1200,
      });
    };

    if (earthIntroActive && mapMode === "earth" && focusGlobeOnTarget(target, { scale: 1.12, holdMs: 1100 })) {
      setActivePilotPlaceId(target.id);
      setSelected(target);
      clearSelectedParcelState();
      setLoadedDallasParcels([]);
      setLoadedSearchResults([]);
      setLoadedSearchQuery("");
      globeHandoffTimerRef.current = window.setTimeout(() => {
        globeHandoffTimerRef.current = null;
        commitPlaceTarget();
      }, 980);
      return;
    }

    commitPlaceTarget();
  };

  const focusGeocodedAddress = (addressResult) => {
    if (!addressResult?.coordinates) return;
    const [longitude, latitude] = addressResult.coordinates.map(Number);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
    const coveredPlace = findPlaceTargetByLngLat(longitude, latitude);
    const inDallas = lngLatInsideDallasBounds(longitude, latitude);
    const mapContext = inDallas ? DALLAS_LOCATION : coveredPlace || NATIONAL_US_LOCATION;
    const placeId = inDallas ? "" : coveredPlace?.id || NATIONAL_ROAMING_ID;
    const contextBounds = mapContext.geoBounds || NATIONAL_US_GEO_BOUNDS;
    const [x, y] = lngLatToScreenPoint(longitude, latitude, contextBounds, mapContext.coordinates);
    const contextCamera = getCameraForLocation(mapContext);
    const targetCamera = {
      ...contextCamera,
      x,
      y,
      zoom: Math.max(contextCamera.zoom, 1.62),
      pitch: clamp(mapCamera?.pitch ?? 48, 24, 72),
      bearing: normalizeBearing(mapCamera?.bearing ?? 0),
    };
    const addressLocation = {
      ...mapContext,
      id: `geocoded-address:${longitude.toFixed(6)},${latitude.toFixed(6)}`,
      name: addressResult.matchedAddress,
      type: "U.S. address",
      status: coveredPlace || inDallas ? "aerial location · parcel coverage available" : "aerial location · parcel coverage unavailable",
      coordinates: [longitude, latitude],
    };
    stopEarthInertia();
    stopParcelEntryAnimation();
    clearGlobeHandoffTimer();
    setActivePilotPlaceId(placeId);
    setSelected(addressLocation);
    clearSelectedParcelState();
    setMapMode("parcel");
    setEarthIntroActive(false);
    setMapCamera(targetCamera);
    setLiveMapBounds(getViewportBounds(targetCamera));
    setLoadedSearchResults([]);
    setGeocodedAddress(addressResult);
    setGeocodingError("");
    mapApiRef.current?.flyToLngLat?.([longitude, latitude], {
      zoom: 16.2,
      pitch: targetCamera.pitch,
      bearing: targetCamera.bearing,
      duration: 1200,
    });
  };

  const focusNationalParcelResult = (result) => {
    const parcel = result?.parcels?.[0];
    const route = result?.route;
    if (!parcel || !route) return false;
    const target = mapLocationForPlaceId(route.datasetId);
    const placeId = route.datasetId === activeCountyDataset.id ? "" : route.datasetId;
    const centroid = safePoint(parcel.centroid, [target.camera.x, target.camera.y]);
    const targetCamera = { ...getCameraForLocation(target), x: centroid[0], y: centroid[1], zoom: Math.max(target.camera.zoom, 1.62) };
    stopEarthInertia();
    stopParcelEntryAnimation();
    clearGlobeHandoffTimer();
    setActivePilotPlaceId(placeId);
    setSelected(target);
    setMapMode("parcel");
    setEarthIntroActive(false);
    setShowParcelLabels(true);
    setShowGrid(true);
    setMapCamera(targetCamera);
    setLiveMapBounds(getViewportBounds(targetCamera));
    setSelectedDevelopmentId("");
    setSelectedParcelAccount(countyAwareParcelId(parcel));
    setSelectedParcelSnapshot(parcel);
    setSelectedParcelMapFocusEnabled(true);
    setLoadedSearchResults(result.parcels);
    setLoadedSearchQuery(String(result.matchedQuery || searchText).trim());
    setGeocodedAddress(result.geocoded || null);
    setGeocodingError("");
    mapApiRef.current?.flyToCamera?.(targetCamera);
    return true;
  };

  const handleMapPointerDown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    stopEarthInertia();
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    setIsDragging(true);
    const startedDrag = {
      x: event.clientX,
      y: event.clientY,
      mode: getDragNavigationMode(event),
      time: window.performance?.now?.() || Date.now(),
      velocityX: 0,
      velocityY: 0,
    };
    dragStateRef.current = startedDrag;
    setDragStart(startedDrag);
  };

  const handleMapWheel = (event) => {
    event.preventDefault();
    const cursorPoint = getCursorPointInElement(event);
    setMapCamera((current) => {
      const next = applyWheelZoom(current, event.deltaY, cursorPoint);
      return next;
    });
  };

  const allMapParcels = activePilotPlaceId === NATIONAL_ROAMING_ID
    ? []
    : activeCountyParcelPlaceId
      ? loadedPilotParcels
      : loadedDallasParcels.length
        ? loadedDallasParcels
        : fallbackDallasParcels;
  const visibleMapParcels = useMemo(() => {
    if (activeCountyParcelPlaceId) {
      const viewportParcels = filterParcelRecordsForViewport(loadedPilotParcels, { bounds: liveMapBounds, maxFeatures: parcelRenderProfile.maxFeatures });
      return viewportParcels.length ? viewportParcels : loadedPilotParcels.slice(0, parcelRenderProfile.maxFeatures);
    }
    if (!loadedDallasParcels.length) return getVisibleDallasParcels(mapCamera);
    const viewportParcels = filterParcelRecordsForViewport(loadedDallasParcels, { bounds: liveMapBounds, maxFeatures: parcelRenderProfile.maxFeatures });
    return viewportParcels.length ? viewportParcels : loadedDallasParcels.slice(0, parcelRenderProfile.maxFeatures);
  }, [activeCountyParcelPlaceId, liveMapBounds, loadedDallasParcels, loadedPilotParcels, mapCamera, parcelRenderProfile.maxFeatures]);
  const activePlaceSearchTarget = useMemo(() => findPlaceTarget(debouncedSearchText), [debouncedSearchText]);
  useEffect(() => {
    let cancelled = false;
    if (activeCountyParcelPlaceId || !visibleMapParcels.length) return () => { cancelled = true; };
    const parcelIds = visibleMapParcels
      .flatMap((parcel) => [String(parcel.accountNum || parcel.accountNumber || ""), String(parcel.gisParcelId || "")])
      .filter(Boolean);
    const developmentServiceRoot = parcelDatasetForRecord(visibleMapParcels[0], activeParcelDataset)?.dataRoots?.developments;
    loadDevelopmentRecordsForParcels(parcelIds, parcelRenderProfile.maxFeatures * 2, developmentServiceRoot)
      .then((records) => {
        if (cancelled || !records.length) return;
        setDevelopmentParcelIndex((current) => {
          const next = new Map(current);
          records.forEach((record) => next.set(String(record.parcelId), record));
          return next;
        });
      })
      .catch((error) => console.warn("Real Estate Savant viewport development shard load failed.", error));
    return () => { cancelled = true; };
  }, [activeParcelDataset, parcelRenderProfile.maxFeatures, visibleMapParcels]);

  useEffect(() => {
    let cancelled = false;
    const query = debouncedSearchText.trim();
    if (activePlaceSearchTarget || query.length < 2) return () => { cancelled = true; };
    searchDevelopmentRecords(query, SEARCH_RESULT_LOOKUP_LIMIT, activeParcelDataset?.dataRoots?.developments)
      .then((records) => {
        if (cancelled || !records.length) return;
        setDevelopmentParcelIndex((current) => {
          const next = new Map(current);
          records.forEach((record) => next.set(String(record.parcelId), record));
          return next;
        });
      })
      .catch((error) => console.warn("Real Estate Savant development search shard load failed.", error));
    return () => { cancelled = true; };
  }, [activeParcelDataset, activePlaceSearchTarget, debouncedSearchText]);

  const currentSearchQuery = debouncedSearchText.trim();
  const globalSearchResults = useMemo(
    () => (currentSearchQuery && !activePlaceSearchTarget && loadedSearchQuery === currentSearchQuery ? loadedSearchResults : []),
    [activePlaceSearchTarget, currentSearchQuery, loadedSearchQuery, loadedSearchResults],
  );
  const developmentResults = useMemo(() => {
    if (parseHighestBestUseSearch(debouncedSearchText)) return [];
    const staticResults = searchDevelopmentIntel(debouncedSearchText);
    const indexedResults = searchIndexedDevelopments(developmentParcelIndex.values(), debouncedSearchText, SEARCH_RESULT_LOOKUP_LIMIT);
    const seen = new Set(staticResults.map((record) => String(record.linkedAccount || record.id)));
    return [
      ...staticResults,
      ...indexedResults.filter((record) => {
        const key = String(record.linkedAccount || record.id);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    ].slice(0, SEARCH_RESULT_LOOKUP_LIMIT);
  }, [debouncedSearchText, developmentParcelIndex]);
  const filteredMapParcels = useMemo(
    () => (activePlaceSearchTarget ? visibleMapParcels : debouncedSearchText.trim() ? globalSearchResults : filterParcels(visibleMapParcels, debouncedSearchText)),
    [activePlaceSearchTarget, debouncedSearchText, globalSearchResults, visibleMapParcels]
  );
  const selectedParcel = selectedParcelAccount
    ? allMapParcels.find((parcel) => parcelMatchesSelection(parcel, selectedParcelAccount)) ||
      filteredMapParcels.find((parcel) => parcelMatchesSelection(parcel, selectedParcelAccount)) ||
      (parcelMatchesSelection(selectedParcelSnapshot, selectedParcelAccount) ? selectedParcelSnapshot : null)
    : null;
  const selectedParcelDataset = parcelDatasetForRecord(selectedParcel, activeParcelDataset);
  const selectedDevelopmentRecord = selectedParcel
    ? resolveSelectedDevelopmentRecord({
        embeddedRecords: developmentIntel.records,
        indexedRecords: developmentParcelIndex,
        selectedDevelopmentId,
        parcelAccountId: selectedParcel.accountNum || selectedParcel.accountNumber,
        parcelGisId: selectedParcel.gisParcelId,
      })
    : null;

  const selectDevelopmentResult = (record) => {
    if (!record) return;
    setSelectedDevelopmentId(record.id);
    const linkedAccount = String(record.linkedAccount || "");
    const linkedParcel = allMapParcels.find((parcel) => String(parcel.accountNum || parcel.accountNumber) === linkedAccount);
    if (linkedParcel) {
      jumpToParcel(linkedParcel);
      return;
    }
    if (!linkedAccount) return;
    searchFullParcelRecords(linkedAccount, 1, activeParcelDataset)
      .then((parcels) => {
        if (parcels[0]) jumpToParcel(parcels[0]);
      })
      .catch((error) => {
        console.warn("Real Estate Savant linked development parcel search failed.", error);
      });
  };

  const runUnifiedSearch = (rawQuery, failureMessage = "Real Estate Savant full parcel search submit failed.") => {
    const sourceQuery = String(rawQuery || "").trim();
    if (!sourceQuery) return;
    const highestBestUseIntent = parseHighestBestUseSearch(sourceQuery);
    const query = highestBestUseIntent?.locationQuery || sourceQuery;
    const requestId = ++searchRequestIdRef.current;
    submittedSearchQueryRef.current = sourceQuery;
    setDebouncedSearchText(sourceQuery);
    queueHighestBestUseIntent(highestBestUseIntent);
    if (highestBestUseIntent?.mode === "viewport-ranking") {
      const rankedParcels = rankParcelsForHighestBestUse(visibleMapParcels, highestBestUseIntent.useId, {
        limit: SEARCH_RESULT_LOOKUP_LIMIT,
      });
      setLoadedSearchResults(rankedParcels);
      setLoadedSearchQuery(sourceQuery);
      clearGeocodedAddressState();
      setSearchLoading(false);
      if (rankedParcels[0]) {
        setSelectedDevelopmentId("");
        jumpToParcel(rankedParcels[0]);
      } else {
        setGeocodingError("No loaded viewport parcels have enough verified land and value data for HBU ranking.");
      }
      return;
    }
    const placeTarget = findPlaceTarget(query);
    if (placeTarget) {
      moveToPlaceTarget(placeTarget);
      setLoadedSearchQuery(sourceQuery);
      setSearchLoading(false);
      return;
    }
    if (looksLikeUsStreetAddress(query)) {
      setLoadedSearchResults([]);
      setLoadedSearchQuery(sourceQuery);
      clearGeocodedAddressState();
      setSearchLoading(true);
      searchNationalParcelAddress(query, {
        maxFeatures: SEARCH_RESULT_LOOKUP_LIMIT,
        searchDataset: searchFullParcelRecords,
      })
        .then((nationalResult) => {
          if (searchRequestIdRef.current !== requestId) return;
          if (nationalResult?.status === "parcel-found" && focusNationalParcelResult(nationalResult)) return;
          if (nationalResult?.geocoded) {
            focusGeocodedAddress(nationalResult.geocoded);
            if (nationalResult.status === "county-not-connected") {
              setGeocodingError(`${nationalResult.geography?.countyName || "This county"} is located, but its parcel service is not connected yet.`);
            } else if (nationalResult.status === "county-covered-no-parcel-match") {
              setGeocodingError("Address located. Showing nearby parcels because no indexed parcel address matched exactly.");
            }
          } else {
            setGeocodingError("No U.S. address match was found.");
          }
        })
        .catch((error) => {
          console.warn("Real Estate Savant national parcel routing failed.", error);
          if (searchRequestIdRef.current === requestId) setGeocodingError("Address lookup is temporarily unavailable.");
        })
        .finally(() => {
          if (searchRequestIdRef.current === requestId) setSearchLoading(false);
        });
      return;
    }
    const instantParcels = mergeParcelSearchResults(
      SEARCH_RESULT_LOOKUP_LIMIT,
      searchParcelRecords([
        ...(activeCountyParcelPlaceId ? [] : fallbackSearchParcels),
        ...(loadedDallasParcels.length || activeCountyParcelPlaceId ? allMapParcels : []),
      ], query),
    );
    const presentedInstantParcels = highestBestUseIntent
      ? instantParcels.filter((parcel) => isExactParcelAddressMatch(parcel, query))
      : instantParcels;
    setLoadedSearchResults(presentedInstantParcels);
    setLoadedSearchQuery(sourceQuery);
    clearGeocodedAddressState();
    setSearchLoading(true);
    const instantSelection = highestBestUseIntent
      ? presentedInstantParcels[0]
      : instantParcels[0];
    if (instantSelection) {
      setSelectedDevelopmentId("");
      jumpToParcel(instantSelection);
    }
    Promise.all([
      activeParcelDataset
        ? searchFullParcelRecords(query, SEARCH_RESULT_LOOKUP_LIMIT, activeParcelDataset).catch((error) => {
            console.warn(failureMessage, error);
            return [];
          })
        : Promise.resolve([]),
      searchDevelopmentRecords(query, SEARCH_RESULT_LOOKUP_LIMIT, activeParcelDataset?.dataRoots?.developments).catch((error) => {
        console.warn("Real Estate Savant submitted development shard search failed.", error);
        return [];
      }),
    ])
      .then(async ([parcels, indexedDevelopments]) => {
        if (searchRequestIdRef.current !== requestId) return;
        const matchingDevelopments = [...searchDevelopmentIntel(query), ...indexedDevelopments];
        if (indexedDevelopments.length) {
          setDevelopmentParcelIndex((current) => {
            const next = new Map(current);
            indexedDevelopments.forEach((record) => next.set(String(record.parcelId), record));
            return next;
          });
        }
        const mergedParcels = mergeParcelSearchResults(
          SEARCH_RESULT_LOOKUP_LIMIT,
          highestBestUseIntent ? presentedInstantParcels : instantParcels,
          parcels,
        );
        setLoadedSearchResults(mergedParcels);
        setLoadedSearchQuery(sourceQuery);
        const mergedSelection = highestBestUseIntent
          ? mergedParcels.find((parcel) => isExactParcelAddressMatch(parcel, query)) || mergedParcels[0]
          : mergedParcels[0];
        if (mergedSelection && (!instantSelection || highestBestUseIntent)) {
          setSelectedDevelopmentId("");
          jumpToParcel(mergedSelection);
        } else if (!mergedParcels[0] && matchingDevelopments[0]) {
          selectDevelopmentResult(matchingDevelopments[0]);
        } else if (!mergedParcels[0]) {
          try {
            const addressResult = await geocodeAddress(query);
            if (searchRequestIdRef.current !== requestId) return;
            if (addressResult) focusGeocodedAddress(addressResult);
            else setGeocodingError("No parcel or U.S. address match was found.");
          } catch (error) {
            console.warn("Real Estate Savant address geocoding failed.", error);
            if (searchRequestIdRef.current === requestId) setGeocodingError("Address lookup is temporarily unavailable.");
          }
        }
        if (searchRequestIdRef.current === requestId) setSearchLoading(false);
      })
      .catch((error) => {
        console.warn(failureMessage, error);
        if (searchRequestIdRef.current !== requestId) return;
        setLoadedSearchResults(presentedInstantParcels);
        setLoadedSearchQuery(sourceQuery);
        setSearchLoading(false);
      });
  };

  const submitParcelSearch = () => {
    runUnifiedSearch(searchText);
  };

  const clearParcelSearch = () => {
    searchRequestIdRef.current += 1;
    submittedSearchQueryRef.current = "";
    setSearchText("");
    setDebouncedSearchText("");
    setLoadedSearchResults([]);
    setLoadedSearchQuery("");
    setHighestBestUseSearchIntent(null);
    clearGeocodedAddressState();
    setSearchLoading(false);
  };

  useEffect(() => {
    if (!initialDatasetId || !initialSearch.trim() || selectedParcelAccount || !loadedSearchResults.length) return;
    const normalizeInitialParcelId = (value) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const normalizedInitial = normalizeInitialParcelId(initialSearch);
    const exactParcel = loadedSearchResults.find((parcel) => [parcel.accountNum, parcel.accountNumber, parcel.sourceParcelId]
      .map(normalizeInitialParcelId)
      .includes(normalizedInitial));
    if (exactParcel) jumpToParcel(exactParcel);
  }, [activePilotPlaceId, initialDatasetId, initialSearch, loadedSearchResults, selectedParcelAccount]);

  useEffect(() => {
    if (initialSearchSubmittedRef.current || !initialSearch.trim()) return;
    initialSearchSubmittedRef.current = true;
    runUnifiedSearch(initialSearch, "Real Estate Savant initial parcel search failed.");
  }, [initialSearch]);

  useEffect(() => {
    let cancelled = false;
    if (!showZoning || !filteredMapParcels.length) {
      setVisibleParcelZoningMap((current) => (current.size ? new Map() : current));
      return () => {
        cancelled = true;
      };
    }
    const parcelIds = filteredMapParcels
      .slice(0, ZONING_LAYER_LOOKUP_LIMIT)
      .flatMap((parcel) => [countyAwareParcelId(parcel), parcel.accountNum || parcel.accountNumber, parcel.gisParcelId])
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    const zoningServiceRoot = parcelDatasetForRecord(filteredMapParcels[0], activeParcelDataset)?.dataRoots?.zoning;
    loadParcelZoningSummaries(parcelIds, ZONING_LAYER_LOOKUP_LIMIT, zoningServiceRoot)
      .then((records) => {
        if (!cancelled) setVisibleParcelZoningMap(records);
      })
      .catch((error) => {
        console.warn("Real Estate Savant zoning layer load failed.", error);
        if (!cancelled) setVisibleParcelZoningMap(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [activeParcelDataset, filteredMapParcels, showZoning]);

  useEffect(() => {
    let cancelled = false;
    if (!showFloodplain || !filteredMapParcels.length) {
      setVisibleParcelFloodplainMap((current) => (current.size ? new Map() : current));
      return () => {
        cancelled = true;
      };
    }
    const parcelIds = filteredMapParcels
      .slice(0, FLOODPLAIN_LAYER_LOOKUP_LIMIT)
      .flatMap((parcel) => [countyAwareParcelId(parcel), parcel.accountNum || parcel.accountNumber, parcel.gisParcelId])
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    const floodplainServiceRoot = parcelDatasetForRecord(filteredMapParcels[0], activeParcelDataset)?.dataRoots?.floodplain;
    loadParcelFloodplainSummaries(parcelIds, FLOODPLAIN_LAYER_LOOKUP_LIMIT, floodplainServiceRoot)
      .then((records) => {
        if (!cancelled) setVisibleParcelFloodplainMap(records);
      })
      .catch((error) => {
        console.warn("Real Estate Savant floodplain layer load failed.", error);
        if (!cancelled) setVisibleParcelFloodplainMap(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [activeParcelDataset, filteredMapParcels, showFloodplain]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedParcelAccount) {
      setSelectedParcelZoning(null);
      setSelectedParcelZoningError("");
      setSelectedParcelZoningLoading(false);
      setSelectedParcelZoningLoaded(false);
      return () => {
        cancelled = true;
      };
    }
    // The selected map ID is county-aware and may end in a geometry UUID, while
    // parcel-intelligence shards are keyed by the appraisal account number.
    const parcelLookupId = parcelStableAccountId(selectedParcel || {}) || selectedParcelAccount;
    setSelectedParcelZoningLoading(true);
    setSelectedParcelZoningLoaded(false);
    setSelectedParcelZoningError("");
    const zoningServiceRoot = selectedParcelDataset?.dataRoots?.zoning;
    loadParcelZoningSummary(parcelLookupId, zoningServiceRoot)
      .then((zoning) => {
        if (!cancelled) {
          setSelectedParcelZoning(zoning);
          setSelectedParcelZoningLoaded(true);
        }
      })
      .catch((error) => {
        console.warn("Real Estate Savant zoning load failed.", error);
        if (!cancelled) {
          setSelectedParcelZoning(null);
          setSelectedParcelZoningLoaded(true);
          setSelectedParcelZoningError("Zoning could not be loaded for this parcel.");
        }
      })
      .finally(() => {
        if (!cancelled) setSelectedParcelZoningLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedParcel, selectedParcelAccount, selectedParcelDataset]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedParcelAccount) {
      setSelectedParcelFloodplain(null);
      setSelectedParcelFloodplainError("");
      setSelectedParcelFloodplainLoading(false);
      setSelectedParcelFloodplainLoaded(false);
      return () => {
        cancelled = true;
      };
    }
    const parcelLookupId = selectedParcelAccount || parcelStableAccountId(selectedParcel || {});
    setSelectedParcelFloodplainLoading(true);
    setSelectedParcelFloodplainLoaded(false);
    setSelectedParcelFloodplainError("");
    const floodplainServiceRoot = selectedParcelDataset?.dataRoots?.floodplain;
    loadParcelFloodplainSummary(parcelLookupId, floodplainServiceRoot)
      .then((floodplain) => {
        if (!cancelled) {
          setSelectedParcelFloodplain(floodplain);
          setSelectedParcelFloodplainLoaded(true);
        }
      })
      .catch((error) => {
        console.warn("Real Estate Savant floodplain load failed.", error);
        if (!cancelled) {
          setSelectedParcelFloodplain(null);
          setSelectedParcelFloodplainLoaded(true);
          setSelectedParcelFloodplainError("Floodplain data could not be loaded for this parcel.");
        }
      })
      .finally(() => {
        if (!cancelled) setSelectedParcelFloodplainLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedParcel, selectedParcelAccount, selectedParcelDataset]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedParcelAccount) {
      setSelectedParcelPermits([]);
      setSelectedParcelPermitsError("");
      setSelectedParcelPermitsLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setSelectedParcelPermitsLoading(true);
    setSelectedParcelPermitsError("");
    const permitServiceRoot = selectedParcelDataset?.dataRoots?.permits;
    loadPermitsForParcel(parcelStableAccountId(selectedParcel || {}) || String(selectedParcelAccount).split(":").pop(), 250, permitServiceRoot)
      .then((permits) => {
        if (!cancelled) setSelectedParcelPermits(permits);
      })
      .catch((error) => {
        console.warn("Real Estate Savant parcel permit load failed.", error);
        if (!cancelled) {
          setSelectedParcelPermits([]);
          setSelectedParcelPermitsError("Permit records could not be loaded for this parcel.");
        }
      })
      .finally(() => {
        if (!cancelled) setSelectedParcelPermitsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedParcel, selectedParcelAccount, selectedParcelDataset]);

  return (
    <div className="relative h-screen w-full overflow-hidden bg-black text-white">
      <SyntheticMapScene
        mapCamera={mapCamera}
        selectedId={selected.id}
        selectedParcelAccount={selectedParcelAccount}
        focusSelectedParcel={selectedParcelMapFocusEnabled}
        mapGeoBounds={activeMapGeoBounds}
        mapLocation={activeMapLocation}
        visibleParcels={filteredMapParcels}
        developmentIndex={developmentParcelIndex}
        floodplainParcelMap={visibleParcelFloodplainMap}
        zoningParcelMap={visibleParcelZoningMap}
        onParcelSelect={jumpToParcel}
        mapMode={mapMode}
        showParcelLabels={showParcelLabels}
        showGrid={showGrid}
        showDimensions={showDimensions}
        showFloodplain={showFloodplain}
        showZoning={showZoning}
        parcelRenderProfile={parcelRenderProfile}
        onPointerDown={handleMapPointerDown}
        onWheel={handleMapWheel}
        isDragging={isDragging}
        earthIntroActive={earthIntroActive}
        mapApiRef={mapApiRef}
        onViewportChange={earthIntroActive ? null : handleLiveMapViewportChange}
        globeControlsRef={globeControlsRef}
      />
      <TopBar
        mapMode={mapMode}
        earthIntroActive={earthIntroActive}
        onOpenTools={onOpenTools}
        onParcelView={enterDallasParcelMode}
        onValueView={() => setMapMode("value")}
        onExit={onExit}
        onCreListings={() => onOpenMarketplace?.("cre")}
        onResidentialListings={() => onOpenMarketplace?.("resi")}
        onRentalListings={() => onOpenMarketplace?.("rentals")}
        onOpenCrm={onOpenCrm}
      />
      <SearchBar
        value={searchText}
        onChange={setSearchText}
        onSubmit={submitParcelSearch}
        onClear={clearParcelSearch}
        placeholder="What are you looking for"
        loading={searchLoading}
        reserveMapControls={!earthIntroActive}
      />
      <SearchStatusPanel
        searchText={findPlaceTarget(debouncedSearchText) ? "" : debouncedSearchText}
        searchResults={globalSearchResults}
        developmentResults={developmentResults}
        geocodedAddress={geocodedAddress}
        geocodingError={geocodingError}
        searchLoading={searchLoading}
        highestBestUseIntent={highestBestUseSearchIntent}
        onClear={clearParcelSearch}
        onSelectParcel={(parcel) => {
          setSelectedDevelopmentId("");
          if (highestBestUseSearchIntent) queueHighestBestUseIntent(highestBestUseSearchIntent);
          jumpToParcel(parcel);
        }}
        onSelectDevelopment={selectDevelopmentResult}
        onSelectGeocodedAddress={focusGeocodedAddress}
      />
      {!earthIntroActive && (
        <CompactMapControls
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onReset={resetCompass}
          onFindMyLocation={findMyLocation}
          locating={locating}
          locationStatus={locationStatus}
        />
      )}
      {selectedParcel && (
        <FocusedParcelCard
          parcel={selectedParcel}
          developmentRecord={selectedDevelopmentRecord}
          parcelZoning={selectedParcelZoning}
          parcelZoningLoading={selectedParcelZoningLoading}
          parcelZoningLoaded={selectedParcelZoningLoaded}
          parcelZoningError={selectedParcelZoningError}
          parcelFloodplain={selectedParcelFloodplain}
          parcelFloodplainLoading={selectedParcelFloodplainLoading}
          parcelFloodplainLoaded={selectedParcelFloodplainLoaded}
          parcelFloodplainError={selectedParcelFloodplainError}
          permitRecords={selectedParcelPermits}
          permitsLoading={selectedParcelPermitsLoading}
          permitsError={selectedParcelPermitsError}
          decisionToolIntent={highestBestUseSearchIntent}
          onClose={() => {
            clearSelectedParcelState();
            setSelectedParcelMapFocusEnabled(true);
          }}
        />
      )}
      {!earthIntroActive && (
        <AerialLayerControls
          showParcelLabels={showParcelLabels}
          setShowParcelLabels={setShowParcelLabels}
          showGrid={showGrid}
          setShowGrid={setShowGrid}
          showDimensions={showDimensions}
          setShowDimensions={setShowDimensions}
          showFloodplain={showFloodplain}
          setShowFloodplain={setShowFloodplain}
          showZoning={showZoning}
          setShowZoning={setShowZoning}
        />
      )}
      {landingEarthOverlayVisible && (
        <div
          className="pointer-events-none absolute inset-0 z-50 overflow-hidden bg-black transition-opacity duration-[1600ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
          data-landing-earth-preserved="true"
          onTransitionEnd={() => {
            if (landingEarthOverlayFading) setLandingEarthOverlayVisible(false);
          }}
          style={{ opacity: landingEarthOverlayFading ? 0 : 1 }}
        >
          <img src="/assets/earth-blue-marble-2048.png" alt="Earth" className="h-full w-full object-cover scale-110" draggable="false" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/40 to-black/80" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,rgba(34,197,94,0.15),transparent_25%),radial-gradient(circle_at_70%_50%,rgba(59,130,246,0.12),transparent_25%)]" />
        </div>
      )}
    </div>
  );
}

export default function WhiteRabbitLanding() {
  const [enteredMap, setEnteredMap] = useState(false);
  const [activeListingPage, setActiveListingPage] = useState(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    const type = params.get("type");
    return params.get("listing") && ["cre", "resi", "rentals"].includes(type) ? type : "";
  });
  const [memberSession, setMemberSession] = useState(() => readMemberAccessSession());
  const [crmOpen, setCrmOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [landingSearch, setLandingSearch] = useState("");
  const [landingDatasetId, setLandingDatasetId] = useState("");
  const [memberAccessOpen, setMemberAccessOpen] = useState(false);
  const [memberAccessMode, setMemberAccessMode] = useState("login");

  const openMemberAccess = (mode) => {
    setMemberAccessMode(mode);
    setMemberAccessOpen(true);
  };

  const openListingPage = (listingKind) => {
    setActiveListingPage(listingKind);
  };

  const openListingMap = (query, sourceCountyId = "") => {
    setLandingSearch(query || "");
    setLandingDatasetId(sourceCountyId || "");
    setActiveListingPage("");
    setEnteredMap(true);
    setCrmOpen(false);
    setToolsOpen(false);
  };

  const openCrm = () => {
    setEnteredMap(false);
    setActiveListingPage("");
    setCrmOpen(true);
    setToolsOpen(false);
  };

  const openTools = () => {
    setEnteredMap(false);
    setActiveListingPage("");
    setCrmOpen(false);
    setToolsOpen(true);
  };

  if (enteredMap) {
    return (
      <WhiteRabbitMap
        initialSearch={landingSearch}
        initialDatasetId={landingDatasetId}
        onExit={() => setEnteredMap(false)}
        onOpenMarketplace={(listingKind = "cre") => {
          setEnteredMap(false);
          setActiveListingPage(listingKind);
        }}
        onOpenCrm={openCrm}
        onOpenTools={openTools}
      />
    );
  }

  if (crmOpen) {
    return <CrmPage logo={<RabbitLogo />} onBack={() => setCrmOpen(false)} onOpenMap={openListingMap} />;
  }

  if (toolsOpen) {
    return <SavantToolsPage logo={<RabbitLogo />} onBack={() => setToolsOpen(false)} onOpenMap={(query = "", sourceCountyId = "") => openListingMap(query, sourceCountyId)} onOpenCrm={openCrm} />;
  }

  if (activeListingPage) {
    return (
      <CommercialMarketplacePage
        listingKind={activeListingPage}
        onBack={() => setActiveListingPage("")}
        onOpenMap={openListingMap}
        onOpenListingKind={openListingPage}
        memberSession={memberSession}
        onMemberLogout={() => setMemberSession(null)}
        onMemberUpdate={setMemberSession}
      />
    );
  }

  return (
    <div className="relative h-screen w-full overflow-hidden bg-black text-white">
      <div className="absolute inset-0">
        <img
          src="https://images.unsplash.com/photo-1526772662000-3f88f10405ff?auto=format&fit=crop&w=2000&q=80"
          alt="Mountain overlook"
          className="h-full w-full object-cover scale-110 animate-[pulse_20s_ease-in-out_infinite]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/40 to-black/80" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,rgba(34,197,94,0.15),transparent_25%),radial-gradient(circle_at_70%_50%,rgba(59,130,246,0.12),transparent_25%)]" />
      </div>
      <header className="absolute top-0 z-20 flex w-full items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={openTools}
            aria-label="Open Savant Tools"
            title="Open Savant Tools"
            className="transition hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-white/50"
            data-rabbit-action="open-savant-tools"
          >
            <RabbitLogo />
          </button>
          <span className="text-xs font-semibold tracking-[0.08em] text-white/85">{PLATFORM_IDENTITY.name}</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={openTools} className="px-3 py-2 text-xs text-white/80 transition hover:text-white">Savant Tools</button>
          <button onClick={openCrm} className="px-3 py-2 text-xs text-white/80 transition hover:text-white">CRM</button>
          <button onClick={() => openListingPage("cre")} className="px-3 py-2 text-xs text-white/80 transition hover:text-white">CRE Listings</button>
          <button onClick={() => openListingPage("resi")} className="px-3 py-2 text-xs text-white/80 transition hover:text-white">Resi Listings</button>
          <button onClick={() => openListingPage("rentals")} className="px-3 py-2 text-xs text-white/80 transition hover:text-white">Rentals</button>
          {memberSession ? (
            <button onClick={() => openListingPage("cre")} className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/15" data-landing-member-account="true"><UserRound aria-hidden="true" size={14} />{memberSession.displayName}</button>
          ) : (
            <div className="flex items-center gap-1 rounded-xl border border-white/15 bg-black/25 p-1 backdrop-blur-md" data-landing-member-access="true">
              <button type="button" onClick={() => openMemberAccess("login")} className="rounded-lg px-3 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/10 hover:text-white">Log in</button>
              <button type="button" onClick={() => openMemberAccess("signup")} className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black transition hover:bg-cyan-50">Sign up</button>
            </div>
          )}
        </div>
      </header>
      <SearchBar
        value={landingSearch}
        onChange={setLandingSearch}
        onSubmit={() => setEnteredMap(true)}
        placeholder="What are you looking for"
      />
      <div className="absolute bottom-6 left-6 z-30 max-w-sm">
        <div className="rounded-2xl border border-white/10 bg-black/50 p-5 backdrop-blur-xl">
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Commercial Intelligence</p>
          <h2 className="mt-2 text-xl font-semibold">Explore the Market from Above</h2>
          <p className="mt-2 text-sm text-white/70">Explore parcels, track developments, and visualize market movement in a live aerial environment.</p>
          <button onClick={() => setEnteredMap(true)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-white py-2 text-sm font-medium text-black transition hover:scale-[1.01]"><span>Enter Map</span><span aria-hidden="true">↗</span></button>
        </div>
      </div>
      {memberAccessOpen && (
        <MemberAccessGate
          initialMode={memberAccessMode}
          onCancel={() => setMemberAccessOpen(false)}
          onAccessGranted={(session) => {
            setMemberSession(session);
            setMemberAccessOpen(false);
          }}
        />
      )}
    </div>
  );
}

export type CountyDatasetConfig = {
  id: string;
  countyName: string;
  appraisalDistrictName: string;
  appraisalDistrictAcronym: string;
  active: boolean;
  universalParcelSchema: {
    version: string;
  };
  map: {
    locationId: number;
    locationName: string;
    locationType: string;
    status: string;
    coordinates: [number, number];
    camera: { x: number; y: number; zoom: number; pitch: number; bearing: number };
    geoBounds: {
      minLng: number;
      minLat: number;
      maxLng: number;
      maxLat: number;
    };
  };
  dataRoots: {
    parcels: string;
    permits: string;
    developments: string;
    zoning: string;
    floodplain: string;
  };
  publicManifests: {
    parcels: string;
    permits: string;
    developments: string;
    zoning: string;
    floodplain: string;
  };
  productionOutputs: {
    parcelGeojson: string;
    parcelPmtiles: string;
    vectorTilesDirectory: string;
  };
  optionalLayers?: Array<{
    id: string;
    label: string;
    source: string;
    status: string;
    joinBehavior: string;
    defaultVisible: boolean;
    publicDataRoot?: string;
    manifestPath?: string;
    parcelIndexPath?: string;
    schemaPath?: string;
    parcelIndexSchemaPath?: string;
    reportPath?: string;
    sourceUrls?: string[];
    renderStrategy?: string;
    maxFeaturesPerViewport?: number;
  }>;
  joinKeys: {
    primaryParcelAccount: string;
    appraisal: string;
    land: string;
    secondaryParcelGisId: string;
    blockLabels: string;
    dimensions: string;
    permits: string;
    zoning: string;
    floodplain: string;
  };
  verifiedCounts: {
    parcelGeometryFeatures: number;
    dcadAccountRows: number;
    dcadAppraisalRows: number;
    dcadLandRows: number;
    appParcelChunks: number;
    parcelSearchShards: number;
    sourcePermitRecords: number;
    permitRowsJoined: number;
    permitRowsUnmatched: number;
    parcelsWithDevelopmentSignals: number;
  };
};

export const activeCountyDataset: CountyDatasetConfig = {
  id: "dallas-county-dcad",
  countyName: "Dallas County",
  appraisalDistrictName: "Dallas County Appraisal District",
  appraisalDistrictAcronym: "DCAD",
  active: true,
  universalParcelSchema: {
    version: "wr-universal-parcel-v1",
  },
  map: {
    locationId: 2,
    locationName: "Dallas County DCAD Zone",
    locationType: "Dallas County Appraisal District",
    status: "2026 current extract loaded",
    coordinates: [-96.797, 32.7767],
    camera: { x: 46.6, y: 54.7, zoom: 1.64, pitch: 48, bearing: 0 },
    geoBounds: {
      minLng: -97.1,
      minLat: 32.55,
      maxLng: -96.45,
      maxLat: 33.05,
    },
  },
  dataRoots: {
    parcels: "/data/parcels/",
    permits: "/data/permits/",
    developments: "/data/developments/",
    zoning: "/data/zoning/",
    floodplain: "/data/floodplain/",
  },
  publicManifests: {
    parcels: "/data/parcels/manifest.json",
    permits: "/data/permits/manifest.json",
    developments: "/data/developments/parcel-development-index.json",
    zoning: "/data/zoning/manifest.json",
    floodplain: "/data/floodplain/manifest.json",
  },
  productionOutputs: {
    parcelGeojson: "output/white-rabbit-dallas-parcels.geojson",
    parcelPmtiles: "output/white-rabbit-dallas-parcels.pmtiles",
    vectorTilesDirectory: "output/vector-tiles/",
  },
  optionalLayers: [
    {
      id: "block-labels",
      label: "Block labels",
      source: "BLKID",
      status: "available",
      joinBehavior: "spatial/nearest-label",
      defaultVisible: true,
    },
    {
      id: "parcel-dimensions",
      label: "Parcel dimensions",
      source: "ParcelDimension",
      status: "available",
      joinBehavior: "spatial/nearest-label",
      defaultVisible: false,
    },
    {
      id: "permits",
      label: "Permits and certificates of occupancy",
      source: "City of Dallas OpenData",
      status: "available",
      joinBehavior: "address match to county parcel/account identifiers",
      defaultVisible: false,
    },
    {
      id: "development-signals",
      label: "Development signals",
      source: "White Rabbit development intelligence",
      status: "available",
      joinBehavior: "county parcel/account identifier",
      defaultVisible: false,
    },
    {
      id: "dallas-zoning-intelligence",
      label: "Dallas zoning intelligence",
      source: "City of Dallas Public Zoning ArcGIS services",
      status: "metadata-ready",
      joinBehavior: "ACCT/GIS_ACCT to accountNum/gisParcelId first; spatial join for zoning polygons and case areas",
      defaultVisible: false,
      publicDataRoot: "/data/zoning/",
      manifestPath: "public/data/zoning/manifest.json",
      parcelIndexPath: "public/data/zoning/parcel-zoning-index.json",
      schemaPath: "data/schemas/dallas-zoning-layer.schema.json",
      parcelIndexSchemaPath: "data/schemas/parcel-zoning-index.schema.json",
      reportPath: "output/dallas-zoning-source-report.md",
      sourceUrls: [
        "https://developmentweb.dallascityhall.com/publiczoningweb/",
        "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/4",
        "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/9",
        "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/11",
        "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/15",
        "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/AreasOfRequest/FeatureServer/10",
      ],
      renderStrategy: "build-time fetch, offline join, viewport chunks, capped runtime loader",
      maxFeaturesPerViewport: 750,
    },
    {
      id: "dallas-floodplain-intelligence",
      label: "Dallas floodplain intelligence",
      source: "City of Dallas Current Floodplain ArcGIS service",
      status: "parcel-index-ready",
      joinBehavior: "parcel centroid spatial join to official Dallas floodplain polygons; keyed back to countyParcelId/accountNum",
      defaultVisible: false,
      publicDataRoot: "/data/floodplain/",
      manifestPath: "public/data/floodplain/manifest.json",
      parcelIndexPath: "public/data/floodplain/parcel-floodplain-index.json",
      schemaPath: "data/schemas/parcel-floodplain-index.schema.json",
      parcelIndexSchemaPath: "data/schemas/parcel-floodplain-index.schema.json",
      reportPath: "output/dallas-parcel-floodplain-index-report.md",
      sourceUrls: [
        "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/ArcGIS/rest/services/Current_Floodplain/FeatureServer",
        "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/ArcGIS/rest/services/Current_Floodplain/FeatureServer/0",
      ],
      renderStrategy: "build-time ArcGIS fetch, offline parcel centroid spatial join, viewport-safe sharded parcel ID lookup, capped runtime loader",
      maxFeaturesPerViewport: 750,
    },
  ],
  joinKeys: {
    primaryParcelAccount: "PARCEL_GEOM.Acct -> DCAD ACCOUNT_INFO.ACCOUNT_NUM",
    appraisal: "PARCEL_GEOM.Acct -> DCAD ACCOUNT_APPRL_YEAR.ACCOUNT_NUM",
    land: "PARCEL_GEOM.Acct -> DCAD LAND.ACCOUNT_NUM",
    secondaryParcelGisId: "PARCEL_GEOM.Acct -> DCAD GIS_PARCEL_ID",
    blockLabels: "BLKID spatial/nearest-label join; no direct parcel ID field in inspected schema",
    dimensions: "ParcelDimension spatial/nearest-label join; no direct parcel ID field in inspected schema",
    permits: "City of Dallas permit/CO address match joined back to DCAD parcel/account identifiers",
    zoning: "City of Dallas zoning ACCT/GIS_ACCT bridge to accountNum/gisParcelId; spatial fallback for zoning polygons and case areas",
    floodplain: "City of Dallas Current Floodplain parcel centroid spatial join keyed back to countyParcelId/accountNum",
  },
  verifiedCounts: {
    parcelGeometryFeatures: 696601,
    dcadAccountRows: 861357,
    dcadAppraisalRows: 861348,
    dcadLandRows: 749625,
    appParcelChunks: 1614,
    parcelSearchShards: 1224,
    sourcePermitRecords: 150571,
    permitRowsJoined: 97300,
    permitRowsUnmatched: 53271,
    parcelsWithDevelopmentSignals: 24950,
  },
};

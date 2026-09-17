import { createUserListing, USER_LISTING_KINDS } from "./userListings.mjs";

export const LISTING_IMPORT_VERSION = "wr-user-listing-csv-import-v1";

const FIELD_ALIASES = {
  propertyName: ["property name", "listing name", "name", "property", "title"],
  address: ["property address", "listing address", "street address", "address"],
  county: ["county", "county name"],
  city: ["city", "municipality"],
  state: ["state", "state code"],
  market: ["market", "metro", "area"],
  status: ["status", "listing status"],
  assetType: ["asset type", "property type", "type"],
  priceLabel: ["price label", "display price"],
  askingPrice: ["asking price", "list price", "listing price", "price"],
  estimatedMarketValue: ["estimated market value", "market value", "estimated value", "arv"],
  annualNoi: ["annual noi", "noi", "net operating income"],
  monthlyRent: ["monthly rent", "rent"],
  marketMonthlyRent: ["market monthly rent", "market rent", "comp rent"],
  monthlyExpenses: ["monthly expenses", "expenses"],
  sizeLabel: ["size", "size label", "building size", "square feet", "sq ft", "sqft"],
  landLabel: ["land", "land size", "lot size", "acreage", "acres"],
  capRate: ["cap rate", "lease terms", "use"],
  yearBuilt: ["year built", "built"],
  zoning: ["zoning", "zone"],
  parcelId: ["parcel id", "parcel", "apn", "account number"],
  coordinates: ["coordinates", "lat lng", "latitude longitude"],
  latitude: ["latitude", "lat"],
  longitude: ["longitude", "lng", "lon", "long"],
  tags: ["tags", "features", "labels"],
  highlight: ["description", "highlight", "remarks", "notes"],
  image: ["image", "image url", "photo", "photo url"],
  contactName: ["contact name", "listing contact", "agent", "agent name", "owner"],
  contactEmail: ["contact email", "email", "agent email", "owner email"],
  contactPhone: ["contact phone", "phone", "agent phone", "owner phone"],
};

function normalizedHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function parseCsvRows(source) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const text = String(source || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value); value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value); value = "";
      if (row.some((cell) => String(cell).trim())) rows.push(row);
      row = [];
    } else value += character;
  }
  row.push(value);
  if (row.some((cell) => String(cell).trim())) rows.push(row);
  return rows;
}

function fieldValue(record, aliases) {
  for (const alias of aliases) {
    const value = record[normalizedHeader(alias)];
    if (String(value || "").trim()) return String(value).trim();
  }
  return "";
}

function listingIdentity(record) {
  return [record.listingKind, record.propertyName, record.address, record.county]
    .map((value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
}

function hasAlias(headers, field) {
  return FIELD_ALIASES[field].some((alias) => headers.includes(normalizedHeader(alias)));
}

export function importUserListingsFromCsv(csvText, listingKind, existingRecords = [], options = {}) {
  if (!USER_LISTING_KINDS.has(listingKind)) throw new TypeError("CSV listings are supported on CRE, residential, and rental pages only.");
  const rows = parseCsvRows(csvText);
  const emptyResult = { schemaVersion: LISTING_IMPORT_VERSION, records: [...existingRecords], imported: 0, skipped: 0, invalid: 0 };
  if (rows.length < 2) return { ...emptyResult, error: "The CSV does not contain a header and listing rows." };
  const headers = rows[0].map(normalizedHeader);
  const missing = ["propertyName", "address", "county"].filter((field) => !hasAlias(headers, field));
  if (missing.length) return { ...emptyResult, error: "The CSV must include Property Name, Address, and County columns." };

  const now = options.now || new Date().toISOString();
  const identities = new Set(existingRecords.map(listingIdentity));
  const importedRecords = [];
  let skipped = 0;
  let invalid = 0;

  rows.slice(1).forEach((values, rowIndex) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
    const draft = Object.fromEntries(Object.entries(FIELD_ALIASES).map(([field, aliases]) => [field, fieldValue(record, aliases)]));
    if (!draft.coordinates && draft.latitude && draft.longitude) draft.coordinates = `${draft.latitude}, ${draft.longitude}`;
    try {
      const listing = createUserListing(draft, listingKind, {
        id: `csv-listing-${Date.parse(now) || Date.now()}-${rowIndex + 1}`,
        now,
        ownerMemberId: options.ownerMemberId,
        ownerDisplayName: options.ownerDisplayName,
      });
      const identity = listingIdentity(listing);
      if (identities.has(identity)) { skipped += 1; return; }
      identities.add(identity);
      importedRecords.push(listing);
    } catch {
      invalid += 1;
    }
  });

  return { ...emptyResult, records: [...importedRecords, ...existingRecords], imported: importedRecords.length, skipped, invalid, error: "" };
}

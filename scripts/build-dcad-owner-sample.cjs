const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { parse } = require("csv-parse");

const downloads = "C:/Users/ernes/Downloads";
const dcadZip = path.join(downloads, "DCAD2026_CURRENT.ZIP");
const outFile = path.join(__dirname, "..", "src", "data", "dcadOwnerParcels.json");

const targetAccounts = new Set([
  "008052000B01A0000",
  "00000155887000000",
  "00000182602000000",
  "00000156442000000",
]);

function normalizeAccount(value) {
  return String(value || "").trim().toUpperCase();
}

function money(value) {
  const numeric = Number.parseFloat(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function firstNonEmpty(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function streamZipCsv(entryName) {
  return new Promise((resolve, reject) => {
    const rows = new Map();
    const tar = spawn("tar", ["-xOf", dcadZip, entryName]);
    const parser = parse({
      columns: true,
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
    });

    tar.stdout.pipe(parser);

    parser.on("data", (row) => {
      const account = normalizeAccount(row.ACCOUNT_NUM);
      if (targetAccounts.has(account) && !rows.has(account)) rows.set(account, row);
    });

    parser.on("error", reject);
    tar.on("error", reject);
    tar.on("close", () => resolve(rows));
  });
}

async function main() {
  const accountById = await streamZipCsv("ACCOUNT_INFO.CSV");
  const appraisalById = await streamZipCsv("ACCOUNT_APPRL_YEAR.CSV");
  const landById = await streamZipCsv("LAND.CSV");

  const parcels = [...targetAccounts].map((accountNum) => {
    const account = accountById.get(accountNum);
    const appraisal = appraisalById.get(accountNum);
    const land = landById.get(accountNum);

    if (!account) throw new Error(`Missing ACCOUNT_INFO row for ${accountNum}`);

    return {
      accountNum,
      gisParcelId: firstNonEmpty(account.GIS_PARCEL_ID, appraisal?.GIS_PARCEL_ID, accountNum),
      ownerName: firstNonEmpty(account.OWNER_NAME1, account.BIZ_NAME),
      ownerName2: firstNonEmpty(account.OWNER_NAME2, account.OWNER_ADDRESS_LINE1),
      businessName: firstNonEmpty(account.BIZ_NAME),
      ownerMailingAddress: [account.OWNER_ADDRESS_LINE1, account.OWNER_ADDRESS_LINE2, account.OWNER_ADDRESS_LINE3, account.OWNER_ADDRESS_LINE4]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(", "),
      ownerCity: firstNonEmpty(account.OWNER_CITY),
      ownerState: firstNonEmpty(account.OWNER_STATE),
      ownerZip: firstNonEmpty(account.OWNER_ZIPCODE),
      propertyAddress: [account.STREET_NUM, account.STREET_HALF_NUM, account.FULL_STREET_NAME, account.BLDG_ID, account.UNIT_ID]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(" "),
      propertyCity: firstNonEmpty(account.PROPERTY_CITY),
      propertyZip: firstNonEmpty(account.PROPERTY_ZIPCODE),
      neighborhood: firstNonEmpty(account.NBHD_CD),
      legal: [account.LEGAL1, account.LEGAL2, account.LEGAL3, account.LEGAL4, account.LEGAL5]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(" "),
      deedTransferDate: firstNonEmpty(account.DEED_TXFR_DATE),
      division: firstNonEmpty(account.DIVISION_CD),
      totalValue: money(appraisal?.TOT_VAL),
      improvementValue: money(appraisal?.IMPR_VAL),
      landValue: money(appraisal?.LAND_VAL),
      cityJurisdiction: firstNonEmpty(appraisal?.CITY_JURIS_DESC),
      countyJurisdiction: firstNonEmpty(appraisal?.COUNTY_JURIS_DESC),
      isdJurisdiction: firstNonEmpty(appraisal?.ISD_JURIS_DESC),
      buildingClassCode: firstNonEmpty(appraisal?.BLDG_CLASS_CD),
      landArea: money(land?.AREA_SIZE),
      landAreaUnit: firstNonEmpty(land?.AREA_UOM_DESC),
      frontage: money(land?.FRONT_DIM),
      depth: money(land?.DEPTH_DIM),
      zoning: firstNonEmpty(land?.ZONING),
      sptdDescription: firstNonEmpty(land?.SPTD_DESC),
    };
  });

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), parcels }, null, 2));
  console.log(`Wrote ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

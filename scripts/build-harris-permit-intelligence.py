#!/usr/bin/env python3
"""Build a conservative Houston 2024 permit-to-Harris-parcel index.

The City workbooks do not contain HCAD account numbers. This builder therefore
accepts only a unique exact normalized situs-address match. Ambiguous and
unmatched permits are retained in QA output and never attributed to a parcel.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "harris-county-tx" / "permits"
PARCEL_ROOT = ROOT / "public" / "data" / "counties" / "harris-county-tx" / "parcels"
PUBLIC_ROOT = ROOT / "public" / "data" / "counties" / "harris-county-tx" / "permits"
OUTPUT_ROOT = ROOT / "output" / "harris-county-tx"
ADAPTER_PATH = ROOT / "data" / "county-adapters" / "harris-county-tx" / "adapter.json"
SOURCE_MANIFEST_PATH = ROOT / "data" / "county-adapters" / "harris-county-tx" / "houston-permit-source-manifest.json"

SOURCES = [
    ("single-family", "SF-Permits-2024.xlsx", "https://houstontx.gov/planning/Demographics/docs_pdfs/SF-Permits-2024.xlsx"),
    ("multifamily", "MF-Permits-2024.xlsx", "https://houstontx.gov/planning/Demographics/docs_pdfs/MF-Permits-2024.xlsx"),
    ("demolition", "DM-Permits-2024.xlsx", "https://houstontx.gov/planning/Demographics/docs_pdfs/DM-Permits-2024.xlsx"),
]

SUFFIXES = {
    "STREET": "ST", "ROAD": "RD", "AVENUE": "AVE", "BOULEVARD": "BLVD",
    "DRIVE": "DR", "LANE": "LN", "COURT": "CT", "PLACE": "PL",
    "PARKWAY": "PKWY", "HIGHWAY": "HWY", "TRAIL": "TRL", "CIRCLE": "CIR",
    "TERRACE": "TER", "WAY": "WAY", "FREEWAY": "FWY",
}


def clean_value(value):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    text = str(value).strip()
    return re.sub(r"\.0$", "", text)


def normalize_address(value):
    text = clean_value(value).upper()
    text = re.sub(r"\b(APT|UNIT|SUITE|STE|#)\s*[A-Z0-9-]+.*$", "", text)
    text = re.sub(r"[^A-Z0-9 ]+", " ", text)
    parts = [SUFFIXES.get(part, part) for part in text.split()]
    return " ".join(parts)


def row_address(row):
    direct = clean_value(row.get("ADDRESS"))
    if direct:
        return direct
    return " ".join(filter(None, [
        clean_value(row.get("SITUS_STR_NO")), clean_value(row.get("SITUS_STR_NOFR")),
        clean_value(row.get("SITUS_PRE_DIR")), clean_value(row.get("SITUS_STR_NAME")),
        clean_value(row.get("SITUS_STR_TYPE")), clean_value(row.get("SITUS_POST_DIR")),
    ]))


def date_text(value):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    if isinstance(value, (int, float)):
        parsed = pd.Timestamp("1899-12-30") + pd.to_timedelta(float(value), unit="D")
    else:
        parsed = pd.to_datetime(value, errors="coerce")
    return "" if pd.isna(parsed) else parsed.date().isoformat()


def number_value(value):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_permits():
    permits = []
    source_rows = {}
    source_files = []
    for category, filename, url in SOURCES:
        path = RAW / filename
        if not path.exists():
            raise FileNotFoundError(f"Missing official Houston permit workbook: {path}")
        frame = pd.read_excel(path)
        source_rows[category] = len(frame)
        source_files.append({"category": category, "file": str(path.relative_to(ROOT)).replace("\\", "/"), "url": url, "sha256": sha256(path), "rows": len(frame)})
        for _, row in frame.iterrows():
            address = row_address(row)
            project = clean_value(row.get("PROJECT_NO"))
            permits.append({
                "permitId": project,
                "category": category,
                "description": clean_value(row.get("PRMT_DESC")) or category,
                "issueDate": date_text(row.get("SOLD_DATE")),
                "address": address,
                "normalizedAddress": normalize_address(address),
                "zip": clean_value(row.get("SITUS_ZIP_CODE")) or clean_value(row.get("ZIP")),
                "estimatedValue": number_value(row.get("ESTIMATED_VAL")),
                "dwellingCount": number_value(row.get("DWELLINGS_CNT")),
                "buildingCount": number_value(row.get("BUILDING_CNT")),
                "sourceFile": filename,
                "sourceUrl": url,
            })
    return permits, source_rows, source_files


def scan_parcels(wanted_addresses):
    manifest = json.loads((PARCEL_ROOT / "manifest.json").read_text(encoding="utf-8"))
    candidates = defaultdict(list)
    scanned = 0
    for chunk in manifest["chunks"]:
        payload = json.loads((PARCEL_ROOT / chunk["file"]).read_text(encoding="utf-8"))
        for parcel in payload.get("parcels", []):
            scanned += 1
            normalized = normalize_address(parcel.get("propertyAddress") or parcel.get("address"))
            if normalized in wanted_addresses:
                candidates[normalized].append({
                    "parcelId": parcel.get("accountNum") or parcel.get("accountNumber") or parcel.get("sourceParcelId"),
                    "countyParcelId": parcel.get("countyParcelId"),
                    "gisParcelId": parcel.get("gisParcelId"),
                    "address": parcel.get("propertyAddress") or parcel.get("address"),
                })
    return candidates, scanned, manifest


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main():
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    permits, source_rows, source_files = read_permits()
    wanted = {item["normalizedAddress"] for item in permits if item["normalizedAddress"]}
    candidates, scanned, parcel_manifest = scan_parcels(wanted)

    joined, unmatched, ambiguous = [], [], []
    for permit in permits:
        matches = candidates.get(permit["normalizedAddress"], [])
        unique = {m["parcelId"]: m for m in matches if m.get("parcelId")}
        if len(unique) == 1:
            parcel = next(iter(unique.values()))
            joined.append({**permit, **parcel, "joinMethod": "unique-exact-normalized-situs-address"})
        elif len(unique) > 1:
            ambiguous.append({**permit, "candidateParcelIds": sorted(unique)})
        else:
            unmatched.append(permit)

    by_parcel = defaultdict(list)
    for record in joined:
        public_record = {key: value for key, value in record.items() if key != "normalizedAddress"}
        by_parcel[record["parcelId"]].append(public_record)

    for old in PUBLIC_ROOT.glob("parcel-permits-*.json") if PUBLIC_ROOT.exists() else []:
        old.unlink()
    PUBLIC_ROOT.mkdir(parents=True, exist_ok=True)
    shard_rows = defaultdict(dict)
    for parcel_id, records in by_parcel.items():
        key = hashlib.sha256(parcel_id.encode("utf-8")).hexdigest()[:2]
        shard_rows[key][parcel_id] = records
    shards = []
    for key, rows in sorted(shard_rows.items()):
        filename = f"parcel-permits-{key}.json"
        write_json(PUBLIC_ROOT / filename, {"schemaVersion": "wr-harris-permit-index-v1", "records": rows})
        shards.append({"id": key, "file": filename, "parcelCount": len(rows), "permitCount": sum(len(v) for v in rows.values())})

    counts = {
        "sourcePermitRecords": len(permits),
        "permitRowsJoined": len(joined),
        "permitRowsUnmatched": len(unmatched),
        "permitRowsAmbiguous": len(ambiguous),
        "parcelsWithPermits": len(by_parcel),
        "parcelRecordsScanned": scanned,
        "sourceParcelRecords": parcel_manifest.get("featureCount"),
    }
    manifest = {
        "schemaVersion": "wr-harris-permit-index-v1",
        "generatedAt": generated_at,
        "status": "ready-historical-2024-refresh-required",
        "coverage": "City of Houston 2024 single-family, multifamily, and demolition permits; not all Harris County jurisdictions and not certificates of occupancy",
        "freshnessWarning": "The official 2025 workbook links returned HTTP 404 when checked in September 2026. This historical layer must not be represented as current permit coverage.",
        "joinKey": "unique exact normalized situs address -> HCAD parcel accountNum",
        "counts": counts,
        "sourceRowsByCategory": source_rows,
        "sourceFiles": source_files,
        "shards": shards,
    }
    write_json(PUBLIC_ROOT / "manifest.json", manifest)
    write_json(OUTPUT_ROOT / "harris-permit-report.json", {**manifest, "qaFiles": ["harris-permits-unmatched.json", "harris-permits-ambiguous.json"]})
    write_json(OUTPUT_ROOT / "harris-permits-unmatched.json", unmatched)
    write_json(OUTPUT_ROOT / "harris-permits-ambiguous.json", ambiguous)
    write_json(SOURCE_MANIFEST_PATH, {"schemaVersion": "wr-source-manifest-v1", "countyId": "harris-county-tx", "generatedAt": generated_at, "sources": source_files, "rightsNote": "Official City of Houston public planning workbooks; preserve source URLs and verify reuse terms before redistribution beyond derived parcel links."})

    report_md = f"""# Harris County permit intelligence report

Generated: {generated_at}

## Result

- Official 2024 permit rows: **{len(permits):,}**
- Unique exact address joins: **{len(joined):,}**
- Unmatched rows: **{len(unmatched):,}**
- Ambiguous rows quarantined: **{len(ambiguous):,}**
- Harris parcels with at least one joined permit: **{len(by_parcel):,}**
- Parcel records scanned: **{scanned:,}**

## Join rule

Only a unique exact normalized situs-address match is accepted. The source does not expose an HCAD account number. Ambiguous and unmatched rows are retained separately and never attributed to a parcel.

## Coverage limitation

This is historical City of Houston 2024 single-family, multifamily, and demolition activity. It is not countywide, does not include certificates of occupancy, and is not current. The official 2025 workbook links returned HTTP 404 when checked in September 2026.
"""
    (OUTPUT_ROOT / "harris-permit-report.md").write_text(report_md, encoding="utf-8")

    adapter = json.loads(ADAPTER_PATH.read_text(encoding="utf-8"))
    adapter["sourceFiles"]["permitsRaw"] = [item["url"] for item in source_files]
    adapter["sourceFiles"]["permitsProcessed"] = "public/data/counties/harris-county-tx/permits/manifest.json"
    for layer in adapter.get("optionalLayers", []):
        if layer.get("id") == "permits":
            layer.update({
                "source": "City of Houston Planning and Development 2024 single-family, multifamily, and demolition permit workbooks",
                "status": "ready-historical-2024-refresh-required",
                "joinBehavior": "unique exact normalized situs address to HCAD accountNum; ambiguous and unmatched records are quarantined; no CO coverage and no countywide claim",
                "reportPath": "output/harris-county-tx/harris-permit-report.md",
            })
    adapter["joinKeys"]["permits"] = "unique exact normalized situs address -> HCAD accountNum; 2024 City of Houston only; ambiguous matches excluded"
    adapter["verifiedCounts"].update(counts)
    ADAPTER_PATH.write_text(json.dumps(adapter, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(counts, indent=2))


if __name__ == "__main__":
    main()

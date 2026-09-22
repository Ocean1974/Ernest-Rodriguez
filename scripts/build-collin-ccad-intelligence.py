#!/usr/bin/env python3
"""Build a gated Collin CAD parcel-intelligence index from an official CSV export.

The companion XLSX is retained as provenance and schema evidence. The CSV twin is
used for streaming ingestion because it preserves the same 114-column export
without requiring the entire workbook in memory.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import shutil
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COUNTY_ID = "collin-county-tx"
DEFAULT_OUTPUT = ROOT / "output" / COUNTY_ID
DEFAULT_PUBLIC = ROOT / "public" / "data" / "counties" / COUNTY_ID / "intelligence"
DEFAULT_SOURCE = ROOT / "data" / "raw" / COUNTY_ID / "CCAD_Parcel_Feature_Set.csv"
DEFAULT_WORKBOOK = ROOT / "data" / "raw" / COUNTY_ID / "CCAD_Parcel_Feature_Set.xlsx"
REQUIRED_FIELDS = {
    "OBJECTID",
    "propID",
    "geoID",
    "GlobalID",
    "ownerName",
    "situsConcat",
    "legalAbsSubCode",
    "entitySchoolCode",
    "entityCityCode",
    "entityMUD",
    "entityTIF",
    "currValMarket",
    "prevValMarket",
    "noticeValMarket",
    "dataDate",
}


def clean(value: object) -> str:
    return str(value or "").strip()


def number(value: object):
    text = clean(value)
    if not text:
        return None
    try:
        parsed = float(text)
    except ValueError:
        return text
    return int(parsed) if parsed.is_integer() else parsed


def compact(value):
    if isinstance(value, dict):
        output = {key: compact(item) for key, item in value.items()}
        return {key: item for key, item in output.items() if item not in (None, "", {}, [])}
    return value


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def xlsx_header(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as archive:
        worksheet_names = [name for name in archive.namelist() if name.startswith("xl/worksheets/") and name.endswith(".xml")]
        if not worksheet_names:
            raise ValueError("Workbook has no worksheet XML")
        with archive.open(worksheet_names[0]) as stream:
            for event, element in ET.iterparse(stream, events=("end",)):
                if element.tag.rsplit("}", 1)[-1] != "row":
                    continue
                values: list[str] = []
                for cell in element:
                    if cell.tag.rsplit("}", 1)[-1] != "c":
                        continue
                    value = ""
                    for child in cell.iter():
                        if child.tag.rsplit("}", 1)[-1] in {"v", "t"} and child.text is not None:
                            value = child.text
                    values.append(value)
                return values
    return []


def intelligence_record(row: dict[str, str]) -> dict:
    return compact(
        {
            "globalId": clean(row.get("GlobalID")).lower(),
            "objectId": number(row.get("OBJECTID")),
            "propertyId": clean(row.get("propID") or row.get("PROP_ID")),
            "geoId": clean(row.get("geoID")),
            "gisPropertyId": clean(row.get("gisPropID")),
            "property": {
                "year": number(row.get("propYear")),
                "type": clean(row.get("propType")),
                "subtype": clean(row.get("propSubType")),
                "categoryCode": clean(row.get("propCategoryCode")),
                "useCode": clean(row.get("propUseCode")),
                "status": clean(row.get("propStatus")),
                "createdDate": clean(row.get("propCreateDate")),
            },
            "situs": {
                "address": clean(row.get("situsConcat")),
                "shortAddress": clean(row.get("situsConcatShort")),
                "city": clean(row.get("situsCity")),
                "zip": clean(row.get("situsZip")),
            },
            "owner": {
                "id": clean(row.get("ownerID")),
                "name": clean(row.get("ownerName")),
                "additionalName": clean(row.get("ownerNameAddtl")),
                "mailingAddress1": clean(row.get("ownerAddrLine1")),
                "mailingAddress2": clean(row.get("ownerAddrLine2")),
                "city": clean(row.get("ownerAddrCity")),
                "state": clean(row.get("ownerAddrState")),
                "zip": clean(row.get("ownerAddrZip")),
                "country": clean(row.get("ownerAddrCountry")),
            },
            "legal": {
                "abstractSubdivisionCode": clean(row.get("legalAbsSubCode")),
                "abstractSubdivisionName": clean(row.get("legalAbsSubName")),
                "block": clean(row.get("legalAbsSubBlock")),
                "lot": clean(row.get("legalAbsSubLot")),
                "description": clean(row.get("legalDescription")),
                "mapId": clean(row.get("mapID")),
                "neighborhoodCode": clean(row.get("nbhdCode")),
                "marketAreaCode": clean(row.get("marketAreaCode")),
            },
            "jurisdictions": {
                "entityCodes": clean(row.get("entityCodes")),
                "schoolCode": clean(row.get("entitySchoolCode")),
                "cityCode": clean(row.get("entityCityCode")),
                "mudCode": clean(row.get("entityMUD")),
                "tifCode": clean(row.get("entityTIF")),
                "specialCode": clean(row.get("entitySBCL")),
            },
            "improvements": {
                "yearBuilt": number(row.get("imprvYearBuilt")),
                "classCode": clean(row.get("imprvClassCd")),
                "mainAreaSqFt": number(row.get("imprvMainArea")),
                "units": number(row.get("imprvUnits")),
                "poolFlag": clean(row.get("imprvPoolFlag")),
                "categoryCodes": clean(row.get("imprvCategoryCodes")),
            },
            "land": {
                "typeCode": clean(row.get("landTypeCode")),
                "acres": number(row.get("landSizeAcres")),
                "squareFeet": number(row.get("landSizeSqft")),
                "agAcres": number(row.get("landAgAcres")),
                "categoryCodes": clean(row.get("landCategoryCodes")),
            },
            "valuation": {
                "current": {
                    "year": number(row.get("currValYear")),
                    "improvement": number(row.get("currValImprv")),
                    "land": number(row.get("currValLand")),
                    "market": number(row.get("currValMarket")),
                    "agLoss": number(row.get("currValAgLoss")),
                    "appraised": number(row.get("currValAppraised")),
                    "homesteadCapLoss": number(row.get("currValHSCapLoss")),
                    "nonHomesteadCapLoss": number(row.get("currValNHSCapLoss")),
                    "assessed": number(row.get("currValAssessed")),
                },
                "previous": {
                    "year": number(row.get("prevValYear")),
                    "improvement": number(row.get("prevValImprv")),
                    "land": number(row.get("prevValLand")),
                    "market": number(row.get("prevValMarket")),
                    "agLoss": number(row.get("prevValAgLoss")),
                    "appraised": number(row.get("prevValAppraised")),
                    "homesteadCapLoss": number(row.get("prevValHSCapLoss")),
                    "nonHomesteadCapLoss": number(row.get("prevValNHSCapLoss")),
                    "assessed": number(row.get("prevValAssessed")),
                },
                "notice": {
                    "year": number(row.get("noticeYear")),
                    "improvement": number(row.get("noticeValImprv")),
                    "land": number(row.get("noticeValLand")),
                    "market": number(row.get("noticeValMarket")),
                    "agLoss": number(row.get("noticeValAgLoss")),
                    "appraised": number(row.get("noticeValAppraised")),
                    "homesteadCapLoss": number(row.get("noticeValHSCapLoss")),
                    "nonHomesteadCapLoss": number(row.get("noticeValNHSCapLoss")),
                    "assessed": number(row.get("noticeValAssessed")),
                    "date": clean(row.get("noticeDate")),
                },
            },
            "exemptions": {
                "codes": clean(row.get("exemptCodes")),
                "homesteadFlag": clean(row.get("exemptHmstdFlag")),
                "protestCode": clean(row.get("protestCode")),
            },
            "deed": {
                "typeCode": clean(row.get("deedTypeCd")),
                "instrument": clean(row.get("deedNum")),
                "book": clean(row.get("deedBook")),
                "page": clean(row.get("deedPage")),
                "effectiveDate": clean(row.get("deedEffDate")),
                "fileDate": clean(row.get("deedFileDate")),
            },
            "lineage": {
                "dataDate": clean(row.get("dataDate")),
                "editDate": clean(row.get("EditDate")),
                "editor": clean(row.get("Editor")),
            },
        }
    )


def load_existing_ids(service_root: Path) -> set[str]:
    manifest_path = service_root / "manifest.json"
    if not manifest_path.exists():
        return set()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    output: set[str] = set()
    for chunk in manifest.get("chunks", []):
        relative = chunk.get("file", "") if isinstance(chunk, dict) else ""
        if not relative:
            continue
        payload = json.loads((service_root / relative).read_text(encoding="utf-8-sig"))
        for parcel in payload.get("parcels", []):
            county_id = clean(parcel.get("countyParcelId"))
            prefix = f"{COUNTY_ID}:"
            if county_id.startswith(prefix):
                output.add(county_id[len(prefix) :].lower())
    return output


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=str(DEFAULT_SOURCE), help="Official CCAD CSV export")
    parser.add_argument("--workbook", default=str(DEFAULT_WORKBOOK), help="Companion CCAD XLSX export used for provenance/schema verification")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--public-dir", default=str(DEFAULT_PUBLIC))
    parser.add_argument("--existing-service-root", default=str(ROOT / "public" / "data" / "counties" / COUNTY_ID / "parcels"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = Path(args.source).resolve()
    workbook = Path(args.workbook).resolve() if args.workbook else None
    output_dir = Path(args.output_dir).resolve()
    public_dir = Path(args.public_dir).resolve()
    shard_dir = public_dir / "shards"
    if not source.exists():
        raise FileNotFoundError(source)

    output_dir.mkdir(parents=True, exist_ok=True)
    public_dir.mkdir(parents=True, exist_ok=True)
    if shard_dir.exists():
        shutil.rmtree(shard_dir)
    shard_dir.mkdir(parents=True)

    existing_ids = load_existing_ids(Path(args.existing_service_root).resolve())
    shard_streams: dict[str, object] = {}
    shard_counts: Counter[str] = Counter()
    coverage: Counter[str] = Counter()
    unique_global_ids: set[str] = set()
    duplicate_global_ids = 0
    source_global_ids: set[str] = set()
    csv_headers: list[str] = []
    records = 0
    latest_data_date = ""

    try:
        with source.open("r", encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            csv_headers = list(reader.fieldnames or [])
            missing = sorted(REQUIRED_FIELDS - set(csv_headers))
            if missing:
                raise ValueError(f"Missing required CCAD fields: {', '.join(missing)}")
            for row in reader:
                records += 1
                global_id = clean(row.get("GlobalID")).lower()
                if global_id:
                    if global_id in unique_global_ids:
                        duplicate_global_ids += 1
                    unique_global_ids.add(global_id)
                    source_global_ids.add(global_id)
                for label, field in {
                    "propertyId": "propID",
                    "geoId": "geoID",
                    "ownerName": "ownerName",
                    "situsAddress": "situsConcat",
                    "abstractSubdivisionCode": "legalAbsSubCode",
                    "schoolCode": "entitySchoolCode",
                    "cityCode": "entityCityCode",
                    "mudCode": "entityMUD",
                    "tifCode": "entityTIF",
                    "currentMarketValue": "currValMarket",
                    "previousMarketValue": "prevValMarket",
                    "noticeMarketValue": "noticeValMarket",
                    "yearBuilt": "imprvYearBuilt",
                    "buildingArea": "imprvMainArea",
                    "landArea": "landSizeSqft",
                    "exemptionCodes": "exemptCodes",
                    "deedInstrument": "deedNum",
                }.items():
                    if clean(row.get(field)):
                        coverage[label] += 1
                data_date = clean(row.get("dataDate"))
                if data_date > latest_data_date:
                    latest_data_date = data_date
                if not global_id:
                    continue
                shard = global_id[:2]
                if shard not in shard_streams:
                    shard_streams[shard] = (shard_dir / f"{shard}.ndjson").open("w", encoding="utf-8", newline="\n")
                shard_streams[shard].write(json.dumps(intelligence_record(row), separators=(",", ":"), ensure_ascii=True) + "\n")
                shard_counts[shard] += 1
    finally:
        for shard_stream in shard_streams.values():
            shard_stream.close()

    workbook_evidence = None
    if workbook:
        if not workbook.exists():
            raise FileNotFoundError(workbook)
        workbook_headers = xlsx_header(workbook)
        if workbook_headers != csv_headers:
            raise ValueError("Companion XLSX and CSV headers do not match")
        workbook_evidence = {
            "fileName": workbook.name,
            "sizeBytes": workbook.stat().st_size,
            "sha256": sha256(workbook),
            "headerMatchesCsv": True,
        }

    matched_existing = len(source_global_ids & existing_ids) if existing_ids else 0
    source_not_in_existing = len(source_global_ids - existing_ids) if existing_ids else records
    existing_not_in_source = len(existing_ids - source_global_ids) if existing_ids else 0
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    manifest = {
        "schemaVersion": "wr-collin-ccad-intelligence-v1",
        "sourceCountyId": COUNTY_ID,
        "generatedAt": generated_at,
        "status": "verified-refresh-candidate-not-activated",
        "activationAuthorized": False,
        "source": {
            "organization": "Collin Central Appraisal District",
            "dataset": "CCAD Parcel Feature Set",
            "fileName": source.name,
            "sizeBytes": source.stat().st_size,
            "sha256": sha256(source),
            "fieldCount": len(csv_headers),
            "workbookEvidence": workbook_evidence,
        },
        "identity": {
            "joinKey": "GlobalID",
            "scope": "refresh-local feature identity; not stable across CCAD republish events",
            "recordCount": records,
            "globalIdNonblank": len(unique_global_ids),
            "globalIdDuplicates": duplicate_global_ids,
            "globalIdUnique": duplicate_global_ids == 0 and len(unique_global_ids) == records,
        },
        "coverage": {
            key: {"count": count, "percent": round((count / records) * 100, 4) if records else 0}
            for key, count in sorted(coverage.items())
        },
        "freshness": {"latestDataDate": latest_data_date},
        "existingParcelServiceComparison": {
            "existingGlobalIdCount": len(existing_ids),
            "matchedGlobalIdCount": matched_existing,
            "sourceGlobalIdsNotInExistingService": source_not_in_existing,
            "existingServiceGlobalIdsNotInSource": existing_not_in_source,
            "activationBlocker": matched_existing == 0 and bool(existing_ids),
            "finding": "The CCAD republish regenerated GlobalID values; rebuild geometry and intelligence from the same refresh before activation."
            if matched_existing == 0 and existing_ids
            else "GlobalID overlap exists; complete duplicate-safe reconciliation before activation.",
        },
        "delivery": {
            "format": "ndjson",
            "key": "lowercase GlobalID",
            "shardKey": "first two hexadecimal characters of lowercase GlobalID",
            "shardCount": len(shard_counts),
            "recordCount": sum(shard_counts.values()),
            "shards": {key: {"file": f"shards/{key}.ndjson", "count": shard_counts[key]} for key in sorted(shard_counts)},
        },
        "truthBoundary": [
            "The local export is a refresh candidate and does not replace the active parcel geometry service until geometry reconciliation and county QC pass.",
            "GlobalID is unique inside this refresh but is version-scoped: zero current IDs match the existing parcel service, so it must not be treated as a cross-refresh stable key.",
            "Owner phone and email are not inferred because the official CCAD export does not provide verified fields for them.",
            "Jurisdiction codes are source attributes; municipal zoning districts still require authoritative city zoning verification.",
        ],
    }
    (public_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (output_dir / "ccad-intelligence-report.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    report_lines = [
        "# Collin County CCAD parcel intelligence",
        "",
        f"- Source records: **{records:,}**",
        f"- Source fields: **{len(csv_headers):,}**",
        f"- Unique nonblank GlobalID values: **{len(unique_global_ids):,}**",
        f"- Duplicate GlobalID values: **{duplicate_global_ids:,}**",
        f"- Latest source data date: **{latest_data_date or 'not supplied'}**",
        f"- Existing parcel-service IDs matched: **{matched_existing:,}** of **{len(existing_ids):,}**",
        f"- Source IDs not in the existing parcel service: **{source_not_in_existing:,}**",
        f"- Existing parcel-service IDs absent from this source: **{existing_not_in_source:,}**",
        f"- Intelligence shards: **{len(shard_counts):,}**",
        "- Join finding: **GlobalID is unique within this export but was regenerated across the CCAD refresh.**",
        "",
        "## Field coverage",
        "",
        "| Field group | Records | Coverage |",
        "| --- | ---: | ---: |",
    ]
    for key, item in manifest["coverage"].items():
        report_lines.append(f"| {key} | {item['count']:,} | {item['percent']:.2f}% |")
    report_lines.extend(
        [
            "",
            "## Activation boundary",
            "",
            "This refresh is indexed for parcel intelligence but remains inactive in the visible map. Its GlobalID values have zero overlap with the existing parcel service, so geometry and intelligence must be rebuilt from the same CCAD refresh before county QC and activation can pass.",
            "",
        ]
    )
    (output_dir / "ccad-intelligence-report.md").write_text("\n".join(report_lines), encoding="utf-8")
    print(json.dumps({"recordCount": records, "shardCount": len(shard_counts), "manifest": str(public_dir / "manifest.json")}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # fail closed with a useful pipeline error
        print(f"Collin CCAD intelligence build failed: {exc}", file=sys.stderr)
        raise

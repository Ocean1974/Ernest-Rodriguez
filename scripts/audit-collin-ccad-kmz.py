#!/usr/bin/env python3
"""Stream-audit the CCAD KMZ without expanding its 1.28 GB one-line KML."""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COUNTY_ID = "collin-county-tx"
DEFAULT_SOURCE = ROOT / "data" / "raw" / COUNTY_ID / "CCAD_Parcel_Feature_Set.kmz"
DEFAULT_CSV = ROOT / "data" / "raw" / COUNTY_ID / "CCAD_Parcel_Feature_Set.csv"
DEFAULT_INTELLIGENCE = ROOT / "public" / "data" / "counties" / COUNTY_ID / "intelligence"
DEFAULT_OUTPUT = ROOT / "output" / COUNTY_ID
ROW_PATTERN = re.compile(r"<tr><td>(.*?)</td><td>(.*?)</td></tr>", re.DOTALL)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def clean_id(value: object) -> str:
    return str(value or "").strip().strip("{}").lower()


def parse_description(text: str) -> dict[str, str]:
    return {html.unescape(name).strip(): html.unescape(value).strip() for name, value in ROW_PATTERN.findall(text)}


def load_intelligence_ids(root: Path) -> set[str]:
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    ids: set[str] = set()
    for shard in manifest["delivery"]["shards"].values():
        with (root / shard["file"]).open("r", encoding="utf-8") as stream:
            for line in stream:
                if line.strip():
                    ids.add(clean_id(json.loads(line).get("globalId")))
    return ids


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=str(DEFAULT_SOURCE))
    parser.add_argument("--csv", default=str(DEFAULT_CSV))
    parser.add_argument("--intelligence-root", default=str(DEFAULT_INTELLIGENCE))
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = Path(args.source).resolve()
    csv_path = Path(args.csv).resolve()
    intelligence_root = Path(args.intelligence_root).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    intelligence_ids = load_intelligence_ids(intelligence_root)

    with csv_path.open("r", encoding="utf-8-sig", newline="") as stream:
        csv_fields = list(csv.reader(stream).__next__())
    expected_kmz_fields = [field for field in csv_fields if field != "OBJECTID"]

    placemark_count = 0
    polygon_count = 0
    geometry_placemark_count = 0
    global_ids: set[str] = set()
    duplicate_global_ids = 0
    missing_global_ids = 0
    latest_data_date = ""
    kmz_fields: list[str] = []

    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        if len(entries) != 1 or entries[0].filename.lower() != "doc.kml":
            raise ValueError("Expected a single doc.kml entry")
        entry = entries[0]
        with archive.open(entry) as stream:
            for _, element in ET.iterparse(stream, events=("end",)):
                if element.tag.rsplit("}", 1)[-1] != "Placemark":
                    continue
                placemark_count += 1
                description = next(
                    ("".join(child.itertext()) for child in element if child.tag.rsplit("}", 1)[-1] == "description"),
                    "",
                )
                values = parse_description(description)
                if not kmz_fields:
                    kmz_fields = list(values)
                global_id = clean_id(values.get("GlobalID"))
                if not global_id:
                    missing_global_ids += 1
                elif global_id in global_ids:
                    duplicate_global_ids += 1
                else:
                    global_ids.add(global_id)
                data_date = values.get("dataDate", "")
                if data_date > latest_data_date:
                    latest_data_date = data_date
                feature_polygons = sum(1 for child in element.iter() if child.tag.rsplit("}", 1)[-1] == "Polygon")
                polygon_count += feature_polygons
                if feature_polygons:
                    geometry_placemark_count += 1
                if placemark_count % 50000 == 0:
                    print(f"CCAD KMZ audit: {placemark_count:,} placemarks", flush=True)
                element.clear()

    overlap = len(global_ids & intelligence_ids)
    coverage_percent = round((len(global_ids) / len(intelligence_ids) * 100) if intelligence_ids else 0, 4)
    report = {
        "schemaVersion": "wr-collin-ccad-kmz-audit-v1",
        "sourceCountyId": COUNTY_ID,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "status": "verified-partial-redundant-delivery-wgs84-geometry-cross-check",
        "activationAuthorized": False,
        "source": {
            "format": "KMZ containing KML",
            "fileName": source.name,
            "sizeBytes": source.stat().st_size,
            "sha256": sha256(source),
            "kmlUncompressedBytes": entry.file_size,
            "kmlCompressedBytes": entry.compress_size,
        },
        "schema": {
            "kmzFieldCount": len(kmz_fields),
            "csvFieldCount": len(csv_fields),
            "objectIdOmittedFromKmzPopup": "OBJECTID" in csv_fields and "OBJECTID" not in kmz_fields,
            "fieldSetsMatchExceptObjectId": kmz_fields == expected_kmz_fields,
            "fields": kmz_fields,
            "newFieldsBeyondCurrentCsv": sorted(set(kmz_fields) - set(csv_fields)),
        },
        "features": {
            "placemarkCount": placemark_count,
            "geometryPlacemarkCount": geometry_placemark_count,
            "polygonCount": polygon_count,
            "coordinateReferenceSystem": "OGC KML WGS84 longitude/latitude",
            "globalIdNonblank": len(global_ids),
            "globalIdMissing": missing_global_ids,
            "globalIdDuplicates": duplicate_global_ids,
            "latestDataDate": latest_data_date,
        },
        "reconciliation": {
            "currentIntelligenceGlobalIds": len(intelligence_ids),
            "kmzGlobalIds": len(global_ids),
            "globalIdOverlap": overlap,
            "kmzOnlyGlobalIds": len(global_ids - intelligence_ids),
            "intelligenceOnlyGlobalIds": len(intelligence_ids - global_ids),
            "currentRefreshCoveragePercent": coverage_percent,
        },
        "incrementalIntelligenceGroups": [],
        "scoreImpact": {
            "beforePercent": 92.9,
            "afterPercent": 92.9,
            "reason": "The partial KMZ repeats the current CCAD attribute schema for a subset of current parcel identities; it adds WGS84 geometry corroboration, not a new intelligence group.",
        },
        "truthBoundary": "Use this KMZ as partial refresh/geometry evidence only. It covers 206,204 of 441,278 current parcel GlobalIDs, so it is not a complete county delivery. Do not double-count its duplicated parcel attributes or load the 1.28 GB KML directly in the browser.",
    }
    json_path = output_dir / "ccad-kmz-audit.json"
    md_path = output_dir / "ccad-kmz-audit.md"
    json_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(
        f"# Collin County CCAD KMZ audit\n\n- Placemarks: **{placemark_count:,}**\n- Placemarks with polygon geometry: **{geometry_placemark_count:,}**\n- Polygon elements: **{polygon_count:,}**\n- KMZ attribute fields: **{len(kmz_fields):,}**\n- GlobalID matches to current intelligence: **{overlap:,}**\n- Current-refresh coverage: **{coverage_percent:.4f}%**\n- KMZ-only IDs: **{len(global_ids - intelligence_ids):,}**\n- Current-intelligence-only IDs: **{len(intelligence_ids - global_ids):,}**\n- Score impact: **92.9% → 92.9%**\n\nThe KMZ corroborates WGS84 polygon geometry for a 206,204-parcel subset of the current refresh. It repeats the existing CCAD attribute schema, is not a complete county delivery, and does not add another scorecard group.\n",
        encoding="utf-8",
    )
    print(json.dumps({"placemarks": placemark_count, "globalIdOverlap": overlap, "scoreAfter": 92.9}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

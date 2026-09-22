#!/usr/bin/env python3
"""Reconcile the local CCAD File Geodatabase with the staged intelligence CSV."""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COUNTY_ID = "collin-county-tx"
DEFAULT_GDB_ROOT = ROOT / "data" / "raw" / COUNTY_ID / "ccad-filegdb-refresh"
DEFAULT_CSV = ROOT / "data" / "raw" / COUNTY_ID / "CCAD_Parcel_Feature_Set.csv"
DEFAULT_OUTPUT = ROOT / "output" / COUNTY_ID

sys.path.insert(0, str(ROOT / ".tools" / "python"))
try:
    import pyogrio
    from pyogrio.raw import read
except ImportError as exc:
    raise RuntimeError("pyogrio is required; install it into .tools/python") from exc


def clean_id(value: object) -> str:
    return str(value or "").strip().strip("{}").lower()


def clean_number(value: object) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    text = str(value).strip()
    return text[:-2] if text.endswith(".0") else text


def locate_gdb(root: Path) -> Path:
    if root.suffix.lower() == ".gdb" and root.is_dir():
        return root
    matches = sorted(root.glob("*.gdb"))
    if len(matches) != 1:
        raise ValueError(f"Expected one .gdb directory under {root}, found {len(matches)}")
    return matches[0]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gdb", default=str(DEFAULT_GDB_ROOT))
    parser.add_argument("--csv", default=str(DEFAULT_CSV))
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    gdb = locate_gdb(Path(args.gdb).resolve())
    source_csv = Path(args.csv).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    info = pyogrio.read_info(gdb, layer="Parcels")
    metadata, _, _, columns = read(
        gdb,
        layer="Parcels",
        columns=["GlobalID", "propID", "geoID", "dataDate"],
        read_geometry=False,
        datetime_as_string=True,
    )
    gdb_columns = dict(zip(metadata["fields"].tolist(), columns))
    gdb_global_ids = [clean_id(value) for value in gdb_columns["GlobalID"]]
    gdb_prop_ids = [clean_number(value) for value in gdb_columns["propID"]]
    gdb_geo_ids = [str(value or "").strip() for value in gdb_columns["geoID"]]

    with source_csv.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        csv_fields = list(reader.fieldnames or [])
        csv_global_ids: list[str] = []
        csv_prop_ids: list[str] = []
        csv_geo_ids: list[str] = []
        for row in reader:
            csv_global_ids.append(clean_id(row.get("GlobalID")))
            csv_prop_ids.append(clean_number(row.get("propID")))
            csv_geo_ids.append(str(row.get("geoID") or "").strip())

    with warnings.catch_warnings(record=True) as geometry_warnings:
        warnings.simplefilter("always")
        geometry_metadata, _, geometries, _ = read(gdb, layer="Parcels", columns=[], read_geometry=True)

    gdb_id_set = set(gdb_global_ids)
    csv_id_set = set(csv_global_ids)
    normalized_csv_fields = {
        {"Shape__Area": "SHAPE_Area", "Shape__Length": "SHAPE_Length"}.get(field, field)
        for field in csv_fields
        if field != "OBJECTID"
    }
    gdb_fields = set(info["fields"].tolist())
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    report = {
        "schemaVersion": "wr-collin-ccad-filegdb-audit-v1",
        "sourceCountyId": COUNTY_ID,
        "generatedAt": generated_at,
        "status": "geometry-and-intelligence-aligned-awaiting-service-rebuild-and-qc",
        "activationAuthorized": False,
        "source": {
            "format": "Esri File Geodatabase",
            "archiveNote": "The supplied ZIP contains a .gdb directory, not an OGC .gpkg file.",
            "geodatabaseDirectory": gdb.name,
            "layer": "Parcels",
            "driver": info["driver"],
        },
        "geometry": {
            "featureCount": int(info["features"]),
            "geometryType": info["geometry_type"],
            "crs": info["crs"],
            "bounds": [float(value) for value in info["total_bounds"]],
            "nullGeometryCount": sum(value is None for value in geometries),
            "emptyWkbCount": sum(value is not None and len(value) == 0 for value in geometries),
            "readerWarnings": sorted({str(item.message) for item in geometry_warnings}),
        },
        "schema": {
            "csvFieldCount": len(csv_fields),
            "gdbAttributeFieldCount": len(gdb_fields),
            "fidColumn": info["fid_column"],
            "normalizedFieldSetsMatch": normalized_csv_fields == gdb_fields,
            "csvFieldsMissingFromGdb": sorted(normalized_csv_fields - gdb_fields),
            "gdbFieldsMissingFromCsv": sorted(gdb_fields - normalized_csv_fields),
        },
        "reconciliation": {
            "csvRecordCount": len(csv_global_ids),
            "gdbRecordCount": len(gdb_global_ids),
            "gdbGlobalIdNonblank": sum(bool(value) for value in gdb_global_ids),
            "gdbGlobalIdDistinct": len(gdb_id_set - {""}),
            "gdbGlobalIdDuplicates": len(gdb_global_ids) - len(gdb_id_set),
            "globalIdOverlap": len(gdb_id_set & csv_id_set),
            "csvOnlyGlobalIds": len(csv_id_set - gdb_id_set),
            "gdbOnlyGlobalIds": len(gdb_id_set - csv_id_set),
            "rowOrderGlobalIdMatches": sum(left == right for left, right in zip(gdb_global_ids, csv_global_ids)),
            "rowOrderPropertyIdMatches": sum(left == right for left, right in zip(gdb_prop_ids, csv_prop_ids)),
            "rowOrderGeoIdMatches": sum(left == right for left, right in zip(gdb_geo_ids, csv_geo_ids)),
        },
        "activationGate": "Rebuild the viewport parcel service from this File Geodatabase, then run geometry validity and county QC before visible activation.",
    }

    json_path = output_dir / "ccad-filegdb-report.json"
    md_path = output_dir / "ccad-filegdb-report.md"
    json_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(
        "\n".join(
            [
                "# Collin County CCAD File Geodatabase audit",
                "",
                f"- Format: **{report['source']['format']}**",
                f"- Layer: **Parcels**",
                f"- Features: **{report['geometry']['featureCount']:,}**",
                f"- Geometry: **{report['geometry']['geometryType']}**, **{report['geometry']['crs']}**",
                f"- Null geometries: **{report['geometry']['nullGeometryCount']:,}**",
                f"- Distinct GlobalID values: **{report['reconciliation']['gdbGlobalIdDistinct']:,}**",
                f"- GlobalID matches to intelligence CSV: **{report['reconciliation']['globalIdOverlap']:,}**",
                f"- CSV-only IDs: **{report['reconciliation']['csvOnlyGlobalIds']:,}**",
                f"- GDB-only IDs: **{report['reconciliation']['gdbOnlyGlobalIds']:,}**",
                "",
                "## Activation boundary",
                "",
                report["activationGate"],
                "",
            ]
        ),
        encoding="utf-8",
    )
    print(json.dumps({"featureCount": report["geometry"]["featureCount"], "globalIdOverlap": report["reconciliation"]["globalIdOverlap"], "report": str(json_path)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

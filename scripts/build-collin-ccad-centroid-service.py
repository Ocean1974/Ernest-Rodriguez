#!/usr/bin/env python3
"""Build a lightweight, refresh-scoped CCAD parcel centroid service for spatial joins."""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COUNTY_ID = "collin-county-tx"
DEFAULT_GDB_ROOT = ROOT / "data" / "raw" / COUNTY_ID / "ccad-filegdb-refresh"
DEFAULT_OUTPUT = ROOT / "public" / "data" / "counties" / COUNTY_ID / "parcels-refresh"

sys.path.insert(0, str(ROOT / ".tools" / "python"))
try:
    import numpy as np
    import shapely
    from pyogrio.raw import read
    from pyproj import Transformer
except ImportError as exc:
    raise RuntimeError("pyogrio, shapely, numpy, and pyproj are required in .tools/python") from exc


def locate_gdb(root: Path) -> Path:
    if root.suffix.lower() == ".gdb" and root.is_dir():
        return root
    matches = sorted(root.glob("*.gdb"))
    if len(matches) != 1:
        raise ValueError(f"Expected one .gdb directory under {root}, found {len(matches)}")
    return matches[0]


def clean_id(value: object) -> str:
    return str(value or "").strip().strip("{}").lower()


def clean_number(value: object) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    text = str(value).strip()
    return text[:-2] if text.endswith(".0") else text


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gdb", default=str(DEFAULT_GDB_ROOT))
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--batch-size", type=int, default=10000)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    gdb = locate_gdb(Path(args.gdb).resolve())
    output_dir = Path(args.output_dir).resolve()
    if ROOT not in output_dir.parents:
        raise ValueError(f"Output escapes workspace: {output_dir}")
    chunk_dir = output_dir / "chunks"
    chunk_dir.mkdir(parents=True, exist_ok=True)
    for existing in chunk_dir.glob("*.json"):
        existing.unlink()

    handles: dict[str, object] = {}
    counts: Counter[str] = Counter()
    first_record: set[str] = set()
    transformer = Transformer.from_crs("EPSG:2276", "EPSG:4326", always_xy=True)
    source_count = 0
    missing_geometry = 0
    invalid_centroid = 0
    _, _, all_geometry_wkb, _ = read(gdb, layer="Parcels", columns=[], read_geometry=True)

    try:
        offset = 0
        while True:
            metadata, _, _, columns = read(
                gdb,
                layer="Parcels",
                columns=["GlobalID", "propID", "geoID"],
                read_geometry=False,
                skip_features=offset,
                max_features=args.batch_size,
            )
            batch_count = len(columns[0]) if columns else 0
            if batch_count == 0:
                break
            geometry_wkb = all_geometry_wkb[offset : offset + batch_count]
            fields = dict(zip(metadata["fields"].tolist(), columns))
            geometries = shapely.from_wkb(geometry_wkb, on_invalid="ignore")
            centroids = shapely.centroid(geometries)
            x = shapely.get_x(centroids)
            y = shapely.get_y(centroids)
            lng, lat = transformer.transform(x, y)

            for index in range(len(geometry_wkb)):
                global_id = clean_id(fields["GlobalID"][index])
                if not global_id:
                    raise ValueError(f"Missing GlobalID at source offset {offset + index}")
                center = None
                if geometry_wkb[index] is None:
                    missing_geometry += 1
                elif np.isfinite(lng[index]) and np.isfinite(lat[index]):
                    center = [round(float(lng[index]), 7), round(float(lat[index]), 7)]
                else:
                    invalid_centroid += 1
                shard = global_id[:2]
                if shard not in handles:
                    handle = (chunk_dir / f"{shard}.json").open("w", encoding="utf-8", newline="\n")
                    handle.write(json.dumps({"schemaVersion": "wr-collin-ccad-centroid-chunk-v1", "chunkId": shard})[:-1] + ',"parcels":[')
                    handles[shard] = handle
                handle = handles[shard]
                if shard in first_record:
                    handle.write(",")
                else:
                    first_record.add(shard)
                parcel = {
                    "sourceCountyId": COUNTY_ID,
                    "countyParcelId": f"{COUNTY_ID}:{global_id}",
                    "accountNum": clean_number(fields["propID"][index]),
                    "gisParcelId": str(fields["geoID"][index] or "").strip(),
                    "liveGeometry": {"center": center} if center else {},
                }
                handle.write(json.dumps(parcel, separators=(",", ":"), ensure_ascii=True))
                counts[shard] += 1
                source_count += 1
            offset += batch_count
            print(f"CCAD centroid service: {source_count:,} parcels", flush=True)
    finally:
        for handle in handles.values():
            handle.write("]}")
            handle.close()

    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    chunks = [
        {"id": key, "file": f"chunks/{key}.json", "count": counts[key]}
        for key in sorted(counts)
    ]
    manifest = {
        "schemaVersion": "wr-collin-ccad-centroid-service-v1",
        "sourceCountyId": COUNTY_ID,
        "generatedAt": generated_at,
        "status": "refresh-spatial-join-service-not-visible-map-service",
        "activationAuthorized": False,
        "sourceFormat": "Esri File Geodatabase",
        "sourceLayer": "Parcels",
        "sourceCrs": "EPSG:2276",
        "outputCrs": "EPSG:4326",
        "featureCount": source_count,
        "missingGeometry": missing_geometry,
        "invalidCentroid": invalid_centroid,
        "chunkCount": len(chunks),
        "chunks": chunks,
        "truthBoundary": "Lightweight centroid service for offline parcel-intelligence joins; not a replacement for full parcel polygon delivery.",
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"featureCount": source_count, "missingGeometry": missing_geometry, "chunkCount": len(chunks)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

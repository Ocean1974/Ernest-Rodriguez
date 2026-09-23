#!/usr/bin/env python3
"""Build the live Collin viewport/search service from the verified CCAD refresh."""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import shutil
import sys
from collections import Counter, OrderedDict, defaultdict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COUNTY_ID = "collin-county-tx"
DEFAULT_GDB_ROOT = ROOT / "data" / "raw" / COUNTY_ID / "ccad-filegdb-refresh"
DEFAULT_CSV = ROOT / "data" / "raw" / COUNTY_ID / "CCAD_Parcel_Feature_Set.csv"
DEFAULT_OUTPUT = ROOT / "public" / "data" / "counties" / COUNTY_ID / "parcels"
DEFAULT_REPORT = ROOT / "output" / COUNTY_ID
BOUNDS = {"minLng": -96.95, "minLat": 32.95, "maxLng": -96.3, "maxLat": 33.45}
GRID_SIZE = 48
SEARCH_PART_SIZE = 20_000
SEARCH_FIELDS = [
    "schemaVersion", "sourceCountyId", "countyParcelId", "accountNum", "accountNumber",
    "sourceParcelId", "gisParcelId", "displayParcelId", "address", "ownerName",
    "propertyName", "ownerName2", "businessName", "blockId", "zoning", "landUseCode",
    "landUseDescription", "totalValue", "chunkId", "centroid",
]
COMMON_TOKENS = {"the", "and", "of", "tx", "street", "road", "drive", "lane", "court", "avenue", "boulevard"}

sys.path.insert(0, str(ROOT / ".tools" / "python"))
try:
    import shapely
    from pyogrio.raw import read
    from pyproj import Transformer
except ImportError as exc:
    raise RuntimeError("pyogrio, shapely, and pyproj are required in .tools/python") from exc


def compact(value: object) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    text = str(value).strip()
    return text[:-2] if text.endswith(".0") else text


def clean_global_id(value: object) -> str:
    return compact(value).strip("{}").lower()


def first(*values: object) -> str:
    return next((compact(value) for value in values if compact(value)), "")


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
    parser.add_argument("--report-dir", default=str(DEFAULT_REPORT))
    parser.add_argument("--batch-size", type=int, default=20000)
    return parser.parse_args()


def safe_workspace_path(path: Path) -> Path:
    resolved = path.resolve()
    if resolved == ROOT or ROOT not in resolved.parents:
        raise ValueError(f"Path escapes workspace or is too broad: {resolved}")
    return resolved


def normalize_token(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "", compact(value).lower())


def search_keys(values: list[object], *, address_only: bool = False) -> set[str]:
    keys: set[str] = set()
    for value in values:
        raw = compact(value).lower()
        whole = normalize_token(raw)
        if len(whole) >= 2:
            keys.add(whole[:2])
        for part in re.split(r"[^a-z0-9]+", raw):
            token = normalize_token(part)
            if len(token) < 2 or (address_only and token in COMMON_TOKENS):
                continue
            keys.add(token[:2])
    return keys


def round_point(point: tuple[float, float] | list[float]) -> list[float]:
    return [round(float(point[0]), 7), round(float(point[1]), 7)]


def to_screen(point: list[float]) -> list[float]:
    x = (point[0] - BOUNDS["minLng"]) / (BOUNDS["maxLng"] - BOUNDS["minLng"]) * 100
    y = (1 - (point[1] - BOUNDS["minLat"]) / (BOUNDS["maxLat"] - BOUNDS["minLat"])) * 100
    return [round(min(100, max(0, x)), 4), round(min(100, max(0, y)), 4)]


def largest_ring(geometry: object) -> list[list[float]]:
    if geometry is None or getattr(geometry, "is_empty", True):
        return []
    if geometry.geom_type == "Polygon":
        polygon = geometry
    elif geometry.geom_type == "MultiPolygon":
        polygon = max(geometry.geoms, key=lambda item: item.area)
    else:
        return []
    points = list(polygon.exterior.coords)
    if len(points) > 48:
        stride = math.ceil(len(points) / 48)
        points = points[::stride]
        if points[0] != points[-1]:
            points.append(points[0])
    return [round_point(point) for point in points]


def simplified_ring(coordinates: object, max_points: int = 64) -> list[list[float]]:
    points = list(coordinates)
    if len(points) > max_points:
        stride = math.ceil(len(points) / max_points)
        points = points[::stride]
        if points[0] != points[-1]:
            points.append(points[0])
    return [round_point(point) for point in points]


def simplified_geojson_geometry(geometry: object) -> dict[str, object] | None:
    if geometry is None or geometry.is_empty:
        return None
    if geometry.geom_type == "Polygon":
        rings = [simplified_ring(geometry.exterior.coords)]
        rings.extend(simplified_ring(interior.coords) for interior in geometry.interiors)
        return {"type": "Polygon", "coordinates": rings}
    if geometry.geom_type == "MultiPolygon":
        polygons = []
        for polygon in geometry.geoms:
            rings = [simplified_ring(polygon.exterior.coords)]
            rings.extend(simplified_ring(interior.coords) for interior in polygon.interiors)
            polygons.append(rings)
        return {"type": "MultiPolygon", "coordinates": polygons}
    return None


class JsonArrayPool:
    def __init__(self, max_open: int = 128):
        self.max_open = max_open
        self.handles: OrderedDict[Path, object] = OrderedDict()
        self.counts: Counter[Path] = Counter()
        self.headers: dict[Path, str] = {}

    def write(self, path: Path, header: dict[str, object], value: object) -> None:
        self.write_encoded(path, header, json.dumps(value, separators=(",", ":"), ensure_ascii=True))

    def write_encoded(self, path: Path, header: dict[str, object], encoded: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path not in self.headers:
            self.headers[path] = json.dumps(header, separators=(",", ":"))[:-1] + ',"parcels":['
        handle = self.handles.pop(path, None)
        if handle is None:
            is_new = not path.exists()
            handle = path.open("a", encoding="utf-8", newline="\n")
            if is_new:
                handle.write(self.headers[path])
        self.handles[path] = handle
        if self.counts[path]:
            handle.write(",")
        handle.write(encoded)
        self.counts[path] += 1
        if len(self.handles) > self.max_open:
            _, old_handle = self.handles.popitem(last=False)
            old_handle.close()

    def write_many_encoded(self, path: Path, header: dict[str, object], encoded_values: list[str]) -> None:
        if not encoded_values:
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        if path not in self.headers:
            self.headers[path] = json.dumps(header, separators=(",", ":"))[:-1] + ',"parcels":['
        handle = self.handles.pop(path, None)
        if handle is None:
            is_new = not path.exists()
            handle = path.open("a", encoding="utf-8", newline="\n")
            if is_new:
                handle.write(self.headers[path])
        self.handles[path] = handle
        if self.counts[path]:
            handle.write(",")
        handle.write(",".join(encoded_values))
        self.counts[path] += len(encoded_values)
        if len(self.handles) > self.max_open:
            _, old_handle = self.handles.popitem(last=False)
            old_handle.close()

    def finalize(self) -> None:
        for handle in self.handles.values():
            handle.close()
        self.handles.clear()
        for path in self.headers:
            with path.open("a", encoding="utf-8", newline="\n") as stream:
                stream.write("]}")


def pack_search(record: dict[str, object]) -> list[object]:
    values = [record.get(field, "") for field in SEARCH_FIELDS]
    while values and values[-1] in ("", None):
        values.pop()
    return values


def parcel_record(row: dict[str, str], center: list[float], screen_center: list[float], chunk_id: str) -> dict[str, object]:
    global_id = clean_global_id(row.get("GlobalID"))
    prop_id = compact(row.get("propID") or row.get("PROP_ID"))
    geo_id = compact(row.get("geoID"))
    county_parcel_id = f"{COUNTY_ID}:{global_id}"
    address = compact(row.get("situsConcat"))
    acreage = compact(row.get("landSizeAcres"))
    area_sq_ft = compact(row.get("landSizeSqft"))
    area_label = " / ".join(value for value in [f"{acreage} acres" if acreage else "", f"{area_sq_ft} land sq ft" if area_sq_ft else ""] if value)
    has_geometry = bool(chunk_id and center)
    record: dict[str, object] = {
        "schemaVersion": "wr-universal-parcel-v1",
        "sourceCountyId": COUNTY_ID,
        "countyParcelId": county_parcel_id,
        "sourceParcelId": prop_id,
        "accountNum": prop_id,
        "accountNumber": prop_id,
        "gisParcelId": first(geo_id, row.get("gisPropID")),
        "displayParcelId": first(geo_id, prop_id, global_id),
        "address": address,
        "propertyAddress": address,
        "city": compact(row.get("situsCity")),
        "propertyZip": compact(row.get("situsZip")),
        "propertyName": first(row.get("legalAbsSubName"), f"Collin Parcel {geo_id or prop_id or global_id}"),
        "ownerName": compact(row.get("ownerName")),
        "ownerName2": compact(row.get("ownerNameAddtl")),
        "businessName": compact(row.get("dbaName")),
        "ownerMailingAddress": compact(row.get("ownerAddrLine1")),
        "ownerMailingAddress2": compact(row.get("ownerAddrLine2")),
        "ownerCity": compact(row.get("ownerAddrCity")),
        "ownerState": compact(row.get("ownerAddrState")),
        "ownerZip": compact(row.get("ownerAddrZip")),
        "ownerPhone": "",
        "ownerEmail": "",
        "zoning": "",
        "landUseCode": compact(row.get("propUseCode")),
        "landUseDescription": compact(row.get("propType")),
        "landAreaSqFt": area_sq_ft,
        "landAreaUnit": "sq ft" if area_sq_ft else "",
        # The September 2026 CCAD delivery is a 2027 in-progress roll. Its
        # currVal* columns are intentionally blank; prevVal* is the certified
        # 2026 roll and is the correct usable appraisal value source.
        "landValue": first(row.get("currValLand"), row.get("prevValLand")),
        "improvementValue": first(row.get("currValImprv"), row.get("prevValImprv")),
        "totalValue": first(row.get("currValMarket"), row.get("prevValMarket")),
        "appraisedValue": first(row.get("currValAppraised"), row.get("prevValAppraised")),
        "assessedValue": first(row.get("currValAssessed"), row.get("prevValAssessed")),
        "valueYear": first(row.get("currValYear"), row.get("prevValYear")),
        "valueStatus": "certified-prior-roll" if not compact(row.get("currValMarket")) and compact(row.get("prevValMarket")) else "current-roll",
        "yearBuilt": compact(row.get("imprvYearBuilt")),
        "grossBuildingArea": compact(row.get("imprvMainArea")),
        "blockId": first(row.get("legalAbsSubBlock"), row.get("legalAbsSubName"), row.get("mapID")),
        "legalDescription": compact(row.get("legalDescription")),
        "areaLabel": area_label,
        "perimeter": compact(row.get("Shape__Length")),
        "centroid": screen_center,
        "points": [],
        "liveGeometry": {"center": center} if center else {},
        "realGeometry": {"type": "Feature", "geometry": "__WR_GEOMETRY__" if has_geometry else None, "properties": {"countyParcelId": county_parcel_id, "accountNum": prop_id, "sourceParcelId": prop_id, "gisParcelId": geo_id, "globalId": global_id}},
        "dimensions": {"perimeterFt": compact(row.get("Shape__Length")), "areaSqFt": area_sq_ft, "acreage": acreage, "dimensionLabel": area_label, "sourceLayer": "CCAD Parcels 2026-09-21 refresh"},
        "joins": {"accountInfo": bool(prop_id), "ownerAppraisal": True, "parcelDimension": bool(area_sq_ft or acreage), "parcelGeometry": has_geometry, "zoning": False, "permits": False, "floodplain": False, "migrationDemand": False},
        "sourceReferences": {"countyAdapter": "data/county-adapters/collin-county-tx/adapter.json", "sourceManifest": "data/county-adapters/collin-county-tx/collin-county-tx-source-manifest.json", "parcelGeometrySource": "verified local CCAD File Geodatabase", "primaryFeatureKey": "GlobalID", "businessParcelCandidates": ["propID", "PROP_ID", "geoID"]},
    }
    if chunk_id:
        record["chunkId"] = chunk_id
    return record


def main() -> int:
    args = parse_args()
    gdb = locate_gdb(Path(args.gdb).resolve())
    csv_path = Path(args.csv).resolve()
    output_dir = safe_workspace_path(Path(args.output_dir))
    report_dir = safe_workspace_path(Path(args.report_dir))
    staging = safe_workspace_path(output_dir.parent / f".{output_dir.name}-refresh-staging")
    backup = safe_workspace_path(output_dir.parent / f".{output_dir.name}-previous")
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    report_dir.mkdir(parents=True, exist_ok=True)

    chunk_pool = JsonArrayPool(max_open=2048)
    search_pool = JsonArrayPool(max_open=2048)
    address_pool = JsonArrayPool(max_open=2048)
    chunk_counts: Counter[str] = Counter()
    chunk_bounds: dict[str, dict[str, float]] = {}
    search_counts: Counter[str] = Counter()
    address_counts: Counter[str] = Counter()
    source_count = 0
    geometry_count = 0
    missing_geometry = 0
    invalid_geometry = 0
    row_order_matches = 0
    value_record_count = 0
    dimension_record_count = 0
    certified_prior_roll_count = 0
    transformer = Transformer.from_crs("EPSG:2276", "EPSG:4326", always_xy=True)

    with csv_path.open("r", encoding="utf-8-sig", newline="") as csv_stream:
        reader = csv.DictReader(csv_stream)
        offset = 0
        while True:
            rows = []
            for _ in range(args.batch_size):
                try:
                    rows.append(next(reader))
                except StopIteration:
                    break
            if not rows:
                break
            metadata, _, geometry_wkb, columns = read(
                gdb,
                layer="Parcels",
                columns=["GlobalID"],
                read_geometry=True,
                skip_features=offset,
                max_features=len(rows),
            )
            gdb_ids = dict(zip(metadata["fields"].tolist(), columns))["GlobalID"]
            if len(gdb_ids) != len(rows):
                raise ValueError(f"GDB/CSV batch length mismatch at offset {offset}: {len(gdb_ids)} != {len(rows)}")
            geometries = shapely.from_wkb(geometry_wkb, on_invalid="ignore")
            projected = shapely.transform(geometries, transformer.transform, interleaved=False)
            projected_valid = shapely.is_valid(projected) & ~shapely.is_empty(projected) & ~shapely.is_missing(projected)
            centroids = shapely.centroid(projected)
            centroid_x = shapely.get_x(centroids)
            centroid_y = shapely.get_y(centroids)
            geometry_json = shapely.to_geojson(projected)
            batch_chunks: dict[Path, list[str]] = defaultdict(list)
            batch_search: dict[Path, list[str]] = defaultdict(list)
            batch_address: dict[Path, list[str]] = defaultdict(list)

            for index, row in enumerate(rows):
                source_count += 1
                csv_id = clean_global_id(row.get("GlobalID"))
                gdb_id = clean_global_id(gdb_ids[index])
                if not csv_id or csv_id != gdb_id:
                    raise ValueError(f"GDB/CSV GlobalID mismatch at row {source_count}: {gdb_id} != {csv_id}")
                row_order_matches += 1
                chunk_id = ""
                center: list[float] = []
                screen: list[float] = []
                if geometry_wkb[index] is None:
                    missing_geometry += 1
                elif not projected_valid[index] or not math.isfinite(float(centroid_x[index])) or not math.isfinite(float(centroid_y[index])):
                    invalid_geometry += 1
                else:
                    geometry_count += 1
                    center = round_point((centroid_x[index], centroid_y[index]))
                    screen = to_screen(center)
                    chunk_x = max(0, min(GRID_SIZE - 1, int(screen[0] / 100 * GRID_SIZE)))
                    chunk_y = max(0, min(GRID_SIZE - 1, int(screen[1] / 100 * GRID_SIZE)))
                    chunk_id = f"{chunk_x}-{chunk_y}"
                record = parcel_record(row, center, screen, chunk_id)
                if compact(record.get("totalValue")):
                    value_record_count += 1
                if record.get("joins", {}).get("parcelDimension"):
                    dimension_record_count += 1
                if record.get("valueStatus") == "certified-prior-roll":
                    certified_prior_roll_count += 1
                record_json = json.dumps(record, separators=(",", ":"), ensure_ascii=True)
                if chunk_id:
                    record_json = record_json.replace('"__WR_GEOMETRY__"', str(geometry_json[index]))
                if chunk_id:
                    chunk_path = staging / "chunks" / f"{chunk_id}.json"
                    batch_chunks[chunk_path].append(record_json)
                    chunk_counts[chunk_id] += 1
                    x, y = record["centroid"]
                    bounds = chunk_bounds.setdefault(chunk_id, {"minX": x, "minY": y, "maxX": x, "maxY": y})
                    bounds.update(minX=min(bounds["minX"], x), minY=min(bounds["minY"], y), maxX=max(bounds["maxX"], x), maxY=max(bounds["maxY"], y))

                packed = pack_search(record)
                packed_json = json.dumps(packed, separators=(",", ":"), ensure_ascii=True)
                general_values = [record.get(name) for name in ["accountNum", "accountNumber", "sourceParcelId", "gisParcelId", "displayParcelId", "address", "ownerName", "propertyName", "ownerName2", "businessName", "blockId", "landUseCode", "landUseDescription"]]
                for key in search_keys(general_values):
                    part = search_counts[key] // SEARCH_PART_SIZE + 1
                    path = staging / "search" / f"{key}-{part:03}.json"
                    batch_search[path].append(packed_json)
                    search_counts[key] += 1
                if record.get("address"):
                    for key in search_keys([record["address"]], address_only=True):
                        part = address_counts[key] // SEARCH_PART_SIZE + 1
                        path = staging / "address-search" / f"{key}-{part:03}.json"
                        batch_address[path].append(packed_json)
                        address_counts[key] += 1
            for path, values in batch_chunks.items():
                chunk_pool.write_many_encoded(path, {"chunkId": path.stem}, values)
            for path, values in batch_search.items():
                search_pool.write_many_encoded(path, {"fields": SEARCH_FIELDS}, values)
            for path, values in batch_address.items():
                address_pool.write_many_encoded(path, {"fields": SEARCH_FIELDS}, values)
            offset += len(rows)
            print(f"CCAD refresh parcel service: {source_count:,} records", flush=True)

        try:
            next(reader)
            raise ValueError("CSV contains records beyond the GDB feature stream")
        except StopIteration:
            pass

    chunk_pool.finalize()
    search_pool.finalize()
    address_pool.finalize()

    def shard_manifest(folder: str, counts: Counter[str]) -> dict[str, object]:
        files: dict[str, object] = {}
        for key in sorted(counts):
            part_count = math.ceil(counts[key] / SEARCH_PART_SIZE)
            names = [f"{folder}/{key}-{part:03}.json" for part in range(1, part_count + 1)]
            files[key] = names[0] if len(names) == 1 else names
        return {"keyLength": 2, "fields": SEARCH_FIELDS, "files": files, "counts": dict(sorted(counts.items())), "recordMembershipCount": sum(counts.values())}

    chunks = [{"id": key, "file": f"chunks/{key}.json", "count": chunk_counts[key], "bounds": chunk_bounds[key]} for key in sorted(chunk_counts, key=lambda value: tuple(map(int, value.split("-"))))]
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    manifest = {
        "schemaVersion": "wr-collin-ccad-refresh-parcel-service-v1",
        "generatedAt": generated_at,
        "sourceUpdatedAt": "2026-09-21T00:00:00Z",
        "source": "data/raw/collin-county-tx/ccad-filegdb-refresh/*.gdb + CCAD_Parcel_Feature_Set.csv",
        "sourceCountyId": COUNTY_ID,
        "mode": "full-refresh",
        "activationStatus": "release-candidate-awaiting-tile-and-gate-certification",
        "activationAuthorized": False,
        "sourceVerifiedFeatureCount": source_count,
        "featureCount": source_count,
        "geometryFeatureCount": geometry_count,
        "searchIndexCount": source_count,
        "skipped": 0,
        "missingGeometry": missing_geometry,
        "invalidGeometry": invalid_geometry,
        "rowOrderGlobalIdMatches": row_order_matches,
        "appraisalValueRecordCount": value_record_count,
        "joinedAppraisalCount": source_count,
        "joinedParcelDimensionCount": dimension_record_count,
        "certifiedPriorRollRecordCount": certified_prior_roll_count,
        "appraisalValuePolicy": "Use currVal* when populated; otherwise use certified prevVal* from the CCAD in-progress delivery.",
        "chunkCount": len(chunks),
        "gridSize": GRID_SIZE,
        "bounds": BOUNDS,
        "chunks": chunks,
        "searchIndexShards": shard_manifest("search", search_counts),
        "addressSearchIndexShards": shard_manifest("address-search", address_counts),
        "productionGates": ["final county QC", "explicit Collin production activation review"],
        "buildStrategy": "build-time local File Geodatabase geometry joined by verified same-row GlobalID to the matching CCAD appraisal CSV; viewport chunks plus bounded search shards",
        "uiConstraint": "No landing-page redesign and no direct runtime load of the source File Geodatabase.",
    }
    (staging / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")) + "\n", encoding="utf-8")

    if backup.exists():
        shutil.rmtree(backup)
    if output_dir.exists():
        output_dir.rename(backup)
    try:
        staging.rename(output_dir)
    except Exception:
        if backup.exists() and not output_dir.exists():
            backup.rename(output_dir)
        raise
    if backup.exists():
        shutil.rmtree(backup)

    report = {
        "schemaVersion": "wr-collin-ccad-refresh-parcel-service-report-v1",
        "generatedAt": generated_at,
        "sourceCountyId": COUNTY_ID,
        "sourceRecordCount": source_count,
        "searchIndexCount": source_count,
        "geometryFeatureCount": geometry_count,
        "missingGeometry": missing_geometry,
        "invalidGeometry": invalid_geometry,
        "rowOrderGlobalIdMatches": row_order_matches,
        "appraisalValueRecordCount": value_record_count,
        "joinedAppraisalCount": source_count,
        "joinedParcelDimensionCount": dimension_record_count,
        "certifiedPriorRollRecordCount": certified_prior_roll_count,
        "chunkCount": len(chunks),
        "searchShardFileCount": len(search_pool.headers),
        "addressSearchShardFileCount": len(address_pool.headers),
        "activationAuthorized": False,
    }
    (report_dir / "ccad-refresh-parcel-service-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (report_dir / "ccad-refresh-parcel-service-report.md").write_text(
        "\n".join([
            "# Collin County current-refresh parcel service",
            "",
            f"- Source records: **{source_count:,}**",
            f"- Searchable records: **{source_count:,}**",
            f"- Polygon records: **{geometry_count:,}**",
            f"- Missing geometry: **{missing_geometry:,}**",
            f"- Invalid geometry: **{invalid_geometry:,}**",
            f"- Same-row GlobalID joins: **{row_order_matches:,}**",
            f"- Viewport chunks: **{len(chunks):,}**",
            f"- General search shard files: **{len(search_pool.headers):,}**",
            f"- Address search shard files: **{len(address_pool.headers):,}**",
            "",
            "The live Collin parcel service now uses the verified 2026-09-21 CCAD refresh. Production activation remains gated on final county QC.",
            "",
        ]),
        encoding="utf-8",
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

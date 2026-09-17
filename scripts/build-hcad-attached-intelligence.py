"""Build chunk-aligned HCAD parcel-intelligence sidecars from an attached FileGDB.

The input archive is user-supplied data, never an instruction source. This builder
does not modify the existing geometry chunks. It joins the attached attributes to
the already-built Harris parcel service by HCAD_NUM and publishes reversible,
viewport-aligned enrichment sidecars.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from pyogrio import read_info
from pyogrio.raw import read


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_GDB = ROOT / "data/raw/harris-county-tx/GIS_Public_2026-09-06/parcel-extract/Parcels/Parcels.gdb"
PARCEL_ROOT = ROOT / "public/data/counties/harris-county-tx/parcels"
OUTPUT_ROOT = ROOT / "output/harris-county-tx"
SOURCE_ZIP = ROOT / "data/raw/harris-county-tx/GIS_Public_2026-09-06/Parcels.zip"
FIELDS = [
    "countyParcelId", "ownerName", "propertyAddress", "address", "city", "propertyZip",
    "ownerMailingAddress", "ownerMailingAddress2", "ownerCity", "ownerState", "ownerZip",
    "landAreaSize", "landAreaUnit", "improvementYear", "hcadAttached",
]
SOURCE_COLUMNS = [
    "HCAD_NUM", "CurrOwner", "LocNum", "LocName", "LocAddr", "city", "zip",
    "StatedArea", "Acreage", "SiteNumber", "Stacked", "mail_addr_1", "mail_addr_2",
    "mail_city", "mail_state", "mail_zip", "yr_impr", "Shape_Length", "Shape_Area",
]


def compact(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() in {"nan", "none", "<na>"} else text


def normalized(value) -> str:
    return re.sub(r"[^a-z0-9]", "", compact(value).lower())


def json_value(value):
    if value is None:
        return ""
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float) and value != value:
        return ""
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_source(gdb: Path):
    _, _, _, arrays = read(
        str(gdb), layer="Parcels", columns=SOURCE_COLUMNS, read_geometry=False
    )
    info = read_info(str(gdb), layer="Parcels")
    return info, {name: values for name, values in zip(SOURCE_COLUMNS, arrays)}


def source_record(columns, index: int) -> dict:
    return {name: json_value(columns[name][index]) for name in SOURCE_COLUMNS}


def attributes_signature(record: dict) -> tuple[str, ...]:
    return tuple(normalized(record.get(name)) for name in SOURCE_COLUMNS if name != "HCAD_NUM")


def select_source_index(columns, candidates, parcel: dict):
    if isinstance(candidates, int):
        return candidates, "unique"
    records = [(index, source_record(columns, index)) for index in candidates]
    address = normalized(parcel.get("propertyAddress") or parcel.get("address"))
    if address:
        matches = [(index, record) for index, record in records if normalized(record["LocAddr"]) == address]
        if len(matches) == 1:
            return matches[0][0], "address"
        if matches:
            records = matches
    owner = normalized(parcel.get("ownerName"))
    if owner:
        matches = [(index, record) for index, record in records if normalized(record["CurrOwner"]) == owner]
        if len(matches) == 1:
            return matches[0][0], "owner"
        if matches:
            records = matches
    signatures = {attributes_signature(record) for _, record in records}
    if len(signatures) == 1:
        return records[0][0], "equivalent-duplicate"
    return None, "ambiguous"


def enrichment_values(parcel: dict, record: dict) -> list:
    county_parcel_id = compact(parcel.get("countyParcelId"))
    loc_addr = compact(record["LocAddr"])
    acreage = compact(record["Acreage"]) or compact(record["StatedArea"])
    attached = {
        "snapshot": "GIS_Public.zip/Parcels.zip",
        "hcadNum": compact(record["HCAD_NUM"]),
        "locationNumber": json_value(record["LocNum"]),
        "locationName": compact(record["LocName"]),
        "siteNumber": compact(record["SiteNumber"]),
        "stacked": json_value(record["Stacked"]),
        "statedArea": json_value(record["StatedArea"]),
        "acreage": compact(record["Acreage"]),
        "yearImproved": json_value(record["yr_impr"]),
        "shapeArea": json_value(record["Shape_Area"]),
        "shapeLength": json_value(record["Shape_Length"]),
    }
    return [
        county_parcel_id,
        compact(record["CurrOwner"]),
        loc_addr,
        loc_addr,
        compact(record["city"]),
        compact(record["zip"]),
        compact(record["mail_addr_1"]),
        compact(record["mail_addr_2"]),
        compact(record["mail_city"]),
        compact(record["mail_state"]),
        compact(record["mail_zip"]),
        acreage,
        "acres",
        json_value(record["yr_impr"]),
        attached,
    ]


def write_json(path: Path, value, pretty=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2 if pretty else None, separators=None if pretty else (",", ":"))
        handle.write("\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--gdb", type=Path, default=DEFAULT_GDB)
    args = parser.parse_args()
    gdb = args.gdb.resolve()
    if not gdb.is_dir() or gdb.suffix.lower() != ".gdb":
        raise SystemExit(f"HCAD FileGDB not found: {gdb}")

    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    metadata, columns = load_source(gdb)
    row_count = len(columns["HCAD_NUM"])
    key_lookup: dict[str, int | list[int]] = {}
    missing_hcad = 0
    for index, raw_key in enumerate(columns["HCAD_NUM"]):
        key = compact(raw_key)
        if not key:
            missing_hcad += 1
            continue
        current = key_lookup.get(key)
        if current is None:
            key_lookup[key] = index
        elif isinstance(current, int):
            key_lookup[key] = [current, index]
        else:
            current.append(index)

    duplicate_groups = sum(1 for value in key_lookup.values() if isinstance(value, list))
    duplicate_excess = sum(len(value) - 1 for value in key_lookup.values() if isinstance(value, list))
    max_multiplicity = max((len(value) if isinstance(value, list) else 1 for value in key_lookup.values()), default=0)
    sidecar_root = PARCEL_ROOT / "intelligence/hcad-gis-public-2026-08-04"
    sidecar_chunk_root = sidecar_root / "chunks"
    sidecar_chunk_root.mkdir(parents=True, exist_ok=True)

    service_manifest_path = PARCEL_ROOT / "manifest.json"
    service_manifest = json.loads(service_manifest_path.read_text(encoding="utf-8"))
    files = {}
    counts = {}
    matched = 0
    unmatched = 0
    ambiguous = 0
    missing_existing_key = 0
    match_methods = Counter()
    seen_attached_keys: set[str] = set()

    for position, chunk in enumerate(service_manifest["chunks"], start=1):
        source_chunk_path = PARCEL_ROOT / chunk["file"]
        payload = json.loads(source_chunk_path.read_text(encoding="utf-8"))
        sidecar_records = []
        for parcel in payload.get("parcels", []):
            key = compact(
                parcel.get("sourceReferences", {}).get("harris", {}).get("HCAD_NUM")
                or parcel.get("sourceParcelId")
                or parcel.get("accountNum")
            )
            if not key:
                missing_existing_key += 1
                unmatched += 1
                continue
            candidates = key_lookup.get(key)
            if candidates is None:
                unmatched += 1
                continue
            source_index, method = select_source_index(columns, candidates, parcel)
            if source_index is None:
                ambiguous += 1
                unmatched += 1
                continue
            record = source_record(columns, source_index)
            sidecar_records.append(enrichment_values(parcel, record))
            matched += 1
            seen_attached_keys.add(key)
            match_methods[method] += 1
        if sidecar_records:
            relative = f"intelligence/hcad-gis-public-2026-08-04/chunks/{chunk['id']}.json"
            write_json(sidecar_chunk_root / f"{chunk['id']}.json", {"fields": FIELDS, "parcels": sidecar_records})
            files[chunk["id"]] = relative
            counts[chunk["id"]] = len(sidecar_records)
        if position % 100 == 0:
            print(f"Matched {matched:,} parcels across {position:,} viewport chunks...", flush=True)

    source_zip_hash = sha256_file(SOURCE_ZIP) if SOURCE_ZIP.exists() else None
    geometry_positive_area = sum(1 for value in columns["Shape_Area"] if value is not None and float(value) > 0)
    geometry_positive_length = sum(1 for value in columns["Shape_Length"] if value is not None and float(value) > 0)
    attached_keys_not_in_service = len(key_lookup) - len(seen_attached_keys)
    audit = {
        "schemaVersion": "wr-hcad-attached-intelligence-audit-v1",
        "generatedAt": generated_at,
        "countyId": "harris-county-tx",
        "source": {
            "userAttachment": "C:/Users/ernes/Downloads/GIS_Public.zip",
            "isolatedArchive": "data/raw/harris-county-tx/GIS_Public_2026-09-06/Parcels.zip",
            "isolatedArchiveSha256": source_zip_hash,
            "archiveModifiedAt": "2026-08-04T13:07:52-04:00",
            "layer": metadata["layer_name"],
            "driver": metadata["driver"],
            "crs": metadata["crs"],
            "geometryType": metadata["geometry_type"],
            "featureCount": row_count,
            "bounds": [float(value) for value in metadata["total_bounds"]],
            "fields": SOURCE_COLUMNS,
        },
        "keyAudit": {
            "joinKey": "HCAD_NUM",
            "nonblank": row_count - missing_hcad,
            "missing": missing_hcad,
            "distinctNonblank": len(key_lookup),
            "duplicateExcess": duplicate_excess,
            "duplicateGroups": duplicate_groups,
            "maxMultiplicity": max_multiplicity,
        },
        "geometryAudit": {
            "positiveShapeArea": geometry_positive_area,
            "nonpositiveOrNullShapeArea": row_count - geometry_positive_area,
            "positiveShapeLength": geometry_positive_length,
            "nonpositiveOrNullShapeLength": row_count - geometry_positive_length,
            "topologicalValidity": "not-yet-scanned",
        },
        "distribution": {
            "existingServiceParcels": int(service_manifest["featureCount"]),
            "matchedExistingParcels": matched,
            "unmatchedExistingParcels": unmatched,
            "ambiguousExistingParcels": ambiguous,
            "existingParcelsMissingJoinKey": missing_existing_key,
            "matchMethods": dict(match_methods),
            "attachedDistinctKeysUsed": len(seen_attached_keys),
            "attachedDistinctKeysNotInExistingService": attached_keys_not_in_service,
            "sidecarChunkCount": len(files),
            "sidecarRecordCount": matched,
        },
        "activation": {
            "authorized": False,
            "reason": "Attached intelligence is joined, but new/changed geometry and unresolved records require reconciliation and QA before Harris activation.",
        },
    }
    intelligence_manifest = {
        "schemaVersion": "wr-parcel-intelligence-sidecar-v1",
        "generatedAt": generated_at,
        "sourceCountyId": "harris-county-tx",
        "sourceSnapshot": audit["source"],
        "joinKey": "HCAD_NUM",
        "fields": FIELDS,
        "featureCount": matched,
        "chunkCount": len(files),
        "files": files,
        "counts": counts,
        "auditReport": "/data/counties/harris-county-tx/parcels/intelligence/hcad-gis-public-2026-08-04/audit.json",
        "activationStatus": "joined-needs-geometry-reconciliation-and-qa",
    }
    write_json(sidecar_root / "manifest.json", intelligence_manifest, pretty=True)
    write_json(sidecar_root / "audit.json", audit, pretty=True)
    write_json(OUTPUT_ROOT / "attached-gis-audit.json", audit, pretty=True)

    markdown = [
        "# Harris County attached GIS parcel-intelligence audit", "",
        f"- Attached parcel features: {row_count:,}",
        f"- Distinct nonblank HCAD_NUM values: {len(key_lookup):,}",
        f"- Missing HCAD_NUM: {missing_hcad:,}",
        f"- Duplicate excess rows: {duplicate_excess:,} across {duplicate_groups:,} groups",
        f"- CRS: {metadata['crs']}",
        f"- Geometry type: {metadata['geometry_type']}",
        f"- Positive Shape_Area and Shape_Length: {geometry_positive_area:,} / {geometry_positive_length:,}", "",
        "## Distribution into the existing parcel service", "",
        f"- Existing service parcels: {int(service_manifest['featureCount']):,}",
        f"- Matched and enriched: {matched:,}",
        f"- Unmatched: {unmatched:,}",
        f"- Ambiguous duplicate-key matches: {ambiguous:,}",
        f"- Attached distinct keys not present in the existing service: {attached_keys_not_in_service:,}",
        f"- Viewport-aligned sidecar chunks: {len(files):,}", "",
        "## Production gate", "",
        "The enrichment sidecars are active in the parcel loader, but Harris remains disabled. Attached-only parcels and geometry changes must be reconciled, topology must be validated, and county QA must pass before activation.", "",
    ]
    (OUTPUT_ROOT / "attached-gis-audit.md").write_text("\n".join(markdown), encoding="utf-8", newline="\n")

    service_manifest["intelligenceSidecars"] = {
        "version": intelligence_manifest["schemaVersion"],
        "manifest": "intelligence/hcad-gis-public-2026-08-04/manifest.json",
        "joinKey": "HCAD_NUM",
        "featureCount": matched,
        "chunkCount": len(files),
        "files": files,
        "counts": counts,
        "activationStatus": intelligence_manifest["activationStatus"],
    }
    write_json(service_manifest_path, service_manifest)
    print(json.dumps(audit["distribution"], indent=2), flush=True)


if __name__ == "__main__":
    main()

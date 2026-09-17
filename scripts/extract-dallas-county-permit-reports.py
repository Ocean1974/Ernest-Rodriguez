#!/usr/bin/env python3
"""Extract Dallas County monthly issued-permit PDF tables into auditable JSON.

This script intentionally preserves both normalized rows and page/table coordinates so
that every supply observation can be traced back to the official monthly report.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path

import pdfplumber


PERMIT_NUMBER = re.compile(r"^\d{4}-\d+(?:-[A-Z0-9]+)+$")
ISSUED_DATE = re.compile(r"^\d{2}/\d{2}/\d{4}$")


def clean(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\n", " ")).strip()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_row(cells: list[object]) -> dict[str, str] | None:
    values = [clean(cell) for cell in cells]
    while values and not values[-1]:
        values.pop()
    if len(values) < 5:
        return None
    permit_index = next((index for index, value in enumerate(values) if PERMIT_NUMBER.fullmatch(value)), None)
    if permit_index is None or permit_index + 4 >= len(values):
        return None
    issued_date = values[permit_index + 1]
    if not ISSUED_DATE.fullmatch(issued_date):
        return None
    permit_type = values[permit_index + 2]
    description = values[permit_index + 3]
    site_address = " ".join(value for value in values[permit_index + 4 :] if value)
    if not permit_type or not description or not site_address:
        return None
    classification = "commercial" if "(C)" in permit_type else "residential" if "(R)" in permit_type else "unclassified"
    return {
        "permitNumber": values[permit_index],
        "issuedDate": datetime.strptime(issued_date, "%m/%d/%Y").date().isoformat(),
        "permitType": permit_type,
        "description": description,
        "siteAddress": site_address,
        "classification": classification,
    }


def extract_report(path: Path) -> dict[str, object]:
    records: list[dict[str, object]] = []
    rejected_rows: list[dict[str, object]] = []
    with pdfplumber.open(path) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            tables = page.extract_tables()
            for table_number, table in enumerate(tables, start=1):
                for row_number, cells in enumerate(table, start=1):
                    normalized = normalize_row(cells)
                    if normalized:
                        records.append({
                            **normalized,
                            "sourceFile": path.name,
                            "sourcePage": page_number,
                            "sourceTable": table_number,
                            "sourceRow": row_number,
                        })
                    else:
                        text = " | ".join(clean(cell) for cell in cells if clean(cell))
                        if text and not ("Permit" in text and "Issued" in text and "Site Address" in text):
                            rejected_rows.append({
                                "sourceFile": path.name,
                                "sourcePage": page_number,
                                "sourceTable": table_number,
                                "sourceRow": row_number,
                                "text": text,
                            })
    return {
        "sourceFile": path.name,
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
        "pageCount": len(pdf.pages),
        "records": records,
        "rejectedRows": rejected_rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    input_dir = Path(args.input_dir)
    output = Path(args.output)
    reports = [extract_report(path) for path in sorted(input_dir.glob("*.pdf"))]
    all_records = [record for report in reports for record in report["records"]]
    permit_numbers = [record["permitNumber"] for record in all_records]
    event_keys = [f'{record["permitNumber"]}:{record["issuedDate"]}' for record in all_records]
    payload = {
        "schemaVersion": "wr-dallas-county-issued-permits-extraction-v1",
        "sourceFileCount": len(reports),
        "recordCount": len(all_records),
        "uniquePermitNumberCount": len(set(permit_numbers)),
        "duplicatePermitNumberCount": len(permit_numbers) - len(set(permit_numbers)),
        "uniquePermitEventCount": len(set(event_keys)),
        "duplicatePermitEventCount": len(event_keys) - len(set(event_keys)),
        "rejectedRowCount": sum(len(report["rejectedRows"]) for report in reports),
        "reports": reports,
        "records": all_records,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: payload[key] for key in ("sourceFileCount", "recordCount", "uniquePermitNumberCount", "duplicatePermitNumberCount", "uniquePermitEventCount", "duplicatePermitEventCount", "rejectedRowCount")}, indent=2))


if __name__ == "__main__":
    main()

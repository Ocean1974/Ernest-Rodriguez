# Dallas County DCAD Adapter

This folder is the county adapter home for Dallas County / DCAD.

## Files

- `adapter.json` locks the Dallas County source files, join keys, public service roots, required outputs, and verified counts.
- `../../schemas/universal-parcel.schema.json` is the county-neutral parcel contract Dallas maps into.

## Purpose

Use this folder as the working pattern for the next county adapter. Keep county-specific source mapping, join-key notes, count verification, and production tile handoff here before changing the active county config.

Every county should map raw parcel data into `wr-universal-parcel-v1` before publishing app parcel chunks.

## UI Rule

This adapter is data plumbing only. Do not redesign or restyle the White Rabbit pages while working inside this folder.

# Savant Data Maintenance Agent

This worker keeps the Savant Development Path Radar independent of Codex or any open browser session. It is deterministic and is intended to run in a dedicated production worker, scheduled job, or immutable release pipeline.

## Commands

- `npm run savant:agent:validate` validates current artifacts without fetching or rebuilding.
- `npm run savant:agent` fetches official permit sources, rebuilds every dependent artifact, runs focused tests, and authorizes publication only when all gates pass.
- `npm run savant:agent -- --skip-fetch` rebuilds from the existing raw permit snapshot.
- `npm run savant:agent -- --daemon` runs immediately and then repeats every `SAVANT_REFRESH_INTERVAL_HOURS` (default 24). A platform scheduler invoking the one-shot command is preferred for immutable deployments.

## Production contract

1. Run the agent in a release workspace, never inside the active static deployment.
2. Treat exit code `0` and `publishAuthorized: true` as the only permission to deploy the generated release.
3. Exit code `2` means validation completed but publication is blocked. Exit code `1` means the worker failed.
4. Keep the current production deployment active when a run is blocked or fails.
5. Publish `public/data/savant-tools/maintenance-status.json` with the release so the UI and health monitors can report the exact evidence state.
6. Retain `output/savant-maintenance-agent-runs.jsonl` and `output/savant-maintenance-agent-last-good.json` in durable worker storage.

## Accuracy gates

- Required artifacts and official source identities are present.
- Source API row counts equal fetched row counts.
- Raw snapshots are recent.
- Upstream source metadata reports a recent update time.
- Permit joined, unmatched, and search counts reconcile exactly.
- Permit join rate remains above the floor and does not regress beyond policy.
- Permit, development, opportunity, and radar counts reconcile.
- Candidate-count drift remains bounded relative to the last successful run.
- Radar accounts are unique, scored in descending order, and carry evidence-backed reason codes.
- Every downstream artifact was regenerated within the allowed pipeline window.

The agent fails closed. It never converts a build timestamp into an upstream source timestamp, and it never describes stale upstream data as current.

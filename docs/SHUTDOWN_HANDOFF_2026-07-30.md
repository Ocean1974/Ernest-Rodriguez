# White Rabbit Project — Shutdown Handoff

Saved: July 30, 2026  
Workspace: `C:\Users\ernes\OneDrive\Desktop\The White Rabbit Project`

## Safe shutdown status

- All current source, scripts, tests, reports, and generated county plans are stored on disk in the project workspace.
- The approved frontend design remains locked and was not changed during the Texas/Kentucky continuation work.
- Dallas remains the production baseline.
- Texas and Kentucky now advance as concurrent, independently quality-gated state pipelines.
- No additional county was activated without passing its county gate.

## Exact Texas/Kentucky status

- Texas: 254 counties total
  - 1 core complete
  - 1 partial/map-search ready
  - 252 require source work
- Kentucky: 120 counties total
  - 0 core complete
  - 1 partial/map-search ready
  - 119 require source work
- Combined: 374 counties total
  - 1 core complete
  - 2 partial/map-search ready
  - 371 require source work
- Verification queues: 373 remaining counties, with 50 counties in the first controlled batches.
- Priority ingestion plan: 14 high-value Texas/Kentucky counties; all 14 remain blocked from activation until official data and QC gates pass.

## Saved reports

- `output/tx-ky-verification-queues/tx-ky-verification-queues.md`
- `output/tx-ky-verification-queues/tx-ky-verification-queues.json`
- `output/tx-ky-completion-gate/tx-ky-completion-gate.md`
- `output/tx-ky-completion-gate/tx-ky-completion-gate.json`
- `output/county-batch-plan/tx-ky-priority-batch-plan.md`
- `output/county-batch-plan/tx-ky-priority-batch-plan.json`

## Verification completed before shutdown

- Full `npm.cmd test` suite passed.
- `npm.cmd run build:verify` passed.
- Production app shell was generated in `output/app-shell-build`.
- `http://127.0.0.1:5173/` returned HTTP 200.
- `http://127.0.0.1:5173/data/dallas-manifest.json` returned HTTP 200.

## Restart after powering the computer back on

Open PowerShell in the project folder:

```powershell
Set-Location "C:\Users\ernes\OneDrive\Desktop\The White Rabbit Project"
```

Start the verified app shell:

```powershell
Start-Process -FilePath npm.cmd `
  -ArgumentList @("run","preview","--","--host","127.0.0.1","--port","5173","--strictPort","--outDir","output/app-shell-build") `
  -WorkingDirectory "C:\Users\ernes\OneDrive\Desktop\The White Rabbit Project" `
  -WindowStyle Hidden
```

If the package preview command does not honor the custom output folder, use:

```powershell
npx.cmd vite preview --host 127.0.0.1 --port 5173 --strictPort --outDir output/app-shell-build
```

Then open:

```text
http://127.0.0.1:5173/
```

## Resume point

Continue the 14-county priority plan by obtaining and validating official county parcel sources. Preserve the locked frontend and keep each county inactive until schema, geometry, identifier, search, and production-tile checks pass.


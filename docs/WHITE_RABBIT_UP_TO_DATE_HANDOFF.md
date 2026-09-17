# White Rabbit Project

Timestamp: 2026-05-02 22:40:55 -04:00

## 1. Project Name

White Rabbit Project

## 2. Current Source-of-Truth Files

- `src/App.tsx` is the current White-rabbit-google-earth-landing baseline and the main file controlling the landing page, live map shell, map UI, parcel mode, search panels, and in-file self-tests.
- `src/main.tsx` imports `./App.tsx`, so the running Vite app uses `src/App.tsx` as the active application entry component.
- `src/map/loadParcels.ts` provides viewport parcel filtering/loading and full parcel search helpers used by `src/App.tsx`.
- `src/data/parcelAccessManifest.json`, `src/data/dcadOwnerParcels.json`, `src/data/parcelDimensionLabels.json`, `src/data/developmentIntel.json`, and `src/data/selectedParcelGeojson.json` are wired into `src/App.tsx`.
- `public/data/parcels/manifest.json` and `public/data/parcels/search-index.json` exist and are part of the current parcel loader/search assets.
- `tests/map-entry-mode.test.cjs` contains current regression checks for the landing page, Three.js globe, Enter Map behavior, and explicit Dallas parcel entry.
- `package.json` contains the current scripts and dependencies, including `three`, `@react-three/fiber`, and `@react-three/drei`.
- `AGENTS.md` remains the repo instruction file and says not to redesign the approved UI unless Ernest explicitly asks.

## 3. Current Landing Page Status

- The app still opens first on `WhiteRabbitLanding()`.
- The landing page currently renders a real Three.js / React Three Fiber globe via `LandingGlobe`, not the old flat landing `<img>` background.
- `LandingGlobe` uses:
  - `<Canvas />` from `@react-three/fiber`
  - `OrbitControls` and `Stars` from `@react-three/drei`
  - `THREE.CanvasTexture` for a procedural Earth texture
  - `sphereGeometry` for the Earth, a separate cloud shell, and an additive atmosphere glow shell
- Landing globe interaction is implemented through `OrbitControls`:
  - drag rotation is enabled
  - wheel/trackpad zoom is enabled
  - damping is enabled
  - idle `autoRotate` is enabled
  - panning is disabled
- `LandingEarth` also uses `useFrame()` to slowly rotate the Earth and cloud shell.
- The White Rabbit UI overlays remain outside the Canvas:
  - top rabbit branding/header
  - centered search bar
  - bottom-left Commercial Intelligence card
  - Enter Map button
- `Enter Map` still intentionally switches from `WhiteRabbitLanding()` to `WhiteRabbitMap()` by setting `enteredMap` to `true`.
- `Enter Map` does not auto-enter Dallas/DCAD parcel mode.
- Current landing page code uses `<LandingGlobe />` directly inside the landing root background.

## 4. Current Map Status

- `WhiteRabbitMap()` remains separate from `WhiteRabbitLanding()`.
- The live map screen starts in `mapMode = "earth"` and `earthIntroActive = true`.
- There is no timer-based automatic Dallas/DCAD transition in the current `WhiteRabbitMap()`.
- Dallas/DCAD parcel mode is entered through the explicit `enterDallasParcelMode()` function.
- `enterDallasParcelMode()` currently:
  - sets selected location to `DALLAS_LOCATION`
  - sets `mapMode` to `"parcel"`
  - sets the camera to `getParcelViewCamera()`
  - updates live map bounds
  - sets `earthIntroActive` to `false`
  - turns parcel labels and grid on
  - calls `mapApiRef.current?.flyToCamera?.(parcelCamera)`
- `TopBar` Parcel View and the manual `Enter Dallas Parcel View` button are wired to explicit parcel entry.
- Parcel selection/search jumps also call `jumpToParcel()`, which calls `enterDallasParcelMode()` before flying to the selected parcel.
- `LiveTileMapBackground` still controls the map shell background.
- Dallas aerial/satellite tiles from Esri World Imagery are gated by `isDallasParcelMode = !earthIntroActive && mapMode === "parcel"`.
- Before explicit parcel mode, the map shell still uses the Earth intro-style background path, not the new Three.js landing globe.
- The actual MapLibre map engine is present in `LiveMapEngine`, using `maplibregl.Map`.

## 5. Known Issues

- The new interactive Three.js globe is currently on the landing page, not the live map page. The interrupted request to move the interactive map/globe to the live map page did not complete and should be treated as not applied.
- The live map Earth intro still uses the older `LiveTileMapBackground` flat/CSS image-based Earth treatment. It has not been replaced with the Three.js `LandingGlobe`.
- The landing globe uses a procedural Earth texture generated in canvas, not a real satellite/photographic Earth texture.
- The procedural texture uses random speckles at runtime, so the exact cloud/highlight distribution may vary between reloads.
- The map screen still carries a `landingEarthOverlayVisible` transition overlay that uses the older flat Earth image when `preserveLandingEarth` is true.
- Some in-file self-tests still describe the Dallas overlay as four records, which is accurate for the fallback fixture path but should not be confused with full DCAD access.
- Full parcel loader/search code is wired, but the UI still has fallback sample behavior when live viewport/search loading returns no records or fails.
- `git.exe` is not available on PATH in this environment. A local `.git` checkpoint was created manually in prior save tasks, but normal Git CLI status/diff commands are unavailable.
- Large generated/data folders exist in the project (`data`, `output`, `public`, `dist`, `node_modules`). Prior checkpoint metadata excluded these heavy/generated folders from the local checkpoint.

## 6. Current Controls and Behaviors

Landing page:

- Dragging the globe rotates it through `OrbitControls`.
- Wheel/trackpad zoom adjusts the globe camera distance through `OrbitControls`.
- The globe slowly auto-rotates while idle.
- Search submission stores the landing search text and enters `WhiteRabbitMap()`.
- Enter Map stores the landing search text, preserves the landing Earth overlay during transition, and enters `WhiteRabbitMap()`.
- Landing does not call `setMapMode("parcel")`.
- Landing does not call `setEarthIntroActive(false)`.
- Landing does not set any `initialMapMode = "dallasParcel"` path.

Map page:

- Pointer drag and wheel handlers are active in the map shell.
- Compact controls provide zoom in, zoom out, and compass reset.
- TopBar Parcel View explicitly enters Dallas parcel mode.
- TopBar Value View switches from parcel mode into value mode.
- Exit Map returns to the landing page.
- Manual `Enter Dallas Parcel View` button appears while `earthIntroActive` is true and explicitly enters Dallas parcel mode.
- Search can find parcel records from loaded full-search results or fallback Dallas sample records.
- Search development results can jump to linked parcel records when available.
- Parcel clicks/jumps enter Dallas parcel mode and fly to the selected parcel.

## 7. Current Data Status

- The app still contains embedded `DCAD_DALLAS_SAMPLE` records for four modeled Dallas parcels:
  - `10300 SANDEN DR`
  - `1616 GREENVILLE AVE`
  - `1701 SKILLMAN ST`
  - `1901 N HENDERSON AVE`
- The app still contains `DALLAS_PARCEL_FEATURES` for those four fallback/prototype parcel overlays.
- `getDallasRenderableParcels()` joins the four fallback parcel features to the embedded sample records, owner sample data, dimension labels, and selected real parcel GeoJSON where available.
- `loadParcelRecordsForViewport()` is called from `WhiteRabbitMap()` using current `liveMapBounds` and `parcelRenderProfile.maxFeatures`.
- `searchFullParcelRecords()` is called for non-empty search text.
- If full viewport loading succeeds with records, `loadedDallasParcels` is used.
- If full search returns records, `loadedSearchResults` is used.
- If full loading/search fails or returns no usable records, the UI falls back to the four Dallas sample parcels.
- `parcelAccessManifest` is imported and connected as `FULL_PARCEL_ACCESS_META`.
- `public/data/parcels/search-index.json` exists and is large, indicating generated search/index assets are present in the repo folder.
- The original large DCAD ZIP/source data and generated output folders are present locally, but they were not part of the prior lightweight checkpoint.

## 8. Recommended Next Steps

1. Decide whether the interactive Three.js globe should remain on the landing page or move into the live map Earth intro page. If moving it, do that as a focused placement-only task.
2. Replace the live map Earth intro flat `LiveTileMapBackground` Earth treatment with the Three.js globe only if that is the approved direction, without changing Dallas parcel mode behavior.
3. Add a deterministic Earth texture or real Earth texture asset for `LandingGlobe` so the globe appearance is stable across reloads.
4. Verify live parcel viewport loading against `public/data/parcels/manifest.json` and `search-index.json`, then document exact counts and fallback behavior.
5. Install/configure a normal Git CLI or move the repo into an environment with Git available, then create a standard Git commit that includes the docs handoff file and the approved source/config/test files.

## 9. Git / Worktree Status

- Normal `git status` / `git diff` cannot be run because `git.exe` is not available on PATH in this environment.
- A local `.git` checkpoint repository exists from prior save tasks.
- The last recorded local checkpoint hash is `721dbe4856bb96300caca10cd96dbe984bc99277` with message `Save approved White Rabbit landing-page baseline`.
- This handoff task creates one new file: `docs/WHITE_RABBIT_UP_TO_DATE_HANDOFF.md`.
- No application code, styling, map behavior, or landing behavior was intentionally changed for this handoff task.
- Do not treat heavy generated folders (`node_modules`, `dist`, `data`, `output`, `public`) as normal source commits unless intentionally creating a large data checkpoint.

## 10. Current Command Status

- The most recent known successful verification before this handoff:
  - `npm test` passed
  - `npm run build` passed
- Those commands were not rerun for this documentation-only handoff task.

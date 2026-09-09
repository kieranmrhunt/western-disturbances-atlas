# Western Disturbance Atlas

Static GitHub Pages atlas for the ERA5-derived WD v7 catalogue: 49,200 regional candidate trajectories and 1,493,423 three-hourly track points from 1950–2025.

The interface shares the visual language and main workflow of the [Monsoon Low-Pressure System Atlas](https://kieranmrhunt.github.io/monsoon-low-atlas/) while retaining WD-specific diagnostics and removing LPS-specific concepts.

## Scientific conventions

- `track_id` identifies one Lagrangian trajectory and is the atlas grain for maps, counts, filtering and exports.
- Genesis and lysis are the first and last published three-hourly track points.
- Display names are `WD YYYY NNN`, using genesis year and within-year genesis order; the original `track_id` remains in exports and deep links.
- Year controls use calendar years; exact date ranges select a particular winter. The configurable crossing marker defaults to 60°E, uses the first linearly interpolated crossing and does not realign trajectories.
- Intensity is track-centred relative vorticity averaged through the 450–300 hPa layer, spectrally truncated to T42, in 10⁻⁵ s⁻¹. This is the upper-tropospheric WD diagnostic; the site does not substitute 850-hPa LPS vorticity.
- Precipitation is the catalogue's track-centred or regional 24 h diagnostic in mm.
- Vorticity, precipitation and path-length percentiles are fixed against the complete 49,200-track catalogue. Filtering does not rescale them.
- Density counts each trajectory once per one-degree grid cell. Density remains selectable through a geographical segment index built from the underlying trajectories.
- The five precipitation-impact boxes are transparent analysis regions, not administrative boundaries. “Dominant” is the box with the largest peak 24 h precipitation for a trajectory.
- Genesis locations use the four winter k-means clusters from Figure 5 of the 2025 WD review (North Atlantic jet stream, Alps/Northern Europe, Mediterranean and Zagros), with distant points assigned to `Other` using the original clusters' 99.5% distance envelopes.
- Eight exploratory route archetypes use standardised longitude and latitude interpolated at nine elapsed-life fractions. Multi-WD spells link systems in the same winter and dominant precipitation region when the next genesis occurs within 72 hours of the latest lysis.
- Catalogue analogues are ranked principally by standardised full-trajectory shape, with smaller lifetime, intensity, path-length and precipitation penalties, across different years.
- ERA5-derived catalogue extremes are internal diagnostics, not authoritative meteorological records.
- The selected-track slider and evolution chart both follow actual catalogue track-point times. Independent gridded ERA5 backgrounds provide contemporaneous 350-hPa vorticity, trailing 24 h precipitation, 500-hPa wind, temperature and specific humidity, and mean-sea-level pressure.

The atlas deliberately omits LPS pressure-deficit classes, IBTrACS matching, BSISO filters, cyclone names and Indian-state precipitation fills.

## Geographic selection

The base catalogue retains trajectories lasting ≥24 h, with peak T42 vorticity ≥2 × 10⁻⁵ s⁻¹ and a track point in 55–90°E, 20–50°N. The atlas offers entry into a user-defined box, a latitude band east of a chosen longitude, an eastward meridian crossing, or no further entry requirement. Tests use float32 coordinates along complete trajectories, interpolate gaps up to 9 h, and include box boundaries.

Defaults are DJFM genesis, lifetime ≥48 h, an eastward 70°E crossing at 20–50°N, and screened track quality. The optional quality screen requires ≥80% temporal coverage, ≤20% ambiguous links and reverse-check disagreements, and no detector-boundary/source-time censoring. With all months, this gives 12,944 tracks. Removing entry and quality restrictions and setting lifetime to 24 h exposes all 49,200 tracks. The same rules apply to counts, plots, exports, saved links and pinned references.

## Features

- Shared global filters for calendar years, exact active-date ranges, month/season (genesis, active, peak-vorticity or peak-precipitation timing), review-paper genesis region, lysis sector, route archetype, sequence membership, contemporaneous climate regime, upper-level vorticity percentile, precipitation percentile, path length, duration and dominant impact region.
- Deep-linkable filter, tab, map and selection state.
- Individual tracks by default, plus unique-track density, genesis, lysis and selected-track-only layers; every data layer can select the true nearest trajectory using point-to-segment distance rather than canvas paint order. The selected trajectory is black.
- Contemporaneous ERA5 overlays for positive 350-hPa vorticity, trailing 24 h precipitation, 500-hPa wind speed, temperature and specific humidity, and mean-sea-level pressure. New archive-wide fields stay disabled until their validation manifest exists.
- Per-track dossiers, previous/next navigation, nearest trajectory analogues, actual-UTC track-point stepping, and accessible lifecycle plots. Selected-system evolution supports three line variables with independent axes while keeping precipitation bars visible; subset evolution supports six small multiples whose axes fit the filtered interquartile range, with the all-catalogue median retained as a reference.
- Selected-system time–pressure sections of vorticity at 850, 700, 500, 450, 400, 350 and 300 hPa; other ERA5 fields at 850, 700 and 500 hPa, first-meridian-crossing markers, daily 200-hPa jet relationship diagnostics, and lazy lifetime precipitation footprints. Times absent from the jet source, including 29–31 October 2023, remain unavailable.
- Genesis-month NOAA PSL ONI, NAO, AO and PNA filters plus daily BOM RMM MJO phase. These are regime descriptors rather than causal attribution.
- Filter-aware annual, seasonal, impact-region and genesis-density climatologies.
- Filter-aware catalogue extremes.
- Summary CSV, track GeoJSON, reproducibility JSON and selected-track-point CSV exports.
- Responsive mobile layout and keyboard-accessible tab, table and chart alternatives.

## September 2026 additions

P1–P8 and P10–P12 are included; P9 state/regional precipitation fills are not.
The masthead strapline has been removed.

- Extremes include finite-only diagnostic histograms, grouped median/IQR boxes
  with 5–95% whiskers, and selectable two-variable scatter plots with CSV export.
- Annual activity supports system counts, systems per 100 selected calendar
  days and WD-days, with a centred 11-year mean only for complete windows.
  Event counts follow the selected time anchor; WD-days integrate overlap.
- Climatology adds genesis-to-lysis pathways and climate-state composition
  against a time/month-matched catalogue reference.
- A pinned subset supplies the reference median/IQR for evolution plots and
  the reference storm-centred composite. Both plotted IQRs determine shared
  evolution scales when a reference is pinned. Links preserve the reference.
- IMDAA and ERA-Interim trajectory overlays use explicitly labelled legacy
  catalogues. `scripts/build_reanalysis_matches.py` records source hashes,
  temporal overlap, distance and uniqueness checks; no-match is not absence.
- Storm-relative precipitation and longitude–pressure composites use local
  ERA5 data, with one independent Slurm job per WD. Missing cells and partial
  archives remain explicit; downloads include each cell's sample count.

### Operational WD forecasts

`scripts/build_forecasts.py` reuses the neighbouring LPS atlas's provider
adapters and byte-range inventory handling, not its LPS tracks. Only required
upper-level wind and precipitation GRIB messages are downloaded. Existing
500/700/850-hPa LPS products alone cannot supply the WD layer diagnostic.

The experimental detector uses T42 450–300-hPa layer vorticity, a 2 × 10⁻⁵ s⁻¹
positive maximum threshold, 900-km spherical predictive links per six hours,
36-hour minimum lifetime, eastward progress, path efficiency ≥0.1 and a
60–80°E, 20–50°N impact-domain intersection. This forecast-specific maximum
detector is not numerically identical to the catalogue centroid detector.
GFS uses native 300/350/400/450-hPa winds; IFS, AIFS and GEFS interpolate the
350/450-hPa levels from 300/400/500 hPa. Precipitation is exact trailing 24 h
accumulation, unavailable before lead 24 h, area-weighted within 400 km along
tracks. GEFS contains its control and 30 perturbed members; grouped member
support is conditional on detection/matching, not a probability forecast.

The Forecasts tab provides model/cycle selection, matched ensemble groups,
optional member trajectories, selectable tracks, weather overlays, map
pan/zoom and a draggable evolution-time marker. GFS, IFS and AIFS are shown
individually or together. Forecast filters are separate from catalogue filters.
Runs older than 30 h are labelled stale.

```bash
python scripts/submit_forecast_update.py --dry-run
python scripts/install_forecast_cron.py --apply
```

The installer preserves and backs up existing cron tasks. An hourly check
submits missing members from the latest two eligible cycles after a five-hour
publication allowance, skips completed/active members and retries failures.
Slurm schedules jobs without an application-level concurrency cap. Each
validated member is published atomically to the public `atlas-forecasts-v1`
directory; incomplete members are not advertised. Raw, re-downloadable GRIB
cache messages expire after 48 h; published forecast runs are retained.
All workers reuse the shared `.weather-runtime` font/cache directories.

Forecast providers: [NOAA/NCEP](https://www.nco.ncep.noaa.gov/pmb/products/gfs/)
and [ECMWF Open Data](https://www.ecmwf.int/en/forecasts/datasets/open-data)
(IFS/AIFS under CC-BY-4.0). Outputs are modified research guidance, not official
warnings. The runtime uses the existing `py311` environment and neighbouring
LPS provider utilities; see the Slurm scripts for resolved environment paths.

### Storm-centred archive

```bash
sbatch --array=0-8148 scripts/build_composites.slurm 0
sbatch --array=0-8148 scripts/build_composites.slurm 8149
sbatch --dependency=afterany:JOB_A:JOB_B scripts/finalize_composites.slurm
```

The builder uses BADC ERA5 model-level longitude sections when present;
otherwise it uses the local UT-vorticity/South-Asia pressure-level archive.
It never silently downloads full-globe remote chunks. Model-level fields are
surface-pressure masked; the older pressure-level fallback lacks a surface
pressure field, so below-ground extrapolation can remain at lower levels.
Nine snapshots use actual UTC track points nearest equal elapsed-life
fractions. Precipitation is mean UTC-day total in a moving, north-up frame,
not the lifetime accumulation and not causal attribution. Per-WD products
retain full 0.25° sections; annual subset shards use a compact 1° grid and
nine pressure levels. Finalization publishes files before its inventory.

### Climate-change comparison

`scripts/build_climate_change.py` audits the existing CMIP5 CSVs against the
original six-hourly model-time arrays. It preserves 360-day and no-leap
calendars and counts each system once, at first entry to 60–80°E, 20–36.5°N.
The tab uses model pairs with all 240 months covered in both 1980–1999 and
2080–2099, equal model weights and archived RCP2.6/4.5/6.0/8.5 scenarios.
Incomplete months are unavailable, not zero. Input hashes, completeness and
exclusions are in `assets/wd-climate-change-v1.json.gz`. This is an explicitly
legacy CMIP5 comparison, not CMIP6 or the revised ERA5 detector. Intensity
comparisons are withheld because the CSVs do not uniquely encode the original
detector configuration.

Numerical and browser checks are in `scripts/test_analysis_core.cjs`,
`scripts/test_forecasts.py` and `scripts/browser_science_smoke.cjs`.

## Deployment

Deploy `index.html` and `assets/` together. The catalogue application remains static; monthly weather videos are fetched from the public JASMIN GWS configured in `wd-data-config`.

For local development, serve the repository over HTTP because browsers do not allow `fetch()` of local gzip assets from a `file://` page:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/`.

## Asset layout

- `assets/wd-atlas-catalogue-v7.json.gz`: catalogue metadata, track summaries, track-point offsets and evolution-field descriptors.
- `assets/wd-atlas-points-v7.i16.gz`: concatenated track-point `int16` longitude ×100, latitude ×100, vorticity ×10 and precipitation ×100 arrays.
- `assets/wd-atlas-times-v7.i32.gz`: actual track-point times as integer hours since 1950-01-01 UTC, preserving gaps bridged by the tracker.
- `assets/wd-atlas-diag-v7-*.f32.gz`: one `float32` per track point per diagnostic file, fetched only when selected.
- `assets/wd-atlas-routes-v7.json.gz`: eight trajectory-shape archetypes and track assignments.
- `assets/wd-atlas-climate-v7.json.gz`: genesis-time NOAA and BOM regime values and categories.
- `assets/wd-atlas-jet-v7.json`: daily 200-hPa jet diagnostic definitions and availability.
- `assets/map-context.js`: quantised Natural Earth coastline and national-border polylines.
- `assets/wd-atlas-coordinates-v7.f32.gz`: higher-precision longitude/latitude arrays for geographic selection.
- `assets/atlas-build-manifest.json`: source and asset SHA-256 checksums.
- `assets/atlas.css`: shared monsoon-atlas design language plus WD additions.
- `assets/atlas-app.js`: dependency-free atlas application.

Modern browsers decompress the gzip assets with `DecompressionStream`.

## Existing weather archive and v6 maintenance

`data/wd-weather-months.csv` lists every catalogue month from January 1950 through December 2025. Build a single smoke-test month with:

```bash
python scripts/build_weather_videos.py \
  --field vorticity350 \
  --month 201712 \
  --output-dir /home/users/kieran/incompass/public/kieran/track_data/WD/atlas-weather-v5-r1
```

The original month-at-a-time Slurm array is retained for small repairs. For a
full archive build, use four resumable sub-month chunks so a slow source read
cannot occupy an array slot for six hours:

```bash
chunk_job=$(sbatch --parsable scripts/build_weather_chunks.slurm \
  data/wd-weather-months.csv \
  /home/users/kieran/incompass/public/kieran/track_data/WD/atlas-weather-v5-r1 \
  wind500)
assemble_job=$(sbatch --parsable --dependency=afterany:${chunk_job} \
  scripts/assemble_weather_videos.slurm \
  data/wd-weather-months.csv \
  /home/users/kieran/incompass/public/kieran/track_data/WD/atlas-weather-v5-r1 \
  wind500)
sbatch --dependency=afterany:${assemble_job} scripts/finalize_weather_archive.slurm \
  data/wd-weather-months.csv \
  /home/users/kieran/incompass/public/kieran/track_data/WD/atlas-weather-v5-r1 \
  wind500
```

Each chunk contains one quarter of a month as deterministic gzip-compressed
RGB frames. The assembly array validates all four chunks before encoding the
monthly WebM. Existing validated monthly videos are skipped by both stages, so
the workflow is restartable. Run the four optional fields serially to avoid
multiple field arrays competing to read the same archive. Within each field,
Slurm schedules all eligible chunks without an application-level concurrency
throttle; the helper retains a four-hour ceiling for unusually slow reads:

```bash
bash scripts/submit_weather_staging_serial.sh
```

If an ERA5T source month was downloaded before its final analyses appeared,
stage only the missing pressure-level vorticity times without rewriting the
original multi-gigabyte month:

```bash
python scripts/fetch_vorticity_supplement.py \
  /home/users/kieran/ncas/data/era5-incompass/ut-vort/202512.nc
```

The builder automatically merges a validated
`ut-vort/_supplements/YYYYMM.nc` file. Set `WD_WEATHER_OVERWRITE=1` on a
targeted chunk and assembly submission to replace an already encoded partial
month.

After the array completes, validate every month and write the public manifest:

```bash
python scripts/build_weather_videos.py \
  --field vorticity350 \
  --month-manifest data/wd-weather-months.csv \
  --output-dir /home/users/kieran/incompass/public/kieran/track_data/WD/atlas-weather-v5-r1 \
  --finalize
```

For an unattended build, submit that finalization with `--dependency=afterok:<array-job-id>` using `scripts/finalize_weather_archive.slurm`.

Each WebM frame stores colour in its left half and an opacity mask as right-half luma. The frontend reconstructs RGBA in a canvas. Vorticity and 500-hPa fields use one frame per ERA5 three-hourly analysis; precipitation and mean-sea-level pressure use one frame per hour.

Impact footprints use one independently verifiable job per WD, followed by a
short yearly order-and-pack stage. Existing complete year shards are skipped,
so this can resume without rebuilding published years:

```bash
track_job_a=$(sbatch --parsable scripts/build_impact_tracks.slurm 0)
track_job_b=$(sbatch --parsable scripts/build_impact_tracks.slurm 8149)
assemble_job=$(sbatch --parsable --dependency=afterany:${track_job_a}:${track_job_b} \
  scripts/assemble_impact_track_years.slurm)
sbatch --dependency=afterany:${assemble_job} scripts/finalize_impact_footprints.slurm
```

The finalizer reconciles yearly track IDs with WD v6, checks every packed-grid
shape and checksum, and writes `impact-manifest.json` to the public archive.
Completed yearly shards are skipped, and the staging manifest remains usable
while incomplete years are being assembled.

Each track task reads only its inclusive genesis-to-lysis interval, even when
that interval crosses a month boundary. Per-track metadata records identity,
time range, source files, grid, shape and checksum; a year is not published if
any expected track is absent or invalid. The earlier monthly-contribution
scripts remain only for provenance of already staged intermediate files.

## v7 track-dependent products

The gridded weather backgrounds are unchanged: they do not depend on track IDs.
Lifetime footprints and storm-centred composites are rebuilt for the v7 positions
and timestamps and published under `atlas-impact-v7` and `atlas-composites-v7`.
Earlier versioned products are retained.

```bash
python scripts/build_impact_v7.py --prepare
sbatch --array=0-911 scripts/build_impact_v7.slurm
# After all monthly parts finish:
python scripts/build_impact_v7.py --assemble

python scripts/build_composites_v7.py --prepare
# One task per WD, in arrays of at most 10,000; final array has 9,200 tasks.
sbatch --array=0-9999 scripts/build_composites_v7.slurm 0
# Repeat with offsets 10000, 20000, 30000; then 0-9199 with offset 40000.
python scripts/build_composites_v7.py --finalize
```

Outputs are staged locally under `.v7-products/`. Publish data before its
inventory. The footprint assembler requires complete hourly coverage for every
track; composite inventories explicitly identify the available systems.

## Rebuilding the catalogue assets

Build the WD-v7 browser assets from the validated Parquet catalogue with:

```bash
python scripts/build_catalogue_v7.py
sbatch scripts/refresh_v7_context.slurm
# After the context job completes:
python scripts/refresh_asset_manifest_v7.py
python scripts/validate_atlas.py
node scripts/test_geography.cjs
```

The builder enforces row, key and per-track count conservation and writes deterministic gzip files plus a SHA-256 manifest.

## Legacy split assets

The original deployment embedded the catalogue and map context in one 3.9 MB HTML file. To reproduce the split assets from a checkout of that legacy file:

```bash
python scripts/split_legacy_assets.py path/to/legacy-index.html --output-dir assets
```

The splitter preserves the original gzip streams byte for byte and records their checksums. It does not reinterpret or regenerate the scientific catalogue.

The common stylesheet can be refreshed from a monsoon-atlas checkout with:

```bash
python scripts/import_lps_style.py path/to/monsoon-low-atlas/index.html assets/atlas.css
```

Reapply the WD additions at the end of `assets/atlas.css` after importing a newer upstream style.

## Provenance

The atlas currently uses the v7 catalogue. Earlier dataset releases remain under the [Western disturbance dataset concept DOI](https://doi.org/10.5281/zenodo.18328597); this atlas refresh does not publish a new Zenodo version.

# Western Disturbances Atlas

Static GitHub Pages atlas for the ERA5-derived WD v5 catalogue: 16,850 western-disturbance trajectories and 398,584 three-hourly fixes from 1950–2025.

The interface shares the visual language and main workflow of the [Monsoon Low-Pressure System Atlas](https://kieranmrhunt.github.io/monsoon-low-atlas/) while retaining WD-specific diagnostics and removing LPS-specific concepts.

## Scientific conventions

- `track_id` identifies one Lagrangian trajectory and is the atlas grain for maps, counts, filtering and exports.
- Genesis and lysis are the first and last published three-hourly fixes.
- Display names are `WD YYYY NNN`, using genesis year and within-year genesis order; the original `track_id` remains in exports and deep links.
- Intensity is track-centred relative vorticity averaged through the 450–300 hPa layer, spectrally truncated to T42, in 10⁻⁵ s⁻¹. This is the upper-tropospheric WD diagnostic; the site does not substitute 850-hPa LPS vorticity.
- Precipitation is the catalogue's track-centred or regional 24 h diagnostic in mm.
- Vorticity, precipitation and path-length percentiles are fixed against the complete 16,850-track snapshot. Filtering does not rescale them.
- Density counts each trajectory once per one-degree grid cell. Density remains selectable through a geographical segment index built from the underlying trajectories.
- The five precipitation-impact boxes are transparent analysis regions, not administrative boundaries. “Dominant” is the box with the largest peak 24 h precipitation for a trajectory.
- Genesis locations use the four winter k-means clusters from Figure 5 of the 2025 WD review (North Atlantic jet stream, Alps/Northern Europe, Mediterranean and Zagros), with distant points assigned to `Other` using the original clusters' 99.5% distance envelopes.
- ERA5-derived catalogue extremes are internal diagnostics, not authoritative meteorological records.
- The selected-track time control follows catalogue fixes and their 450–300 hPa vorticity. Independent gridded ERA5 backgrounds provide 350-hPa vorticity and trailing 24 h precipitation at the same valid time.

The atlas deliberately omits LPS pressure-deficit classes, IBTrACS matching, BSISO filters, cyclone names and Indian-state precipitation fills.

## Features

- Shared global filters for genesis years or exact active-date ranges, genesis month/season, review-paper genesis region, upper-level vorticity percentile, precipitation percentile, path length, duration and dominant impact region.
- Deep-linkable filter, tab, map and selection state.
- Individual tracks by default, plus unique-track density, genesis, lysis and selected-track-only layers; every data layer can select the true nearest trajectory using point-to-segment distance rather than canvas paint order. The selected trajectory is black.
- Contemporaneous ERA5 overlays for three-hourly positive 350-hPa vorticity at 0.5° and hourly trailing 24 h precipitation at 1°.
- Per-track dossiers, three-hourly time stepping, regional precipitation diagnostics and accessible lifecycle plots for stored vorticity, precipitation, position and trajectory-derived speed, cumulative path and displacement.
- Filter-aware annual, seasonal, impact-region and genesis-density climatologies.
- Filter-aware catalogue extremes.
- Summary CSV, track GeoJSON, reproducibility JSON and selected-fix CSV exports.
- Responsive mobile layout and keyboard-accessible tab, table and chart alternatives.

## Deployment

Deploy `index.html` and `assets/` together. The catalogue application remains static; monthly weather videos are fetched from the public JASMIN GWS configured in `wd-data-config`.

For local development, serve the repository over HTTP because browsers do not allow `fetch()` of local gzip assets from a `file://` page:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/`.

## Asset layout

- `assets/wd-atlas-catalogue-v5.json.gz`: catalogue metadata, track summaries and fix offsets.
- `assets/wd-atlas-fixes-v5.i16.gz`: concatenated `int16` longitude ×100, latitude ×100, vorticity ×10 and precipitation ×100 arrays.
- `assets/map-context.js`: quantised Natural Earth coastline and national-border polylines.
- `assets/atlas-build-manifest.json`: byte counts and SHA-256 checksums.
- `assets/atlas.css`: shared monsoon-atlas design language plus WD additions.
- `assets/atlas-app.js`: dependency-free atlas application.

Modern browsers decompress the two gzip assets with `DecompressionStream`.

## Weather archive

`data/wd-weather-months.csv` lists every catalogue month from January 1950 through December 2025. Build a single smoke-test month with:

```bash
python scripts/build_weather_videos.py \
  --field vorticity350 \
  --month 201712 \
  --output-dir /home/users/kieran/incompass/public/kieran/track_data/WD/atlas-weather-v5-r1
```

The Slurm array renders the complete archive:

```bash
mkdir -p hpc-logs
sbatch scripts/build_weather_videos.slurm \
  data/wd-weather-months.csv \
  /home/users/kieran/incompass/public/kieran/track_data/WD/atlas-weather-v5-r1 \
  vorticity350
```

After the array completes, validate every month and write the public manifest:

```bash
python scripts/build_weather_videos.py \
  --field vorticity350 \
  --month-manifest data/wd-weather-months.csv \
  --output-dir /home/users/kieran/incompass/public/kieran/track_data/WD/atlas-weather-v5-r1 \
  --finalize
```

For an unattended build, submit that finalization with `--dependency=afterok:<array-job-id>` using `scripts/finalize_weather_archive.slurm`.

Each WebM frame stores colour in its left half and an opacity mask as right-half luma. The frontend reconstructs RGBA in a canvas. Vorticity uses one frame per ERA5 three-hourly analysis; precipitation uses one frame per hour.

## Rebuilding the split assets

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

The atlas links to the archived 1950–2022 dataset at [Zenodo](https://doi.org/10.5281/zenodo.8208019). The deployed atlas snapshot extends through 2025; until that extension has its own archived release record, exports identify it as `WD v5 atlas snapshot` rather than implying Zenodo contains the later years.

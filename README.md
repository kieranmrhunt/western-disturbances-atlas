# Western Disturbance Atlas

Static GitHub Pages atlas for the corrected ERA5-derived WD v6 catalogue: 16,298 western-disturbance trajectories and 460,411 three-hourly track points from 1950–2025.

The interface shares the visual language and main workflow of the [Monsoon Low-Pressure System Atlas](https://kieranmrhunt.github.io/monsoon-low-atlas/) while retaining WD-specific diagnostics and removing LPS-specific concepts.

## Scientific conventions

- `track_id` identifies one Lagrangian trajectory and is the atlas grain for maps, counts, filtering and exports.
- Genesis and lysis are the first and last published three-hourly track points.
- Display names are `WD YYYY NNN`, using genesis year and within-year genesis order; the original `track_id` remains in exports and deep links.
- Winter years assign December genesis events to the following year. The configurable crossing marker is the first linearly interpolated crossing of that longitude and does not realign trajectories.
- Intensity is track-centred relative vorticity averaged through the 450–300 hPa layer, spectrally truncated to T42, in 10⁻⁵ s⁻¹. This is the upper-tropospheric WD diagnostic; the site does not substitute 850-hPa LPS vorticity.
- Precipitation is the catalogue's track-centred or regional 24 h diagnostic in mm.
- Vorticity, precipitation and path-length percentiles are fixed against the complete 16,298-track catalogue. Filtering does not rescale them.
- Density counts each trajectory once per one-degree grid cell. Density remains selectable through a geographical segment index built from the underlying trajectories.
- The five precipitation-impact boxes are transparent analysis regions, not administrative boundaries. “Dominant” is the box with the largest peak 24 h precipitation for a trajectory.
- Genesis locations use the four winter k-means clusters from Figure 5 of the 2025 WD review (North Atlantic jet stream, Alps/Northern Europe, Mediterranean and Zagros), with distant points assigned to `Other` using the original clusters' 99.5% distance envelopes.
- Eight exploratory route archetypes use standardised longitude and latitude interpolated at nine elapsed-life fractions. Multi-WD spells link systems in the same winter and dominant precipitation region when the next genesis occurs within 72 hours of the latest lysis.
- Catalogue analogues are ranked principally by standardised full-trajectory shape, with smaller genesis-month, lifetime, intensity and precipitation penalties.
- ERA5-derived catalogue extremes are internal diagnostics, not authoritative meteorological records.
- The selected-track slider and evolution chart both follow actual catalogue track-point times. Independent gridded ERA5 backgrounds provide contemporaneous 350-hPa vorticity, trailing 24 h precipitation, 500-hPa wind, temperature and specific humidity, and mean-sea-level pressure.

The atlas deliberately omits LPS pressure-deficit classes, IBTrACS matching, BSISO filters, cyclone names and Indian-state precipitation fills.

## Features

- Shared global filters for calendar or winter genesis years, exact active-date ranges, genesis month/season, review-paper genesis region, lysis sector, route archetype, sequence membership, contemporaneous climate regime, upper-level vorticity percentile, precipitation percentile, path length, duration and dominant impact region.
- Deep-linkable filter, tab, map and selection state.
- Individual tracks by default, plus unique-track density, genesis, lysis and selected-track-only layers; every data layer can select the true nearest trajectory using point-to-segment distance rather than canvas paint order. The selected trajectory is black.
- Contemporaneous ERA5 overlays for positive 350-hPa vorticity, trailing 24 h precipitation, 500-hPa wind speed, temperature and specific humidity, and mean-sea-level pressure. New archive-wide fields stay disabled until their validation manifest exists.
- Per-track dossiers, previous/next navigation, nearest trajectory analogues, actual-UTC track-point stepping, and accessible lifecycle plots. Selected-system evolution supports three line variables with independent axes while keeping precipitation bars visible; subset evolution supports six small multiples whose axes fit the filtered data, with the all-catalogue median retained as a reference.
- Selected-system time–pressure sections of vorticity and other ERA5 fields at 850, 700 and 500 hPa, first-meridian-crossing markers, daily 200-hPa jet relationship diagnostics, and lazy lifetime precipitation footprints. Thirty-four track points on 29–31 October 2023 are absent from the jet source and remain unavailable.
- Genesis-month NOAA PSL ONI, NAO, AO and PNA filters plus daily BOM RMM MJO phase. These are regime descriptors rather than causal attribution.
- Filter-aware annual, seasonal, impact-region and genesis-density climatologies.
- Filter-aware catalogue extremes.
- Summary CSV, track GeoJSON, reproducibility JSON and selected-track-point CSV exports.
- Responsive mobile layout and keyboard-accessible tab, table and chart alternatives.

## Deployment

Deploy `index.html` and `assets/` together. The catalogue application remains static; monthly weather videos are fetched from the public JASMIN GWS configured in `wd-data-config`.

For local development, serve the repository over HTTP because browsers do not allow `fetch()` of local gzip assets from a `file://` page:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/`.

## Asset layout

- `assets/wd-atlas-catalogue-v6.json.gz`: catalogue metadata, track summaries, track-point offsets and evolution-field descriptors.
- `assets/wd-atlas-fixes-v6.i16.gz`: concatenated track-point `int16` longitude ×100, latitude ×100, vorticity ×10 and precipitation ×100 arrays.
- `assets/wd-atlas-times-v6.i32.gz`: actual track-point times as integer hours since 1950-01-01 UTC, preserving gaps bridged by the tracker.
- `assets/wd-atlas-diag-v6-*.f32.gz`: one `float32` per track point per diagnostic file, fetched only when selected.
- `assets/wd-atlas-routes-v1.json.gz`: eight trajectory-shape archetypes and track assignments.
- `assets/wd-atlas-climate-v1.json.gz`: genesis-time NOAA and BOM regime values and categories.
- `assets/wd-atlas-jet-v1.json`: daily 200-hPa jet diagnostic definitions and availability.
- `assets/map-context.js`: quantised Natural Earth coastline and national-border polylines.
- `assets/atlas-build-manifest.json`: byte counts and SHA-256 checksums.
- `assets/atlas.css`: shared monsoon-atlas design language plus WD additions.
- `assets/atlas-app.js`: dependency-free atlas application.

Modern browsers decompress the gzip assets with `DecompressionStream`.

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

Each WebM frame stores colour in its left half and an opacity mask as right-half luma. The frontend reconstructs RGBA in a canvas. Vorticity and 500-hPa fields use one frame per ERA5 three-hourly analysis; precipitation and mean-sea-level pressure use one frame per hour.

The impact-footprint array and its dependent validator are submitted with:

```bash
sbatch scripts/build_impact_footprints.slurm
sbatch --dependency=afterok:<array-job-id> scripts/finalize_impact_footprints.slurm
```

The finalizer reconciles yearly track IDs with WD v6, checks every packed-grid shape and checksum, and writes `impact-manifest.json` to the public archive.

## Rebuilding the catalogue assets

Build the WD-v6 browser assets from the validated Parquet catalogue with:

```bash
python scripts/build_catalogue_v6.py
python scripts/build_route_archetypes.py
python scripts/build_climate_indices.py
sbatch scripts/build_jet_diagnostics.slurm
python scripts/validate_atlas.py
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

The atlas follows the versioned dataset under the [Western disturbance dataset concept DOI](https://doi.org/10.5281/zenodo.18328597). A new WD-v6 version is prepared as a Zenodo draft for author review; the concept DOI continues to resolve to the latest published version until that draft is published.

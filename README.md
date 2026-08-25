# Western Disturbances Atlas

Static GitHub Pages atlas for the ERA5-derived WD v5 catalogue: 16,850 western-disturbance trajectories and 398,584 three-hourly fixes from 1950–2025.

The interface shares the visual language and main workflow of the [Monsoon Low-Pressure System Atlas](https://kieranmrhunt.github.io/monsoon-low-atlas/) while retaining WD-specific diagnostics and removing LPS-specific concepts.

## Scientific conventions

- `track_id` identifies one Lagrangian trajectory and is the atlas grain for maps, counts, filtering and exports.
- Genesis and lysis are the first and last published three-hourly fixes.
- Intensity is track-centred relative vorticity averaged through the 450–300 hPa layer, spectrally truncated to T42, in 10⁻⁵ s⁻¹. This is the upper-tropospheric WD diagnostic; the site does not substitute 850-hPa LPS vorticity.
- Precipitation is the catalogue's track-centred or regional 24 h diagnostic in mm.
- Vorticity, precipitation and path-length percentiles are fixed against the complete 16,850-track snapshot. Filtering does not rescale them.
- Density counts each trajectory once per one-degree grid cell.
- The five rainfall-impact boxes are transparent analysis regions, not administrative boundaries. “Dominant” is the box with the largest peak 24 h precipitation for a trajectory.
- ERA5-derived catalogue extremes are internal diagnostics, not authoritative meteorological records.
- The selected-track time control follows catalogue fixes and their 450–300 hPa vorticity. It is not a gridded synoptic weather reconstruction.

The atlas deliberately omits LPS pressure-deficit classes, IBTrACS matching, BSISO filters, cyclone names and Indian-state rainfall fills.

## Features

- Shared global filters for genesis date, months, upper-level vorticity percentile, precipitation percentile, path length, duration and dominant impact region.
- Deep-linkable filter, tab, map and selection state.
- Unique-track density, individual tracks, genesis and lysis map layers; map pan, zoom, subset fit and multiple colour schemes.
- Per-track dossiers, three-hourly time stepping, regional rainfall diagnostics and accessible lifecycle values.
- Filter-aware annual, seasonal, impact-region and genesis-density climatologies.
- Filter-aware catalogue extremes.
- Summary CSV, track GeoJSON, reproducibility JSON and selected-fix CSV exports.
- Responsive mobile layout and keyboard-accessible tab, table and chart alternatives.

## Deployment

Deploy `index.html` and `assets/` together. No server-side component or build step is required for the current checked-in assets.

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

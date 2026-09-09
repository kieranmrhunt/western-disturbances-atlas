# September 2026 atlas expansion

Scope: P1–P8, P10–P12; P9 regional precipitation fills excluded. Remove the
masthead strapline. Preserve calendar years, date editing, median/IQR evolution,
black selection, actual track-point clocks and existing weather interactions.

## Delivery and chart contracts

This is an extension of the user's existing scientific web application, not a
new portable dashboard. Keep its native canvas renderer and static deployment.
No synthetic values or LPS tracks relabelled as WDs. Source-backed comparisons
carry their detector, coverage and units; unavailable data remain unavailable.

| Item | Question / chart | Source / validation |
| --- | --- | --- |
| P1 | Where is an event in its diagnostic distribution? Histogram and grouped boxes | WD v6 per-event reductions; finite-only sample sizes; median/IQR, 5–95% whiskers |
| P2 | How do two event properties covary? Selectable scatter | One point per v6 trajectory, exact ID selection, missing pairs excluded |
| P3 | When was the event active or at its peak? Shared month semantics | Published UTC times; dates clipped consistently; first peak on ties |
| P4 | Frequency versus persistence? Annual bars and 11-year mean | Actual selected-day exposure, calendar years, no missing years treated as zero |
| P5 | Which genesis regions feed which endpoints? Matrix | Existing review clusters and lysis longitude sectors; counts/row percentages |
| P6 | Is a regime overrepresented? Paired share bars | Existing climate asset; time/month-matched all-catalogue reference; missing categories explicit |
| P7 | How does subset evolution differ from a reference? Median/IQR panels | Pin immutable track IDs and filter description; shared scale fits plotted IQRs |
| P8 | Structure relative to the moving centre? Spatial composites | Per-WD ERA5 gridded extraction, north up, valid-count masks, pressure levels explicit |
| P10 | Do reanalyses agree on the trajectory? Overlaid tracks | Existing IMDAA T42 and ERA-Interim T63; temporal/spatial matching; legacy methods labelled |
| P11 | Where are WDs forecast? Forecast tracks, weather and evolution | Upper-level forecast winds, detector/linker provenance, complete-cycle publication, stale-run warning |
| P12 | How does simulated WD activity change? Paired-model comparisons | Existing CMIP5 catalogues if accepted; separate from ERA5 v6, coverage audit |

Use existing atlas blues and neutral comparison lines; solid/dashed and labelled
marks distinguish comparisons without colour alone. Count bars start at zero.
Scatter axes include every finite plotted point. Small subsets remain visible
with their sample size; empty subsets have an explicit empty state. Provide
accessible tables and machine-readable export provenance.

## Verification

- Pure numerical tests: temporal overlap, peak ties/missingness, leap years,
  exposure, zero versus unavailable, finite diagnostic pairs, quantiles.
- Builder checks: catalogue order/IDs, spatial match uniqueness and coverage,
  pressure-level provenance, retained forecast cycle completeness.
- Browser checks: all tabs, filters, chart selection, pinned reference, URL
  reload, forecast time scrubbing, selected-track map extent, narrow layout.
- Existing atlas validation and syntax checks before publishing.

## Delivery verification, 9 September 2026

- All 16,298 per-WD jobs completed successfully; the publication job completed
  and the public inventory advertises exactly 16,298 unique IDs in 76 year
  shards. Every shard's shape and IDs were independently checked after copying.
- Subset-grid availability: vorticity and precipitation 16,298 WDs; equivalent
  potential temperature and relative humidity 15,008. Missing thermodynamic
  fields are excluded and reported, not treated as zero.
- Forecasts: validated GFS/IFS/AIFS and all 31 GEFS members for initial cycles
  8 September 18 UTC and 9 September 00 UTC. Numerical checks cover spherical
  vorticity, T42 preservation of low-degree fields and exact accumulation
  windows. Hourly missing-member checks are installed, preserving other cron
  entries and retaining a backup of the prior crontab.
- CMIP5: 77 model/experiment records audited. Native 360-day/no-leap calendars
  and shifted 03/09/15/21-hour sampling are supported. Four records have an
  incomplete month; paired comparisons exclude them. RCP2.6/4.5/6.0/8.5 retain
  6/20/4/21 complete paired models respectively.
- Browser checks cover finite-value charts, actual scatter selection, pinned
  references after reload, month definitions, matched reanalysis overlays
  without map movement, selected/subset composites, climate comparisons,
  GEFS member selection, preserved forecast lead/selection after reload,
  keyboard time movement, no duplicate IDs and a 390-pixel viewport.
- Forecast maxima detection remains explicitly experimental and is not a
  calibrated warning product or the exact ERA5 catalogue detector. CMIP5 is
  explicitly legacy; the CSVs do not uniquely encode detector configuration,
  so cross-generation intensity comparisons are withheld.

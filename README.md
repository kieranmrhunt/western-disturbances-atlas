# Western Disturbances Atlas (1950–2025)

An interactive, single-file dashboard for exploring the ERA5 WD v5 catalogue of
Western Disturbances: 16,850 Lagrangian storm tracks tracked at 3-hourly resolution
from 1950–2025.

**Live demo:** _<add your URL here once deployed>_

## Features

- Filter the full catalogue by genesis month, year range, intensity percentile
  (upper-tropospheric vorticity), peak 24h rainfall, track length, and dominant
  rainfall region.
- View filtered tracks on a custom map, coloured by peak intensity, with
  hover/click inspection.
- For any selected disturbance: its full track, the lifetime evolution of
  intensity and rainfall, and percentile comparisons against the whole catalogue
  and its genesis-month average.

## How it works

Everything is embedded in `index.html` — there is no server, build step, or
external dependency beyond Google Fonts. The ~398k track points are packed into a
gzipped binary payload (base64) and decoded in the browser via the
`DecompressionStream` API. The file is ~3.9 MB.

> Requires a modern browser (Chrome/Edge, Firefox, Safari 16.4+) for
> `DecompressionStream`. Serving over http(s) — e.g. GitHub Pages — is the most
> reliable way to view it.

## Hosting

Drop `index.html` on any static host (GitHub Pages, Cloudflare Pages, Netlify,
Vercel, S3, …). No configuration needed.

## Data

Source: ERA5-derived Western Disturbance tracking catalogue (WD v5),
3-hourly track points 1950–2025.

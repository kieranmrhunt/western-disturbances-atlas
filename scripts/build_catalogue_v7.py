#!/usr/bin/env python3
"""Pack the extended v7 catalogue, retaining user-selectable WD definitions."""

import argparse
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

from build_catalogue_v6 import (EPOCH, REGIONS, ROOT, compact_i16,
                                diagnostic_group, diagnostic_style, json_values,
                                percentile, sha256, write_gzip)

STEM = 'wd_v7-era5-1950-2025'


def descriptor(field, unit, old_fields):
    key = field.replace('_400km', '').replace('_mean', '').replace('_m_s', '')
    if field in old_fields:
        label = old_fields[field]['label']
        unit = old_fields[field]['units']
    elif re.match(r'vo_\d+hpa_', field):
        level = re.search(r'\d+', field).group()
        operation = 'maximum (200 km)' if '_max_' in field else 'mean (400 km)'
        label = f'{level}-hPa vorticity {operation}'
    else:
        label = field.replace('_', ' ').capitalize()
    unit = {'10^-5 s^-1': '10⁻⁵ s⁻¹', 'mm liquid-water equivalent': 'mm'}.get(unit, unit)
    return dict(key=key, field=field, label=label, shortLabel=label.replace(' (400 km)', ''),
                yLabel=f'{label} ({unit})', unit=f' {unit}', group=diagnostic_group(field),
                **diagnostic_style(field, unit))


def build(source, output):
    point_path = source / f'{STEM}-track-points.parquet'
    summary_path = source / f'{STEM}-summary.parquet'
    release_path = source / f'{STEM}-manifest.json'
    release = json.loads(release_path.read_text())
    points = pd.read_parquet(point_path)
    summary = pd.read_parquet(summary_path).sort_values(['genesis_time_utc', 'track_id']).reset_index(drop=True)
    if points.duplicated(['track_id', 'valid_time_utc']).any() or summary.track_id.duplicated().any():
        raise ValueError('Duplicate v7 track/UTC keys')
    order = pd.Series(np.arange(len(summary)), index=summary.track_id)
    points['_order'] = points.track_id.map(order)
    if points._order.isna().any():
        raise ValueError('Track points without a summary')
    points.sort_values(['_order', 'time_hours'], inplace=True, ignore_index=True)
    counts = points.groupby('_order', sort=True).size().to_numpy()
    if not np.array_equal(counts, summary.track_points):
        raise ValueError('Track-point counts and summaries disagree')
    if len(points) != release['track_points'] or len(summary) != release['tracks']:
        raise ValueError('Catalogue differs from release counts')
    offsets = np.c_[np.r_[0, np.cumsum(counts)[:-1]], counts]
    first, last = offsets[:, 0], offsets.sum(axis=1) - 1
    grouped = points.groupby('_order', sort=True)
    genesis = pd.to_datetime(summary.genesis_time_utc, utc=True)
    region_columns = [f'precip_box_24hr_{region}' for region in REGIONS]
    regional = grouped[region_columns].max()
    values = regional.to_numpy()
    dominant = np.argmax(np.where(np.isfinite(values), values, -np.inf), axis=1)
    # Missing regional precipitation is not Karakoram and must remain separate.
    dominant[~np.isfinite(values).any(axis=1)] = len(REGIONS)
    peak_pr = grouped.precip_24hr_400km.max()
    quality = ((summary.coverage_fraction >= .8)
               & (summary.ambiguous_links / (summary.track_points - 1) <= .2)
               & (summary.reverse_disagreements / (summary.track_points - 1) <= .2)
               & ~summary.quality_flags.str.contains('detector_boundary', na=False)
               & ~summary.left_censored & ~summary.right_censored)
    cat = dict(id=summary.track_id.tolist(), uid=summary.track_uid.tolist(),
               year=genesis.dt.year.tolist(), month=genesis.dt.month.tolist(),
               day=genesis.dt.day.tolist(), hour=genesis.dt.hour.tolist(),
               npts=counts.tolist(), dur=json_values(summary.duration_hours),
               glon=json_values(points.lon.iloc[first], 2), glat=json_values(points.lat.iloc[first], 2),
               llon=json_values(points.lon.iloc[last], 2), llat=json_values(points.lat.iloc[last], 2),
               len_km=json_values(summary.path_km, 1), pk_int=json_values(summary.peak_vorticity, 2),
               mn_int=json_values(grouped.vorticity.mean(), 2),
               pk_pr=json_values(peak_pr, 2), mn_pr=json_values(grouped.precip_24hr_400km.mean(), 2),
               mslp=json_values(grouped.mslp_min_400km.min(), 2),
               wind=json_values(grouped.ws10_max_400km.max(), 2), dom=dominant.tolist(),
               pct_int=percentile(summary.peak_vorticity), pct_pr=percentile(peak_pr),
               pct_len=percentile(summary.path_km), quality=quality.astype(int).tolist(),
               core=summary.core_catalogue.astype(int).tolist(),
               flags=summary.quality_flags.fillna('').tolist())
    for key, column in zip(['rk', 'rh', 'rw', 'rc', 'rn'], region_columns):
        cat[key] = json_values(regional[column], 2)

    output.mkdir(parents=True, exist_ok=True)
    assets, descriptors = {}, []
    def asset(key, filename, payload, **extra):
        path = output / filename
        write_gzip(path, payload)
        assets[key] = dict(file=filename, bytes=path.stat().st_size,
                           uncompressed_bytes=len(payload), sha256=sha256(path), **extra)

    old_schema = ROOT.parent / 'catalogue-v6/full-r2/wd_v6-era5-1950-2025-schema.json'
    old_fields = json.loads(old_schema.read_text())['fields'] if old_schema.exists() else {}
    definitions = pd.read_csv(source / 'weather-variable-dictionary.csv')
    excluded = {'precip_24hr_400km', 'precip_24hr_complete',
                'ut_vo_350hpa_max_200km', 'ut_vo_350hpa_mean_400km'}
    for row in definitions.itertuples():
        if row.variable in excluded:
            continue
        d = descriptor(row.variable, row.units, old_fields)
        if 'coverage' in row.variable:
            d.update(group='Data coverage', zeroBased=True)
        filename = f'wd-atlas-diag-v7-{d["key"]}.f32.gz'
        d['file'] = f'assets/{filename}'
        asset(f'diagnostic:{d["key"]}', filename,
              points[row.variable].to_numpy(dtype='<f4').tobytes(), field=row.variable)
        descriptors.append(d)
    for field, label, unit in [('area_km2', 'Vortex area', 'km²'),
                              ('circulation_m2_s', 'Vortex circulation', 'm² s⁻¹'),
                              ('aspect_ratio', 'Vortex aspect ratio', ''),
                              ('mean_vorticity', 'Mean object vorticity', '10⁻⁵ s⁻¹'),
                              ('prediction_error_km', 'Link prediction error', 'km'),
                              ('advected_overlap', 'Advected vortex overlap', '')]:
        d = dict(key=field, field=field, label=label, shortLabel=label,
                 yLabel=f'{label} ({unit})' if unit else label, unit=f' {unit}',
                 group='Vortex structure', decimals=2, zeroBased=True,
                 colour='--mla-purple', fallback='#76558f')
        filename = f'wd-atlas-diag-v7-{field}.f32.gz'
        d['file'] = f'assets/{filename}'
        asset(f'diagnostic:{field}', filename, points[field].to_numpy(dtype='<f4').tobytes(), field=field)
        descriptors.append(d)
    if len({d['key'] for d in descriptors}) != len(descriptors):
        raise ValueError('Duplicate diagnostic keys')
    meta = dict(schema='western-disturbances-atlas-v7', catalogue='WD v7', catalogue_version='WD v7',
                npts=len(points), ntracks=len(summary), regions=REGIONS + ['unavailable'],
                time_epoch=EPOCH.isoformat().replace('+00:00', 'Z'), diagnostics=descriptors,
                population='Extended regional v7 trajectories; entry, duration and quality are atlas filters.',
                overall=dict(n=len(summary), pk_int=float(summary.peak_vorticity.mean()),
                             pk_pr=float(peak_pr.mean()), len_km=float(summary.path_km.mean()),
                             dur=float(summary.duration_hours.mean())),
                yearly={str(y): int((genesis.dt.year == y).sum()) for y in range(1950, 2026)})
    asset('catalogue', 'wd-atlas-catalogue-v7.json.gz',
          json.dumps(dict(meta=meta, cat=cat, off=offsets.tolist()), separators=(',', ':'), allow_nan=False).encode())
    packed = np.concatenate([compact_i16(points.lon, 100), compact_i16(points.lat, 100),
                             compact_i16(points.vorticity, 10), compact_i16(points.precip_24hr_400km, 100)])
    asset('fixes', 'wd-atlas-points-v7.i16.gz', packed.astype('<i2').tobytes())
    hours = ((pd.to_datetime(points.valid_time_utc, utc=True) - EPOCH) / pd.Timedelta(hours=1)).to_numpy(dtype='<i4')
    asset('times', 'wd-atlas-times-v7.i32.gz', hours.tobytes())
    asset('coordinates', 'wd-atlas-coordinates-v7.f32.gz',
          np.concatenate([points.lon.to_numpy(dtype='<f4'), points.lat.to_numpy(dtype='<f4')]).tobytes())
    manifest = dict(schema='western-disturbances-atlas-assets-v7',
                    source={name: dict(file=path.name, sha256=sha256(path)) for name, path in
                            [('track_points', point_path), ('summary', summary_path), ('release_manifest', release_path)]},
                    counts=dict(tracks=len(summary), track_points=len(points), diagnostics=len(descriptors),
                                core=int(summary.core_catalogue.sum()), quality=int(quality.sum())), assets=assets)
    (output / 'atlas-build-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest['counts']), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT.parent / 'catalogue-v7/release-candidate')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets')
    args = parser.parse_args()
    build(args.source, args.output)

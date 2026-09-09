#!/usr/bin/env python3
"""Audit and summarise the user's legacy CMIP5 WD CSVs; no ERA5-v6 relabelling.

Unit: one system's first entry to 60–80 E, 20–36.5 N. Exposure comes from the
original model time arrays, not the presence of detected tracks. Native model
calendars are preserved, including 30 February in 360-day simulations.
"""
import argparse
import calendar
from collections import Counter
from datetime import datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path
import re
import sys
import warnings

import cftime
import numpy as np
import pandas as pd

# These are trusted, local Python-2 NumPy archives made by the user's pipeline.
# Map the renamed calendar module without converting dates to Gregorian time.
sys.modules['netcdftime'] = cftime
sys.modules['netcdftime._netcdftime'] = cftime._cftime
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent.parent/'cmip5'
WINDOWS = {'historical': (1980, 1999), 'rcp26': (2080, 2099),
           'rcp45': (2080, 2099), 'rcp60': (2080, 2099), 'rcp85': (2080, 2099)}

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def month_days(year, month, cal):
    if cal in ('standard', 'gregorian', 'proleptic_gregorian'):
        return calendar.monthrange(year, month)[1]
    return cftime.datetime(year, month, 1, calendar=cal).daysinmonth

def coverage(experiment, model, source=SOURCE):
    start, end = WINDOWS[experiment]
    keys, calendars, phases, files = set(), set(), set(), []
    duplicates = 0
    for path in sorted((source/'time_files'/experiment).glob(f'time_6hrPlev_{model}_{experiment}_*.npy')):
        bounds = re.search(r'_(\d{4})\d{6,10}-(\d{4})\d{6,10}\.nc\.npy$', path.name)
        if not bounds or int(bounds[2]) < start or int(bounds[1]) > end:
            continue
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', DeprecationWarning)
            warnings.simplefilter('ignore', np.exceptions.VisibleDeprecationWarning)
            values = np.load(path, allow_pickle=True, encoding='latin1')
        files.append({'file': str(path.relative_to(source)), 'sha256': digest(path)})
        for t in values:
            if not start <= t.year <= end:
                continue
            if t.minute or t.second:
                raise ValueError(f'Unexpected source timestep: {t}')
            phases.add(t.hour % 6)
            calendars.add(getattr(t, 'calendar', 'standard'))
            k = (t.year, t.month, t.day, t.hour)
            duplicates += k in keys
            keys.add(k)
    if len(calendars) != 1:
        raise ValueError(f'Missing or mixed source calendars: {sorted(calendars)}')
    if len(phases) != 1:
        raise ValueError(f'Source does not have a single six-hour sampling phase: {sorted(phases)}')
    cal = calendars.pop()
    phase = phases.pop()
    counts = Counter((y, m) for y, m, d, h in keys)
    rows = []
    for y in range(start, end+1):
        for m in range(1, 13):
            days = month_days(y, m, cal)
            expected = {(y, m, d, h) for d in range(1, days+1) for h in range(phase, 24, 6)}
            rows.append({'year': y, 'month': m, 'days': days, 'source_samples': counts[y, m],
                         'hour_offset': phase, 'complete': expected.issubset(keys) and counts[y, m] == len(expected)})
    return cal, rows, files, duplicates

def summarise(path, experiment, source=SOURCE):
    model = path.stem
    cal, rows, files, duplicates = coverage(experiment, model, source)
    frame = pd.read_csv(path, usecols=['particle', 'time', 'lon', 'lat'])
    if frame.isna().any().any() or frame.duplicated(['particle', 'time']).any():
        raise ValueError('Null values or duplicate particle/time key')
    if not frame.lat.between(-90, 90).all() or not frame.lon.between(-180, 360).all():
        raise ValueError('Invalid coordinates')
    frame = frame.sort_values(['particle', 'time'], kind='stable')
    start, end = WINDOWS[experiment]
    if int(frame.time.min()[:4]) > start or int(frame.time.max()[:4]) < end:
        raise ValueError('Stored track catalogue does not span the comparison window')
    inside = frame[frame.lon.between(60, 80, inclusive='neither') & frame.lat.between(20, 36.5, inclusive='neither')]
    events = inside.groupby('particle', sort=False).first()
    counts = Counter((int(t[:4]), int(t[5:7])) for t in events.time)
    for row in rows:
        row['count'] = counts[row['year'], row['month']] if row['complete'] else None
    return {'model': model, 'experiment': experiment, 'calendar': cal, 'months': rows,
            'source': {'csv': str(path.relative_to(source)), 'sha256': digest(path),
                       'track_points': len(frame), 'tracks': frame.particle.nunique(),
                       'domain_tracks': len(events), 'first_track_time': frame.time.min(),
                       'last_track_time': frame.time.max(), 'coverage_files': files,
                       'overlapping_source_timestamps': duplicates,
                       'complete_months': sum(r['complete'] for r in rows)}}

def build(source, output):
    models, excluded = [], []
    historical = {p.stem for p in (source/'track_data/historical').glob('*.csv')}
    for experiment in WINDOWS:
        for path in sorted((source/'track_data'/experiment).glob('*.csv')):
            if path.stem not in historical:
                continue
            try:
                result = summarise(path, experiment, source)
                models.append(result)
                print(experiment, path.stem, result['source']['complete_months'], '/240 complete months', flush=True)
            except (ValueError, OSError, ImportError) as e:
                excluded.append({'experiment': experiment, 'model': path.stem, 'reason': str(e)})
                print('Excluded', experiment, path.stem, str(e), flush=True)
    payload = {'schema': 'wd-climate-change-v1', 'built_utc': datetime.now(timezone.utc).isoformat(),
               'source_label': 'Existing CMIP5 WD track archive (legacy tracker)',
               'windows': WINDOWS, 'models': models, 'excluded': excluded,
               'method': {'event': 'First track entry to 60–80°E, 20–36.5°N; one event per source particle.',
                          'coverage': 'Every six-hour timestamp is checked against source time arrays in each native model calendar. Incomplete months remain unavailable.',
                          'comparison': 'Paired models only; all selected months must be complete in all 20 years of both periods. Equal model weights, not pooled events.',
                          'limits': 'Legacy CMIP5 tracks, not ERA5 v6 or CMIP6. The CSVs do not encode a unique detector configuration; no cross-generation intensity comparison is made. One archived realisation per model; model spread is not a probability interval.'}}
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name('.'+output.name+'.tmp')
    temporary.write_bytes(gzip.compress(json.dumps(payload, allow_nan=False, separators=(',', ':')).encode(), mtime=0))
    temporary.replace(output)
    print(output, len(models), 'model/experiment records;', len(excluded), 'excluded', flush=True)

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, default=SOURCE)
    p.add_argument('--output', type=Path, default=ROOT/'assets/wd-climate-change-v1.json.gz')
    a = p.parse_args(); build(a.source, a.output)

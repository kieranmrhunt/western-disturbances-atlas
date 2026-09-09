#!/usr/bin/env python3
"""Operational upper-tropospheric WD forecasts, with reusable GRIB byte caches.

Shares the LPS atlas's provider adapters and HTTP inventory/range handling, not
its lower-tropospheric detector or tracks. Cached GRIB messages are immutable
and keyed by URL/range. Only complete, validated member runs are published.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[1]
LPS = ROOT.parent.parent / 'era5-lps' / 'monsoon-low-atlas'
sys.path.insert(0, str(LPS))
sys.path.insert(0, str(ROOT.parent / 'parallel'))
for package in ('pyshtools-4.13.1-py311h36e255c_1', 'astropy-7.1.0-py311h76ea63d_0', 'astropy-iers-data-0.2025.9.22.0.37.25-py311h06a4308_0', 'pyerfa-2.0.1.5-py311h5eee18b_0'):
    sys.path.append(str(Path('/home/users/kieran/miniconda3/pkgs') / package / 'lib/python3.11/site-packages'))
os.environ.setdefault('MPLBACKEND', 'Agg')
os.environ.setdefault('MPLCONFIGDIR', str(ROOT / '.weather-runtime/matplotlib'))
import numpy as np
if not hasattr(np, 'in1d'):
    np.in1d = np.isin
import pandas as pd
from eccodes import codes_new_from_message, codes_get, codes_get_array, codes_release
from scipy.interpolate import RegularGridInterpolator
from scipy.ndimage import maximum_filter
from pyshtools.expand import SHExpandDH, MakeGridDH
from forecast_pipeline.sources import HttpClient, NcepAdapter, EcmwfAdapter, parse_ncep_index, parse_ecmwf_index, _ncep_record, _ecmwf_record
from forecast_pipeline.forecast_core import ManifestLock
from link_wd_v6 import link_candidates, path_metrics, split_large_reversals, touches_impact_domain

SCHEMA = 'wd-operational-forecast-v1'
LAT = np.arange(90, -90, -.5)
LON = np.arange(0, 360, .5)
REG_LAT = np.arange(5, 65.1, 1.)
REG_LON = np.arange(-30, 120.1, 1.)
LEVELS = [300, 350, 400, 450]
VERSION = 'wd-fc-v1-t42-6h'
DECODE_LOCK = threading.Lock()
SPECTRAL_LOCK = threading.Lock()

def atomic_bytes(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
        os.chmod(temporary, 0o644)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def write_json(path, payload):
    data = json.dumps(payload, allow_nan=False, separators=(',', ':')).encode()
    atomic_bytes(path, gzip.compress(data, mtime=0) if path.suffix == '.gz' else data)

class CachedClient(HttpClient):
    def __init__(self, root):
        super().__init__(timeout=40, retries=3)
        self.root = root
    def get(self, url, *, byte_range=None):
        key = hashlib.sha256(f'{url}|{byte_range}'.encode()).hexdigest()
        path = self.root / key[:2] / key
        if path.exists():
            return path.read_bytes()
        result = super().get(url, byte_range=byte_range)
        if byte_range is not None and result[:4] != b'GRIB':
            raise ValueError('Provider did not return a GRIB message')
        atomic_bytes(path, result)
        return result

def decode(payload):
    with DECODE_LOCK:
        return _decode(payload)

def _decode(payload):
    h = codes_new_from_message(payload)
    try:
        ni, nj = int(codes_get(h, 'Ni')), int(codes_get(h, 'Nj'))
        lat = np.asarray(codes_get_array(h, 'latitudes')).reshape(nj, ni)[:, 0]
        lon = np.asarray(codes_get_array(h, 'longitudes')).reshape(nj, ni)[0] % 360
        field = np.asarray(codes_get_array(h, 'values')).reshape(nj, ni)
        metadata = {k: str(codes_get(h, k)) for k in ('shortName', 'units', 'stepRange', 'level', 'dataDate', 'dataTime', 'endStep')}
        iy, ix = np.argsort(lat), np.argsort(lon)
        field = field[iy][:, ix]; lat, lon = lat[iy], lon[ix]
        # Periodic endpoint, then interpolate only to the fixed DH grid.
        field = np.c_[field, field[:, :1]]; lon = np.r_[lon, lon[0] + 360]
        yy, xx = np.meshgrid(LAT, LON, indexing='ij')
        result = RegularGridInterpolator((lat, lon), field, bounds_error=True)(np.stack([yy, xx], axis=-1))
        if not np.isfinite(result).all() or np.abs(result).max() > 1e12:
            raise ValueError('Missing or invalid global forecast grid')
        return result, metadata
    finally:
        codes_release(h)

def vorticity(u, v):
    phi = np.deg2rad(LAT); cos = np.cos(phi)[:, None]
    dv = (np.roll(v, -1, axis=1) - np.roll(v, 1, axis=1)) / np.deg2rad(1.)
    ducos = np.gradient(u * cos, phi, axis=0)
    result = (dv - ducos) / (6371000. * np.maximum(cos, 1e-5))
    result[0] = np.mean(result[1])
    return result

def t42(field):
    # SHTOOLS caches Fortran workspaces and must not be entered concurrently.
    with SPECTRAL_LOCK:
        coefficients = SHExpandDH(field, sampling=2)
        coefficients[:, 43:, :] = 0
        return MakeGridDH(coefficients, sampling=2)

def regional(field):
    iy = np.rint((90 - REG_LAT) / .5).astype(int)
    ix = np.rint((REG_LON % 360) / .5).astype(int)
    return field[np.ix_(iy, ix)]

def load_step(client, model, cycle, member, step):
    provenance = []
    if model in ('gfs', 'gefs'):
        adapter = NcepAdapter(model, client=client)
        url, inventory = adapter._urls(cycle, step, member)
        if model == 'gfs':
            url = url.replace('0p25', '0p50'); inventory = url + '.idx'
        records = parse_ncep_index(client.text(inventory))
        def get(parameter, level):
            record = _ncep_record(records, f'{parameter}:{level} mb' if level else f'{parameter}:surface')
            return fetch(record, url)
    else:
        adapter = EcmwfAdapter(model, client=client)
        specs = [(role, url, parse_ecmwf_index(client.text(index))) for role, url, index in adapter._file_specs(cycle, step)]
        url, records, number = adapter._records_for_member(specs, member)
        def get(parameter, level):
            record = _ecmwf_record(records, {'UGRD': 'u', 'VGRD': 'v', 'APCP': 'tp'}[parameter], level=str(level) if level else None, number=number)
            return fetch(record, url)
    def fetch(record, source_url):
        payload = client.get(source_url, byte_range=(record.offset, record.offset + record.length - 1 if record.length > 0 else None))
        field, meta = decode(payload)
        if meta['dataDate'] != cycle.strftime('%Y%m%d') or int(meta['dataTime']) != cycle.hour * 100 or int(meta['endStep']) != step:
            raise ValueError(f'GRIB initialization/lead mismatch: {meta}')
        if meta['shortName'] in ('u', 'v') and meta['units'] not in ('m s**-1', 'm s-1'):
            raise ValueError(f'Unexpected wind units: {meta}')
        provenance.append({'url': source_url, 'offset': record.offset, 'length': record.length, **meta})
        return field, meta
    # GEFS/ECMWF publish 300/400/500 hPa, not the 350/450 levels. Linear
    # pressure interpolation is explicit; no 850-hPa substitute is permitted.
    source_levels = LEVELS if model == 'gfs' else [300, 400, 500]
    winds = {level: (get('UGRD', level)[0], get('VGRD', level)[0]) for level in source_levels}
    vort = {level: vorticity(*winds[level]) for level in source_levels}
    if source_levels != LEVELS:
        vort[350] = (vort[300] + vort[400]) * .5
        vort[450] = (vort[400] + vort[500]) * .5
    layer = t42(np.mean([vort[level] for level in LEVELS], axis=0)) * 1e5
    rain, accumulation = None, None
    if step:
        rain, meta = get('APCP', None)
        if meta['units'] == 'm':
            rain *= 1000
        elif meta['units'] not in ('kg m**-2', 'kg m-2', 'mm'):
            raise ValueError(f'Unrecognised precipitation units: {meta["units"]}')
        parts = [int(v) for v in meta['stepRange'].split('-')]
        accumulation = [parts[0] if len(parts) > 1 else 0, parts[-1]]
        rain = regional(rain)
    return {'step': step, 'vorticity': regional(layer), 'precipitation': rain, 'accumulation': accumulation, 'provenance': provenance}

def six_hour_precipitation(frames):
    output = []
    for i, frame in enumerate(frames):
        step, rain, span = frame['step'], frame['precipitation'], frame['accumulation']
        if step == 0:
            output.append(None); continue
        if span == [step - 6, step]:
            increment = rain
        else:
            previous = frames[i - 1]
            if span == [0, 6] and i == 1:
                increment = rain
            elif previous['precipitation'] is not None and previous['accumulation'] == [span[0], step - 6]:
                increment = rain - previous['precipitation']
            else:
                raise ValueError(f'Cannot form exact six-hour precipitation from {span}')
        if np.nanmin(increment) < -.1:
            raise ValueError('Unexpected negative precipitation increment')
        output.append(np.maximum(increment, 0))
    return output

def track_frames(frames, cycle, member):
    candidates = []
    for j, frame in enumerate(frames):
        f = frame['vorticity']
        peaks = np.argwhere((f == maximum_filter(f, size=7, mode='nearest')) & (f >= 2.0))
        for iy, ix in peaks:
            if iy < 2 or iy >= len(REG_LAT) - 2 or ix < 2 or ix >= len(REG_LON) - 2:
                continue
            # Subgrid weighted centre in the contiguous local 3x3 maximum.
            patch = np.maximum(f[iy-1:iy+2, ix-1:ix+2] - 1., 0)
            lon = float(np.average(REG_LON[ix-1:ix+2], weights=patch.sum(axis=0)))
            lat = float(np.average(REG_LAT[iy-1:iy+2], weights=patch.sum(axis=1)))
            candidates.append({'frame': j, 'lon': lon, 'lat': lat, 'vorticity': float(f[iy, ix]), 'lead': frame['step']})
    if not candidates:
        return []
    linked = link_candidates(pd.DataFrame(candidates), search_range_km=900., memory=0, predictor_span=4)
    tracks = []
    for _, raw in linked.groupby('particle'):
        for segment in split_large_reversals(raw, 7):
            if len(segment) < 7 or not touches_impact_domain(segment):
                continue
            geometry = path_metrics(segment)
            if geometry['net_longitude_deg'] <= 0 or geometry['path_efficiency'] < .1 or geometry['max_step_km'] > 900.01:
                continue
            points = []
            for row in segment.itertuples():
                rain = frames[row.frame].get('precip24')
                if rain is not None:
                    yy, xx = np.meshgrid(REG_LAT, REG_LON, indexing='ij')
                    mask = ((yy - row.lat) * 111.) ** 2 + ((xx - row.lon) * 111. * np.cos(np.deg2rad(row.lat))) ** 2 <= 400 ** 2
                    precip = float(np.average(rain[mask], weights=np.cos(np.deg2rad(yy[mask])))) if mask.any() else None
                else:
                    precip = None
                points.append([int(row.lead), round(row.lon, 3), round(row.lat, 3), round(row.vorticity, 3), None if precip is None else round(precip, 3)])
            tracks.append({'id': f'{member}-{len(tracks)+1:03d}', 'member': member, 'points': points, 'geometry': geometry})
    return tracks

def pack(field):
    return np.rint(field * 100).astype(np.int32).ravel().tolist() if field is not None else None

def validate(payload):
    """Publication gate, also runnable against existing archived member runs."""
    if payload.get('schema') != SCHEMA or payload.get('version') != VERSION:
        raise ValueError('Forecast schema/version mismatch')
    steps = list(range(0, payload['horizon']+1, 6))
    if [f['lead'] for f in payload['frames']] != steps:
        raise ValueError('Incomplete or disordered forecast frames')
    size = len(payload['grid']['lon'])*len(payload['grid']['lat'])
    for frame in payload['frames']:
        for name in ('vorticity', 'precipitation'):
            a = frame[name]
            if name == 'precipitation' and frame['lead'] < 24:
                if a is not None: raise ValueError('Unjustified precipitation before 24 h')
                continue
            if a is None or len(a) != size or not np.isfinite(a).all():
                raise ValueError(f'Invalid {name} grid at lead {frame["lead"]}')
            if name == 'precipitation' and min(a) < 0:
                raise ValueError('Negative precipitation')
    identities = set()
    for track in payload['tracks']:
        if track['id'] in identities: raise ValueError('Duplicate forecast track ID')
        identities.add(track['id'])
        points = track['points']; leads = [p[0] for p in points]
        if len(points) < 7 or leads[-1]-leads[0] < 36 or not np.all(np.diff(leads) == 6):
            raise ValueError('Invalid forecast track lifetime/continuity')
        if not np.isfinite(np.asarray(points)[:, :4].astype(float)).all():
            raise ValueError('Invalid track coordinates/intensity')
        for h, lon, lat, vort, precip in points:
            if h not in steps or not -30 <= lon <= 120 or not 5 <= lat <= 65 or vort < 2:
                raise ValueError('Track point outside detector bounds')
            if (h < 24 and precip is not None) or (h >= 24 and (precip is None or not np.isfinite(precip) or precip < 0)):
                raise ValueError('Track precipitation timing/validity mismatch')
    return {'status': 'passed', 'expected_frames': len(steps), 'actual_frames': len(payload['frames']),
            'complete': True, 'checks': ['UTC cycle/lead provenance', 'complete six-hour grid sequence',
            'finite fields and dimensions', 'exact precipitation accumulation windows',
            'unique, continuous, domain-retained tracks']}

def build(args):
    cycle = datetime.strptime(args.cycle, '%Y%m%d%H').replace(tzinfo=timezone.utc)
    destination = args.output / 'runs' / f'{args.model}-{args.cycle}-{args.member}.json.gz'
    if destination.exists() and not args.force:
        with gzip.open(destination, 'rt') as stream:
            existing=json.load(stream)
        validate(existing)
        publish(args.output, existing)
        return destination
    client = CachedClient(args.cache)
    steps = list(range(0, args.horizon + 1, 6))
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        frames = list(pool.map(lambda step: load_step(client, args.model, cycle, args.member, step), steps))
    increments = six_hour_precipitation(frames)
    for i, frame in enumerate(frames):
        frame['precip24'] = np.sum(increments[i-3:i+1], axis=0) if i >= 4 else None
    tracks = track_frames(frames, cycle, args.member)
    payload = {'schema': SCHEMA, 'version': VERSION, 'model': args.model, 'member': args.member, 'cycle': args.cycle, 'cycle_utc': cycle.isoformat(), 'built_utc': datetime.now(timezone.utc).isoformat(), 'horizon': args.horizon,
        'grid': {'lon': REG_LON.tolist(), 'lat': REG_LAT.tolist(), 'scale': .01}, 'tracks': tracks,
        'method': {'tracking': 'Positive 450–300-hPa layer relative vorticity, global spherical T42; regional maxima at least 2e-5 s-1; 900-km spherical predictive links per 6 h; at least 36 h; eastward and domain-crossing retention', 'catalogue_comparability': 'Forecast-specific maxima detector and six-hour sampling, not a rerun of the ERA5 catalogue centroid detector; guidance is not an official warning.', 'pressure_levels': LEVELS, 'interpolated_levels': [] if args.model == 'gfs' else [350, 450], 'precipitation': 'Exact trailing 24-hour accumulation; unavailable before lead 24 h; track values are area-weighted means within 400 km.'},
        'frames': [{'lead': f['step'], 'vorticity': pack(f['vorticity']), 'precipitation': pack(f['precip24'])} for f in frames],
        'provenance': [p for f in frames for p in f['provenance']], 'qa': {'status': 'passed', 'expected_frames': len(steps), 'actual_frames': len(frames), 'complete': True}}
    payload['qa'] = validate(payload)
    write_json(destination, payload)
    write_json(args.output / 'tracks' / destination.name, {k: v for k, v in payload.items() if k != 'frames'})
    publish(args.output, payload)
    return destination

def publish(root, completed=None):
    with ManifestLock(root):
        manifest_path=root/'manifest.json'
        entries=json.loads(manifest_path.read_text()).get('runs', []) if completed and manifest_path.exists() else []
        if completed:
            payloads=[completed]
        else:
            payloads=[]
            for path in sorted((root / 'runs').glob('*.json.gz')):
                with gzip.open(path, 'rt') as stream: payloads.append(json.load(stream))
        for p in payloads:
            if p.get('schema') != SCHEMA or not p.get('qa', {}).get('complete'):
                continue
            validate(p)
            path=root/'runs'/f'{p["model"]}-{p["cycle"]}-{p["member"]}.json.gz'
            sidecar = root / 'tracks' / path.name
            if not sidecar.exists():
                write_json(sidecar, {k: v for k, v in p.items() if k != 'frames'})
            entries=[r for r in entries if (r['model'],r['cycle'],r['member']) != (p['model'],p['cycle'],p['member'])]
            entries.append({k: p[k] for k in ('model', 'member', 'cycle', 'cycle_utc', 'horizon', 'built_utc', 'version')} | {'url': str(path.relative_to(root)), 'tracks_url': str(sidecar.relative_to(root)), 'track_count': len(p['tracks'])})
        entries.sort(key=lambda r:(r['cycle'],r['model'],r['member']))
        write_json(root / 'manifest.json', {'schema': 'wd-forecast-manifest-v1', 'generated_utc': datetime.now(timezone.utc).isoformat(), 'runs': entries})

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--model', choices=['gfs', 'gefs', 'ifs', 'aifs'], default='gfs')
    p.add_argument('--member', default='det')
    p.add_argument('--cycle', required=True)
    p.add_argument('--horizon', type=int, default=168)
    p.add_argument('--workers', type=int, default=4)
    p.add_argument('--output', type=Path, default=ROOT / 'forecast-data')
    p.add_argument('--cache', type=Path, default=ROOT / '.forecast-cache')
    p.add_argument('--force', action='store_true')
    args = p.parse_args()
    if args.horizon < 36 or args.horizon % 6:
        p.error('horizon must be a multiple of six hours, at least 36 h')
    print(build(args), flush=True)
if __name__ == '__main__':
    main()

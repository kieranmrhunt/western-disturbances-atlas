#!/usr/bin/env python3
"""Match existing legacy WD catalogues to v7 without changing either geometry."""
from pathlib import Path
import gzip
import hashlib
import json
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {'imdaa': ('IMDAA', 'wd_imdaa_T42.csv', 'T42'), 'erainterim': ('ERA-Interim', 'wd_erai_T63.csv', 'T63')}

def sphere(lon, lat):
    lon, lat = np.deg2rad(lon), np.deg2rad(lat)
    return np.column_stack([np.cos(lat)*np.cos(lon), np.cos(lat)*np.sin(lon), np.sin(lat)]) * 6371.0088

def build():
    reference_path = ROOT.parent / 'catalogue-v7/release-candidate/wd_v7-era5-1950-2025-track-points.parquet'
    era = pd.read_parquet(reference_path, columns=['track_id', 'valid_time_utc', 'lon', 'lat'])
    era['time'] = pd.to_datetime(era['valid_time_utc'], utc=True)
    era = era.sort_values('time')
    trees = {t: (cKDTree(sphere(g.lon, g.lat)), g.track_id.to_numpy()) for t, g in era.groupby('time')}
    reference_groups = {str(i): g.set_index('time').sort_index() for i, g in era.groupby('track_id')}
    catalogue = json.loads(gzip.decompress((ROOT / 'assets/wd-atlas-catalogue-v7.json.gz').read_bytes()))
    ids = catalogue['cat']['id']
    result = {'schema': 'wd-reanalysis-matches-v1', 'catalogue': 'WD v7', 'track_ids': ids, 'sources': {}, 'method': {'same_UTC_only': True, 'minimum_overlap_hours': 24, 'minimum_common_points': 5, 'maximum_median_distance_km': 300, 'maximum_p90_distance_km': 600, 'minimum_bidirectional_lifetime_coverage': .35, 'assignment': 'one-to-one greedy increasing median distance; ambiguous alternatives within 30 km rejected'}}
    for source, (label, filename, truncation) in SOURCES.items():
        path = ROOT.parent / 'output' / filename
        frame = pd.read_csv(path, usecols=['particle', 'time', 'lon', 'lat', 'vort'])
        frame['time'] = pd.to_datetime(frame['time'], utc=True)
        frame = frame.dropna().sort_values(['particle', 'time']).drop_duplicates(['particle', 'time'])
        groups = {str(i): g.set_index('time').sort_index() for i, g in frame.groupby('particle')}
        pairs = []
        for sid, g in groups.items():
            candidates = set()
            for t, row in g.iterrows():
                if t not in trees:
                    continue
                tree, owners = trees[t]
                nearby = tree.query_ball_point(sphere([row.lon], [row.lat])[0], 400.)
                candidates.update(str(i) for i in owners[nearby])
            for eid in candidates:
                e = reference_groups[eid]
                common = e.index.intersection(g.index)
                if len(common) < 5:
                    continue
                overlap = (common.max() - common.min()).total_seconds()/3600
                if overlap < 24:
                    continue
                duration_e = (e.index.max()-e.index.min()).total_seconds()/3600
                duration_g = (g.index.max()-g.index.min()).total_seconds()/3600
                coverage = min(overlap/max(1, duration_e), overlap/max(1, duration_g))
                if coverage < .35:
                    continue
                delta = sphere(e.loc[common].lon, e.loc[common].lat) - sphere(g.loc[common].lon, g.loc[common].lat)
                chord = np.linalg.norm(delta, axis=1)
                distances = 2*6371.0088*np.arcsin(np.minimum(1, chord/(2*6371.0088)))
                median, p90 = np.quantile(distances, [.5, .9])
                if median <= 300 and p90 <= 600:
                    pairs.append({'era5_track_id': eid, 'source_track_id': sid, 'median_distance_km': round(float(median), 2), 'p90_distance_km': round(float(p90), 2), 'overlap_hours': overlap, 'coverage': round(coverage, 3), 'common_points': len(common)})
        by_e, by_s = {}, {}
        for pair in pairs:
            by_e.setdefault(pair['era5_track_id'], []).append(pair['median_distance_km'])
            by_s.setdefault(pair['source_track_id'], []).append(pair['median_distance_km'])
        ambiguous_e = {i for i, d in by_e.items() if len(d) > 1 and sorted(d)[1] - min(d) < 30}
        ambiguous_s = {i for i, d in by_s.items() if len(d) > 1 and sorted(d)[1] - min(d) < 30}
        used_e, used_s, accepted = set(), set(), []
        for pair in sorted(pairs, key=lambda p: p['median_distance_km']):
            e, s = pair['era5_track_id'], pair['source_track_id']
            if e in used_e or s in used_s or e in ambiguous_e or s in ambiguous_s:
                continue
            used_e.add(e); used_s.add(s); accepted.append(pair)
        tracks = {sid: [[t.isoformat(), round(row.lon, 3), round(row.lat, 3), round(row.vort*1e5, 3)] for t, row in groups[sid].iterrows()] for sid in sorted(used_s)}
        result['sources'][source] = {'label': label, 'truncation': truncation, 'method': 'Existing legacy WD tracker; not the repaired v6 detector/linker', 'source_file': filename, 'source_sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'coverage_start': frame.time.min().isoformat(), 'coverage_end': frame.time.max().isoformat(), 'source_tracks': len(groups), 'matched_tracks': len(accepted), 'ambiguous_era5_tracks': len(ambiguous_e), 'matches': accepted, 'tracks': tracks}
        print(source, len(accepted), 'unambiguous matches', flush=True)
    output = ROOT / 'assets/wd-reanalysis-matches-v7.json.gz'
    output.write_bytes(gzip.compress(json.dumps(result, separators=(',', ':'), allow_nan=False).encode(), mtime=0))
    print(output)
if __name__ == '__main__':
    build()

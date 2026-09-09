#!/usr/bin/env python3
"""Per-WD storm-relative composites using existing local ERA5 archives only.

Reuses the LPS atlas's pressure interpolation and thermodynamic diagnostics.
No automatic remote full-globe downloads: missing local levels are explicit.
"""
import argparse
import gzip
import importlib.util
import json
from pathlib import Path
import sys
import numpy as np
import pandas as pd
from netCDF4 import Dataset, date2num

ROOT = Path(__file__).resolve().parents[1]
PROVIDER = ROOT.parent.parent / 'era5-lps/monsoon-low-atlas/scripts/build_storm_composite.py'
spec = importlib.util.spec_from_file_location('wd_composite_provider', PROVIDER)
provider = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = provider
spec.loader.exec_module(provider)
DATA = Path('/home/users/kieran/ncas/data/era5-incompass')
PRESSURE = provider.PRESSURE_HPA
REL = provider.RELATIVE_DEGREES

def read_model_line(source, name, levels, lat, lons):
    """Read two latitude rows and only needed longitudes, including 0° wrap."""
    position = (90-lat)/.25
    j = int(np.clip(np.floor(position), 0, 719)); fy = position-j
    positions = np.mod(lons, 360)/.25
    i0 = np.floor(positions).astype(int) % 1440; i1 = (i0+1) % 1440
    fx = positions - np.floor(positions)
    columns = np.unique(np.r_[i0, i1])
    with Dataset(source) as ds:
        var = ds.variables[name]
        raw = var[0, j:j+2, columns][None] if levels is None else var[0, levels, j:j+2, columns]
        field = np.asarray(np.ma.filled(raw, np.nan), float)
    a, b = np.searchsorted(columns, i0), np.searchsorted(columns, i1)
    out = (1-fx)*((1-fy)*field[:,0,a]+fy*field[:,1,a])+fx*((1-fy)*field[:,0,b]+fy*field[:,1,b])
    return out[0] if levels is None else out
provider.read_model_line = read_model_line

def local_line(path, names, when, lat, lon):
    shape = (len(PRESSURE), len(REL))
    out = {name: np.full(shape, np.nan) for name in names}
    if not path.exists():
        return out
    with Dataset(path) as ds:
        tn = 'valid_time' if 'valid_time' in ds.variables else 'time'
        tv = ds.variables[tn]; values = np.asarray(tv[:]); target = date2num(when.to_pydatetime().replace(tzinfo=None), tv.units, getattr(tv,'calendar','standard'))
        it = int(np.argmin(np.abs(values-target)))
        if abs(float(values[it])-target)>1:
            return out
        lats = np.asarray(ds.variables['latitude'][:]); lons = np.asarray(ds.variables['longitude'][:])
        pl = np.asarray(ds.variables['pressure_level' if 'pressure_level' in ds.variables else 'level'][:])
        js = np.argsort(np.abs(lats-lat))[:2]; js.sort()
        targets = lon+REL
        if lons.min()>=0:
            targets = targets % 360
        for name in names:
            if name not in ds.variables:
                continue
            # Small regional fallback only; subset before reading data.
            xs = np.flatnonzero((lons>=targets.min()-.5)&(lons<=targets.max()+.5))
            if len(xs)<2:
                continue
            for p, level in enumerate(PRESSURE):
                found = np.flatnonzero(np.abs(pl-level)<.1)
                if not len(found):
                    continue
                raw = ds.variables[name][it,int(found[0]),js[0]:js[-1]+1,xs[0]:xs[-1]+1]
                field = np.asarray(np.ma.filled(raw,np.nan),float)
                out[name][p] = provider.sample_regular_grid(field,lats[js[0]:js[-1]+1],lons[xs[0]:xs[-1]+1],np.array([lat]),targets)[0]
    return out

def fallback(when, lat, lon):
    ut = local_line(DATA/'ut-vort'/f'{when:%Y%m}.nc',['vo'],when,lat,lon)['vo']*1e5
    pl = local_line(DATA/'3hourly_pl_SA'/f'{when:%Y%m}.nc',['t','q','vo'],when,lat,lon)
    vo = np.where(np.isfinite(ut),ut,pl['vo']*1e5)
    return vo, provider.theta_e_bolton(pl['t'],pl['q']), provider.relative_humidity_mixed_phase(pl['t'],pl['q'])

def build(track_id, output):
    path = output/'tracks'/f'track-{track_id}.json.gz'
    if path.exists():
        with gzip.open(path,'rt') as stream:
            existing=json.load(stream)
        if existing.get('schema')=='wd-storm-composite-v1' and existing.get('track_id')==track_id and existing.get('build_version')==2:
            return path
    catalogue = ROOT.parent/'catalogue-v6/full-r2/wd_v6-era5-1950-2025-fixes.parquet'
    track = pd.read_parquet(catalogue,columns=['track_id','valid_time_utc','lon','lat'],filters=[('track_id','=',track_id)]).rename(columns={'valid_time_utc':'time'}).sort_values('time').reset_index(drop=True)
    track['time']=pd.to_datetime(track.time,utc=True).dt.tz_localize(None)
    if track.empty:
        raise ValueError(f'Unknown WD {track_id}')
    paths=provider.SourcePaths(DATA/'hourly_precip_SA',Path('/nonexistent-not-used'),Path('/badc/ecmwf-era5/data/oper/an_ml'))
    shape=(len(PRESSURE),len(REL)); keys=['relative_vorticity','theta_e','relative_humidity']
    totals={key:np.zeros(shape) for key in keys}; counts={key:np.zeros(shape,dtype=np.int16) for key in keys}
    samples=dict.fromkeys(keys,0); sources=set(); warnings=[]
    # Select actual UTC track points nearest nine equally spaced elapsed times.
    targets=np.linspace(track.time.iloc[0].value,track.time.iloc[-1].value,9)
    indices=np.unique([int(np.argmin(np.abs(track.time.astype('int64').to_numpy()-t))) for t in targets])
    for i in indices:
        row=track.iloc[i]; when=pd.Timestamp(row.time)
        try:
            fields=provider.badc_vertical_snapshot(paths.badc_model,when,row.lat,row.lon);sources.add('BADC ERA5 model levels')
        except (OSError,KeyError,ValueError,IndexError):
            fields=fallback(when,row.lat,row.lon);sources.add('Local UT vorticity and South Asia pressure-level archive (partial levels/domain)')
            if not warnings:
                warnings.append('Pressure-level fallback has no surface-pressure field: below-ground extrapolation may remain at its lower levels. Model-level snapshots are surface-pressure masked.')
        for key,field in zip(keys,fields):
            provider.add_field(totals[key],counts[key],field)
            samples[key]+=int(np.isfinite(field).any())
    sections={}
    for key,scale,units in [('relative_vorticity',.01,'10-5 s-1'),('theta_e',.1,'K'),('relative_humidity',.1,'%')]:
        packed=provider.pack_field(provider.finite_mean(totals[key],counts[key]),scale=scale,units=units,samples=samples[key],requested_samples=len(indices),source='; '.join(sorted(sources)))
        if packed:
            packed['cell_samples']=counts[key].ravel().tolist();sections[key]=packed
    total=np.zeros((len(REL),len(REL))); count=np.zeros(total.shape,dtype=np.int16); n=0
    centres=provider.daily_centres(track)
    for day,lat,lon in centres:
        field=provider.era5_daily_footprint(paths,day,lat,lon)
        if field is not None and np.isfinite(field).any():
            provider.add_field(total,count,field);n+=1
    precipitation=provider.pack_field(provider.finite_mean(total,count),scale=.01,units='mm day-1',samples=n,requested_samples=len(centres),source='Local ERA5 hourly total precipitation, UTC-day sums')
    if precipitation:
        precipitation['cell_samples']=count.ravel().tolist()
    if not sections:
        raise ValueError('No valid vertical fields; refusing empty composite publication')
    payload={'schema':'wd-storm-composite-v1','build_version':2,'catalogue':'WD v6','track_id':track_id,'track_start':track.time.iloc[0].isoformat(),'track_end':track.time.iloc[-1].isoformat(),'built_utc':provider.utc_now(),'grid':{'relative_degrees':REL.tolist(),'pressure_hpa':PRESSURE.tolist()},'method':{'frame':'North-up moving-centre coordinates; no trajectory rotation','vertical':'Equal-weight means of nine nearest actual track points at equally spaced elapsed times. Missing levels are masked; model-level snapshots also mask below-surface points. '+(' '.join(warnings)),'precipitation':'Mean UTC-day total precipitation, each day centred on the track point nearest noon; includes complete calendar days, unlike the lifetime accumulation footprint.','source_policy':'Local files only; no silent remote full-globe downloads.'},'section':sections,'precipitation':precipitation,'warnings':warnings}
    for key,field in sections.items():
        problems=provider.validate_packed_field(field,shape,key)
        if problems:raise ValueError(problems)
    provider.atomic_gzip_json(payload,path)
    print(path,flush=True);return path

def index(output):
    catalogue=json.loads(gzip.decompress((ROOT/'assets/wd-atlas-catalogue-v6.json.gz').read_bytes()))
    ids=catalogue['cat']['id']; available=[]; shards={}
    levels=[850,700,500,450,400,350,300,250,200]
    pi=[int(np.argmin(abs(PRESSURE-p))) for p in levels]
    for track_id,year in zip(ids,catalogue['cat']['year']):
        path=output/'tracks'/f'track-{track_id}.json.gz'
        if not path.exists():continue
        with gzip.open(path,'rt') as stream:asset=json.load(stream)
        if asset.get('schema')!='wd-storm-composite-v1' or asset.get('track_id')!=track_id:raise ValueError(path)
        available.append(track_id); fields={}
        for key,field in asset['section'].items():
            arr=np.asarray(field['data'],dtype=object).reshape(field['shape'])[pi,::4]
            fields[key]={'shape':list(arr.shape),'scale':field['scale'],'data':arr.ravel().tolist()}
        if asset['precipitation']:
            field=asset['precipitation'];arr=np.asarray(field['data'],dtype=object).reshape(field['shape'])[::4,::4]
            fields['precipitation']={'shape':list(arr.shape),'scale':field['scale'],'data':arr.ravel().tolist()}
        shards.setdefault(year,[]).append({'track_id':track_id,'fields':fields})
    years=[]
    for year,rows in sorted(shards.items()):
        relative=f'years/{year}.json.gz'; provider.atomic_gzip_json({'schema':'wd-subset-composite-v1','tracks':rows,'pressure_hpa':levels,'relative_degrees':REL[::4].tolist()},output/relative)
        years.append({'year':year,'url':relative,'tracks':len(rows)})
    payload={'schema':'wd-composite-manifest-v1','catalogue':'WD v6','expected_tracks':len(ids),'available_tracks':available,'years':years,'generated_utc':provider.utc_now()}
    provider.atomic_gzip_json(payload,output/'manifest.json.gz')
    print(len(available),'/',len(ids),'WD composites',flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--track-id',type=int);p.add_argument('--index',type=int);p.add_argument('--offset',type=int,default=0);p.add_argument('--finalize',action='store_true');p.add_argument('--output',type=Path,default=ROOT/'.composite-runs');args=p.parse_args()
    if args.finalize:index(args.output)
    else:
        ids=json.loads(gzip.decompress((ROOT/'assets/wd-atlas-catalogue-v6.json.gz').read_bytes()))['cat']['id']
        build(args.track_id if args.track_id is not None else ids[args.index+args.offset],args.output)

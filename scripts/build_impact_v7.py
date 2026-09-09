#!/usr/bin/env python3
"""Read each ERA5 month once to accumulate all v7 lifetime footprints."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
from netCDF4 import Dataset, num2date

ROOT = Path(__file__).resolve().parents[1]
EPOCH = pd.Timestamp('1950-01-01', tz='UTC')


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, separators=(',', ':'), allow_nan=False)+'\n')


def prepare(output):
    cat = json.loads(gzip.decompress((ROOT/'assets/wd-atlas-catalogue-v7.json.gz').read_bytes()))
    hours = np.frombuffer(gzip.decompress((ROOT/'assets/wd-atlas-times-v7.i32.gz').read_bytes()), dtype='<i4')
    starts = [int(hours[a]) for a,n in cat['off']]
    ends = [int(hours[a+n-1]) for a,n in cat['off']]
    records = [dict(id=i,year=y,start=a,end=b) for i,y,a,b in zip(cat['cat']['id'],cat['cat']['year'],starts,ends)]
    write_json(output/'tracks.json', records)
    months = pd.period_range('1950-01','2025-12',freq='M')
    for period in months:
        a = int((period.start_time.tz_localize('UTC')-EPOCH)/pd.Timedelta(hours=1))
        b = int(((period+1).start_time.tz_localize('UTC')-EPOCH)/pd.Timedelta(hours=1))
        write_json(output/'inputs'/(period.strftime('%Y%m')+'.json'), [r for r in records if r['start']<b and r['end']>=a])
    print(f'{len(records)} tracks; {len(months)} monthly inputs', flush=True)


def month(output, month, source_root):
    target=output/'parts'/f'{month}.npz'
    if target.exists():
        with np.load(target) as data:
            if str(data['catalogue']) == 'WD v7' and np.isfinite(data['values']).all():
                print(f'{month}: already complete'); return
        raise ValueError(f'Invalid existing part {target}')
    records=json.loads((output/'inputs'/f'{month}.json').read_text())
    source=source_root/f'{month}.nc'
    with Dataset(source) as ds:
        tn='valid_time' if 'valid_time' in ds.variables else 'time'
        tv=ds[tn]
        times=pd.DatetimeIndex(num2date(tv[:],tv.units,getattr(tv,'calendar','standard'),
                                       only_use_cftime_datetimes=False,only_use_python_datetimes=True)).tz_localize('UTC')
        hours=((times-EPOCH)/pd.Timedelta(hours=1)).to_numpy(dtype=np.int64)
        if not np.all(np.diff(hours)==1): raise ValueError(f'{month}: missing hourly times')
        name=next(n for n in ('avg_tprate','mtpr','total_precipitation_rate','tp') if n in ds.variables)
        variable=ds[name]; units=variable.units.lower().strip()
        if 'kg' in units and 's' in units: factor=3600.
        elif units in ('m','metre','meter'): factor=1000.
        elif units in ('mm',): factor=1.
        else: raise ValueError(f'Unknown precipitation units {units}')
        if variable.dimensions != (tn,'latitude','longitude'): raise ValueError(variable.dimensions)
        lat=np.asarray(ds['latitude'][:]); lon=np.asarray(ds['longitude'][:])
        yi=np.flatnonzero((lat>=20)&(lat<=40))[:80]; xi=np.flatnonzero((lon>=60)&(lon<=100))[:160]
        if len(yi)!=80 or len(xi)!=160: raise ValueError('Expected 0.25-degree input grid')
        fields=[]
        for a in range(0,len(hours),48):
            raw=np.ma.asarray(variable[a:a+48,yi[0]:yi[-1]+1,xi[0]:xi[-1]+1])
            if np.ma.getmaskarray(raw).any() or not np.isfinite(raw).all(): raise ValueError(f'{month}: missing precipitation')
            values=np.maximum(np.asarray(raw,dtype=np.float64)*factor,0)
            fields.append(values.reshape(-1,20,4,40,4).mean(axis=(2,4)))
        field=np.concatenate(fields)
        lats=lat[yi].reshape(20,4).mean(axis=1); lons=lon[xi].reshape(40,4).mean(axis=1)
        if lats[0]<lats[-1]: field=field[:,::-1]; lats=lats[::-1]
        if lons[0]>lons[-1]: field=field[:,:,::-1]; lons=lons[::-1]
    prefix=np.concatenate([np.zeros((1,20,40)),field.cumsum(axis=0)],axis=0)
    values=[]; counts=[]
    for r in records:
        a=max(r['start'],int(hours[0])); b=min(r['end'],int(hours[-1]))
        i,j=np.searchsorted(hours,[a,b]); j+=1
        if j<=i: raise ValueError(f'No overlapping times {r["id"]}')
        values.append(prefix[j]-prefix[i]); counts.append(j-i)
    target.parent.mkdir(parents=True,exist_ok=True)
    temporary=target.with_name(target.stem+'.tmp.npz')
    np.savez_compressed(temporary, catalogue='WD v7', ids=np.array([r['id'] for r in records]),
                        values=np.asarray(values), counts=counts,
                        bounds=[lons[0]-.5,lats[-1]-.5,lons[-1]+.5,lats[0]+.5])
    temporary.replace(target)
    print(f'{month}: {len(records)} track contributions from {len(hours)} hours',flush=True)


def assemble(output):
    records=json.loads((output/'tracks.json').read_text())
    lookup={r['id']:i for i,r in enumerate(records)}
    totals=np.zeros((len(records),20,40),dtype=np.float64); counts=np.zeros(len(records),dtype=np.int64)
    bounds=None
    for period in pd.period_range('1950-01','2025-12',freq='M'):
        with np.load(output/'parts'/(period.strftime('%Y%m')+'.npz')) as data:
            indices=[lookup[i] for i in data['ids']]
            totals[indices]+=data['values']; counts[indices]+=data['counts']
            if bounds is not None and not np.allclose(bounds,data['bounds']): raise ValueError('Grid changed')
            bounds=data['bounds'].tolist()
    expected=np.array([r['end']-r['start']+1 for r in records])
    if not np.array_equal(counts,expected): raise ValueError('Incomplete track lifetime coverage')
    packed=np.rint(totals*10)
    if packed.min()<0 or packed.max()>65535: raise ValueError('Footprint encoding overflow')
    entries=[]; publication=output/'public'
    for year in range(1950,2026):
        indices=[i for i,r in enumerate(records) if r['year']==year]
        payload=publication/str(year)/f'{year}.u16.gz'; payload.parent.mkdir(parents=True,exist_ok=True)
        payload.write_bytes(gzip.compress(packed[indices].astype('<u2').tobytes(),mtime=0))
        digest=hashlib.sha256(payload.read_bytes()).hexdigest()
        meta=dict(schema='western-disturbances-atlas-impact-footprint-v1', catalogue='WD v7',year=year,
                  track_ids=[records[i]['id'] for i in indices],shape=[len(indices),20,40],
                  scale=10,dtype='uint16',units='mm',layout='track,latitude,longitude',
                  bounds_west_south_east_north=bounds,sha256=digest,
                  definition='Hourly precipitation from genesis through lysis, including both endpoint hours')
        write_json(payload.with_suffix('.json'),meta)
        entries.append(dict(year=year,tracks=len(indices),payload=f'{year}/{year}.u16.gz',
                            metadata=f'{year}/{year}.u16.json',sha256=digest,bytes=payload.stat().st_size))
    write_json(publication/'impact-manifest.json',dict(schema='western-disturbances-atlas-impact-archive-v1',
               catalogue='WD v7',status='complete',years=entries,tracks=len(records),expected_years=76,
               built_utc=pd.Timestamp.now(tz='UTC').isoformat()))
    print(f'Validated {len(records)} complete lifetime footprints',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--prepare',action='store_true'); group.add_argument('--month'); group.add_argument('--assemble',action='store_true')
    parser.add_argument('--output',type=Path,default=ROOT/'.v7-products/impact')
    parser.add_argument('--source',type=Path,default=Path('/home/users/kieran/ncas/data/era5-incompass/hourly_precip_SA'))
    args=parser.parse_args()
    if args.prepare: prepare(args.output)
    elif args.assemble: assemble(args.output)
    else: month(args.output,args.month,args.source)

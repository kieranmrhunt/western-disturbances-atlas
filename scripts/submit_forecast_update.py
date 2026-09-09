#!/usr/bin/env python3
"""Idempotent hourly WD forecast submission; Slurm controls concurrency.

Check the latest two cycles after a five-hour publication allowance. Completed
members and queued/running members are not resubmitted. Failed/missing members
are retried on the next invocation; unrelated LPS jobs are never changed.
"""
import argparse
from datetime import datetime, timedelta, timezone
import fcntl
import json
from pathlib import Path
import subprocess
import time
import re

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = Path('/home/users/kieran/incompass/public/kieran/track_data/WD/atlas-forecasts-v1')

def prune_cache():
    """Expire only this builder's hashed, re-downloadable GRIB byte cache."""
    cutoff=time.time()-48*3600; removed=0; reclaimed=0
    for directory in (ROOT/'.forecast-cache').iterdir():
        if not directory.is_dir() or not re.fullmatch('[0-9a-f]{2}',directory.name): continue
        for path in directory.iterdir():
            if path.is_symlink() or not re.fullmatch('[0-9a-f]{64}',path.name) or not path.name.startswith(directory.name): continue
            stat=path.stat()
            if stat.st_mtime<cutoff:
                path.unlink();removed+=1;reclaimed+=stat.st_size
    if removed: print(f'Expired {removed} re-downloadable GRIB cache messages ({reclaimed} bytes); published forecasts retained.',flush=True)

def submit(output, dry_run=False, now=None):
    stamp = (now or datetime.now(timezone.utc))-timedelta(hours=5)
    latest = stamp.replace(hour=stamp.hour//6*6, minute=0, second=0, microsecond=0)
    cycles = [(latest-timedelta(hours=h)).strftime('%Y%m%d%H') for h in (0, 6)]
    inventory = output/'manifest.json'
    complete = set()
    if inventory.exists():
        payload = json.loads(inventory.read_text())
        if payload.get('schema') != 'wd-forecast-manifest-v1': raise ValueError('Unexpected forecast inventory')
        complete = {(r['model'], r['cycle'], r['member']) for r in payload['runs'] if r.get('version') == 'wd-fc-v1-t42-6h'}
    # A controller error stops submission, rather than being treated as no jobs.
    active = subprocess.run(['squeue', '-h', '--me', '-r', '-o', '%j|%K'], check=True,
                            text=True, capture_output=True, timeout=35).stdout.splitlines()
    active = {tuple(line.strip().split('|', 1)) for line in active}
    submitted = []
    for cycle in cycles:
        for model in ('gfs', 'ifs', 'aifs', 'gefs'):
            name = f'wd-fc-{model}-{cycle}'
            base = ['sbatch', '--parsable', f'--job-name={name}']
            if model == 'gefs':
                tasks = [i for i in range(31) if (model, cycle, 'c00' if i == 0 else f'p{i:02d}') not in complete
                         and (name, str(i)) not in active]
                if not tasks: continue
                base.append('--array='+','.join(map(str, tasks)))
                member = 'array'
            else:
                if (model, cycle, 'det') in complete or any(n == name for n, _ in active): continue
                member = 'det'
            cmd = base+['scripts/update_forecast.slurm', model, cycle, member, str(output)]
            if dry_run:
                print(' '.join(cmd), flush=True)
            else:
                result = subprocess.run(cmd, cwd=ROOT, check=True, text=True, capture_output=True, timeout=45)
                submitted.append(result.stdout.strip()); print(name, result.stdout.strip(), flush=True)
    return submitted

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--output', type=Path, default=PUBLIC); p.add_argument('--dry-run', action='store_true'); a=p.parse_args()
    lock = ROOT/'.forecast-cache/submit.lock'; lock.parent.mkdir(exist_ok=True)
    with lock.open('a') as stream:
        try: fcntl.flock(stream, fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise SystemExit('Another WD submission check is active.')
        submit(a.output, a.dry_run)
        if not a.dry_run: prune_cache()

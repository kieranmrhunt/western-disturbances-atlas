#!/usr/bin/env python3
"""Add only the WD forecast block; preserve and back up every other cron task."""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]
START='# BEGIN WD ATLAS OPERATIONAL FORECASTS'
END='# END WD ATLAS OPERATIONAL FORECASTS'

def current():
    result=subprocess.run(['crontab','-l'],text=True,capture_output=True,timeout=15)
    if result.returncode and 'no crontab' not in result.stderr: raise RuntimeError(result.stderr)
    return result.stdout if result.returncode==0 else ''

def install(apply=False):
    original=current();lines=original.splitlines();kept=[];inside=False
    for line in lines:
        if line==START: inside=True;continue
        if line==END: inside=False;continue
        if not inside: kept.append(line)
    if inside: raise ValueError('Unterminated WD cron block; refusing to change the crontab')
    block=[START,'# Hourly retry; each model cycle is submitted once after provider publication.',
           f'25 * * * * cd {ROOT} && /home/users/kieran/miniconda3/envs/py311/bin/python scripts/submit_forecast_update.py >> hpc-logs/wd-forecast-cron.log 2>&1',END]
    updated='\n'.join(kept).rstrip()+'\n\n'+'\n'.join(block)+'\n'
    if not apply: print('\n'.join(block));return
    if original==updated: print('WD forecast schedule already installed.');return
    if current()!=original: raise RuntimeError('Crontab changed during review; retry installation')
    backup=ROOT/'hpc-logs'/f'crontab-before-wd-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.txt'
    backup.write_text(original)
    subprocess.run(['crontab','-'],input=updated,text=True,check=True,timeout=15)
    if current()!=updated: raise RuntimeError('Installed crontab does not match the requested update')
    print(f'Installed hourly WD refresh; previous crontab saved at {backup}')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--apply',action='store_true');a=p.parse_args();install(a.apply)

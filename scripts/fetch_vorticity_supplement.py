#!/usr/bin/env python3
"""Fetch missing three-hourly ERA5 pressure-level vorticity for one month.

The original monthly source remains immutable.  Missing times are written to
``SOURCE_DIR/_supplements/YYYYMM.nc`` and merged by build_weather_videos.py at
read time.  This avoids rewriting a multi-gigabyte source file merely to add a
few late ERA5T fields.
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path

import cdsapi
import numpy as np
import pandas as pd
import xarray as xr


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="Incomplete YYYYMM.nc source")
    parser.add_argument("--destination", type=Path)
    return parser.parse_args()


def coord_name(dataset: xr.Dataset, candidates: tuple[str, ...]) -> str:
    for name in candidates:
        if name in dataset.coords or name in dataset.dims:
            return name
    raise KeyError(f"None of {candidates} occurs in {list(dataset.coords)}")


def normalise(dataset: xr.Dataset, template: xr.Dataset) -> xr.Dataset:
    variable = next((name for name in ("vo", "relative_vorticity", "vorticity") if name in dataset), None)
    if variable is None:
        raise KeyError(f"No relative-vorticity variable in {list(dataset.data_vars)}")
    time = coord_name(dataset, ("valid_time", "time"))
    level = coord_name(dataset, ("pressure_level", "level", "isobaricInhPa"))
    field = dataset[variable]
    if "expver" in field.dims:
        field = field.max("expver", skipna=True)
    elif "expver" in field.coords:
        field = field.drop_vars("expver")
    renames = {}
    if time != "valid_time":
        renames[time] = "valid_time"
    if level != "pressure_level":
        renames[level] = "pressure_level"
    field = field.rename(renames)
    if field.name != "vo":
        field = field.rename("vo")
    field = field.sel(pressure_level=template.pressure_level.values)
    for coordinate in ("latitude", "longitude"):
        wanted = np.asarray(template[coordinate].values)
        found = np.asarray(field[coordinate].values)
        if found.shape != wanted.shape or not np.allclose(found, wanted, rtol=0, atol=1.0e-6):
            raise ValueError(f"Downloaded {coordinate} grid does not match source")
        field = field.assign_coords({coordinate: template[coordinate]})
    field = field.assign_coords(pressure_level=template.pressure_level)
    return field.to_dataset(name="vo")


def main() -> None:
    args = arguments()
    if not args.source.is_file():
        raise FileNotFoundError(args.source)
    month = args.source.stem
    if len(month) != 6 or not month.isdigit():
        raise ValueError(f"Source name must be YYYYMM.nc, got {args.source.name}")
    destination = args.destination or args.source.parent / "_supplements" / args.source.name
    with xr.open_dataset(args.source) as source:
        source_time = coord_name(source, ("valid_time", "time"))
        actual = pd.DatetimeIndex(source[source_time].values)
        start = pd.Timestamp(f"{month[:4]}-{month[4:]}-01")
        expected = pd.date_range(start, start + pd.offsets.MonthBegin(1), freq="3h", inclusive="left")
        missing = expected.difference(actual)
        template = xr.Dataset(coords={
            "pressure_level": source[coord_name(source, ("pressure_level", "level", "isobaricInhPa"))].values,
            "latitude": source.latitude.values,
            "longitude": source.longitude.values,
        })
        source_attrs = dict(source.attrs)
        variable_attrs = dict(source[next(name for name in ("vo", "relative_vorticity", "vorticity") if name in source)].attrs)
    if not len(missing):
        print(json.dumps({"month": month, "missing_times": 0, "status": "source already complete"}, indent=2))
        return

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.parent.chmod(0o2755)
    if destination.is_file():
        with xr.open_dataset(destination) as existing:
            staged = normalise(existing, template)
            staged_times = pd.DatetimeIndex(staged.valid_time.values)
        if staged_times.equals(missing):
            print(json.dumps({
                "month": month,
                "missing_times": len(missing),
                "times": [timestamp.isoformat() for timestamp in missing],
                "destination": str(destination),
                "bytes": destination.stat().st_size,
                "status": "validated supplement already complete",
            }, indent=2))
            return
        raise ValueError(f"Existing supplement times {staged_times.tolist()} do not equal missing times {missing.tolist()}")
    pieces: list[xr.Dataset] = []
    client = cdsapi.Client()
    with tempfile.TemporaryDirectory(prefix=f"wd-vorticity-{month}-", dir=destination.parent) as temporary_dir:
        for date, group in pd.Series(missing, index=missing).groupby(missing.normalize()):
            target = Path(temporary_dir) / f"{date:%Y%m%d}.nc"
            group_times = pd.DatetimeIndex(group.values)
            request = {
                "product_type": "reanalysis",
                "variable": "vorticity",
                "year": f"{date.year:04d}",
                "month": f"{date.month:02d}",
                "day": f"{date.day:02d}",
                "time": [f"{timestamp.hour:02d}:00" for timestamp in group_times],
                "pressure_level": [str(value) for value in template.pressure_level.values],
                "area": [
                    float(template.latitude.max()), float(template.longitude.min()),
                    float(template.latitude.min()), float(template.longitude.max()),
                ],
                "data_format": "netcdf",
                "download_format": "unarchived",
            }
            client.retrieve("reanalysis-era5-pressure-levels", request, str(target))
            with xr.open_dataset(target) as downloaded:
                pieces.append(normalise(downloaded, template).load())
        supplement = xr.concat(pieces, dim="valid_time").sortby("valid_time")
        _, unique = np.unique(supplement.valid_time.values, return_index=True)
        supplement = supplement.isel(valid_time=np.sort(unique))
        obtained = pd.DatetimeIndex(supplement.valid_time.values)
        if not obtained.equals(missing):
            raise ValueError(f"Downloaded times {obtained.tolist()} do not equal missing times {missing.tolist()}")
        supplement.attrs = source_attrs | {
            "history": f"CDS pressure-level supplement for missing times in {args.source}",
            "supplements_source": str(args.source),
        }
        supplement.vo.attrs = variable_attrs
        temporary = destination.with_name(f".{destination.name}.tmp-{os.getpid()}")
        encoding = {"vo": {"dtype": "float32", "zlib": True, "complevel": 1, "shuffle": True}}
        try:
            supplement.to_netcdf(temporary, encoding=encoding)
            with xr.open_dataset(temporary) as check:
                checked = pd.DatetimeIndex(check.valid_time.values)
                if not checked.equals(missing) or check.vo.shape != supplement.vo.shape:
                    raise ValueError("Written supplement failed validation")
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
        destination.chmod(0o644)
    print(json.dumps({
        "month": month,
        "missing_times": len(missing),
        "times": [timestamp.isoformat() for timestamp in missing],
        "destination": str(destination),
        "bytes": destination.stat().st_size,
    }, indent=2))


if __name__ == "__main__":
    main()

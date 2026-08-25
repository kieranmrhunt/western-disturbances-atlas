#!/usr/bin/env python3
"""Build compact yearly shards of selected-WD precipitation footprints."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr


ROOT = Path(__file__).resolve().parents[1]
EPOCH = pd.Timestamp("1950-01-01T00:00:00Z")
SCALE = 10.0


def sha256(path: Path) -> str:
	digest = hashlib.sha256()
	with path.open("rb") as stream:
		for block in iter(lambda: stream.read(1024 * 1024), b""):
			digest.update(block)
	return digest.hexdigest()


def precipitation(dataset: xr.Dataset) -> xr.DataArray:
	name = next(key for key in ("avg_tprate", "mtpr", "total_precipitation_rate", "tp") if key in dataset)
	field = dataset[name]
	time_name = "valid_time" if "valid_time" in field.coords else "time"
	if time_name != "time":
		field = field.rename({time_name: "time"})
	units = str(field.attrs.get("units", "")).lower()
	if "kg" in units and "s" in units:
		field = field * np.float32(3600.0)
	elif units.strip() in {"m", "metre", "meter"}:
		field = field * np.float32(1000.0)
	return field.clip(min=0).astype("float32")


def prepare_month(path: Path) -> tuple[xr.DataArray, list[float]]:
	dataset = xr.open_dataset(path)
	field = precipitation(dataset)
	lat_index = np.flatnonzero((field.latitude.values >= 20) & (field.latitude.values <= 40))
	lon_index = np.flatnonzero((field.longitude.values >= 60) & (field.longitude.values <= 100))
	field = field.isel(latitude=lat_index, longitude=lon_index).coarsen(latitude=4, longitude=4, boundary="trim").mean()
	latitude = np.asarray(field.latitude.values)
	longitude = np.asarray(field.longitude.values)
	if latitude[0] < latitude[-1]:
		field = field.isel(latitude=slice(None, None, -1)); latitude = latitude[::-1]
	if longitude[0] > longitude[-1]:
		field = field.isel(longitude=slice(None, None, -1)); longitude = longitude[::-1]
	bounds = [float(longitude[0] - .5), float(latitude[-1] - .5), float(longitude[-1] + .5), float(latitude[0] + .5)]
	field.load()
	dataset.close()
	return field, bounds


def main() -> None:
	parser = argparse.ArgumentParser()
	parser.add_argument("--year", type=int, required=True)
	parser.add_argument("--source-dir", type=Path, default=Path("/home/users/kieran/ncas/data/era5-incompass/hourly_precip_SA"))
	parser.add_argument("--catalogue", type=Path, default=ROOT / "assets/wd-atlas-catalogue-v6.json.gz")
	parser.add_argument("--times", type=Path, default=ROOT / "assets/wd-atlas-times-v6.i32.gz")
	parser.add_argument("--output-dir", type=Path, required=True)
	args = parser.parse_args()
	with gzip.open(args.catalogue, "rt", encoding="utf-8") as stream:
		catalogue = json.load(stream)
	cat, offsets = catalogue["cat"], np.asarray(catalogue["off"], dtype=np.int64)
	point_hours = np.frombuffer(gzip.decompress(args.times.read_bytes()), dtype="<i4")
	track_indices = np.flatnonzero(np.asarray(cat["year"]) == args.year)
	track_ids = np.asarray(cat["id"])[track_indices]
	genesis = pd.DatetimeIndex([EPOCH + pd.Timedelta(hours=int(point_hours[offsets[index, 0]])) for index in track_indices])
	lysis = pd.DatetimeIndex([EPOCH + pd.Timedelta(hours=int(point_hours[offsets[index, 0] + offsets[index, 1] - 1])) for index in track_indices])
	months = sorted(set(genesis.strftime("%Y%m")) | set(lysis.strftime("%Y%m")))
	footprints: np.ndarray | None = None
	bounds: list[float] | None = None
	for month in months:
		month_start = pd.Timestamp(f"{month[:4]}-{month[4:]}-01", tz="UTC")
		month_end = month_start + pd.offsets.MonthBegin(1) - pd.Timedelta(seconds=1)
		active = np.flatnonzero((genesis <= month_end) & (lysis >= month_start))
		if not len(active):
			continue
		field, month_bounds = prepare_month(args.source_dir / f"{month}.nc")
		if footprints is None:
			footprints = np.zeros((len(track_indices), field.sizes["latitude"], field.sizes["longitude"]), dtype=np.float32)
			bounds = month_bounds
		elif footprints.shape[1:] != (field.sizes["latitude"], field.sizes["longitude"]) or bounds != month_bounds:
			raise ValueError(f"Grid changed in {month}")
		field_times = pd.DatetimeIndex(field.time.values).tz_localize("UTC")
		for local_index in active:
			mask = (field_times >= genesis[local_index]) & (field_times <= lysis[local_index])
			if mask.any():
				footprints[local_index] += np.asarray(field.isel(time=np.flatnonzero(mask)).sum("time").values, dtype=np.float32)
		field.close()
		print(f"{month}: {len(active)} active tracks")
	if footprints is None or bounds is None:
		raise ValueError(f"No footprint data for {args.year}")
	packed = np.clip(np.rint(footprints * SCALE), 0, np.iinfo(np.uint16).max).astype("<u2")
	year_dir = args.output_dir / str(args.year)
	year_dir.mkdir(parents=True, exist_ok=True)
	for directory in (args.output_dir, year_dir):
		directory.chmod(0o2755)
	data_path = year_dir / f"{args.year}.u16.gz"
	temporary = data_path.with_name(f".{data_path.name}.tmp-{os.getpid()}")
	temporary.write_bytes(gzip.compress(packed.tobytes(), compresslevel=9, mtime=0))
	os.replace(temporary, data_path); data_path.chmod(0o644)
	metadata = {
		"schema": "western-disturbances-atlas-impact-footprint-v1", "year": args.year,
		"definition": "ERA5 precipitation accumulated during the published WD lifetime, inclusive of genesis and lysis hour",
		"units": "mm", "scale": SCALE, "dtype": "uint16", "layout": "track,latitude,longitude",
		"track_ids": track_ids.astype(int).tolist(), "shape": list(packed.shape), "bounds_west_south_east_north": bounds,
		"source": str(args.source_dir), "bytes": data_path.stat().st_size, "sha256": sha256(data_path),
		"built_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
	}
	metadata_path = data_path.with_suffix(".json")
	metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8"); metadata_path.chmod(0o644)
	print(json.dumps({key: value for key, value in metadata.items() if key != "track_ids"}, indent=2))


if __name__ == "__main__":
	main()

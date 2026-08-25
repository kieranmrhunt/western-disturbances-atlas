#!/usr/bin/env python3
"""Build per-fix 200-hPa subtropical-jet diagnostics for the WD atlas."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr


ROOT = Path(__file__).resolve().parents[1]
EPOCH = pd.Timestamp("1950-01-01T00:00:00Z")


def sha256(path: Path) -> str:
	digest = hashlib.sha256()
	with path.open("rb") as stream:
		for block in iter(lambda: stream.read(1024 * 1024), b""):
			digest.update(block)
	return digest.hexdigest()


def write_float(path: Path, values: np.ndarray) -> None:
	path.write_bytes(gzip.compress(np.asarray(values, dtype="<f4").tobytes(), compresslevel=9, mtime=0))


def main() -> None:
	parser = argparse.ArgumentParser()
	parser.add_argument("--source-dir", type=Path, default=Path("/home/users/kieran/ncas/data/era5-incompass/daily-winds-200"))
	parser.add_argument("--catalogue", type=Path, default=ROOT / "assets/wd-atlas-catalogue-v6.json.gz")
	parser.add_argument("--fixes", type=Path, default=ROOT / "assets/wd-atlas-fixes-v6.i16.gz")
	parser.add_argument("--times", type=Path, default=ROOT / "assets/wd-atlas-times-v6.i32.gz")
	parser.add_argument("--output-dir", type=Path, default=ROOT / "assets")
	args = parser.parse_args()
	with gzip.open(args.catalogue, "rt", encoding="utf-8") as stream:
		catalogue = json.load(stream)
	npoints = int(catalogue["meta"]["npts"])
	packed = np.frombuffer(gzip.decompress(args.fixes.read_bytes()), dtype="<i2")
	hours = np.frombuffer(gzip.decompress(args.times.read_bytes()), dtype="<i4")
	longitude = packed[:npoints].astype(np.float32) / 100
	latitude = packed[npoints:npoints * 2].astype(np.float32) / 100
	times = EPOCH + pd.to_timedelta(hours.astype(np.int64), unit="h")
	months = np.asarray(times.strftime("%Y%m"))
	outputs = {
		"jet_axis_latitude_200hpa": np.full(npoints, np.nan, dtype=np.float32),
		"jet_axis_distance_200hpa": np.full(npoints, np.nan, dtype=np.float32),
		"jet_axis_wind_speed_200hpa": np.full(npoints, np.nan, dtype=np.float32),
		"local_wind_speed_200hpa": np.full(npoints, np.nan, dtype=np.float32),
	}
	for month in sorted(set(months)):
		indices = np.flatnonzero((months == month) & (longitude >= 50) & (longitude <= 80))
		if not len(indices):
			continue
		source = args.source_dir / f"{month}.nc"
		if not source.is_file():
			print(f"{month}: source unavailable; {len(indices):,} fixes retained as NaN")
			continue
		with xr.open_dataset(source) as dataset:
			time_name = "valid_time" if "valid_time" in dataset.coords else "time"
			u = dataset["u"]
			v = dataset["v"]
			# The archive normally contains a pre-sliced 200-hPa field. Retain
			# support for multi-level source files so the builder is portable.
			for level_name in ("pressure_level", "level"):
				if level_name in u.coords:
					u = u.sel({level_name: 200}, method="nearest")
					v = v.sel({level_name: 200}, method="nearest")
					break
			lat_mask = (dataset.latitude >= 20) & (dataset.latitude <= 55)
			wind = np.hypot(u.sel(latitude=dataset.latitude[lat_mask]).values, v.sel(latitude=dataset.latitude[lat_mask]).values).astype(np.float32)
			latitudes = np.asarray(u.sel(latitude=dataset.latitude[lat_mask]).latitude.values)
			longitudes = np.asarray(u.longitude.values)
			source_times = pd.DatetimeIndex(dataset[time_name].values).tz_localize("UTC")
		axis_index = np.nanargmax(wind, axis=1)
		axis_speed = np.take_along_axis(wind, axis_index[:, None, :], axis=1)[:, 0, :]
		axis_latitude = latitudes[axis_index]
		day_lookup = {time.normalize(): index for index, time in enumerate(source_times)}
		available = np.asarray([time.normalize() in day_lookup for time in times[indices]])
		if not available.all():
			print(f"{month}: {(~available).sum():,} fixes fall on unavailable source days and remain NaN")
		indices = indices[available]
		if not len(indices):
			continue
		day_index = np.asarray([day_lookup[time.normalize()] for time in times[indices]], dtype=np.int64)
		lon_index = np.abs(longitudes[None, :] - longitude[indices, None]).argmin(axis=1)
		lat_index = np.abs(latitudes[None, :] - latitude[indices, None]).argmin(axis=1)
		axis_lat = axis_latitude[day_index, lon_index]
		outputs["jet_axis_latitude_200hpa"][indices] = axis_lat
		outputs["jet_axis_distance_200hpa"][indices] = latitude[indices] - axis_lat
		outputs["jet_axis_wind_speed_200hpa"][indices] = axis_speed[day_index, lon_index]
		outputs["local_wind_speed_200hpa"][indices] = wind[day_index, lat_index, lon_index]
		print(f"{month}: {len(indices):,} fixes")
	args.output_dir.mkdir(parents=True, exist_ok=True)
	descriptors = [
		{"key": "jet_axis_latitude_200hpa", "label": "200-hPa jet-axis latitude", "shortLabel": "jet latitude", "yLabel": "Jet-axis latitude (°N)", "unit": " °N", "decimals": 1, "zeroBased": False, "group": "Jet relationship"},
		{"key": "jet_axis_distance_200hpa", "label": "Latitude relative to 200-hPa jet axis", "shortLabel": "jet-relative latitude", "yLabel": "Track latitude minus jet-axis latitude (°)", "unit": "°", "decimals": 1, "zeroBased": False, "group": "Jet relationship"},
		{"key": "jet_axis_wind_speed_200hpa", "label": "200-hPa jet-axis wind speed", "shortLabel": "jet wind", "yLabel": "Jet-axis wind speed (m s⁻¹)", "unit": " m s⁻¹", "decimals": 1, "zeroBased": True, "group": "Jet relationship"},
		{"key": "local_wind_speed_200hpa", "label": "Local 200-hPa wind speed", "shortLabel": "local 200-hPa wind", "yLabel": "Local 200-hPa wind speed (m s⁻¹)", "unit": " m s⁻¹", "decimals": 1, "zeroBased": True, "group": "Jet relationship"},
	]
	for descriptor in descriptors:
		filename = f"wd-atlas-diag-v6-{descriptor['key']}.f32.gz"
		path = args.output_dir / filename
		write_float(path, outputs[descriptor["key"]])
		descriptor.update({"file": f"assets/{filename}", "colour": "--mla-indigo", "fallback": "#233f78", "available_fixes": int(np.isfinite(outputs[descriptor["key"]]).sum()), "bytes": path.stat().st_size, "sha256": sha256(path)})
	manifest = {"schema": "western-disturbances-atlas-jet-diagnostics-v1", "source": str(args.source_dir), "definition": "Daily 200-hPa maximum wind speed and its latitude between 20 and 55°N, sampled at the WD longitude from 50 to 80°E", "source_coverage_note": "Thirty-four catalogue fixes on 29-31 October 2023 are unavailable in the dedicated daily-wind source; other dates and fixes outside 50-80E are handled explicitly as available or out of domain.", "built_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "diagnostics": descriptors}
	manifest_path = args.output_dir / "wd-atlas-jet-v1.json"
	manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
	build_manifest_path = ROOT / "assets/atlas-build-manifest.json"
	if build_manifest_path.is_file() and args.output_dir.resolve() == (ROOT / "assets").resolve():
		build_manifest = json.loads(build_manifest_path.read_text(encoding="utf-8"))
		build_manifest["assets"]["jet_manifest"] = {"file": manifest_path.name, "bytes": manifest_path.stat().st_size, "sha256": sha256(manifest_path)}
		for descriptor in descriptors:
			build_manifest["assets"][f"diagnostic:{descriptor['key']}"] = {"file": Path(descriptor["file"]).name, "bytes": descriptor["bytes"], "sha256": descriptor["sha256"]}
		build_manifest_path.write_text(json.dumps(build_manifest, indent=2) + "\n", encoding="utf-8")
	print(json.dumps({"manifest": str(manifest_path), "diagnostics": len(descriptors)}, indent=2))


if __name__ == "__main__":
	main()

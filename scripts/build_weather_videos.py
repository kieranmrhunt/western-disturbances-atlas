#!/usr/bin/env python3
"""Build compact monthly ERA5 weather videos for the WD atlas.

The browser treats each video frame as a georeferenced raster and seeks to the
frame matching the selected three-hourly WD fix.  Colour occupies the left
half of every frame and opacity is encoded as luma in the right half, avoiding
browser-dependent alpha-video support.
"""

from __future__ import annotations

import argparse
import calendar
import gzip
import hashlib
import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr


FPS = 6
FIELD_SPECS = {
	"vorticity350": {
		"source_dir": Path("/home/users/kieran/ncas/data/era5-incompass/ut-vort"),
		"schema": "western-disturbances-atlas-weather-v1",
		"label": "ERA5 350-hPa relative vorticity",
		"units": "1e-5 s-1",
		"step_hours": 3,
		"crop": (20.0, 5.0, 110.0, 55.0),
		"coarsen": 2,
		"positive_only": True,
		"alpha_full": 7.0,
		"alpha_threshold": 0.0,
		"colour_stops": (
			(0.0, (49, 54, 149)), (3.0, (69, 117, 180)),
			(7.0, (145, 191, 219)), (11.0, (247, 247, 247)),
			(17.0, (214, 96, 77)), (28.0, (103, 0, 31)),
		),
	},
	"precipitation": {
		"source_dir": Path("/home/users/kieran/ncas/data/era5-incompass/hourly_precip_SA"),
		"schema": "western-disturbances-atlas-weather-v1",
		"label": "ERA5 trailing 24-hour accumulated precipitation",
		"units": "mm",
		"step_hours": 1,
		"crop": (50.0, -6.0, 110.0, 40.0),
		"coarsen": 4,
		"positive_only": True,
		"alpha_full": 10.0,
		"alpha_threshold": 0.1,
		"colour_stops": (
			(0.0, (247, 252, 253)), (1.0, (204, 236, 230)),
			(5.0, (102, 194, 164)), (10.0, (35, 139, 69)),
			(25.0, (34, 94, 168)), (50.0, (84, 39, 143)),
			(100.0, (62, 0, 92)), (150.0, (46, 0, 72)),
		),
	},
	"wind500": {
		"source_dir": Path("/home/users/kieran/ncas/data/era5-incompass/3hourly_pl_SA"),
		"schema": "western-disturbances-atlas-weather-v1", "label": "ERA5 500-hPa wind speed", "units": "m s-1", "step_hours": 3,
		"crop": (30.0, 5.0, 110.0, 45.0), "coarsen": 4, "loader": "pressure", "variable": "wind_speed", "level": 500,
		"positive_only": True, "alpha_full": 35.0, "alpha_threshold": 0.0,
		"colour_stops": ((0.0, (247, 252, 253)), (10.0, (204, 236, 230)), (20.0, (102, 194, 164)), (30.0, (44, 127, 184)), (45.0, (84, 39, 143)), (65.0, (46, 0, 72))),
	},
	"temperature500": {
		"source_dir": Path("/home/users/kieran/ncas/data/era5-incompass/3hourly_pl_SA"),
		"schema": "western-disturbances-atlas-weather-v1", "label": "ERA5 500-hPa temperature", "units": "K", "step_hours": 3,
		"crop": (30.0, 5.0, 110.0, 45.0), "coarsen": 4, "loader": "pressure", "variable": "t", "level": 500,
		"positive_only": False, "alpha_full": 330.0, "alpha_threshold": 0.0,
		"colour_stops": ((230.0, (49, 54, 149)), (245.0, (69, 117, 180)), (255.0, (247, 247, 247)), (265.0, (244, 109, 67)), (280.0, (103, 0, 31))),
	},
	"humidity500": {
		"source_dir": Path("/home/users/kieran/ncas/data/era5-incompass/3hourly_pl_SA"),
		"schema": "western-disturbances-atlas-weather-v1", "label": "ERA5 500-hPa specific humidity", "units": "g kg-1", "step_hours": 3,
		"crop": (30.0, 5.0, 110.0, 45.0), "coarsen": 4, "loader": "pressure", "variable": "q_gkg", "level": 500,
		"positive_only": True, "alpha_full": 3.0, "alpha_threshold": 0.02,
		"colour_stops": ((0.0, (247, 252, 240)), (0.5, (224, 243, 219)), (1.0, (168, 221, 181)), (2.0, (67, 162, 202)), (3.5, (44, 127, 184)), (5.0, (8, 64, 129))),
	},
	"mslp": {
		"source_dir": Path("/home/users/kieran/ncas/data/era5-incompass/hourly_sfc_SA"),
		"schema": "western-disturbances-atlas-weather-v1", "label": "ERA5 mean-sea-level pressure", "units": "hPa", "step_hours": 1,
		"crop": (30.0, 5.0, 110.0, 45.0), "coarsen": 4, "loader": "surface", "variable": "msl_hpa",
		"positive_only": False, "alpha_full": 1350.0, "alpha_threshold": 0.0,
		"colour_stops": ((970.0, (103, 0, 31)), (990.0, (214, 96, 77)), (1010.0, (247, 247, 247)), (1025.0, (69, 117, 180)), (1045.0, (49, 54, 149))),
	},
}


def arguments() -> argparse.Namespace:
	parser = argparse.ArgumentParser()
	parser.add_argument("--field", choices=tuple(FIELD_SPECS), default="vorticity350")
	parser.add_argument("--source-dir", type=Path)
	parser.add_argument("--output-dir", type=Path)
	parser.add_argument("--month")
	parser.add_argument("--month-manifest", type=Path)
	parser.add_argument("--task-id", type=int)
	parser.add_argument("--chunk-index", type=int)
	parser.add_argument("--chunks-per-month", type=int, default=1)
	parser.add_argument("--catalogue", type=Path)
	parser.add_argument("--write-month-manifest", type=Path)
	parser.add_argument("--fps", type=int, default=FPS)
	parser.add_argument("--ffmpeg", default="ffmpeg")
	parser.add_argument("--overwrite", action="store_true")
	parser.add_argument("--assemble-chunks", action="store_true")
	parser.add_argument("--finalize", action="store_true")
	return parser.parse_args()


def sha256(path: Path) -> str:
	digest = hashlib.sha256()
	with path.open("rb") as stream:
		for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
			digest.update(block)
	return digest.hexdigest()


def write_month_manifest(catalogue: Path, destination: Path) -> None:
	with gzip.open(catalogue, "rt", encoding="utf-8") as stream:
		payload = json.load(stream)
	cat = payload["cat"]
	months: set[str] = set()
	for index, count in enumerate(cat["npts"]):
		start = datetime(cat["year"][index], cat["month"][index], cat["day"][index], cat["hour"][index])
		end = start + timedelta(hours=3 * (int(count) - 1))
		cursor = start.replace(day=1, hour=0)
		while cursor <= end:
			months.add(cursor.strftime("%Y%m"))
			cursor = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
	destination.parent.mkdir(parents=True, exist_ok=True)
	destination.write_text("yyyymm\n" + "\n".join(sorted(months)) + "\n", encoding="utf-8")
	print(json.dumps({"manifest": str(destination), "months": len(months)}, indent=2))


def resolve_month(args: argparse.Namespace) -> str:
	if args.month:
		month = args.month
	elif args.month_manifest is not None and args.task_id is not None:
		manifest = pd.read_csv(args.month_manifest, dtype={"yyyymm": str})
		if not 0 <= args.task_id < len(manifest):
			raise IndexError(f"task {args.task_id} outside {len(manifest)}-month manifest")
		month = str(manifest.iloc[args.task_id]["yyyymm"])
	else:
		raise ValueError("Provide --month, or --month-manifest with --task-id")
	if len(month) != 6 or not month.isdigit() or not 1 <= int(month[4:]) <= 12:
		raise ValueError(f"Invalid YYYYMM month: {month}")
	return month


def time_name(field: xr.DataArray) -> str:
	for name in ("time", "valid_time", "forecast_time"):
		if name in field.coords or name in field.dims:
			return name
	raise KeyError(f"No time coordinate among {list(field.coords)}")


def vorticity350(dataset: xr.Dataset) -> xr.DataArray:
	name = next((key for key in ("vo", "relative_vorticity", "vorticity") if key in dataset), None)
	if name is None:
		raise KeyError(f"No vorticity field among {list(dataset.data_vars)}")
	field = dataset[name]
	level = next((key for key in ("level", "pressure_level", "isobaricInhPa") if key in field.coords or key in field.dims), None)
	if level is None:
		raise KeyError("350-hPa vorticity requires a pressure-level coordinate")
	field = field.sel({level: 350}, method="nearest")
	time = time_name(field)
	if time != "time":
		field = field.rename({time: "time"})
	return field.astype("float32") * np.float32(1.0e5)


def precipitation(dataset: xr.Dataset) -> xr.DataArray:
	name = next((key for key in ("mtpr", "avg_tprate", "total_precipitation_rate", "tp") if key in dataset), None)
	if name is None:
		raise KeyError(f"No precipitation field among {list(dataset.data_vars)}")
	field = dataset[name]
	time = time_name(field)
	if time != "time":
		field = field.rename({time: "time"})
	units = str(field.attrs.get("units", "")).lower()
	if "kg" in units and "s" in units:
		field = field * np.float32(3600.0)
	elif units.strip() in {"m", "metre", "meter"}:
		field = field * np.float32(1000.0)
	return field.clip(min=0).astype("float32")


def pressure_field(dataset: xr.Dataset, spec: dict) -> xr.DataArray:
	level_name = next((key for key in ("level", "pressure_level", "isobaricInhPa") if key in dataset.coords or key in dataset.dims), None)
	if level_name is None:
		raise KeyError("Pressure-level weather field requires a pressure coordinate")
	variable = spec["variable"]
	if variable == "wind_speed":
		field = np.hypot(dataset["u"], dataset["v"])
	elif variable == "q_gkg":
		field = dataset["q"] * np.float32(1000.0)
	else:
		field = dataset[variable]
	field = field.sel({level_name: spec["level"]}, method="nearest")
	time = time_name(field)
	return field.rename({time: "time"}).astype("float32") if time != "time" else field.astype("float32")


def surface_field(dataset: xr.Dataset, spec: dict) -> xr.DataArray:
	variable = spec["variable"]
	if variable == "msl_hpa":
		field = dataset["msl"] / np.float32(100.0)
	else:
		field = dataset[variable]
	time = time_name(field)
	return field.rename({time: "time"}).astype("float32") if time != "time" else field.astype("float32")


def crop_and_coarsen(field: xr.DataArray, spec: dict) -> tuple[xr.DataArray, list[float]]:
	west, south, east, north = spec["crop"]
	latitudes = np.asarray(field.latitude.values)
	longitudes = np.asarray(field.longitude.values)
	lat_index = np.flatnonzero((latitudes >= south) & (latitudes <= north))
	lon_index = np.flatnonzero((longitudes >= west) & (longitudes <= east))
	if not len(lat_index) or not len(lon_index):
		raise ValueError("Weather crop does not intersect the source grid")
	field = field.isel(latitude=lat_index, longitude=lon_index)
	factor = int(spec["coarsen"])
	if factor > 1:
		field = field.coarsen(latitude=factor, longitude=factor, boundary="trim").mean()
	if field.sizes["latitude"] % 2:
		field = field.isel(latitude=slice(0, -1))
	if field.sizes["longitude"] % 2:
		field = field.isel(longitude=slice(0, -1))
	latitude = np.asarray(field.latitude.values, dtype=float)
	longitude = np.asarray(field.longitude.values, dtype=float)
	if latitude[0] < latitude[-1]:
		field = field.isel(latitude=slice(None, None, -1))
		latitude = latitude[::-1]
	if longitude[0] > longitude[-1]:
		field = field.isel(longitude=slice(None, None, -1))
		longitude = longitude[::-1]
	lat_step = float(abs(np.median(np.diff(latitude))))
	lon_step = float(abs(np.median(np.diff(longitude))))
	bounds = [
		float(longitude[0] - lon_step / 2),
		float(latitude[-1] - lat_step / 2),
		float(longitude[-1] + lon_step / 2),
		float(latitude[0] + lat_step / 2),
	]
	return field, bounds


def load_field(
	source: Path,
	field_name: str,
	month: str,
	chunk_index: int | None = None,
	chunks_per_month: int = 1,
) -> tuple[xr.DataArray, list[float], list[Path]]:
	spec = FIELD_SPECS[field_name]
	datasets = [xr.open_dataset(source)]
	sources = [source]
	if field_name == "vorticity350":
		field = vorticity350(datasets[0])
	elif field_name == "precipitation":
		field = precipitation(datasets[0])
		if "expver" in field.dims:
			field = field.max("expver", skipna=True)
		elif "expver" in field.coords:
			field = field.drop_vars("expver")
		previous_month = (pd.Period(month, freq="M") - 1).strftime("%Y%m")
		previous_source = source.parent / f"{previous_month}.nc"
		if not previous_source.is_file():
			raise FileNotFoundError(f"24-hour accumulation requires {previous_source}")
		datasets.append(xr.open_dataset(previous_source))
		previous = precipitation(datasets[-1])
		if "expver" in previous.dims:
			previous = previous.max("expver", skipna=True)
		elif "expver" in previous.coords:
			previous = previous.drop_vars("expver")
		previous = previous.isel(time=slice(-23, None))
		current_times = np.asarray(field.time.values)
		field = xr.concat((previous, field), dim="time").sortby("time")
		_, unique = np.unique(np.asarray(field.time.values), return_index=True)
		field = field.isel(time=np.sort(unique))
		sources.append(previous_source)
	elif spec.get("loader") == "pressure":
		field = pressure_field(datasets[0], spec)
	elif spec.get("loader") == "surface":
		field = surface_field(datasets[0], spec)
	else:
		raise ValueError(f"No loader configured for {field_name}")
	field, bounds = crop_and_coarsen(field, spec)
	if field_name == "precipitation":
		field = field.rolling(time=24, min_periods=24).sum().sel(time=current_times)
	if chunk_index is not None:
		if chunks_per_month < 1 or not 0 <= chunk_index < chunks_per_month:
			raise ValueError(f"Invalid chunk {chunk_index} of {chunks_per_month}")
		indices = np.array_split(np.arange(field.sizes["time"]), chunks_per_month)[chunk_index]
		if not len(indices):
			raise ValueError(f"Weather chunk {chunk_index} of {chunks_per_month} is empty")
		field = field.isel(time=slice(int(indices[0]), int(indices[-1]) + 1))
	field.load()
	for dataset in datasets:
		dataset.close()
	return field, bounds, sources


def colourise(values: np.ndarray, spec: dict) -> np.ndarray:
	values = np.asarray(values, dtype=np.float32)
	finite = np.isfinite(values)
	visible = finite & (values > float(spec["alpha_threshold"]))
	values = np.where(finite, values, 0)
	stops = spec["colour_stops"]
	stop_values = np.asarray([item[0] for item in stops], dtype=np.float32)
	stop_colours = np.asarray([item[1] for item in stops], dtype=np.float32)
	rgb = np.clip(np.stack([
		np.interp(values, stop_values, stop_colours[:, channel]) for channel in range(3)
	], axis=-1), 0, 255).astype(np.uint8)
	alpha = np.where(visible, np.clip(values / float(spec["alpha_full"]), 0, 1) * 255, 0).astype(np.uint8)
	mask = np.repeat(alpha[..., None], 3, axis=-1)
	return np.concatenate((rgb, mask), axis=1)


def valid_video(destination: Path, metadata_path: Path, spec: dict) -> bool:
	if not destination.is_file() or not metadata_path.is_file():
		return False
	try:
		metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
		return metadata.get("sha256") == sha256(destination) and metadata.get("schema") == spec["schema"]
	except (OSError, ValueError, json.JSONDecodeError):
		return False


def video_command(args: argparse.Namespace, width: int, height: int, destination: Path) -> list[str]:
	return [
		args.ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
		"-f", "rawvideo", "-pix_fmt", "rgb24", "-s:v", f"{width * 2}x{height}",
		"-r", str(args.fps), "-i", "-", "-an", "-c:v", "libvpx-vp9",
		"-crf", "28", "-b:v", "0", "-deadline", "good", "-cpu-used", "3",
		"-pix_fmt", "yuv420p", "-g", str(args.fps), "-f", "webm", str(destination),
	]


def chunk_paths(args: argparse.Namespace, month: str, chunk_index: int) -> tuple[Path, Path]:
	stem = f"chunk-{chunk_index:02d}-of-{args.chunks_per_month:02d}"
	directory = args.output_dir / "_chunks" / args.field / month[:4] / month
	payload = directory / f"{stem}.rgb24.gz"
	return payload, payload.with_suffix(".json")


def render_chunk(args: argparse.Namespace, month: str) -> None:
	if args.output_dir is None or args.chunk_index is None:
		raise ValueError("--output-dir and --chunk-index are required for chunk rendering")
	spec = FIELD_SPECS[args.field]
	destination = args.output_dir / args.field / month[:4] / f"{month}.webm"
	metadata_path = destination.with_suffix(".json")
	if valid_video(destination, metadata_path, spec) and not args.overwrite:
		print(f"{month}: final video already complete")
		return
	payload, chunk_metadata_path = chunk_paths(args, month, args.chunk_index)
	if payload.is_file() and chunk_metadata_path.is_file() and not args.overwrite:
		metadata = json.loads(chunk_metadata_path.read_text(encoding="utf-8"))
		if (
			metadata.get("sha256") == sha256(payload)
			and metadata.get("field_key") == args.field
			and metadata.get("month") == month
			and metadata.get("chunk_index") == args.chunk_index
			and metadata.get("chunks_per_month") == args.chunks_per_month
		):
			print(f"{month} chunk {args.chunk_index}: already complete")
			return
	source_dir = args.source_dir or spec["source_dir"]
	source = source_dir / f"{month}.nc"
	if not source.is_file():
		raise FileNotFoundError(source)
	payload.parent.mkdir(parents=True, exist_ok=True)
	for directory in (args.output_dir, args.output_dir / "_chunks", args.output_dir / "_chunks" / args.field, payload.parent.parent, payload.parent):
		directory.chmod(0o2755)
	field, bounds, sources = load_field(source, args.field, month, args.chunk_index, args.chunks_per_month)
	times = pd.DatetimeIndex(field.time.values)
	height = int(field.sizes["latitude"])
	width = int(field.sizes["longitude"])
	temporary = payload.with_name(f".{payload.name}.tmp-{os.getpid()}")
	try:
		with temporary.open("wb") as raw:
			with gzip.GzipFile(fileobj=raw, mode="wb", compresslevel=6, mtime=0) as stream:
				for index in range(len(times)):
					stream.write(colourise(field.isel(time=index).values, spec).tobytes(order="C"))
		os.replace(temporary, payload)
		payload.chmod(0o644)
	finally:
		field.close()
		temporary.unlink(missing_ok=True)
	metadata = {
		"schema": "western-disturbances-atlas-weather-chunk-v1", "field_key": args.field,
		"month": month, "chunk_index": args.chunk_index, "chunks_per_month": args.chunks_per_month,
		"source": str(source), "source_previous": str(sources[1]) if len(sources) > 1 else None,
		"step_hours": spec["step_hours"], "frames": len(times), "width": width, "height": height,
		"bounds_west_south_east_north": bounds, "first_time_utc": times[0].isoformat() + "Z",
		"last_time_utc": times[-1].isoformat() + "Z", "sha256": sha256(payload),
		"bytes": payload.stat().st_size, "built_utc": datetime.now(timezone.utc).isoformat(),
	}
	chunk_metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
	chunk_metadata_path.chmod(0o644)
	print(json.dumps(metadata, indent=2, sort_keys=True))


def assemble_chunks(args: argparse.Namespace, month: str) -> None:
	if args.output_dir is None:
		raise ValueError("--output-dir is required for chunk assembly")
	spec = FIELD_SPECS[args.field]
	destination = args.output_dir / args.field / month[:4] / f"{month}.webm"
	metadata_path = destination.with_suffix(".json")
	if valid_video(destination, metadata_path, spec) and not args.overwrite:
		print(f"{month}: already complete")
		return
	chunks: list[tuple[Path, dict]] = []
	for chunk_index in range(args.chunks_per_month):
		payload, chunk_metadata_path = chunk_paths(args, month, chunk_index)
		if not payload.is_file() or not chunk_metadata_path.is_file():
			raise FileNotFoundError(f"Incomplete weather chunk {month} {chunk_index}/{args.chunks_per_month}")
		metadata = json.loads(chunk_metadata_path.read_text(encoding="utf-8"))
		if metadata.get("sha256") != sha256(payload):
			raise ValueError(f"Checksum mismatch for weather chunk {month} {chunk_index}")
		if metadata.get("field_key") != args.field or metadata.get("month") != month:
			raise ValueError(f"Identity mismatch for weather chunk {month} {chunk_index}")
		if metadata.get("chunk_index") != chunk_index or metadata.get("chunks_per_month") != args.chunks_per_month:
			raise ValueError(f"Sequence mismatch for weather chunk {month} {chunk_index}")
		chunks.append((payload, metadata))
	width, height = int(chunks[0][1]["width"]), int(chunks[0][1]["height"])
	bounds = chunks[0][1]["bounds_west_south_east_north"]
	if any((item[1]["width"], item[1]["height"], item[1]["bounds_west_south_east_north"]) != (width, height, bounds) for item in chunks):
		raise ValueError(f"Grid mismatch among weather chunks for {month}")
	frames = sum(int(item[1]["frames"]) for item in chunks)
	expected = calendar.monthrange(int(month[:4]), int(month[4:]))[1] * 24 // int(spec["step_hours"])
	if frames != expected:
		raise ValueError(f"Weather chunks for {month} have {frames} frames; expected {expected}")
	destination.parent.mkdir(parents=True, exist_ok=True)
	for directory in (args.output_dir, args.output_dir / args.field, destination.parent):
		directory.chmod(0o2755)
	temporary = destination.with_name(f".{destination.name}.tmp-{os.getpid()}")
	command = video_command(args, width, height, temporary)
	process = subprocess.Popen(command, stdin=subprocess.PIPE)
	try:
		assert process.stdin is not None
		for payload, _ in chunks:
			with gzip.open(payload, "rb") as stream:
				for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
					process.stdin.write(block)
		process.stdin.close()
		if process.wait():
			raise subprocess.CalledProcessError(process.returncode, command)
		os.replace(temporary, destination)
		destination.chmod(0o644)
	except Exception:
		if process.stdin and not process.stdin.closed:
			try:
				process.stdin.close()
			except BrokenPipeError:
				pass
		process.kill(); process.wait(); temporary.unlink(missing_ok=True)
		raise
	metadata = {
		"schema": spec["schema"], "field_key": args.field, "field": spec["label"], "units": spec["units"],
		"month": month, "source": chunks[0][1]["source"], "source_previous": chunks[0][1].get("source_previous"),
		"step_hours": spec["step_hours"], "frames_per_second": args.fps, "frames": frames,
		"width": width, "height": height, "encoded_width": width * 2, "mask_layout": "right-half-luma",
		"bounds_west_south_east_north": bounds, "first_time_utc": chunks[0][1]["first_time_utc"],
		"last_time_utc": chunks[-1][1]["last_time_utc"],
		"colour_stops": [{"value": value, "rgb": list(colour)} for value, colour in spec["colour_stops"]],
		"sha256": sha256(destination), "bytes": destination.stat().st_size,
		"built_utc": datetime.now(timezone.utc).isoformat(), "assembled_from_chunks": args.chunks_per_month,
	}
	metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
	metadata_path.chmod(0o644)
	print(json.dumps(metadata, indent=2, sort_keys=True))


def render_month(args: argparse.Namespace, month: str) -> None:
	if args.output_dir is None:
		raise ValueError("--output-dir is required when rendering")
	spec = FIELD_SPECS[args.field]
	source_dir = args.source_dir or spec["source_dir"]
	source = source_dir / f"{month}.nc"
	if not source.is_file():
		raise FileNotFoundError(source)
	destination = args.output_dir / args.field / month[:4] / f"{month}.webm"
	metadata_path = destination.with_suffix(".json")
	if valid_video(destination, metadata_path, spec) and not args.overwrite:
		print(f"{month}: already complete")
		return
	destination.parent.mkdir(parents=True, exist_ok=True)
	for directory in (args.output_dir, args.output_dir / args.field, destination.parent):
		directory.chmod(0o2755)
	temporary = destination.with_name(f".{destination.name}.tmp-{os.getpid()}")
	field, bounds, sources = load_field(source, args.field, month)
	times = pd.DatetimeIndex(field.time.values)
	height = int(field.sizes["latitude"])
	width = int(field.sizes["longitude"])
	command = video_command(args, width, height, temporary)
	process = subprocess.Popen(command, stdin=subprocess.PIPE)
	try:
		assert process.stdin is not None
		for index in range(len(times)):
			process.stdin.write(colourise(field.isel(time=index).values, spec).tobytes(order="C"))
		process.stdin.close()
		if process.wait():
			raise subprocess.CalledProcessError(process.returncode, command)
		os.replace(temporary, destination)
		destination.chmod(0o644)
	except Exception:
		if process.stdin and not process.stdin.closed:
			try:
				process.stdin.close()
			except BrokenPipeError:
				pass
		process.kill()
		process.wait()
		temporary.unlink(missing_ok=True)
		raise
	finally:
		field.close()
	metadata = {
		"schema": spec["schema"], "field_key": args.field, "field": spec["label"],
		"units": spec["units"], "month": month, "source": str(source),
		"source_previous": str(sources[1]) if len(sources) > 1 else None,
		"step_hours": spec["step_hours"], "frames_per_second": args.fps,
		"frames": len(times), "width": width, "height": height,
		"encoded_width": width * 2, "mask_layout": "right-half-luma",
		"bounds_west_south_east_north": bounds,
		"first_time_utc": times[0].isoformat() + "Z",
		"last_time_utc": times[-1].isoformat() + "Z",
		"colour_stops": [{"value": value, "rgb": list(colour)} for value, colour in spec["colour_stops"]],
		"sha256": sha256(destination), "bytes": destination.stat().st_size,
		"built_utc": datetime.now(timezone.utc).isoformat(),
	}
	metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
	metadata_path.chmod(0o644)
	print(json.dumps(metadata, indent=2, sort_keys=True))


def finalize(args: argparse.Namespace) -> None:
	if args.output_dir is None:
		raise ValueError("--output-dir is required with --finalize")
	if args.month_manifest is None:
		raise ValueError("--month-manifest is required with --finalize")
	spec = FIELD_SPECS[args.field]
	months = pd.read_csv(args.month_manifest, dtype={"yyyymm": str})["yyyymm"].tolist()
	entries = []
	for month in months:
		video = args.output_dir / args.field / month[:4] / f"{month}.webm"
		metadata_path = video.with_suffix(".json")
		if not video.is_file() or not metadata_path.is_file():
			raise FileNotFoundError(f"Incomplete weather month {month}")
		metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
		expected = calendar.monthrange(int(month[:4]), int(month[4:]))[1] * 24 // int(spec["step_hours"])
		if metadata.get("frames") != expected or metadata.get("sha256") != sha256(video):
			raise ValueError(f"Weather month {month} failed validation")
		entries.append({
			"month": month, "url": video.relative_to(args.output_dir).as_posix(),
			"metadata_url": metadata_path.relative_to(args.output_dir).as_posix(),
			"frames": expected, "bytes": video.stat().st_size, "sha256": metadata["sha256"],
		})
	manifest = {
		"schema": "western-disturbances-atlas-weather-archive-v1",
		"field_key": args.field, "field": spec["label"], "units": spec["units"],
		"step_hours": spec["step_hours"], "frames_per_second": args.fps,
		"active_months": len(entries), "total_video_bytes": sum(item["bytes"] for item in entries),
		"built_utc": datetime.now(timezone.utc).isoformat(), "months": entries,
	}
	path = args.output_dir / f"{args.field}-manifest.json"
	path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
	path.chmod(0o644)
	print(json.dumps({key: value for key, value in manifest.items() if key != "months"}, indent=2))


def main() -> None:
	args = arguments()
	if args.write_month_manifest:
		if not args.catalogue:
			raise ValueError("--catalogue is required with --write-month-manifest")
		write_month_manifest(args.catalogue, args.write_month_manifest)
	elif args.finalize:
		finalize(args)
	elif args.assemble_chunks:
		assemble_chunks(args, resolve_month(args))
	elif args.chunk_index is not None:
		render_chunk(args, resolve_month(args))
	else:
		render_month(args, resolve_month(args))


if __name__ == "__main__":
	main()

#!/usr/bin/env python3
"""Build compact yearly shards of selected-WD precipitation footprints."""

from __future__ import annotations

import argparse
import fcntl
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


def refresh_staging_manifest(output_dir: Path, cat: dict[str, list]) -> dict:
	"""Atomically publish every completed, internally consistent year shard."""
	minimum_year, maximum_year = min(cat["year"]), max(cat["year"])
	expected_years = maximum_year - minimum_year + 1
	output_dir.mkdir(parents=True, exist_ok=True)
	lock_path = output_dir / ".impact-manifest.lock"
	with lock_path.open("a", encoding="utf-8") as lock:
		fcntl.flock(lock, fcntl.LOCK_EX)
		entries = []
		for year in range(minimum_year, maximum_year + 1):
			metadata_path = output_dir / str(year) / f"{year}.u16.json"
			payload_path = output_dir / str(year) / f"{year}.u16.gz"
			if not metadata_path.is_file() or not payload_path.is_file():
				continue
			metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
			expected_ids = [track_id for track_id, genesis_year in zip(cat["id"], cat["year"]) if genesis_year == year]
			if metadata.get("track_ids") != expected_ids or metadata.get("shape") != [len(expected_ids), 20, 40]:
				continue
			checksum = sha256(payload_path)
			if metadata.get("sha256") != checksum:
				continue
			entries.append({
				"year": year,
				"tracks": len(expected_ids),
				"payload": payload_path.relative_to(output_dir).as_posix(),
				"metadata": metadata_path.relative_to(output_dir).as_posix(),
				"bytes": payload_path.stat().st_size,
				"sha256": checksum,
			})
		manifest = {
			"schema": "western-disturbances-atlas-impact-archive-v1",
			"status": "complete" if len(entries) == expected_years else "staging",
			"definition": "ERA5 total precipitation accumulated hourly from published genesis through lysis on a 1-degree 60-100E, 20-40N grid",
			"expected_years": expected_years,
			"years": entries,
			"tracks": sum(entry["tracks"] for entry in entries),
			"total_payload_bytes": sum(entry["bytes"] for entry in entries),
			"built_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
		}
		path = output_dir / "impact-manifest.json"
		temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
		temporary.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
		os.replace(temporary, path); path.chmod(0o644)
		return manifest


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


def prepare_month(
	path: Path,
	time_start: pd.Timestamp | None = None,
	time_stop: pd.Timestamp | None = None,
) -> tuple[xr.DataArray, list[float]]:
	dataset = xr.open_dataset(path)
	field = precipitation(dataset)
	if time_start is not None or time_stop is not None:
		if time_start is None or time_stop is None:
			raise ValueError("Both time_start and time_stop are required")
		field_times = pd.DatetimeIndex(field.time.values)
		if field_times.tz is None:
			field_times = field_times.tz_localize("UTC")
		else:
			field_times = field_times.tz_convert("UTC")
		selected = np.flatnonzero((field_times >= time_start) & (field_times < time_stop))
		if not len(selected):
			dataset.close()
			raise ValueError(f"No source times in [{time_start}, {time_stop}) for {path}")
		field = field.isel(time=selected)
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


def year_track_context(
	cat: dict[str, list], offsets: np.ndarray, point_hours: np.ndarray, year: int
) -> tuple[np.ndarray, np.ndarray, pd.DatetimeIndex, pd.DatetimeIndex]:
	track_indices = np.flatnonzero(np.asarray(cat["year"]) == year)
	track_ids = np.asarray(cat["id"])[track_indices]
	genesis = pd.DatetimeIndex([EPOCH + pd.Timedelta(hours=int(point_hours[offsets[index, 0]])) for index in track_indices])
	lysis = pd.DatetimeIndex([EPOCH + pd.Timedelta(hours=int(point_hours[offsets[index, 0] + offsets[index, 1] - 1])) for index in track_indices])
	return track_indices, track_ids, genesis, lysis


def valid_year_shard(output_dir: Path, cat: dict[str, list], year: int) -> bool:
	data_path = output_dir / str(year) / f"{year}.u16.gz"
	metadata_path = data_path.with_suffix(".json")
	if not data_path.is_file() or not metadata_path.is_file():
		return False
	try:
		metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
		expected_ids = [track_id for track_id, genesis_year in zip(cat["id"], cat["year"]) if genesis_year == year]
		return (
			metadata.get("track_ids") == expected_ids
			and metadata.get("shape") == [len(expected_ids), 20, 40]
			and metadata.get("sha256") == sha256(data_path)
		)
	except (OSError, ValueError, json.JSONDecodeError):
		return False


def contribution_paths(output_dir: Path, year: int, month: str) -> tuple[Path, Path]:
	payload = output_dir / "_monthly" / str(year) / f"{month}.f32.gz"
	return payload, payload.with_suffix(".json")


def contribution_chunk_paths(
	output_dir: Path, year: int, month: str, chunk_index: int, chunk_count: int
) -> tuple[Path, Path]:
	payload = (
		output_dir / "_monthly_chunks" / str(year) / month
		/ f"chunk-{chunk_index:02d}-of-{chunk_count:02d}.f32.gz"
	)
	return payload, payload.with_suffix(".json")


def month_window(month: str) -> tuple[pd.Timestamp, pd.Timestamp]:
	if len(month) != 6 or not month.isdigit() or not 1 <= int(month[4:]) <= 12:
		raise ValueError(f"Invalid YYYYMM month: {month}")
	start = pd.Timestamp(f"{month[:4]}-{month[4:]}-01", tz="UTC")
	return start, start + pd.offsets.MonthBegin(1)


def chunk_window(month: str, chunk_index: int, chunk_count: int) -> tuple[pd.Timestamp, pd.Timestamp]:
	if chunk_count < 1 or not 0 <= chunk_index < chunk_count:
		raise ValueError(f"Invalid chunk {chunk_index} of {chunk_count}")
	month_start, month_stop = month_window(month)
	total_hours = int((month_stop - month_start) / pd.Timedelta(hours=1))
	start_hour = total_hours * chunk_index // chunk_count
	stop_hour = total_hours * (chunk_index + 1) // chunk_count
	return month_start + pd.Timedelta(hours=start_hour), month_start + pd.Timedelta(hours=stop_hour)


def write_float_contribution(
	payload: Path, metadata_path: Path, contribution: np.ndarray, metadata: dict
) -> None:
	payload.parent.mkdir(parents=True, exist_ok=True)
	for directory in (payload.parents[2], payload.parents[1], payload.parent):
		directory.chmod(0o2755)
	temporary = payload.with_name(f".{payload.name}.tmp-{os.getpid()}")
	temporary.write_bytes(gzip.compress(contribution.astype("<f4", copy=False).tobytes(), compresslevel=6, mtime=0))
	os.replace(temporary, payload); payload.chmod(0o644)
	metadata = {**metadata, "bytes": payload.stat().st_size, "sha256": sha256(payload)}
	metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
	metadata_path.chmod(0o644)


def build_month_chunk(
	args: argparse.Namespace,
	cat: dict[str, list],
	offsets: np.ndarray,
	point_hours: np.ndarray,
) -> None:
	assert args.year is not None and args.month is not None
	assert args.chunk_index is not None and args.chunk_count is not None
	if valid_year_shard(args.output_dir, cat, args.year):
		print(f"{args.year}: final footprint shard already complete")
		return
	month = args.month
	chunk_start, chunk_stop = chunk_window(month, args.chunk_index, args.chunk_count)
	track_indices, track_ids, genesis, lysis = year_track_context(cat, offsets, point_hours, args.year)
	payload, metadata_path = contribution_chunk_paths(
		args.output_dir, args.year, month, args.chunk_index, args.chunk_count
	)
	if payload.is_file() and metadata_path.is_file():
		metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
		if (
			metadata.get("sha256") == sha256(payload)
			and metadata.get("year") == args.year
			and metadata.get("month") == month
			and metadata.get("chunk_index") == args.chunk_index
			and metadata.get("chunk_count") == args.chunk_count
			and metadata.get("shape") == [len(track_indices), 20, 40]
		):
			print(f"{args.year} {month} chunk {args.chunk_index}: already complete")
			return
	field, bounds = prepare_month(args.source_dir / f"{month}.nc", chunk_start, chunk_stop)
	if (field.sizes["latitude"], field.sizes["longitude"]) != (20, 40):
		raise ValueError(f"Unexpected footprint grid for {month}: {(field.sizes['latitude'], field.sizes['longitude'])}")
	contribution = np.zeros((len(track_indices), 20, 40), dtype="<f4")
	field_times = pd.DatetimeIndex(field.time.values).tz_localize("UTC")
	active = np.flatnonzero((genesis < chunk_stop) & (lysis >= chunk_start))
	for local_index in active:
		mask = (field_times >= genesis[local_index]) & (field_times <= lysis[local_index])
		if mask.any():
			contribution[local_index] = np.asarray(
				field.isel(time=np.flatnonzero(mask)).sum("time").values, dtype="<f4"
			)
	field.close()
	metadata = {
		"schema": "western-disturbances-atlas-impact-submonth-contribution-v1",
		"year": args.year, "month": month,
		"chunk_index": args.chunk_index, "chunk_count": args.chunk_count,
		"time_start_inclusive": chunk_start.isoformat(), "time_stop_exclusive": chunk_stop.isoformat(),
		"track_count": len(track_ids), "active_track_count": len(active),
		"shape": list(contribution.shape), "dtype": "float32", "layout": "track,latitude,longitude",
		"bounds_west_south_east_north": bounds, "source": str(args.source_dir / f"{month}.nc"),
		"built_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
	}
	write_float_contribution(payload, metadata_path, contribution, metadata)
	print(json.dumps(metadata, indent=2))


def assemble_month_chunks(
	args: argparse.Namespace,
	cat: dict[str, list],
	offsets: np.ndarray,
	point_hours: np.ndarray,
) -> None:
	assert args.year is not None and args.month is not None and args.chunk_count is not None
	if valid_year_shard(args.output_dir, cat, args.year):
		print(f"{args.year}: final footprint shard already complete")
		return
	month = args.month
	month_start, month_stop = month_window(month)
	track_indices, track_ids, genesis, lysis = year_track_context(cat, offsets, point_hours, args.year)
	payload, metadata_path = contribution_paths(args.output_dir, args.year, month)
	if payload.is_file() and metadata_path.is_file():
		metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
		if (
			metadata.get("sha256") == sha256(payload)
			and metadata.get("year") == args.year
			and metadata.get("month") == month
			and metadata.get("shape") == [len(track_indices), 20, 40]
		):
			print(f"{args.year} {month}: contribution already complete")
			return
	contribution = np.zeros((len(track_indices), 20, 40), dtype="<f4")
	bounds: list[float] | None = None
	expected_start = month_start
	for chunk_index in range(args.chunk_count):
		chunk_payload, chunk_metadata_path = contribution_chunk_paths(
			args.output_dir, args.year, month, chunk_index, args.chunk_count
		)
		if not chunk_payload.is_file() or not chunk_metadata_path.is_file():
			raise FileNotFoundError(f"Incomplete footprint chunk {args.year} {month} {chunk_index}")
		metadata = json.loads(chunk_metadata_path.read_text(encoding="utf-8"))
		if metadata.get("sha256") != sha256(chunk_payload):
			raise ValueError(f"Checksum mismatch for footprint chunk {args.year} {month} {chunk_index}")
		if (
			metadata.get("year") != args.year or metadata.get("month") != month
			or metadata.get("chunk_index") != chunk_index or metadata.get("chunk_count") != args.chunk_count
		):
			raise ValueError(f"Identity mismatch for footprint chunk {args.year} {month} {chunk_index}")
		if metadata.get("shape") != [len(track_indices), 20, 40]:
			raise ValueError(f"Shape mismatch for footprint chunk {args.year} {month} {chunk_index}")
		chunk_start = pd.Timestamp(metadata["time_start_inclusive"])
		chunk_stop = pd.Timestamp(metadata["time_stop_exclusive"])
		if chunk_start != expected_start or chunk_stop <= chunk_start:
			raise ValueError(f"Time coverage mismatch for footprint chunk {args.year} {month} {chunk_index}")
		expected_start = chunk_stop
		chunk_bounds = metadata.get("bounds_west_south_east_north")
		if bounds is None:
			bounds = chunk_bounds
		elif bounds != chunk_bounds:
			raise ValueError(f"Grid changed in footprint chunk {args.year} {month} {chunk_index}")
		raw = gzip.decompress(chunk_payload.read_bytes())
		if len(raw) != contribution.nbytes:
			raise ValueError(f"Payload length mismatch for footprint chunk {args.year} {month} {chunk_index}")
		contribution += np.frombuffer(raw, dtype="<f4").reshape(contribution.shape)
	if expected_start != month_stop or bounds is None:
		raise ValueError(f"Incomplete time coverage for footprint chunks {args.year} {month}")
	month_end = month_stop - pd.Timedelta(seconds=1)
	active = np.flatnonzero((genesis <= month_end) & (lysis >= month_start))
	metadata = {
		"schema": "western-disturbances-atlas-impact-month-contribution-v1",
		"year": args.year, "month": month, "track_count": len(track_ids),
		"active_track_count": len(active), "shape": list(contribution.shape),
		"dtype": "float32", "layout": "track,latitude,longitude",
		"bounds_west_south_east_north": bounds, "source": str(args.source_dir / f"{month}.nc"),
		"assembled_from_chunks": args.chunk_count,
		"built_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
	}
	write_float_contribution(payload, metadata_path, contribution, metadata)
	print(json.dumps(metadata, indent=2))


def build_month_contribution(
	args: argparse.Namespace,
	cat: dict[str, list],
	offsets: np.ndarray,
	point_hours: np.ndarray,
) -> None:
	assert args.year is not None and args.month is not None
	if valid_year_shard(args.output_dir, cat, args.year):
		print(f"{args.year}: final footprint shard already complete")
		return
	month = args.month
	if len(month) != 6 or not month.isdigit() or not 1 <= int(month[4:]) <= 12:
		raise ValueError(f"Invalid YYYYMM month: {month}")
	track_indices, track_ids, genesis, lysis = year_track_context(cat, offsets, point_hours, args.year)
	month_start = pd.Timestamp(f"{month[:4]}-{month[4:]}-01", tz="UTC")
	month_end = month_start + pd.offsets.MonthBegin(1) - pd.Timedelta(seconds=1)
	active = np.flatnonzero((genesis <= month_end) & (lysis >= month_start))
	if not len(active):
		print(f"{args.year} {month}: no active tracks")
		return
	payload, metadata_path = contribution_paths(args.output_dir, args.year, month)
	if payload.is_file() and metadata_path.is_file():
		metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
		if (
			metadata.get("sha256") == sha256(payload)
			and metadata.get("year") == args.year
			and metadata.get("month") == month
			and metadata.get("track_count") == len(track_indices)
			and metadata.get("shape") == [len(track_indices), 20, 40]
		):
			print(f"{args.year} {month}: contribution already complete")
			return
	field, bounds = prepare_month(args.source_dir / f"{month}.nc")
	if (field.sizes["latitude"], field.sizes["longitude"]) != (20, 40):
		raise ValueError(f"Unexpected footprint grid for {month}: {(field.sizes['latitude'], field.sizes['longitude'])}")
	contribution = np.zeros((len(track_indices), 20, 40), dtype="<f4")
	field_times = pd.DatetimeIndex(field.time.values).tz_localize("UTC")
	for local_index in active:
		mask = (field_times >= genesis[local_index]) & (field_times <= lysis[local_index])
		if mask.any():
			contribution[local_index] = np.asarray(field.isel(time=np.flatnonzero(mask)).sum("time").values, dtype="<f4")
	field.close()
	payload.parent.mkdir(parents=True, exist_ok=True)
	for directory in (args.output_dir, args.output_dir / "_monthly", payload.parent):
		directory.chmod(0o2755)
	temporary = payload.with_name(f".{payload.name}.tmp-{os.getpid()}")
	temporary.write_bytes(gzip.compress(contribution.tobytes(), compresslevel=6, mtime=0))
	os.replace(temporary, payload); payload.chmod(0o644)
	metadata = {
		"schema": "western-disturbances-atlas-impact-month-contribution-v1",
		"year": args.year, "month": month, "track_count": len(track_ids),
		"active_track_count": len(active), "shape": list(contribution.shape),
		"dtype": "float32", "layout": "track,latitude,longitude",
		"bounds_west_south_east_north": bounds, "source": str(args.source_dir / f"{month}.nc"),
		"bytes": payload.stat().st_size, "sha256": sha256(payload),
		"built_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
	}
	metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8"); metadata_path.chmod(0o644)
	print(json.dumps(metadata, indent=2))


def assemble_year(
	args: argparse.Namespace,
	cat: dict[str, list],
	offsets: np.ndarray,
	point_hours: np.ndarray,
) -> None:
	assert args.year is not None
	if valid_year_shard(args.output_dir, cat, args.year):
		print(f"{args.year}: already complete")
		return
	track_indices, track_ids, genesis, lysis = year_track_context(cat, offsets, point_hours, args.year)
	months = sorted(set(genesis.strftime("%Y%m")) | set(lysis.strftime("%Y%m")))
	footprints = np.zeros((len(track_indices), 20, 40), dtype=np.float32)
	bounds: list[float] | None = None
	for month in months:
		payload, metadata_path = contribution_paths(args.output_dir, args.year, month)
		if not payload.is_file() or not metadata_path.is_file():
			raise FileNotFoundError(f"Incomplete footprint contribution {args.year} {month}")
		metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
		if metadata.get("sha256") != sha256(payload):
			raise ValueError(f"Checksum mismatch for footprint contribution {args.year} {month}")
		if metadata.get("year") != args.year or metadata.get("month") != month:
			raise ValueError(f"Identity mismatch for footprint contribution {args.year} {month}")
		if metadata.get("shape") != [len(track_indices), 20, 40]:
			raise ValueError(f"Shape mismatch for footprint contribution {args.year} {month}")
		month_bounds = metadata.get("bounds_west_south_east_north")
		if bounds is None:
			bounds = month_bounds
		elif bounds != month_bounds:
			raise ValueError(f"Grid changed in footprint contribution {args.year} {month}")
		raw = gzip.decompress(payload.read_bytes())
		if len(raw) != footprints.nbytes:
			raise ValueError(f"Payload length mismatch for footprint contribution {args.year} {month}")
		footprints += np.frombuffer(raw, dtype="<f4").reshape(footprints.shape)
	if bounds is None:
		raise ValueError(f"No footprint contributions for {args.year}")
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
		"assembled_from_months": months,
	}
	metadata_path = data_path.with_suffix(".json")
	metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8"); metadata_path.chmod(0o644)
	refresh_staging_manifest(args.output_dir, cat)
	print(json.dumps({key: value for key, value in metadata.items() if key != "track_ids"}, indent=2))


def main() -> None:
	parser = argparse.ArgumentParser()
	mode = parser.add_mutually_exclusive_group(required=True)
	mode.add_argument("--year", type=int)
	mode.add_argument("--refresh-manifest", action="store_true")
	parser.add_argument("--month")
	parser.add_argument("--assemble-year", action="store_true")
	parser.add_argument("--assemble-month", action="store_true")
	parser.add_argument("--chunk-index", type=int)
	parser.add_argument("--chunk-count", type=int)
	parser.add_argument("--source-dir", type=Path, default=Path("/home/users/kieran/ncas/data/era5-incompass/hourly_precip_SA"))
	parser.add_argument("--catalogue", type=Path, default=ROOT / "assets/wd-atlas-catalogue-v6.json.gz")
	parser.add_argument("--times", type=Path, default=ROOT / "assets/wd-atlas-times-v6.i32.gz")
	parser.add_argument("--output-dir", type=Path, required=True)
	args = parser.parse_args()
	with gzip.open(args.catalogue, "rt", encoding="utf-8") as stream:
		catalogue = json.load(stream)
	cat, offsets = catalogue["cat"], np.asarray(catalogue["off"], dtype=np.int64)
	if args.refresh_manifest:
		manifest = refresh_staging_manifest(args.output_dir, cat)
		print(json.dumps({key: value for key, value in manifest.items() if key != "years"}, indent=2))
		return
	point_hours = np.frombuffer(gzip.decompress(args.times.read_bytes()), dtype="<i4")
	if args.month and args.assemble_year:
		raise ValueError("Choose --month or --assemble-year, not both")
	if args.assemble_month and not args.month:
		raise ValueError("--assemble-month requires --month")
	if not args.assemble_month and (args.chunk_index is None) != (args.chunk_count is None):
		raise ValueError("--chunk-index and --chunk-count must be supplied together")
	if args.assemble_month and args.chunk_index is not None:
		raise ValueError("--assemble-month does not accept --chunk-index")
	if args.month:
		if args.assemble_month:
			if args.chunk_count is None:
				raise ValueError("--assemble-month requires --chunk-count")
			assemble_month_chunks(args, cat, offsets, point_hours)
			return
		if args.chunk_index is not None:
			build_month_chunk(args, cat, offsets, point_hours)
			return
		build_month_contribution(args, cat, offsets, point_hours)
		return
	if args.assemble_year:
		assemble_year(args, cat, offsets, point_hours)
		return
	track_indices, track_ids, genesis, lysis = year_track_context(cat, offsets, point_hours, args.year)
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
	refresh_staging_manifest(args.output_dir, cat)
	print(json.dumps({key: value for key, value in metadata.items() if key != "track_ids"}, indent=2))


if __name__ == "__main__":
	main()

#!/usr/bin/env python3
"""Build independently verifiable per-WD precipitation footprints and year shards."""

from __future__ import annotations

import argparse
import gzip
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from build_impact_footprints import (
	EPOCH,
	ROOT,
	SCALE,
	prepare_month,
	refresh_staging_manifest,
	sha256,
	valid_year_shard,
)


def track_paths(output_dir: Path, year: int, track_id: int) -> tuple[Path, Path]:
	payload = output_dir / "_tracks" / str(year) / f"{track_id}.f32.gz"
	return payload, payload.with_suffix(".json")


def load_inputs(catalogue_path: Path, times_path: Path) -> tuple[dict[str, list], np.ndarray, np.ndarray]:
	with gzip.open(catalogue_path, "rt", encoding="utf-8") as stream:
		catalogue = json.load(stream)
	cat = catalogue["cat"]
	offsets = np.asarray(catalogue["off"], dtype=np.int64)
	point_hours = np.frombuffer(gzip.decompress(times_path.read_bytes()), dtype="<i4")
	if len(offsets) != len(cat["id"]):
		raise ValueError("Catalogue offsets and track identifiers differ in length")
	return cat, offsets, point_hours


def track_times(offsets: np.ndarray, point_hours: np.ndarray, index: int) -> tuple[pd.Timestamp, pd.Timestamp]:
	start, count = offsets[index]
	if count < 1 or start < 0 or start + count > len(point_hours):
		raise ValueError(f"Invalid point offset for track index {index}: {(start, count)}")
	genesis = EPOCH + pd.Timedelta(hours=int(point_hours[start]))
	lysis = EPOCH + pd.Timedelta(hours=int(point_hours[start + count - 1]))
	return genesis, lysis


def valid_track_payload(
	payload: Path,
	metadata_path: Path,
	track_id: int,
	year: int,
) -> bool:
	if not payload.is_file() or not metadata_path.is_file():
		return False
	try:
		metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
		return (
			metadata.get("schema") == "western-disturbances-atlas-impact-track-v1"
			and metadata.get("track_id") == track_id
			and metadata.get("year") == year
			and metadata.get("shape") == [20, 40]
			and metadata.get("sha256") == sha256(payload)
			and len(gzip.decompress(payload.read_bytes())) == 20 * 40 * 4
		)
	except (OSError, ValueError, json.JSONDecodeError, gzip.BadGzipFile):
		return False


def write_payload(payload: Path, metadata_path: Path, values: np.ndarray, metadata: dict) -> None:
	payload.parent.mkdir(parents=True, exist_ok=True)
	payload.parent.chmod(0o2755)
	temporary = payload.with_name(f".{payload.name}.tmp-{os.getpid()}")
	temporary.write_bytes(gzip.compress(values.tobytes(order="C"), compresslevel=6, mtime=0))
	os.replace(temporary, payload)
	payload.chmod(0o644)
	metadata = {**metadata, "bytes": payload.stat().st_size, "sha256": sha256(payload)}
	temporary_metadata = metadata_path.with_name(f".{metadata_path.name}.tmp-{os.getpid()}")
	temporary_metadata.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
	os.replace(temporary_metadata, metadata_path)
	metadata_path.chmod(0o644)


def build_track(
	args: argparse.Namespace,
	cat: dict[str, list],
	offsets: np.ndarray,
	point_hours: np.ndarray,
) -> None:
	index = args.track_index
	if not 0 <= index < len(cat["id"]):
		raise IndexError(f"Track index {index} outside 0-{len(cat['id']) - 1}")
	track_id = int(cat["id"][index])
	year = int(cat["year"][index])
	if valid_year_shard(args.output_dir, cat, year):
		print(f"{track_id}: final {year} shard already complete")
		return
	payload, metadata_path = track_paths(args.output_dir, year, track_id)
	if valid_track_payload(payload, metadata_path, track_id, year):
		print(f"{track_id}: footprint already complete")
		return
	genesis, lysis = track_times(offsets, point_hours, index)
	periods = pd.period_range(genesis.tz_localize(None), lysis.tz_localize(None), freq="M")
	footprint = np.zeros((20, 40), dtype=np.float64)
	bounds: list[float] | None = None
	sources: list[str] = []
	for period in periods:
		month = period.strftime("%Y%m")
		month_start = pd.Timestamp(period.start_time, tz="UTC")
		month_stop = pd.Timestamp((period + 1).start_time, tz="UTC")
		window_start = max(genesis, month_start)
		window_stop = min(lysis + pd.Timedelta(seconds=1), month_stop)
		source = args.source_dir / f"{month}.nc"
		if not source.is_file():
			raise FileNotFoundError(source)
		field, month_bounds = prepare_month(source, window_start, window_stop)
		if (field.sizes["latitude"], field.sizes["longitude"]) != (20, 40):
			raise ValueError(f"Unexpected footprint grid for {track_id} {month}")
		if bounds is None:
			bounds = month_bounds
		elif bounds != month_bounds:
			raise ValueError(f"Grid changed during track {track_id}")
		footprint += np.asarray(field.astype("float64").sum("time").values, dtype=np.float64)
		field.close()
		sources.append(str(source))
	if bounds is None:
		raise ValueError(f"No precipitation data for track {track_id}")
	values = footprint.astype("<f4")
	for directory in (args.output_dir, args.output_dir / "_tracks", payload.parent):
		directory.mkdir(parents=True, exist_ok=True)
		directory.chmod(0o2755)
	metadata = {
		"schema": "western-disturbances-atlas-impact-track-v1",
		"track_id": track_id,
		"track_index": index,
		"year": year,
		"genesis_utc": genesis.isoformat(),
		"lysis_utc": lysis.isoformat(),
		"shape": [20, 40],
		"dtype": "float32",
		"layout": "latitude,longitude",
		"units": "mm",
		"bounds_west_south_east_north": bounds,
		"sources": sources,
		"built_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
	}
	write_payload(payload, metadata_path, values, metadata)
	print(json.dumps(metadata, indent=2))


def assemble_year(args: argparse.Namespace, cat: dict[str, list]) -> None:
	year = args.assemble_year
	if valid_year_shard(args.output_dir, cat, year):
		print(f"{year}: already complete")
		return
	indices = np.flatnonzero(np.asarray(cat["year"]) == year)
	track_ids = [int(cat["id"][index]) for index in indices]
	if not track_ids:
		raise ValueError(f"No catalogue tracks for {year}")
	footprints = np.empty((len(track_ids), 20, 40), dtype="<f4")
	bounds: list[float] | None = None
	for local_index, track_id in enumerate(track_ids):
		payload, metadata_path = track_paths(args.output_dir, year, track_id)
		if not valid_track_payload(payload, metadata_path, track_id, year):
			raise FileNotFoundError(f"Incomplete footprint track {track_id} for {year}")
		metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
		track_bounds = metadata.get("bounds_west_south_east_north")
		if bounds is None:
			bounds = track_bounds
		elif bounds != track_bounds:
			raise ValueError(f"Grid mismatch for footprint track {track_id}")
		footprints[local_index] = np.frombuffer(
			gzip.decompress(payload.read_bytes()), dtype="<f4"
		).reshape(20, 40)
	if bounds is None:
		raise ValueError(f"No footprint grids for {year}")
	packed = np.clip(np.rint(footprints * SCALE), 0, np.iinfo(np.uint16).max).astype("<u2")
	year_dir = args.output_dir / str(year)
	year_dir.mkdir(parents=True, exist_ok=True)
	for directory in (args.output_dir, year_dir):
		directory.chmod(0o2755)
	payload = year_dir / f"{year}.u16.gz"
	metadata_path = payload.with_suffix(".json")
	metadata = {
		"schema": "western-disturbances-atlas-impact-footprint-v1",
		"year": year,
		"definition": "ERA5 precipitation accumulated during the published WD lifetime, inclusive of genesis and lysis hour",
		"units": "mm",
		"scale": SCALE,
		"dtype": "uint16",
		"layout": "track,latitude,longitude",
		"track_ids": track_ids,
		"shape": list(packed.shape),
		"bounds_west_south_east_north": bounds,
		"source": str(args.source_dir),
		"assembled_from": "per-track-v1",
		"built_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
	}
	write_payload(payload, metadata_path, packed, metadata)
	refresh_staging_manifest(args.output_dir, cat)
	print(json.dumps({key: value for key, value in metadata.items() if key != "track_ids"}, indent=2))


def main() -> None:
	parser = argparse.ArgumentParser()
	mode = parser.add_mutually_exclusive_group(required=True)
	mode.add_argument("--track-index", type=int)
	mode.add_argument("--assemble-year", type=int)
	parser.add_argument("--source-dir", type=Path, default=Path("/home/users/kieran/ncas/data/era5-incompass/hourly_precip_SA"))
	parser.add_argument("--catalogue", type=Path, default=ROOT / "assets/wd-atlas-catalogue-v6.json.gz")
	parser.add_argument("--times", type=Path, default=ROOT / "assets/wd-atlas-times-v6.i32.gz")
	parser.add_argument("--output-dir", type=Path, required=True)
	args = parser.parse_args()
	cat, offsets, point_hours = load_inputs(args.catalogue, args.times)
	if args.track_index is not None:
		build_track(args, cat, offsets, point_hours)
	else:
		assemble_year(args, cat)


if __name__ == "__main__":
	main()

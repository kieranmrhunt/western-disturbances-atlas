#!/usr/bin/env python3
"""Validate the sharded WD impact-footprint archive and write its manifest."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
	hasher = hashlib.sha256()
	with path.open("rb") as stream:
		for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
			hasher.update(block)
	return hasher.hexdigest()


def main() -> None:
	parser = argparse.ArgumentParser()
	parser.add_argument("--catalogue", type=Path, default=ROOT / "assets/wd-atlas-catalogue-v6.json.gz")
	parser.add_argument("--output-dir", type=Path, default=Path("/home/users/kieran/incompass/public/kieran/track_data/WD/atlas-impact-v1"))
	args = parser.parse_args()
	with gzip.open(args.catalogue, "rt", encoding="utf-8") as stream:
		catalogue = json.load(stream)
	cat = catalogue["cat"]
	entries = []
	for year in range(min(cat["year"]), max(cat["year"]) + 1):
		expected_ids = [track_id for track_id, genesis_year in zip(cat["id"], cat["year"]) if genesis_year == year]
		metadata_path = args.output_dir / str(year) / f"{year}.u16.json"
		payload_path = args.output_dir / str(year) / f"{year}.u16.gz"
		if not metadata_path.is_file() or not payload_path.is_file():
			raise FileNotFoundError(f"Incomplete impact-footprint year {year}")
		metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
		if metadata.get("track_ids") != expected_ids:
			raise ValueError(f"Track ordering differs from the catalogue for {year}")
		shape = metadata.get("shape")
		if shape != [len(expected_ids), 20, 40]:
			raise ValueError(f"Unexpected impact-footprint shape for {year}: {shape}")
		uncompressed = gzip.decompress(payload_path.read_bytes())
		if len(uncompressed) != len(expected_ids) * 20 * 40 * 2:
			raise ValueError(f"Unexpected payload length for {year}")
		checksum = digest(payload_path)
		if metadata.get("sha256") and metadata["sha256"] != checksum:
			raise ValueError(f"Checksum mismatch for {year}")
		entries.append({
			"year": year,
			"tracks": len(expected_ids),
			"payload": payload_path.relative_to(args.output_dir).as_posix(),
			"metadata": metadata_path.relative_to(args.output_dir).as_posix(),
			"bytes": payload_path.stat().st_size,
			"sha256": checksum,
		})
	manifest = {
		"schema": "western-disturbances-atlas-impact-archive-v1",
		"status": "complete",
		"definition": "ERA5 total precipitation accumulated hourly from published genesis through lysis on a 1-degree 60-100E, 20-40N grid",
		"expected_years": max(cat["year"]) - min(cat["year"]) + 1,
		"years": entries,
		"tracks": sum(entry["tracks"] for entry in entries),
		"total_payload_bytes": sum(entry["bytes"] for entry in entries),
		"built_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
	}
	path = args.output_dir / "impact-manifest.json"
	path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
	path.chmod(0o644)
	print(json.dumps({key: value for key, value in manifest.items() if key != "years"}, indent=2))


if __name__ == "__main__":
	main()

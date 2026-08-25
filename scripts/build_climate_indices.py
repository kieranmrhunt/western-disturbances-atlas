#!/usr/bin/env python3
"""Join official climate indices to WD genesis time for atlas filtering."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_URLS = {
	"oni": "https://psl.noaa.gov/data/correlation/oni.data",
	"nao": "https://psl.noaa.gov/data/correlation/nao.data",
	"ao": "https://psl.noaa.gov/data/correlation/ao.data",
	"pna": "https://psl.noaa.gov/data/correlation/pna.data",
	"rmm": "https://www.bom.gov.au/climate/mjo/graphics/rmm.74toRealtime.txt",
}


def sha256(path: Path) -> str:
	digest = hashlib.sha256()
	with path.open("rb") as stream:
		for block in iter(lambda: stream.read(1024 * 1024), b""):
			digest.update(block)
	return digest.hexdigest()


def monthly(path: Path) -> dict[tuple[int, int], float | None]:
	rows: dict[tuple[int, int], float | None] = {}
	for line in path.read_text(encoding="utf-8").splitlines()[1:]:
		parts = line.split()
		if len(parts) < 13 or not parts[0].lstrip("-").isdigit():
			continue
		year = int(parts[0])
		for month, text in enumerate(parts[1:13], 1):
			value = float(text)
			rows[(year, month)] = value if abs(value) < 90 else None
	return rows


def rmm(path: Path) -> dict[tuple[int, int, int], tuple[int, float]]:
	rows: dict[tuple[int, int, int], tuple[int, float]] = {}
	for line in path.read_text(encoding="utf-8").splitlines():
		parts = line.split()
		if len(parts) < 7 or not parts[0].isdigit():
			continue
		year, month, day = map(int, parts[:3])
		phase, amplitude = int(parts[5]), float(parts[6])
		if amplitude < 100:
			rows[(year, month, day)] = (phase if amplitude >= 1 else 0, amplitude)
	return rows


def category(value: float | None) -> int:
	if value is None:
		return -9
	return -1 if value <= -0.5 else 1 if value >= 0.5 else 0


def main() -> None:
	parser = argparse.ArgumentParser()
	parser.add_argument("--source-dir", type=Path, default=ROOT / "data/climate-indices")
	parser.add_argument("--catalogue", type=Path, default=ROOT / "assets/wd-atlas-catalogue-v6.json.gz")
	parser.add_argument("--output", type=Path, default=ROOT / "assets/wd-atlas-climate-v1.json.gz")
	args = parser.parse_args()
	with gzip.open(args.catalogue, "rt", encoding="utf-8") as stream:
		catalogue = json.load(stream)
	cat = catalogue["cat"]
	indices = {key: monthly(args.source_dir / f"{key}.data") for key in ("oni", "nao", "ao", "pna")}
	daily_rmm = rmm(args.source_dir / "rmm.74toRealtime.txt")
	values = {key: [] for key in indices}
	categories = {key: [] for key in indices}
	mjo_phase, mjo_amplitude = [], []
	for year, month, day in zip(cat["year"], cat["month"], cat["day"], strict=True):
		for key, rows in indices.items():
			value = rows.get((year, month))
			values[key].append(None if value is None else round(value, 2))
			categories[key].append(category(value))
		phase_amplitude = daily_rmm.get((year, month, day))
		mjo_phase.append(-9 if phase_amplitude is None else phase_amplitude[0])
		mjo_amplitude.append(None if phase_amplitude is None else round(phase_amplitude[1], 2))
	payload = {
		"schema": "western-disturbances-atlas-climate-v1",
		"joined_at": "genesis date/month",
		"built_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
		"sources": [
			{"key": key, "url": url, "sha256": sha256(args.source_dir / ("rmm.74toRealtime.txt" if key == "rmm" else f"{key}.data"))}
			for key, url in SOURCE_URLS.items()
		],
		"thresholds": {"monthly_category": "negative <= -0.5; neutral -0.5 to 0.5; positive >= 0.5", "mjo_active": "RMM amplitude >= 1"},
		"values": values,
		"categories": categories,
		"mjo_phase": mjo_phase,
		"mjo_amplitude": mjo_amplitude,
	}
	args.output.parent.mkdir(parents=True, exist_ok=True)
	with gzip.open(args.output, "wt", encoding="utf-8", compresslevel=9) as stream:
		json.dump(payload, stream, separators=(",", ":"), allow_nan=False)
	manifest_path = ROOT / "assets/atlas-build-manifest.json"
	if manifest_path.is_file() and args.output.parent.resolve() == (ROOT / "assets").resolve():
		manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
		manifest["assets"]["climate_indices"] = {"file": args.output.name, "bytes": args.output.stat().st_size, "sha256": sha256(args.output)}
		manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
	print(json.dumps({"output": str(args.output), "tracks": len(cat["id"]), "sources": len(SOURCE_URLS)}, indent=2))


if __name__ == "__main__":
	main()

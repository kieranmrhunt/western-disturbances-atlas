#!/usr/bin/env python3
"""Build exploratory full-trajectory route archetypes for the WD atlas.

Tracks are interpolated to common elapsed-life fractions, standardised by
coordinate, and clustered with deterministic k-means.  The output is an atlas
view asset, not part of the published objective track catalogue.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np
from sklearn.cluster import KMeans


ROOT = Path(__file__).resolve().parents[1]


def sha256(path: Path) -> str:
	digest = hashlib.sha256()
	with path.open("rb") as stream:
		for block in iter(lambda: stream.read(1024 * 1024), b""):
			digest.update(block)
	return digest.hexdigest()


def arguments() -> argparse.Namespace:
	parser = argparse.ArgumentParser()
	parser.add_argument("--catalogue", type=Path, default=ROOT / "assets/wd-atlas-catalogue-v6.json.gz")
	parser.add_argument("--fixes", type=Path, default=ROOT / "assets/wd-atlas-fixes-v6.i16.gz")
	parser.add_argument("--times", type=Path, default=ROOT / "assets/wd-atlas-times-v6.i32.gz")
	parser.add_argument("--output", type=Path, default=ROOT / "assets/wd-atlas-routes-v1.json.gz")
	parser.add_argument("--clusters", type=int, default=8)
	return parser.parse_args()


ROUTE_LABELS = (
	"European long-range",
	"Mediterranean–West Asian",
	"Northern trans-Asian",
	"Southern West Asian",
	"Central West Asian",
	"Long-range Central Asian",
	"Southern HMA",
	"Northern HMA",
)


def main() -> None:
	args = arguments()
	with gzip.open(args.catalogue, "rt", encoding="utf-8") as stream:
		catalogue = json.load(stream)
	meta = catalogue["meta"]
	offsets = np.asarray(catalogue["off"], dtype=np.int64)
	packed = np.frombuffer(gzip.decompress(args.fixes.read_bytes()), dtype="<i2")
	times = np.frombuffer(gzip.decompress(args.times.read_bytes()), dtype="<i4")
	npoints = int(meta["npts"])
	longitude = packed[:npoints].astype(np.float32) / 100
	latitude = packed[npoints:npoints * 2].astype(np.float32) / 100
	fractions = np.linspace(0, 1, 9, dtype=np.float32)
	shapes = np.empty((len(offsets), len(fractions) * 2), dtype=np.float32)

	for track, (start, length) in enumerate(offsets):
		stop = start + length
		elapsed = times[start:stop].astype(np.float64) - times[start]
		if elapsed[-1] <= 0:
			x = np.zeros(length, dtype=np.float64)
		else:
			x = elapsed / elapsed[-1]
		shapes[track, 0::2] = np.interp(fractions, x, longitude[start:stop])
		shapes[track, 1::2] = np.interp(fractions, x, latitude[start:stop])

	mean = shapes.mean(axis=0)
	standard_deviation = shapes.std(axis=0)
	standard_deviation[standard_deviation < 1e-6] = 1
	standardised = (shapes - mean) / standard_deviation
	model = KMeans(n_clusters=args.clusters, random_state=42, n_init=40, max_iter=500)
	raw_assignments = model.fit_predict(standardised)

	# Stable order: west-to-east genesis, then south-to-north mean corridor.
	cluster_stats: list[dict] = []
	for raw in range(args.clusters):
		members = np.flatnonzero(raw_assignments == raw)
		median_shape = np.median(shapes[members], axis=0)
		cluster_stats.append({
			"raw": raw,
			"count": int(len(members)),
			"genesis_lon": float(median_shape[0]),
			"genesis_lat": float(median_shape[1]),
			"lysis_lon": float(median_shape[-2]),
			"lysis_lat": float(median_shape[-1]),
			"corridor_lat": float(np.median(median_shape[1::2])),
			"median_shape": [round(float(value), 3) for value in median_shape],
		})
	cluster_stats.sort(key=lambda row: (row["genesis_lon"], row["corridor_lat"], row["lysis_lon"]))
	raw_to_stable = {row["raw"]: stable for stable, row in enumerate(cluster_stats)}
	assignments = np.asarray([raw_to_stable[int(value)] for value in raw_assignments], dtype=np.uint8)

	definitions = []
	for stable, row in enumerate(cluster_stats):
		label = ROUTE_LABELS[stable] if args.clusters == len(ROUTE_LABELS) else f"Route {stable + 1}"
		definitions.append({
			"key": f"route_{stable + 1}",
			"label": label,
			"count": row["count"],
			"median_genesis": [round(row["genesis_lon"], 2), round(row["genesis_lat"], 2)],
			"median_lysis": [round(row["lysis_lon"], 2), round(row["lysis_lat"], 2)],
			"median_shape": row["median_shape"],
		})

	payload = {
		"schema": "western-disturbances-atlas-route-archetypes-v1",
		"catalogue": meta.get("catalogue_version", "WD v6"),
		"method": {
			"name": "standardised full-trajectory k-means",
			"clusters": args.clusters,
			"random_state": 42,
			"n_init": 40,
			"life_fractions": [round(float(value), 3) for value in fractions],
			"features": "longitude and latitude interpolated at common elapsed-life fractions",
		},
		"definitions": definitions,
		"assignment": assignments.tolist(),
	}
	args.output.parent.mkdir(parents=True, exist_ok=True)
	with gzip.open(args.output, "wt", encoding="utf-8", compresslevel=9) as stream:
		json.dump(payload, stream, separators=(",", ":"), allow_nan=False)
	manifest_path = ROOT / "assets/atlas-build-manifest.json"
	if manifest_path.is_file() and args.output.parent.resolve() == (ROOT / "assets").resolve():
		manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
		manifest["assets"]["route_archetypes"] = {"file": args.output.name, "bytes": args.output.stat().st_size, "sha256": sha256(args.output)}
		manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
	print(json.dumps({"output": str(args.output), "tracks": len(assignments), "definitions": definitions}, indent=2))


if __name__ == "__main__":
	main()

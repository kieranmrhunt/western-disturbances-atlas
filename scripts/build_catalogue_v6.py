#!/usr/bin/env python3
"""Build compact, browser-ready assets from the validated WD-v6 catalogue."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT.parent / "catalogue-v6" / "full-r2"
STEM = "wd_v6-era5-1950-2025"
REGIONS = ["karakoram", "hindu_kush", "western_himalaya", "central_himalaya", "north_india"]
EPOCH = pd.Timestamp("1950-01-01T00:00:00Z")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def gzip_bytes(payload: bytes) -> bytes:
    return gzip.compress(payload, compresslevel=9, mtime=0)


def write_gzip(path: Path, payload: bytes) -> None:
    path.write_bytes(gzip_bytes(payload))


def json_values(values: pd.Series | np.ndarray, decimals: int | None = None) -> list:
    array = np.asarray(values)
    answer: list = []
    for value in array:
        if pd.isna(value):
            answer.append(None)
        elif np.issubdtype(array.dtype, np.integer):
            answer.append(int(value))
        else:
            number = float(value)
            answer.append(round(number, decimals) if decimals is not None else number)
    return answer


def percentile(values: pd.Series) -> list[float]:
    ranked = values.rank(method="average", pct=True).mul(100)
    return [round(float(value), 1) if pd.notna(value) else 0.0 for value in ranked]


def compact_i16(values: pd.Series, scale: float, missing: int = -32768) -> np.ndarray:
    array = values.to_numpy(dtype=np.float64)
    finite = np.isfinite(array)
    encoded = np.full(array.shape, missing, dtype="<i2")
    scaled = np.rint(array[finite] * scale)
    if scaled.size and (scaled.min() <= -32768 or scaled.max() > 32767):
        raise ValueError(f"int16 packing overflow: {scaled.min()} to {scaled.max()}")
    encoded[finite] = scaled.astype("<i2")
    return encoded


def diagnostic_group(field: str) -> str:
    if field.startswith("precip_box_"):
        return "Regional precipitation"
    if field.startswith("precip_"):
        return "Track-centred precipitation"
    if "vorticity" in field or field.startswith(("ut_vo_", "vo_mean_")):
        return "Vorticity"
    if field.startswith(("mslp_", "ws10_")):
        return "Surface fields"
    if field.startswith(("u_wind_", "v_wind_", "wind_speed_")):
        return "Pressure-level winds"
    if field.startswith("temperature_"):
        return "Temperature"
    if field.startswith(("specific_humidity_", "relative_humidity_")):
        return "Humidity"
    if "moisture_flux" in field:
        return "Moisture flux"
    return "Layer diagnostics"


def diagnostic_style(field: str, units: str) -> dict[str, object]:
    signed = field.startswith(("u_wind_", "v_wind_", "zonal_moisture_flux_", "meridional_moisture_flux_"))
    signed = signed or field.startswith("temperature_difference_")
    if "vorticity" in field or field.startswith(("ut_vo_", "vo_mean_")):
        colour, fallback = "--mla-madder", "#aa3d2d"
    elif "precip" in field or "humidity" in field:
        colour, fallback = "--mla-atlas-blue", "#3978a8"
    elif "wind" in field or "shear" in field:
        colour, fallback = "--mla-turmeric", "#c3931d"
    elif "moisture_flux" in field:
        colour, fallback = "--mla-good", "#5c7d43"
    else:
        colour, fallback = "--mla-purple", "#76558f"
    decimals = 2 if units in {"mm", "mm h-1", "1e-5 s-1", "g kg-1"} else 1
    return {"decimals": decimals, "zeroBased": not signed and units != "K", "colour": colour, "fallback": fallback}


def build_diagnostics(fixes: pd.DataFrame, schema: dict, output: Path) -> tuple[list[dict], dict[str, dict]]:
    descriptors: list[dict] = []
    manifest: dict[str, dict] = {}
    fields = schema["fields"]
    excluded = {"track_vorticity_450_300hpa_t42", "precip_24hr_400km"}
    for field, definition in fields.items():
        if definition.get("role") not in {"evolution", "regional_evolution"} or field in excluded:
            continue
        if field not in fixes:
            raise ValueError(f"Schema evolution field is absent from fixes: {field}")
        key = field.replace("_400km", "").replace("_mean", "").replace("_m_s", "")
        filename = f"wd-atlas-diag-v6-{key}.f32.gz"
        array = fixes[field].to_numpy(dtype="<f4")
        write_gzip(output / filename, array.tobytes(order="C"))
        style = diagnostic_style(field, definition["units"])
        descriptor = {
            "key": key,
            "field": field,
            "file": f"assets/{filename}",
            "label": definition["label"],
            "shortLabel": definition["label"].replace(" (400 km)", ""),
            "yLabel": f"{definition['label']} ({definition['units']})",
            "unit": f" {definition['units']}",
            "group": diagnostic_group(field),
            **style,
        }
        descriptors.append(descriptor)
        path = output / filename
        manifest[f"diagnostic:{key}"] = {
            "file": filename,
            "field": field,
            "bytes": path.stat().st_size,
            "uncompressed_bytes": int(array.nbytes),
            "sha256": sha256(path),
        }
    return descriptors, manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=ROOT / "assets")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    fixes_path = args.source / f"{STEM}-fixes.parquet"
    summary_path = args.source / f"{STEM}-summary.parquet"
    schema_path = args.source / f"{STEM}-schema.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    evolution_fields = [
        field for field, definition in schema["fields"].items()
        if definition.get("role") in {"evolution", "regional_evolution"}
    ]
    base_fields = ["track_id", "valid_time_utc", "lon", "lat"]
    fixes = pd.read_parquet(fixes_path, columns=list(dict.fromkeys(base_fields + evolution_fields)))
    fixes["valid_time_utc"] = pd.to_datetime(fixes["valid_time_utc"], utc=True)
    fixes.sort_values(["track_id", "valid_time_utc"], inplace=True, kind="stable", ignore_index=True)
    summary = pd.read_parquet(summary_path)
    summary.sort_values("track_id", inplace=True, kind="stable", ignore_index=True)

    if len(fixes) != 460_411 or len(summary) != 16_298:
        raise ValueError(f"Unexpected v6 row counts: {len(summary):,} tracks, {len(fixes):,} fixes")
    if fixes.duplicated(["track_id", "valid_time_utc"]).any():
        raise ValueError("Duplicate track/time keys in v6 fixes")
    counts = fixes.groupby("track_id", sort=False).size()
    if not counts.index.equals(pd.Index(summary["track_id"])):
        raise ValueError("Fix and summary track identifiers do not align")
    if not np.array_equal(counts.to_numpy(), summary["n_detections"].to_numpy()):
        raise ValueError("Fix counts do not match n_detections")

    starts = np.r_[0, np.cumsum(counts.to_numpy()[:-1])]
    offsets = [[int(start), int(length)] for start, length in zip(starts, counts.to_numpy(), strict=True)]
    genesis = pd.to_datetime(summary["genesis_time_utc"], utc=True)
    regions = [f"precip_box_24hr_{region}_max" for region in REGIONS]
    region_values = summary[regions].to_numpy(dtype=np.float64)
    dominant = np.argmax(np.where(np.isfinite(region_values), region_values, -np.inf), axis=1)
    peak_precip = summary["precip_24hr_400km_max"]

    cat = {
        "id": json_values(summary["track_id"]),
        "year": json_values(genesis.dt.year.to_numpy()),
        "month": json_values(genesis.dt.month.to_numpy()),
        "day": json_values(genesis.dt.day.to_numpy()),
        "hour": json_values(genesis.dt.hour.to_numpy()),
        "npts": json_values(summary["n_detections"]),
        "dur": json_values(summary["duration_hours"]),
        "glon": json_values(summary["genesis_lon"], 2),
        "glat": json_values(summary["genesis_lat"], 2),
        "llon": json_values(summary["lysis_lon"], 2),
        "llat": json_values(summary["lysis_lat"], 2),
        "len_km": json_values(summary["path_km"], 1),
        "pk_int": json_values(summary["track_vorticity_450_300hpa_t42_max"], 2),
        "mn_int": json_values(summary["track_vorticity_450_300hpa_t42_mean"], 2),
        "pk_pr": json_values(peak_precip, 2),
        "mn_pr": json_values(summary["precip_24hr_400km_mean"], 2),
        "mslp": json_values(summary["mslp_min_400km_min"], 2),
        "wind": json_values(summary["ws10_max_400km_max"], 2),
        "dom": [int(value) for value in dominant],
        "pct_int": percentile(summary["track_vorticity_450_300hpa_t42_max"]),
        "pct_pr": percentile(peak_precip),
        "pct_len": percentile(summary["path_km"]),
    }
    for short, column in zip(["rk", "rh", "rw", "rc", "rn"], regions, strict=True):
        cat[short] = json_values(summary[column], 2)

    diagnostics, diagnostic_manifest = build_diagnostics(fixes, schema, args.output)
    year_values = genesis.dt.year
    meta = {
        "schema": "western-disturbances-atlas-v6",
        "catalogue": "WD v6 / Zenodo concept 10.5281/zenodo.18328597",
        "npts": len(fixes),
        "ntracks": len(summary),
        "regions": REGIONS,
        "time_epoch": EPOCH.isoformat().replace("+00:00", "Z"),
        "diagnostics": diagnostics,
        "overall": {
            "pk_int": round(float(summary["track_vorticity_450_300hpa_t42_max"].mean()), 2),
            "pk_pr": round(float(peak_precip.mean()), 2),
            "len_km": round(float(summary["path_km"].mean()), 1),
            "dur": round(float(summary["duration_hours"].mean()), 1),
            "n": len(summary),
        },
        "monthly": {
            str(month): {
                "n": int((genesis.dt.month == month).sum()),
                "pk_int": round(float(summary.loc[genesis.dt.month == month, "track_vorticity_450_300hpa_t42_max"].mean()), 2),
                "pk_pr": round(float(peak_precip[genesis.dt.month == month].mean()), 2),
                "len_km": round(float(summary.loc[genesis.dt.month == month, "path_km"].mean()), 1),
                "dur": round(float(summary.loc[genesis.dt.month == month, "duration_hours"].mean()), 1),
            }
            for month in range(1, 13)
        },
        "yearly": {str(year): int((year_values == year).sum()) for year in range(1950, 2026)},
    }

    catalogue_name = "wd-atlas-catalogue-v6.json.gz"
    fixes_name = "wd-atlas-fixes-v6.i16.gz"
    times_name = "wd-atlas-times-v6.i32.gz"
    payload = json.dumps({"meta": meta, "cat": cat, "off": offsets}, separators=(",", ":"), allow_nan=False).encode()
    write_gzip(args.output / catalogue_name, payload)
    packed = np.concatenate([
        compact_i16(fixes["lon"], 100),
        compact_i16(fixes["lat"], 100),
        compact_i16(fixes["track_vorticity_450_300hpa_t42"], 10),
        compact_i16(fixes["precip_24hr_400km"], 100),
    ])
    write_gzip(args.output / fixes_name, packed.astype("<i2", copy=False).tobytes(order="C"))
    hours = ((fixes["valid_time_utc"] - EPOCH) / pd.Timedelta(hours=1)).to_numpy(dtype="<i4")
    write_gzip(args.output / times_name, hours.tobytes(order="C"))

    manifest_assets: dict[str, dict] = {}
    for key, filename, uncompressed in [
        ("catalogue", catalogue_name, len(payload)),
        ("fixes", fixes_name, packed.nbytes),
        ("times", times_name, hours.nbytes),
    ]:
        path = args.output / filename
        manifest_assets[key] = {
            "file": filename,
            "bytes": path.stat().st_size,
            "uncompressed_bytes": int(uncompressed),
            "sha256": sha256(path),
        }
    map_context = args.output / "map-context.js"
    manifest_assets["map_context"] = {
        "file": map_context.name,
        "bytes": map_context.stat().st_size,
        "sha256": sha256(map_context),
    }
    manifest_assets.update(diagnostic_manifest)
    manifest = {
        "schema": "western-disturbances-atlas-assets-v6",
        "source": {
            "fixes": str(fixes_path.resolve()),
            "fixes_sha256": sha256(fixes_path),
            "summary": str(summary_path.resolve()),
            "summary_sha256": sha256(summary_path),
            "schema": str(schema_path.resolve()),
            "schema_sha256": sha256(schema_path),
        },
        "counts": {"tracks": len(summary), "fixes": len(fixes), "diagnostics": len(diagnostics)},
        "assets": manifest_assets,
    }
    (args.output / "atlas-build-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Built {len(summary):,} tracks, {len(fixes):,} fixes and {len(diagnostics)} lazy diagnostics")


if __name__ == "__main__":
    main()

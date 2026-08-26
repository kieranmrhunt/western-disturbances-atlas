#!/usr/bin/env python3
"""Validate the static WD atlas assets and document wiring."""

from __future__ import annotations

import gzip
import hashlib
import json
import re
from html.parser import HTMLParser
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DYNAMIC_IDS = {
    "wdCloseDossier",
    "wdDossierDownload",
    "wdFitSelected",
    "wdPreviousTrack",
    "wdNextTrack",
}


class IdParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.ids.extend(value for key, value in attrs if key == "id" and value)


def check(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


def main() -> None:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    parser = IdParser()
    parser.feed(html)
    check(len(parser.ids) == len(set(parser.ids)), "index.html contains duplicate IDs")

    config_match = re.search(
        r'<script id="wd-data-config" type="application/json">(.*?)</script>', html
    )
    check(config_match is not None, "index.html has no WD data configuration")
    config = json.loads(config_match.group(1))
    check(config.get("weatherBase"), "Weather base URL is not configured")
    check(config.get("catalogueVersion") == "WD v6", "Atlas is not labelled WD v6")
    check(config.get("times"), "Actual track-point-time asset is not configured")
    check(config.get("routes") and config.get("climate") and config.get("jet"), "Derived route, climate or jet asset is not configured")
    check(config.get("impactBase"), "Impact-footprint archive is not configured")
    check(config.get("weatherSteps", {}).get("vorticity350") == 3, "350-hPa weather timing must be three-hourly")
    check('<option value="tracks">Individual tracks</option>' in html, "Individual tracks are not the first map-layer option")
    check('<option value="none">None: selected track only</option>' in html, "Selected-track-only map layer is missing")
    check('id="wdDateMin" type="date"' in html and 'id="wdDateMax" type="date"' in html, "Exact date controls are missing")
    check('value="latitude">Latitude' not in html and 'value="longitude">Longitude' not in html, "Position should not be offered as an evolution variable")
    check('data-season="ndjfma"' in html and 'data-season="djfm"' in html, "WD season presets are missing")
    check('id="wdGenesisRegionChips"' in html, "Genesis-region controls are missing")
    check('id="wdLysisRegionChips"' in html and 'id="wdRouteChips"' in html, "Lysis or route controls are missing")
    check('id="wdJetPreset"' not in html and 'id="wdVerticalChart"' in html, "Jet preset remains or vertical diagnostics are missing")
    check('id="wdYearBasis"' not in html, "Year-definition selector remains")
    check('<details class="mla-filter-disclosure" open>' not in html, "A filter disclosure is open by default")
    check('id="wdCrossingLongitude" type="number" min="-20" max="145" step="1" value="60"' in html, "Crossing meridian does not default to 60°E")
    check('<option value="vorticity">Vorticity</option>' in html, "Vertical vorticity option is missing or not the default")
    check('id="wdImpactChart"' in html and 'id="wdSpellChart"' in html, "Impact or sequence chart is missing")
    check("rainfall" not in html.lower(), "User-facing rainfall terminology remains in index.html")
    check("16,298" in html and "460,411" in html, "Static v6 counts are missing")
    check("10.5281/zenodo.18328597" in html, "Dataset concept DOI is missing")

    manifest_path = ROOT / "assets" / "atlas-build-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for entry in manifest["assets"].values():
        path = ROOT / "assets" / entry["file"]
        check(path.exists(), f"Missing asset: {path.relative_to(ROOT)}")
        check(path.stat().st_size == entry["bytes"], f"Byte count mismatch: {path.name}")
        check(hashlib.sha256(path.read_bytes()).hexdigest() == entry["sha256"], f"Checksum mismatch: {path.name}")

    catalogue_path = ROOT / config["catalogue"]
    fixes_path = ROOT / config["fixes"]
    times_path = ROOT / config["times"]
    with gzip.open(catalogue_path, "rt", encoding="utf-8") as stream:
        catalogue = json.load(stream)
    fixes = gzip.decompress(fixes_path.read_bytes())
    times = gzip.decompress(times_path.read_bytes())
    meta = catalogue["meta"]
    cat = catalogue["cat"]
    offsets = catalogue["off"]

    check(meta["ntracks"] == 16_298, "Unexpected catalogue track count")
    check(meta["npts"] == 460_411, "Unexpected catalogue track-point count")
    check(len(offsets) == meta["ntracks"], "Offset count does not match track count")
    check(all(len(values) == meta["ntracks"] for values in cat.values()), "A catalogue summary column has the wrong length")
    check(len(fixes) == meta["npts"] * 4 * np.dtype("<i2").itemsize, "Track-point payload has the wrong byte length")
    check(len(times) == meta["npts"] * np.dtype("<i4").itemsize, "Time payload has the wrong byte length")
    check(offsets[0][0] == 0, "First track does not start at track point zero")
    check(offsets[-1][0] + offsets[-1][1] == meta["npts"], "Track offsets do not cover the track-point payload")
    check(min(cat["year"]) == 1950 and max(cat["year"]) == 2025, "Unexpected catalogue coverage")
    check(len(meta.get("diagnostics", [])) == 56, "Expected 56 lazy ERA5 diagnostics")
    check(len({item["key"] for item in meta["diagnostics"]}) == 56, "Diagnostic keys are not unique")

    packed = np.frombuffer(fixes, dtype="<i2")
    point_times = np.frombuffer(times, dtype="<i4")
    check(np.all(np.diff(point_times[np.array([offsets[0][0] + i for i in range(offsets[0][1])])]) > 0), "Track-point times are not increasing")
    has_bridged_gap = any(
        np.any(np.diff(point_times[start:start + length]) > 3)
        for start, length in offsets
    )
    check(has_bridged_gap, "Time asset does not preserve any tracker-bridged gaps")

    source = ROOT.parent / "catalogue-v6" / "full-r2" / "wd_v6-era5-1950-2025-fixes.parquet"
    source_columns = ["track_id", "valid_time_utc", "lon", "lat", "track_vorticity_450_300hpa_t42", "precip_24hr_400km"]
    source_fixes = pd.read_parquet(source, columns=source_columns).sort_values(["track_id", "valid_time_utc"], kind="stable", ignore_index=True)
    check(len(source_fixes) == meta["npts"], "Source/atlas track-point row conservation failed")
    samples = np.array([0, 1, 17, 12_345, 230_205, meta["npts"] - 1])
    check(np.array_equal(packed[samples], np.rint(source_fixes.loc[samples, "lon"].to_numpy() * 100).astype("<i2")), "Longitude round trip failed")
    check(np.array_equal(packed[meta["npts"] + samples], np.rint(source_fixes.loc[samples, "lat"].to_numpy() * 100).astype("<i2")), "Latitude round trip failed")
    check(np.array_equal(packed[meta["npts"] * 2 + samples], np.rint(source_fixes.loc[samples, "track_vorticity_450_300hpa_t42"].to_numpy() * 10).astype("<i2")), "Vorticity round trip failed")
    source_time = pd.to_datetime(source_fixes["valid_time_utc"], utc=True)
    expected_hours = ((source_time - pd.Timestamp(meta["time_epoch"])) / pd.Timedelta(hours=1)).to_numpy(dtype="<i4")
    check(np.array_equal(point_times[samples], expected_hours[samples]), "Actual-time round trip failed")

    for descriptor in meta["diagnostics"]:
        payload = gzip.decompress((ROOT / descriptor["file"]).read_bytes())
        check(len(payload) == meta["npts"] * np.dtype("<f4").itemsize, f"Wrong diagnostic length: {descriptor['key']}")

    with gzip.open(ROOT / config["routes"], "rt", encoding="utf-8") as stream:
        routes = json.load(stream)
    check(len(routes.get("assignment", [])) == meta["ntracks"], "Route assignments do not cover the catalogue")
    check(len(routes.get("definitions", [])) == 8, "Expected eight route archetypes")
    check(sum(item["count"] for item in routes["definitions"]) == meta["ntracks"], "Route counts do not reconcile")
    with gzip.open(ROOT / config["climate"], "rt", encoding="utf-8") as stream:
        climate = json.load(stream)
    check(all(len(climate["values"][key]) == meta["ntracks"] for key in ("oni", "nao", "ao", "pna")), "Climate values do not cover the catalogue")
    check(len(climate["mjo_phase"]) == meta["ntracks"], "MJO values do not cover the catalogue")
    jet = json.loads((ROOT / config["jet"]).read_text(encoding="utf-8"))
    check(len(jet.get("diagnostics", [])) == 4, "Expected four jet diagnostics")
    for descriptor in jet["diagnostics"]:
        path = ROOT / descriptor["file"]
        payload = gzip.decompress(path.read_bytes())
        check(len(payload) == meta["npts"] * np.dtype("<f4").itemsize, f"Wrong jet diagnostic length: {descriptor['key']}")
        check(hashlib.sha256(path.read_bytes()).hexdigest() == descriptor["sha256"], f"Jet checksum mismatch: {descriptor['key']}")
    diagnostic_samples = [meta["diagnostics"][0], meta["diagnostics"][2], meta["diagnostics"][-1]]
    for descriptor in diagnostic_samples:
        source_values = pd.read_parquet(source, columns=[descriptor["field"]])[descriptor["field"]].to_numpy(dtype="<f4")
        values = np.frombuffer(gzip.decompress((ROOT / descriptor["file"]).read_bytes()), dtype="<f4")
        check(np.allclose(values[samples], source_values[samples], equal_nan=True), f"Diagnostic round trip failed: {descriptor['key']}")

    weather_months = (ROOT / "data" / "wd-weather-months.csv").read_text(encoding="utf-8").splitlines()
    check(len(weather_months) == 913, "Weather manifest must contain a header and 912 months")
    check(weather_months[1] == "195001" and weather_months[-1] == "202512", "Unexpected weather-manifest coverage")

    app = (ROOT / "assets" / "atlas-app.js").read_text(encoding="utf-8")
    check('bindDateInput("#wdDateMin", "dateMin")' in app and "Preserve that partial edit" in app, "Date inputs do not preserve partial keyboard edits")
    check("function loadDiagnostic(metric)" in app and "diagnosticArrays" in app, "Lazy evolution diagnostics are not wired")
    check("fixTimeMillis(index, fix)" in app, "Actual track-point times are not used by the application")
    check("metricRange(summary.flatMap((row) => [row.p02, row.p98])" in app, "Subset evolution axes do not fit the filtered data")
    referenced_ids = set(re.findall(r'\$\("#([A-Za-z][\w-]*)"\)', app))
    missing_ids = sorted(referenced_ids - set(parser.ids) - DYNAMIC_IDS)
    check(not missing_ids, f"JavaScript references missing HTML IDs: {', '.join(missing_ids)}")

    print(
        f"OK: {meta['ntracks']:,} tracks, {meta['npts']:,} track points, "
        f"{len(meta['diagnostics'])} lazy diagnostics, {len(parser.ids)} unique document IDs, "
        f"{len(manifest['assets'])} checksummed assets"
    )


if __name__ == "__main__":
    main()

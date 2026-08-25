#!/usr/bin/env python3
"""Validate the static WD atlas assets and document wiring."""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import struct
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DYNAMIC_IDS = {"wdCloseDossier", "wdDossierDownload", "wdFitSelected"}


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

    manifest_path = ROOT / "assets" / "atlas-build-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for entry in manifest["assets"].values():
        path = ROOT / "assets" / entry["file"]
        check(path.exists(), f"Missing asset: {path.relative_to(ROOT)}")
        check(path.stat().st_size == entry["bytes"], f"Byte count mismatch: {path.name}")
        check(hashlib.sha256(path.read_bytes()).hexdigest() == entry["sha256"], f"Checksum mismatch: {path.name}")

    catalogue_path = ROOT / config["catalogue"]
    fixes_path = ROOT / config["fixes"]
    with gzip.open(catalogue_path, "rt", encoding="utf-8") as stream:
        catalogue = json.load(stream)
    fixes = gzip.decompress(fixes_path.read_bytes())
    meta = catalogue["meta"]
    cat = catalogue["cat"]
    offsets = catalogue["off"]

    check(meta["ntracks"] == 16_850, "Unexpected catalogue track count")
    check(meta["npts"] == 398_584, "Unexpected catalogue fix count")
    check(len(offsets) == meta["ntracks"], "Offset count does not match track count")
    check(all(len(values) == meta["ntracks"] for values in cat.values()), "A catalogue summary column has the wrong length")
    check(len(fixes) == meta["npts"] * 4 * struct.calcsize("h"), "Fix payload has the wrong byte length")
    check(offsets[0][0] == 0, "First track does not start at fix zero")
    check(offsets[-1][0] + offsets[-1][1] == meta["npts"], "Track offsets do not cover the fix payload")
    check(min(cat["year"]) == 1950 and max(cat["year"]) == 2025, "Unexpected catalogue coverage")

    app = (ROOT / "assets" / "atlas-app.js").read_text(encoding="utf-8")
    referenced_ids = set(re.findall(r'\$\("#([A-Za-z][\w-]*)"\)', app))
    missing_ids = sorted(referenced_ids - set(parser.ids) - DYNAMIC_IDS)
    check(not missing_ids, f"JavaScript references missing HTML IDs: {', '.join(missing_ids)}")

    print(
        f"OK: {meta['ntracks']:,} tracks, {meta['npts']:,} fixes, "
        f"{len(parser.ids)} unique document IDs, {len(manifest['assets'])} checksummed assets"
    )


if __name__ == "__main__":
    main()

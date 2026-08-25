#!/usr/bin/env python3
"""Split the original single-file WD atlas into deployable data assets.

The first atlas release embedded two base64-encoded gzip streams and its map
context directly in ``index.html``.  This one-off-compatible builder preserves
those bytes exactly while moving them behind normal HTTP requests.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
from pathlib import Path


def extract(pattern: str, text: str, label: str) -> str:
    match = re.search(pattern, text)
    if not match:
        raise SystemExit(f"Could not find {label} in the legacy atlas")
    return match.group(1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("legacy_index", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path("assets"))
    args = parser.parse_args()

    source = args.legacy_index.read_text(encoding="utf-8")
    output = args.output_dir
    output.mkdir(parents=True, exist_ok=True)

    payloads = {
        "catalogue": (
            "wd-atlas-catalogue-v5.json.gz",
            base64.b64decode(extract(r'const B1="([^"]+)"', source, "B1")),
        ),
        "fixes": (
            "wd-atlas-fixes-v5.i16.gz",
            base64.b64decode(extract(r', B2="([^"]+)"', source, "B2")),
        ),
    }
    manifest: dict[str, object] = {
        "schema": "western-disturbances-atlas-split-assets-v1",
        "source": "legacy single-file WD atlas deployment",
        "source_sha256": hashlib.sha256(source.encode()).hexdigest(),
        "assets": {},
    }
    for key, (name, data) in payloads.items():
        (output / name).write_bytes(data)
        manifest["assets"][key] = {
            "file": name,
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        }

    coast = extract(r"const COAST_LINES=(.*?);\n", source, "coast lines")
    borders = extract(r"const BORDER_LINES=(.*?);\n", source, "border lines")
    context = (
        '"use strict";\n'
        f"window.WD_COAST_LINES={coast};\n"
        f"window.WD_BORDER_LINES={borders};\n"
    )
    (output / "map-context.js").write_text(context, encoding="utf-8")
    manifest["assets"]["map_context"] = {
        "file": "map-context.js",
        "bytes": len(context.encode()),
        "sha256": hashlib.sha256(context.encode()).hexdigest(),
    }

    (output / "atlas-build-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()

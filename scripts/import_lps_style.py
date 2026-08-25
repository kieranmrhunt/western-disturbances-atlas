#!/usr/bin/env python3
"""Import the shared visual language from a monsoon-low atlas checkout."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("lps_index", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    source = args.lps_index.read_text(encoding="utf-8")
    match = re.search(r"<style>(.*?)</style>", source, re.DOTALL)
    if not match:
        raise SystemExit("No inline style block found in LPS index")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(match.group(1).strip() + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

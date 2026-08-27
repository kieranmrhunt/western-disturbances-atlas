#!/bin/bash
# Prewarm shared runtime caches before submitting WD weather arrays.

set -euo pipefail

ATLAS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${WD_ATLAS_PYTHON:-/home/users/kieran/miniconda3/envs/py311/bin/python}"
export MPLCONFIGDIR="${WD_ATLAS_MPLCONFIGDIR:-${ATLAS_ROOT}/.weather-runtime/matplotlib}"
export XDG_CACHE_HOME="${WD_ATLAS_XDG_CACHE_HOME:-${ATLAS_ROOT}/.weather-runtime/xdg-cache}"
mkdir -p "$MPLCONFIGDIR" "$XDG_CACHE_HOME"

"$PYTHON" -c 'import json; import matplotlib; from matplotlib import font_manager; font_manager._load_fontmanager(try_read_cache=True); print(json.dumps({"matplotlib": matplotlib.__version__, "cache": matplotlib.get_cachedir()}))'

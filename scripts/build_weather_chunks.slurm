#!/bin/bash
#SBATCH --account=ncas_climate
#SBATCH --partition=standard
#SBATCH --qos=standard
#SBATCH --cpus-per-task=1
#SBATCH --mem=4G
#SBATCH --time=02:00:00
#SBATCH --job-name=wd-weather-chunk
#SBATCH --array=0-3647
#SBATCH --output=hpc-logs/wd-weather-chunk-%A_%a.out

set -euo pipefail
umask 0022

ATLAS_ROOT="${SLURM_SUBMIT_DIR}"
PYTHON="${WD_ATLAS_PYTHON:-/home/users/kieran/miniconda3/envs/py311/bin/python}"
MONTH_MANIFEST="${1:-${ATLAS_ROOT}/data/wd-weather-months.csv}"
OUTPUT_DIR="${2:-/home/users/kieran/incompass/public/kieran/track_data/WD/atlas-weather-v5-r1}"
FIELD="${3:?weather field is required}"
CHUNKS_PER_MONTH=4
MONTH_COUNT=912
MONTH_TASK=$((SLURM_ARRAY_TASK_ID % MONTH_COUNT))
CHUNK_INDEX=$((SLURM_ARRAY_TASK_ID / MONTH_COUNT))
EXTRA_ARGS=()
if [[ "${WD_WEATHER_OVERWRITE:-0}" == "1" ]]; then
	EXTRA_ARGS+=(--overwrite)
fi

export MPLCONFIGDIR="${WD_ATLAS_MPLCONFIGDIR:-${ATLAS_ROOT}/.weather-runtime/matplotlib}"
export XDG_CACHE_HOME="${WD_ATLAS_XDG_CACHE_HOME:-${ATLAS_ROOT}/.weather-runtime/xdg-cache}"
mkdir -p "$MPLCONFIGDIR" "$XDG_CACHE_HOME"

cd "$ATLAS_ROOT"
"$PYTHON" scripts/build_weather_videos.py \
	--field "$FIELD" \
	--month-manifest "$MONTH_MANIFEST" \
	--task-id "$MONTH_TASK" \
	--chunk-index "$CHUNK_INDEX" \
	--chunks-per-month "$CHUNKS_PER_MONTH" \
	--output-dir "$OUTPUT_DIR" \
	"${EXTRA_ARGS[@]}"

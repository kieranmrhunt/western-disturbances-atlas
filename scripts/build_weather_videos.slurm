#!/bin/bash
#SBATCH --account=ncas_climate
#SBATCH --partition=standard
#SBATCH --qos=standard
#SBATCH --cpus-per-task=1
#SBATCH --mem=6G
#SBATCH --time=06:00:00
#SBATCH --job-name=wd-weather
#SBATCH --array=0-911
#SBATCH --output=hpc-logs/wd-weather-%A_%a.out

set -euo pipefail
umask 0022

ATLAS_ROOT="${SLURM_SUBMIT_DIR}"
PYTHON="${WD_ATLAS_PYTHON:-/home/users/kieran/miniconda3/envs/py311/bin/python}"
MONTH_MANIFEST="${1:-${ATLAS_ROOT}/data/wd-weather-months.csv}"
OUTPUT_DIR="${2:-/home/users/kieran/incompass/public/kieran/track_data/WD/atlas-weather-v5-r1}"
FIELD="${3:-vorticity350}"

export MPLCONFIGDIR="${WD_ATLAS_MPLCONFIGDIR:-${ATLAS_ROOT}/.weather-runtime/matplotlib}"
export XDG_CACHE_HOME="${WD_ATLAS_XDG_CACHE_HOME:-${ATLAS_ROOT}/.weather-runtime/xdg-cache}"
mkdir -p "$MPLCONFIGDIR" "$XDG_CACHE_HOME"

cd "$ATLAS_ROOT"
"$PYTHON" scripts/build_weather_videos.py \
	--field "$FIELD" \
	--month-manifest "$MONTH_MANIFEST" \
	--task-id "${SLURM_ARRAY_TASK_ID}" \
	--output-dir "$OUTPUT_DIR"

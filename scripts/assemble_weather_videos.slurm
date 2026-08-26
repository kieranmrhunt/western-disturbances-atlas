#!/bin/bash
#SBATCH --account=ncas_climate
#SBATCH --partition=standard
#SBATCH --qos=standard
#SBATCH --cpus-per-task=1
#SBATCH --mem=2G
#SBATCH --time=00:20:00
#SBATCH --job-name=wd-weather-assemble
#SBATCH --array=0-911%8
#SBATCH --output=hpc-logs/wd-weather-assemble-%A_%a.out

set -euo pipefail
umask 0022

ATLAS_ROOT="${SLURM_SUBMIT_DIR}"
PYTHON="${WD_ATLAS_PYTHON:-/home/users/kieran/miniconda3/envs/py311/bin/python}"
MONTH_MANIFEST="${1:-${ATLAS_ROOT}/data/wd-weather-months.csv}"
OUTPUT_DIR="${2:-/home/users/kieran/incompass/public/kieran/track_data/WD/atlas-weather-v5-r1}"
FIELD="${3:?weather field is required}"

export MPLCONFIGDIR="${TMPDIR:-/tmp}/wd-atlas-mpl-${SLURM_JOB_ID}"
export XDG_CACHE_HOME="${TMPDIR:-/tmp}/wd-atlas-cache-${SLURM_JOB_ID}"
mkdir -p "$MPLCONFIGDIR" "$XDG_CACHE_HOME"

cd "$ATLAS_ROOT"
"$PYTHON" scripts/build_weather_videos.py \
	--field "$FIELD" \
	--month-manifest "$MONTH_MANIFEST" \
	--task-id "${SLURM_ARRAY_TASK_ID}" \
	--chunks-per-month 4 \
	--assemble-chunks \
	--output-dir "$OUTPUT_DIR"

#!/bin/bash
#SBATCH --account=ncas_climate
#SBATCH --partition=standard
#SBATCH --qos=standard
#SBATCH --cpus-per-task=1
#SBATCH --mem=4G
#SBATCH --time=01:15:00
#SBATCH --job-name=wd-impact-month
#SBATCH --array=0-987
#SBATCH --output=hpc-logs/wd-impact-month-%A_%a.out

set -euo pipefail
umask 0022

ATLAS_ROOT="${SLURM_SUBMIT_DIR}"
PYTHON="${WD_ATLAS_PYTHON:-/home/users/kieran/miniconda3/envs/py311/bin/python}"
OUTPUT_DIR="${1:-/home/users/kieran/incompass/public/kieran/track_data/WD/atlas-impact-v1}"
SLOTS_PER_YEAR=13
YEAR=$((1950 + SLURM_ARRAY_TASK_ID / SLOTS_PER_YEAR))
MONTH_SLOT=$((SLURM_ARRAY_TASK_ID % SLOTS_PER_YEAR))
if (( MONTH_SLOT < 12 )); then
	MONTH=$(printf '%04d%02d' "$YEAR" "$((MONTH_SLOT + 1))")
else
	MONTH=$(printf '%04d01' "$((YEAR + 1))")
fi

export MPLCONFIGDIR="${TMPDIR:-/tmp}/wd-impact-mpl-${SLURM_JOB_ID}"
export XDG_CACHE_HOME="${TMPDIR:-/tmp}/wd-impact-cache-${SLURM_JOB_ID}"
mkdir -p "$MPLCONFIGDIR" "$XDG_CACHE_HOME"

cd "$ATLAS_ROOT"
"$PYTHON" scripts/build_impact_footprints.py \
	--year "$YEAR" \
	--month "$MONTH" \
	--output-dir "$OUTPUT_DIR"

#!/bin/bash
#SBATCH --account=ncas_climate
#SBATCH --partition=standard
#SBATCH --qos=standard
#SBATCH --cpus-per-task=1
#SBATCH --mem=2G
#SBATCH --time=00:20:00
#SBATCH --job-name=wd-impact-1950-month
#SBATCH --array=0-6
#SBATCH --output=hpc-logs/wd-impact-1950-month-%A_%a.out

set -euo pipefail
umask 0022

ATLAS_ROOT="${SLURM_SUBMIT_DIR}"
PYTHON="${WD_ATLAS_PYTHON:-/home/users/kieran/miniconda3/envs/py311/bin/python}"
OUTPUT_DIR="${1:-/home/users/kieran/incompass/public/kieran/track_data/WD/atlas-impact-v1}"
MONTHS=(195001 195002 195003 195004 195005 195006 195007)
MONTH="${MONTHS[$SLURM_ARRAY_TASK_ID]}"

export MPLCONFIGDIR="${TMPDIR:-/tmp}/wd-impact-mpl-${SLURM_JOB_ID}"
export XDG_CACHE_HOME="${TMPDIR:-/tmp}/wd-impact-cache-${SLURM_JOB_ID}"
mkdir -p "$MPLCONFIGDIR" "$XDG_CACHE_HOME"

cd "$ATLAS_ROOT"
"$PYTHON" scripts/build_impact_footprints.py \
	--year 1950 \
	--month "$MONTH" \
	--assemble-month \
	--chunk-count 4 \
	--output-dir "$OUTPUT_DIR"

exit 0

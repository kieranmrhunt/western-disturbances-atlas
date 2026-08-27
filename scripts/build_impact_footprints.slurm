#!/bin/bash
#SBATCH --account=ncas_climate
#SBATCH --partition=standard
#SBATCH --qos=standard
#SBATCH --cpus-per-task=1
#SBATCH --mem=8G
#SBATCH --time=06:00:00
#SBATCH --job-name=wd-impact
#SBATCH --array=0-75
#SBATCH --output=hpc-logs/wd-impact-%A_%a.out

set -euo pipefail
umask 0022

ATLAS_ROOT="${SLURM_SUBMIT_DIR}"
PYTHON="${WD_ATLAS_PYTHON:-/home/users/kieran/miniconda3/envs/py311/bin/python}"
OUTPUT_DIR="${1:-/home/users/kieran/incompass/public/kieran/track_data/WD/atlas-impact-v1}"
YEAR=$((1950 + SLURM_ARRAY_TASK_ID))
export MPLCONFIGDIR="${TMPDIR:-/tmp}/wd-impact-mpl-${SLURM_JOB_ID}"
export XDG_CACHE_HOME="${TMPDIR:-/tmp}/wd-impact-cache-${SLURM_JOB_ID}"
mkdir -p "$MPLCONFIGDIR" "$XDG_CACHE_HOME"
cd "$ATLAS_ROOT"
"$PYTHON" scripts/build_impact_footprints.py --year "$YEAR" --output-dir "$OUTPUT_DIR"

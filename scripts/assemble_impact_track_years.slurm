#!/bin/bash
#SBATCH --account=ncas_climate
#SBATCH --partition=standard
#SBATCH --qos=standard
#SBATCH --cpus-per-task=1
#SBATCH --mem=2G
#SBATCH --time=00:20:00
#SBATCH --job-name=wd-impact-track-year
#SBATCH --array=0-75
#SBATCH --output=hpc-logs/wd-impact-track-year-%A_%a.out

set -euo pipefail
umask 0022

ATLAS_ROOT="${SLURM_SUBMIT_DIR}"
PYTHON="${WD_ATLAS_PYTHON:-/home/users/kieran/miniconda3/envs/py311/bin/python}"
OUTPUT_DIR="${1:-/home/users/kieran/incompass/public/kieran/track_data/WD/atlas-impact-v1}"
YEAR=$((1950 + SLURM_ARRAY_TASK_ID))

cd "$ATLAS_ROOT"
"$PYTHON" scripts/build_impact_tracks.py \
	--assemble-year "$YEAR" \
	--output-dir "$OUTPUT_DIR"

exit 0

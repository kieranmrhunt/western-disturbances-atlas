#!/bin/bash
#SBATCH --account=ncas_climate
#SBATCH --partition=standard
#SBATCH --qos=standard
#SBATCH --cpus-per-task=1
#SBATCH --mem=4G
#SBATCH --time=01:00:00
#SBATCH --job-name=wd-impact-track
#SBATCH --array=0-8148
#SBATCH --output=hpc-logs/wd-impact-track-%A_%a.out

set -euo pipefail
umask 0022

ATLAS_ROOT="${SLURM_SUBMIT_DIR}"
PYTHON="${WD_ATLAS_PYTHON:-/home/users/kieran/miniconda3/envs/py311/bin/python}"
TRACK_OFFSET="${1:-0}"
OUTPUT_DIR="${2:-/home/users/kieran/incompass/public/kieran/track_data/WD/atlas-impact-v1}"
TRACK_INDEX=$((TRACK_OFFSET + SLURM_ARRAY_TASK_ID))

cd "$ATLAS_ROOT"
"$PYTHON" scripts/build_impact_tracks.py \
	--track-index "$TRACK_INDEX" \
	--output-dir "$OUTPUT_DIR"

exit 0

#!/bin/bash
#SBATCH --account=ncas_climate
#SBATCH --partition=standard
#SBATCH --qos=standard
#SBATCH --cpus-per-task=1
#SBATCH --mem=4G
#SBATCH --time=02:00:00
#SBATCH --job-name=wd-composite
#SBATCH --output=hpc-logs/wd-composite-%A_%a.out
set -euo pipefail
umask 0022
ATLAS_ROOT="${SLURM_SUBMIT_DIR:?}"
export MPLCONFIGDIR="$ATLAS_ROOT/.weather-runtime/matplotlib"
export XDG_CACHE_HOME="$ATLAS_ROOT/.weather-runtime/xdg-cache"
export OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
cd "$ATLAS_ROOT"
/home/users/kieran/miniconda3/envs/py311/bin/python scripts/build_composites.py --index "${SLURM_ARRAY_TASK_ID:-0}" --offset "${1:-0}" --output "${2:-$ATLAS_ROOT/.composite-runs}"

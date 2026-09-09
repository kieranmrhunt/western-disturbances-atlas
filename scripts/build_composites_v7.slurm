#!/bin/bash
#SBATCH --account=ncas_climate
#SBATCH --partition=standard
#SBATCH --qos=standard
#SBATCH --cpus-per-task=1
#SBATCH --mem=3G
#SBATCH --time=02:00:00
#SBATCH --job-name=wd-v7-composite
#SBATCH --output=hpc-logs/wd-v7-composite-%A_%a.out
set -euo pipefail
export MPLCONFIGDIR="$SLURM_SUBMIT_DIR/.weather-runtime/matplotlib"
export XDG_CACHE_HOME="$SLURM_SUBMIT_DIR/.weather-runtime/xdg-cache"
export OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
PYTHON=/home/users/kieran/miniconda3/envs/py311/bin/python
if [[ "${1:-}" == "finalize" || "${1:-}" == "prepare" ]]; then
  "$PYTHON" scripts/build_composites_v7.py "--$1"
else
  "$PYTHON" scripts/build_composites_v7.py --index "${SLURM_ARRAY_TASK_ID:-0}" --offset "${1:-0}"
fi

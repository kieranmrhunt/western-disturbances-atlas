#!/bin/bash
#SBATCH --account=ncas_climate
#SBATCH --partition=standard
#SBATCH --qos=standard
#SBATCH --cpus-per-task=1
#SBATCH --mem=3G
#SBATCH --time=01:00:00
#SBATCH --job-name=wd-v7-footprint
#SBATCH --output=hpc-logs/wd-v7-footprint-%A_%a.out
set -euo pipefail
export OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 MPLBACKEND=Agg
export MPLCONFIGDIR="$SLURM_SUBMIT_DIR/.weather-runtime/matplotlib"
PYTHON=/home/users/kieran/miniconda3/envs/py311/bin/python
if [[ "${1:-}" == "assemble" ]]; then
  "$PYTHON" scripts/build_impact_v7.py --assemble
else
  printf -v MONTH '%04d%02d' "$((1950+SLURM_ARRAY_TASK_ID/12))" "$((SLURM_ARRAY_TASK_ID%12+1))"
  "$PYTHON" scripts/build_impact_v7.py --month "$MONTH"
fi

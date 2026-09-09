#!/bin/bash
#SBATCH --account=ncas_climate
#SBATCH --partition=standard
#SBATCH --qos=standard
#SBATCH --cpus-per-task=1
#SBATCH --mem=6G
#SBATCH --time=02:00:00
#SBATCH --job-name=wd-forecast
#SBATCH --output=hpc-logs/wd-forecast-%j.out
set -euo pipefail
umask 0022
ATLAS_ROOT="${SLURM_SUBMIT_DIR:?}"
export MPLCONFIGDIR="$ATLAS_ROOT/.weather-runtime/matplotlib"
export XDG_CACHE_HOME="$ATLAS_ROOT/.weather-runtime/xdg-cache"
export OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MPLBACKEND=Agg
cd "$ATLAS_ROOT"
FORECAST_MEMBER="${3:-det}"
if [[ "$FORECAST_MEMBER" == array ]]; then
  if [[ "${SLURM_ARRAY_TASK_ID:?}" == 0 ]]; then FORECAST_MEMBER=c00; else printf -v FORECAST_MEMBER 'p%02d' "$SLURM_ARRAY_TASK_ID"; fi
fi
FORECAST_HORIZON=168
if [[ "${1:?model}" == ifs && ( "${2:8:2}" == 06 || "${2:8:2}" == 18 ) ]]; then FORECAST_HORIZON=144; fi
/home/users/kieran/miniconda3/envs/py311/bin/python scripts/build_forecasts.py --model "$1" --cycle "${2:?cycle}" --member "$FORECAST_MEMBER" --horizon "$FORECAST_HORIZON" --output "${4:-$ATLAS_ROOT/forecast-data}"

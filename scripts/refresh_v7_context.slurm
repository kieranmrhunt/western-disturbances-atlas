#!/bin/bash
#SBATCH --account=ncas_climate
#SBATCH --partition=standard
#SBATCH --qos=standard
#SBATCH --cpus-per-task=1
#SBATCH --mem=12G
#SBATCH --time=02:00:00
#SBATCH --job-name=wd-v7-context
#SBATCH --output=hpc-logs/wd-v7-context-%j.out
set -euo pipefail
export OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 MPLBACKEND=Agg
export MPLCONFIGDIR="$SLURM_SUBMIT_DIR/.weather-runtime/matplotlib"
PYTHON=/home/users/kieran/miniconda3/envs/py311/bin/python
"$PYTHON" scripts/build_route_archetypes.py --catalogue assets/wd-atlas-catalogue-v7.json.gz --fixes assets/wd-atlas-points-v7.i16.gz --times assets/wd-atlas-times-v7.i32.gz --output assets/wd-atlas-routes-v7.json.gz
"$PYTHON" scripts/build_climate_indices.py --catalogue assets/wd-atlas-catalogue-v7.json.gz --output assets/wd-atlas-climate-v7.json.gz
"$PYTHON" scripts/build_jet_diagnostics.py --catalogue assets/wd-atlas-catalogue-v7.json.gz --fixes assets/wd-atlas-points-v7.i16.gz --times assets/wd-atlas-times-v7.i32.gz
"$PYTHON" scripts/build_reanalysis_matches.py

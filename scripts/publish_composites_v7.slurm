#!/bin/bash
#SBATCH --account=ncas_climate
#SBATCH --partition=standard
#SBATCH --qos=standard
#SBATCH --cpus-per-task=1
#SBATCH --mem=8G
#SBATCH --time=01:00:00
#SBATCH --job-name=wd-v7-composite-publish
#SBATCH --output=hpc-logs/wd-v7-composite-publish-%j.out
set -euo pipefail
umask 0022
ATLAS_V7_ROOT="${SLURM_SUBMIT_DIR:-$PWD}"
export MPLCONFIGDIR="$ATLAS_V7_ROOT/.weather-runtime/matplotlib"
export XDG_CACHE_HOME="$ATLAS_V7_ROOT/.weather-runtime/xdg-cache"
export OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
/home/users/kieran/miniconda3/envs/py311/bin/python scripts/build_composites_v7.py --finalize
COMPOSITE_V7_PUBLIC=/home/users/kieran/incompass/public/kieran/track_data/WD/atlas-composites-v7
rsync -a --chmod=D755,F644 --exclude=manifest.json.gz .v7-products/composites/public/ "$COMPOSITE_V7_PUBLIC/"
rsync -a --chmod=F644 .v7-products/composites/public/manifest.json.gz "$COMPOSITE_V7_PUBLIC/manifest.json.gz"

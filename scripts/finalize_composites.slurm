#!/bin/bash
#SBATCH --account=ncas_climate
#SBATCH --partition=standard
#SBATCH --qos=standard
#SBATCH --cpus-per-task=1
#SBATCH --mem=8G
#SBATCH --time=01:00:00
#SBATCH --job-name=wd-composite-publish
#SBATCH --output=hpc-logs/wd-composite-publish-%j.out
set -euo pipefail
umask 0022
ATLAS_ROOT="${SLURM_SUBMIT_DIR:?}"
export MPLCONFIGDIR="$ATLAS_ROOT/.weather-runtime/matplotlib"
export XDG_CACHE_HOME="$ATLAS_ROOT/.weather-runtime/xdg-cache"
export OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
cd "$ATLAS_ROOT"
COMPOSITE_PUBLIC="${1:-/home/users/kieran/incompass/public/kieran/track_data/WD/atlas-composites-v1}"
/home/users/kieran/miniconda3/envs/py311/bin/python scripts/build_composites.py --finalize
# Data first, inventory last: an advertised file is always available.
rsync -a --chmod=D755,F644 --exclude=manifest.json.gz .composite-runs/ "$COMPOSITE_PUBLIC/"
rsync -a --chmod=F644 .composite-runs/manifest.json.gz "$COMPOSITE_PUBLIC/manifest.json.gz"

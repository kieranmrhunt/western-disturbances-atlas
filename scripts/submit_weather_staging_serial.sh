#!/bin/bash
# Submit optional weather fields serially so at most two large source reads compete.

set -euo pipefail

ATLAS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONTH_MANIFEST="${1:-${ATLAS_ROOT}/data/wd-weather-months.csv}"
OUTPUT_DIR="${2:-/home/users/kieran/incompass/public/kieran/track_data/WD/atlas-weather-v5-r1}"
FIELDS=(wind500 temperature500 humidity500 mslp)
DEPENDENCY="${3:-}"

cd "$ATLAS_ROOT"
scripts/prepare_weather_runtime.sh
for FIELD in "${FIELDS[@]}"; do
	CHUNK_ARGS=(--parsable --time=04:00:00)
	if [[ -n "$DEPENDENCY" ]]; then
		CHUNK_ARGS+=(--dependency="afterany:${DEPENDENCY}")
	fi
	CHUNK_JOB=$(sbatch "${CHUNK_ARGS[@]}" scripts/build_weather_chunks.slurm \
		"$MONTH_MANIFEST" "$OUTPUT_DIR" "$FIELD")
	ASSEMBLE_JOB=$(sbatch --parsable --dependency="afterany:${CHUNK_JOB}" \
		scripts/assemble_weather_videos.slurm "$MONTH_MANIFEST" "$OUTPUT_DIR" "$FIELD")
	FINAL_JOB=$(sbatch --parsable --dependency="afterany:${ASSEMBLE_JOB}" \
		scripts/finalize_weather_archive.slurm "$MONTH_MANIFEST" "$OUTPUT_DIR" "$FIELD")
	printf '%s chunks=%s assemble=%s finalize=%s\n' "$FIELD" "$CHUNK_JOB" "$ASSEMBLE_JOB" "$FINAL_JOB"
	DEPENDENCY="$FINAL_JOB"
done

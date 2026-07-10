#!/usr/bin/env bash
set -euo pipefail

canvas_id="${1:?canvas id required}"
./aos show remove --id "$canvas_id" >/dev/null 2>&1 || true
printf 'forced cleanup failure after removing %s\n' "$canvas_id" >&2
exit 7

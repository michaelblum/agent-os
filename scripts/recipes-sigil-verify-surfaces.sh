#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AOS="${AOS:-$ROOT/aos}"

if [ "$#" -lt 1 ]; then
  echo "usage: recipes-sigil-verify-surfaces.sh <canvas-id> [canvas-id ...]" >&2
  exit 2
fi

for canvas_id in "$@"; do
  "$AOS" show wait --id "$canvas_id" --timeout 10s --json >/dev/null
done

python3 - "$AOS" "$@" <<'PY'
import json
import subprocess
import sys

aos = sys.argv[1]
expected = set(sys.argv[2:])
payload = json.loads(subprocess.check_output([aos, "show", "list", "--json"], text=True))
seen = {canvas.get("id") for canvas in payload.get("canvases", [])}
missing = sorted(expected - seen)
if missing:
    print(json.dumps({"status": "failure", "missing": missing}))
    raise SystemExit(1)
print(json.dumps({"status": "success", "surfaces": sorted(expected)}))
PY

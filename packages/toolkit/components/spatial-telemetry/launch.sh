#!/bin/bash
# launch.sh — create the spatial telemetry surface and seed it with bootstrap state.

set -euo pipefail

AOS="${AOS:-./aos}"
CANVAS_ID="${AOS_SPATIAL_TELEMETRY_ID:-spatial-telemetry}"
PANEL_W="${AOS_SPATIAL_TELEMETRY_W:-920}"
PANEL_H="${AOS_SPATIAL_TELEMETRY_H:-620}"

wait_for_eval() {
  local js="$1"
  local attempts="${2:-50}"
  for _ in $(seq 1 "$attempts"); do
    if "$AOS" show eval --id "$CANVAS_ID" --js "$js" 2>/dev/null | python3 -c '
import json, sys
try:
    payload = json.load(sys.stdin)
except Exception:
    raise SystemExit(1)
result = payload.get("result")
raise SystemExit(0 if result in (True, 1, "1", "true") else 1)
' >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

$AOS set content.roots.toolkit packages/toolkit >/dev/null
$AOS content wait --root toolkit --auto-start --timeout 15s >/dev/null

DISPLAY_JSON="$($AOS graph displays --json 2>/dev/null || echo '{"displays":[]}')"
MAIN_W=$(echo "$DISPLAY_JSON" | python3 -c "
import sys, json
payload = json.load(sys.stdin)
displays = payload.get('displays', payload if isinstance(payload, list) else [])
main = next((display for display in displays if display.get('is_main')), displays[0] if displays else None)
print(int((main or {}).get('bounds', {}).get('w', 1920)))
" 2>/dev/null || echo 1920)

X=$((MAIN_W - PANEL_W - 20))
Y=40

$AOS show remove --id "$CANVAS_ID" 2>/dev/null || true
$AOS show create --id "$CANVAS_ID" \
  --at "$X,$Y,$PANEL_W,$PANEL_H" \
  --interactive \
  --scope global \
  --url 'aos://toolkit/components/spatial-telemetry/index.html'

wait_for_eval 'typeof window.__spatialTelemetryState === "object"' \
  || { echo "FAIL: spatial telemetry canvas did not initialize" >&2; exit 1; }

BOOTSTRAP_JSON=$(AOS_BIN="$AOS" python3 - <<'PY'
import json
import os
import subprocess

aos = os.environ["AOS_BIN"]
displays = json.loads(subprocess.check_output([aos, "graph", "displays", "--json"], text=True))
canvases = json.loads(subprocess.check_output([aos, "show", "list", "--json"], text=True))
cursor = json.loads(subprocess.check_output([aos, "see", "cursor", "--json"], text=True))
payload = {
    "type": "bootstrap",
    "payload": {
        "displays": displays.get("data", {}).get("displays", displays.get("displays", displays if isinstance(displays, list) else [])),
        "canvases": canvases.get("canvases", []),
        "cursor": cursor.get("cursor"),
    },
}
print(json.dumps(payload))
PY
)

$AOS show post --id "$CANVAS_ID" --event "$BOOTSTRAP_JSON" >/dev/null
wait_for_eval '!!window.__spatialTelemetryState?.snapshot?.displayRows?.length && !!window.__spatialTelemetryState?.snapshot?.canvasRows?.length' \
  || { echo "FAIL: spatial telemetry bootstrap did not populate snapshot" >&2; exit 1; }

echo "Spatial telemetry launched at ${X},${Y} (${PANEL_W}x${PANEL_H})"
echo "Use ./aos show eval --id ${CANVAS_ID} --js 'JSON.stringify(window.__spatialTelemetryState?.snapshot)' for machine-readable state."

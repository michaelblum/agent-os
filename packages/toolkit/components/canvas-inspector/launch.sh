#!/bin/bash
# launch.sh — Create the canvas inspector and seed it with initial state.
# Live updates flow via in-canvas subscribe('canvas_lifecycle'); no external
# subprocess needed (Task 1 of the toolkit foundation plan added daemon-side
# fan-out of canvas_lifecycle to subscribed canvases).

set -euo pipefail

AOS="${AOS:-./aos}"
CANVAS_ID="canvas-inspector"

$AOS show remove --id "$CANVAS_ID" 2>/dev/null || true

# Position bottom-right of main display
DISPLAY_JSON=$($AOS graph displays --json 2>/dev/null || echo '{"displays":[]}')
MAIN_W=$(echo "$DISPLAY_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
ds=d.get('displays',d) if isinstance(d,dict) else d
m=[x for x in ds if x.get('is_main')][0]
print(int(m['bounds']['w']))
" 2>/dev/null || echo 1920)
MAIN_H=$(echo "$DISPLAY_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
ds=d.get('displays',d) if isinstance(d,dict) else d
m=[x for x in ds if x.get('is_main')][0]
print(int(m['bounds']['h']))
" 2>/dev/null || echo 1080)

PANEL_W=320
PANEL_H=480
X=$((MAIN_W - PANEL_W - 20))
Y=$((MAIN_H - PANEL_H - 60))

$AOS show create --id "$CANVAS_ID" \
  --at "$X,$Y,$PANEL_W,$PANEL_H" \
  --interactive \
  --url 'aos://toolkit/components/canvas-inspector/index.html'

# Wait for the page to wire its bridge + manifest before seeding bootstrap.
for _ in $(seq 1 30); do
  READY_JSON=$($AOS show eval --id "$CANVAS_ID" --js '
    (window.headsup &&
     typeof window.headsup.receive === "function" &&
     window.headsup.manifest &&
     window.headsup.manifest.name === "canvas-inspector") ? "ready" : "wait"
  ' 2>/dev/null || true)
  if printf '%s' "$READY_JSON" | python3 -c '
import json, sys
try:
    payload = json.load(sys.stdin)
except Exception:
    raise SystemExit(1)
raise SystemExit(0 if payload.get("result") == "ready" else 1)
' 2>/dev/null; then
    break
  fi
  sleep 0.1
done

# Seed initial canvas list + display info via prefixed bootstrap message.
# (Channel router strips the canvas-inspector/ prefix and delivers
# {type: 'bootstrap', payload: {...}} to the content's onMessage.)
CANVAS_JSON=$($AOS show list --json 2>/dev/null || echo '{"canvases":[]}')

TMPDIR_BS=$(mktemp -d)
echo "$CANVAS_JSON" > "$TMPDIR_BS/canvases.json"
echo "$DISPLAY_JSON" > "$TMPDIR_BS/displays.json"

BOOTSTRAP_B64=$(python3 - "$TMPDIR_BS" <<'PYEOF'
import json, sys, base64, os
tmpdir = sys.argv[1]
with open(os.path.join(tmpdir, 'canvases.json')) as f:
    canvases = json.load(f).get('canvases', [])
with open(os.path.join(tmpdir, 'displays.json')) as f:
    raw = json.load(f)
    displays = raw.get('displays', raw) if isinstance(raw, dict) else raw
msg = {'type': 'canvas-inspector/bootstrap', 'payload': {'canvases': canvases, 'displays': displays}}
print(base64.b64encode(json.dumps(msg).encode()).decode())
PYEOF
)
rm -rf "$TMPDIR_BS"

if [ -n "$BOOTSTRAP_B64" ]; then
  $AOS show eval --id "$CANVAS_ID" --js "window.headsup.receive(\"$BOOTSTRAP_B64\")"
fi

echo "Canvas inspector launched at ${X},${Y} (${PANEL_W}x${PANEL_H})"
echo "Live lifecycle updates flow via in-canvas subscribe — no subprocess needed."

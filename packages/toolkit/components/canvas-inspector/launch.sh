#!/bin/bash
# launch.sh — Create the canvas inspector and seed it with initial state.
# Live updates flow via in-canvas subscriptions (`canvas_lifecycle` +
# `display_geometry`); no external subprocess needed.

set -euo pipefail

AOS="${AOS:-./aos}"
CANVAS_ID="canvas-inspector"

$AOS show remove --id "$CANVAS_ID" 2>/dev/null || true

$AOS set content.roots.toolkit packages/toolkit >/dev/null
$AOS content wait --root toolkit --auto-start --timeout 15s >/dev/null

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

$AOS show wait --id "$CANVAS_ID" --manifest canvas-inspector --timeout 5s >/dev/null

$AOS show wait \
  --id "$CANVAS_ID" \
  --manifest canvas-inspector \
  --js '!!document.querySelector(".canvas-item.self .canvas-dims") && !!document.querySelector(".minimap-display")' \
  --timeout 5s >/dev/null

echo "Canvas inspector launched at ${X},${Y} (${PANEL_W}x${PANEL_H})"
echo "Live lifecycle + display geometry updates flow via in-canvas subscribe snapshots — no manual bootstrap needed."

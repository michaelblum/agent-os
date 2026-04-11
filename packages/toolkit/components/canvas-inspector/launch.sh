#!/bin/bash
# launch.sh — Create the canvas inspector and bootstrap it with display/canvas data
#
# Usage: bash packages/toolkit/components/canvas-inspector/launch.sh

set -euo pipefail

AOS="${AOS:-./aos}"
CANVAS_ID="canvas-inspector"

# Remove existing instance if any
$AOS show remove --id "$CANVAS_ID" 2>/dev/null || true

# Fetch data
CANVAS_JSON=$($AOS show list --json 2>/dev/null || echo '{"canvases":[]}')
DISPLAY_JSON=$($AOS graph displays --json 2>/dev/null || echo '{"displays":[]}')

# Get main display dimensions for positioning
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

# Panel dimensions — bottom-right of main display
PANEL_W=320
PANEL_H=480
X=$((MAIN_W - PANEL_W - 20))
Y=$((MAIN_H - PANEL_H - 60))

# Create the canvas
$AOS show create --id "$CANVAS_ID" \
  --at "$X,$Y,$PANEL_W,$PANEL_H" \
  --interactive \
  --url "aos://toolkit/components/canvas-inspector/index.html"

# Wait for page to load
sleep 0.5

# Build bootstrap b64 payload via temp files (avoids shell quoting issues with JSON)
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
msg = {'type': 'bootstrap', 'canvases': canvases, 'displays': displays}
print(base64.b64encode(json.dumps(msg).encode()).decode())
PYEOF
)
rm -rf "$TMPDIR_BS"

if [ -n "$BOOTSTRAP_B64" ]; then
  $AOS show eval --id "$CANVAS_ID" --js "window.headsup.receive(\"$BOOTSTRAP_B64\")"
fi

# Start background event relay — pipes canvas_lifecycle events into the inspector
# The listener runs until the inspector canvas is removed or this script is killed
$AOS show listen 2>/dev/null | python3 -c "
import sys, json, base64, subprocess, os

aos = os.environ.get('AOS', './aos')
canvas_id = '$CANVAS_ID'

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        continue
    if event.get('event') != 'canvas_lifecycle':
        continue
    msg = {'type': 'canvas_lifecycle', 'data': event.get('data', {})}
    b64 = base64.b64encode(json.dumps(msg).encode()).decode()
    js = f'window.headsup.receive(\"{b64}\")'
    subprocess.run([aos, 'show', 'eval', '--id', canvas_id, '--js', js],
                   capture_output=True, timeout=5)
" &
LISTENER_PID=$!

echo "Canvas inspector launched at ${X},${Y} (${PANEL_W}x${PANEL_H})"
echo "Event listener running (pid ${LISTENER_PID}). Kill to stop: kill ${LISTENER_PID}"

# Clean up listener when script exits
trap "kill $LISTENER_PID 2>/dev/null" EXIT
wait $LISTENER_PID 2>/dev/null || true

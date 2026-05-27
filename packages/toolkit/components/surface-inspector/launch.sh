#!/bin/bash
# launch.sh — Create Surface Inspector and seed it with initial state.
# Live updates flow via in-canvas subscriptions (`canvas_lifecycle` +
# `display_geometry`); no external subprocess needed.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$ROOT/scripts/aos-content-scope.sh"

AOS="${AOS:-$ROOT/aos}"
CANVAS_ID="${AOS_SURFACE_INSPECTOR_ID:-surface-inspector}"
PANEL_W="${AOS_SURFACE_INSPECTOR_W:-${AOS_CANVAS_INSPECTOR_W:-360}}"
PANEL_H="${AOS_SURFACE_INSPECTOR_H:-${AOS_CANVAS_INSPECTOR_H:-520}}"
TOOLKIT_CONTENT_ROOT="${AOS_TOOLKIT_CONTENT_ROOT:-$(aos_content_root_key_for toolkit "$ROOT")}"

$AOS show remove --id "$CANVAS_ID" 2>/dev/null || true

aos_ensure_content_roots_live "$AOS" \
  "$TOOLKIT_CONTENT_ROOT" "$ROOT/packages/toolkit"

# Position flush bottom-right of the main display's visible bounds for operator
# convenience. This panel placement does not define DesktopWorld.
DISPLAY_JSON=$($AOS graph displays 2>/dev/null || echo '{"data":{"displays":[]}}')
read -r X Y <<EOF
$(echo "$DISPLAY_JSON" | PANEL_W="$PANEL_W" PANEL_H="$PANEL_H" python3 -c "
import json, os, sys

payload = json.load(sys.stdin)
displays = payload.get('data', {}).get('displays', payload.get('displays', payload if isinstance(payload, list) else []))
main = next((display for display in displays if display.get('is_main')), displays[0] if displays else None)
rect = (main or {}).get('visible_bounds') or (main or {}).get('bounds') or {}
x = int(rect.get('x', 0))
y = int(rect.get('y', 0))
w = int(rect.get('w', 1920))
h = int(rect.get('h', 1080))
panel_w = int(os.environ['PANEL_W'])
panel_h = int(os.environ['PANEL_H'])
print(max(x, x + w - panel_w), max(y, y + h - panel_h))
" 2>/dev/null || echo "1600 500")
EOF

$AOS show create --id "$CANVAS_ID" \
  --at "$X,$Y,$PANEL_W,$PANEL_H" \
  --interactive \
  --scope global \
  --url "aos://$TOOLKIT_CONTENT_ROOT/components/surface-inspector/index.html"

$AOS show wait --id "$CANVAS_ID" --manifest surface-inspector --timeout 5s >/dev/null

$AOS show wait \
  --id "$CANVAS_ID" \
  --manifest surface-inspector \
  --js '!!document.querySelector(".tree-row.canvas.self .canvas-dims") && !!document.querySelector(".minimap-display")' \
  --timeout 10s >/dev/null

echo "Surface Inspector launched at ${X},${Y} (${PANEL_W}x${PANEL_H}) flush bottom-right of the main display's visible bounds for operator convenience only"
echo "Live lifecycle + display geometry updates flow via in-canvas subscribe snapshots — no manual bootstrap needed."

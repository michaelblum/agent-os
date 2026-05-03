#!/usr/bin/env bash
# launch.sh - Create the addressable object transform panel.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
AOS="${AOS:-$ROOT/aos}"
CANVAS_ID="${CANVAS_ID:-object-transform-panel}"
PANEL_W="${AOS_OBJECT_TRANSFORM_PANEL_W:-620}"
PANEL_H="${AOS_OBJECT_TRANSFORM_PANEL_H:-420}"

if [[ ! -x "$AOS" ]]; then
  echo "aos binary not found at $AOS" >&2
  exit 1
fi

"$AOS" set content.roots.toolkit packages/toolkit >/dev/null
"$AOS" content wait --root toolkit --auto-start --timeout 15s >/dev/null

DISPLAY_JSON="$("$AOS" graph displays --json 2>/dev/null || echo '{"data":{"displays":[]}}')"
GEOMETRY="$(
  echo "$DISPLAY_JSON" | PANEL_W="$PANEL_W" PANEL_H="$PANEL_H" python3 -c '
import json, os, sys

payload = json.load(sys.stdin)
displays = payload.get("data", {}).get("displays", payload.get("displays", [])) if isinstance(payload, dict) else payload
main = next((entry for entry in displays if entry.get("is_main")), displays[0] if displays else None)
rect = (main or {}).get("visible_bounds") or (main or {}).get("bounds") or {}
x = int(rect.get("x", 0))
y = int(rect.get("y", 0))
w = int(rect.get("w", 1728))
h = int(rect.get("h", 1117))
panel_w = int(os.environ["PANEL_W"])
panel_h = int(os.environ["PANEL_H"])
print(x + max(0, w - panel_w - 16), y + 48, panel_w, panel_h)
' 2>/dev/null || echo "0 48 $PANEL_W $PANEL_H"
)"

read -r X Y W H <<<"$GEOMETRY"

"$AOS" show remove --id "$CANVAS_ID" 2>/dev/null || true
"$AOS" show create \
  --id "$CANVAS_ID" \
  --at "$X,$Y,$W,$H" \
  --interactive \
  --scope global \
  --url 'aos://toolkit/components/object-transform-panel/index.html' >/dev/null

"$AOS" show wait \
  --id "$CANVAS_ID" \
  --manifest object-transform-panel \
  --js 'typeof window.__objectTransformPanelState === "object"' \
  --timeout 5s >/dev/null

echo "Object transform panel launched at ${X},${Y} (${W}x${H})"

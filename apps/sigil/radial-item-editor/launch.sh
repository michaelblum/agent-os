#!/usr/bin/env bash
# launch.sh - Open the Sigil 3D radial item editor and object transform panel.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
AOS="${AOS:-$ROOT/aos}"

if [[ ! -x "$AOS" ]] && command -v aos >/dev/null 2>&1; then
  AOS="$(command -v aos)"
fi

if [[ ! -x "$AOS" ]]; then
  echo "aos binary not found. Set AOS=/path/to/aos and retry." >&2
  exit 1
fi

CONTENT_ROOT="${AOS_SIGIL_CONTENT_ROOT:-sigil}"
EDITOR_ID="${AOS_RADIAL_ITEM_EDITOR_ID:-sigil-radial-item-editor}"
PANEL_ID="${AOS_OBJECT_TRANSFORM_PANEL_ID:-object-transform-panel}"
ITEM_ID="${1:-${AOS_RADIAL_ITEM_ID:-wiki-graph}}"
EDITOR_W="${AOS_RADIAL_ITEM_EDITOR_W:-920}"
EDITOR_H="${AOS_RADIAL_ITEM_EDITOR_H:-620}"
PANEL_W="${AOS_OBJECT_TRANSFORM_PANEL_W:-620}"
PANEL_H="${AOS_OBJECT_TRANSFORM_PANEL_H:-420}"

"$AOS" set "content.roots.$CONTENT_ROOT" "$ROOT/apps/sigil" >/dev/null
"$AOS" set content.roots.toolkit "$ROOT/packages/toolkit" >/dev/null
"$AOS" content wait --root "$CONTENT_ROOT" --auto-start --timeout 15s >/dev/null
"$AOS" content wait --root toolkit --auto-start --timeout 15s >/dev/null

DISPLAY_JSON="$("$AOS" graph displays --json 2>/dev/null || echo '{"data":{"displays":[]}}')"
GEOMETRY="$(
  echo "$DISPLAY_JSON" | EDITOR_W="$EDITOR_W" EDITOR_H="$EDITOR_H" PANEL_W="$PANEL_W" PANEL_H="$PANEL_H" python3 -c '
import json, os, sys

payload = json.load(sys.stdin)
displays = payload.get("data", {}).get("displays", payload.get("displays", [])) if isinstance(payload, dict) else payload
main = next((entry for entry in displays if entry.get("is_main")), displays[0] if displays else None)
rect = (main or {}).get("visible_bounds") or (main or {}).get("bounds") or {}
x = int(rect.get("x", 0))
y = int(rect.get("y", 0))
w = int(rect.get("w", 1728))
h = int(rect.get("h", 1117))
editor_w = min(int(os.environ["EDITOR_W"]), max(520, w - 48))
editor_h = min(int(os.environ["EDITOR_H"]), max(420, h - 96))
panel_w = int(os.environ["PANEL_W"])
panel_h = int(os.environ["PANEL_H"])
editor_x = x + 24
editor_y = y + 64
panel_x = x + max(0, w - panel_w - 16)
panel_y = y + 64
print(editor_x, editor_y, editor_w, editor_h, panel_x, panel_y, panel_w, panel_h)
' 2>/dev/null || echo "24 64 $EDITOR_W $EDITOR_H 1080 64 $PANEL_W $PANEL_H"
)"

read -r EDITOR_X EDITOR_Y RESOLVED_EDITOR_W RESOLVED_EDITOR_H PANEL_X PANEL_Y RESOLVED_PANEL_W RESOLVED_PANEL_H <<<"$GEOMETRY"

"$AOS" show remove --id "$EDITOR_ID" 2>/dev/null || true
"$AOS" show remove --id "$PANEL_ID" 2>/dev/null || true

"$AOS" show create \
  --id "$EDITOR_ID" \
  --at "$EDITOR_X,$EDITOR_Y,$RESOLVED_EDITOR_W,$RESOLVED_EDITOR_H" \
  --interactive \
  --scope global \
  --url "aos://$CONTENT_ROOT/radial-item-editor/index.html?item=$ITEM_ID&controller-id=$PANEL_ID" >/dev/null

"$AOS" show create \
  --id "$PANEL_ID" \
  --at "$PANEL_X,$PANEL_Y,$RESOLVED_PANEL_W,$RESOLVED_PANEL_H" \
  --interactive \
  --scope global \
  --url 'aos://toolkit/components/object-transform-panel/index.html' >/dev/null

"$AOS" show wait \
  --id "$EDITOR_ID" \
  --js 'typeof window.__sigilRadialItemEditor === "object"' \
  --timeout 5s >/dev/null

"$AOS" show wait \
  --id "$PANEL_ID" \
  --manifest object-transform-panel \
  --js 'typeof window.__objectTransformPanelState === "object"' \
  --timeout 5s >/dev/null

echo "Sigil radial item editor launched for $ITEM_ID"
echo "Preview: $EDITOR_ID at ${EDITOR_X},${EDITOR_Y} (${RESOLVED_EDITOR_W}x${RESOLVED_EDITOR_H})"
echo "Controls: $PANEL_ID at ${PANEL_X},${PANEL_Y} (${RESOLVED_PANEL_W}x${RESOLVED_PANEL_H})"

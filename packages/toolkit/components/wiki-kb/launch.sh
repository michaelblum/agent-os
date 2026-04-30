#!/usr/bin/env bash
# launch.sh - Create a wiki-kb demo canvas and seed it with sample graph data.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
AOS="${AOS:-$ROOT/aos}"
CANVAS_ID="${CANVAS_ID:-wiki-kb-demo}"
EVENT_FILE="${EVENT_FILE:-$DIR/sample-graph.event.json}"

if [[ ! -x "$AOS" ]]; then
  echo "aos binary not found at $AOS" >&2
  exit 1
fi

if [[ ! -f "$EVENT_FILE" ]]; then
  echo "sample event not found at $EVENT_FILE" >&2
  exit 1
fi

"$AOS" show remove --id "$CANVAS_ID" 2>/dev/null || true

"$AOS" set content.roots.toolkit packages/toolkit >/dev/null
"$AOS" content wait --root toolkit --auto-start --timeout 15s >/dev/null

DISPLAY_JSON="$("$AOS" graph displays --json 2>/dev/null || echo '{"displays":[]}')"
GEOMETRY="$(
  echo "$DISPLAY_JSON" | python3 -c '
import json, sys

payload = json.load(sys.stdin)
displays = payload.get("data", {}).get("displays", payload.get("displays", [])) if isinstance(payload, dict) else payload
main = next((entry for entry in displays if entry.get("is_main")), displays[0] if displays else None)
if not main:
    print("0 0 1728 1117")
    raise SystemExit(0)
bounds = main.get("bounds") or {}
print(bounds.get("x", 0), bounds.get("y", 0), bounds.get("w", main.get("width", 1728)), bounds.get("h", main.get("height", 1117)))
'
)"

read -r DISPLAY_X DISPLAY_Y DISPLAY_W DISPLAY_H <<<"$GEOMETRY"

PANEL_W=860
PANEL_H=580
if (( PANEL_W > DISPLAY_W - 40 )); then PANEL_W=$((DISPLAY_W - 40)); fi
if (( PANEL_H > DISPLAY_H - 80 )); then PANEL_H=$((DISPLAY_H - 80)); fi
if (( PANEL_W < 480 )); then PANEL_W=480; fi
if (( PANEL_H < 320 )); then PANEL_H=320; fi

X=$((DISPLAY_X + (DISPLAY_W - PANEL_W) / 2))
Y=$((DISPLAY_Y + (DISPLAY_H - PANEL_H) / 2))

"$AOS" show create \
  --id "$CANVAS_ID" \
  --at "$X,$Y,$PANEL_W,$PANEL_H" \
  --interactive \
  --focus \
  --url 'aos://toolkit/components/wiki-kb/index.html' >/dev/null

"$AOS" show wait \
  --id "$CANVAS_ID" \
  --manifest wiki-kb \
  --js '!!document.querySelector(".wiki-kb-status") && document.querySelector(".wiki-kb-view-tab.active")?.dataset.view === "graph"' \
  --timeout 5s >/dev/null

EVENT_CONTENT="$(cat "$EVENT_FILE")"
"$AOS" show post --id "$CANVAS_ID" --event "$EVENT_CONTENT" >/dev/null

"$AOS" show wait \
  --id "$CANVAS_ID" \
  --manifest wiki-kb \
  --js 'document.querySelector(".wiki-kb-status")?.textContent.includes("5 nodes") && document.querySelector(".wiki-kb-status")?.textContent.includes("6 links")' \
  --timeout 5s >/dev/null

echo "Wiki KB demo launched at ${X},${Y} (${PANEL_W}x${PANEL_H})"
echo "Canvas: $CANVAS_ID"
echo "Sample graph: $EVENT_FILE"

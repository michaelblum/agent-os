#!/bin/bash
# launch.sh — create the Sigil interaction trace panel.

set -euo pipefail

AOS="${AOS:-./aos}"
CANVAS_ID="${AOS_SIGIL_TRACE_ID:-sigil-interaction-trace}"
PANEL_W="${AOS_SIGIL_TRACE_W:-760}"
PANEL_H="${AOS_SIGIL_TRACE_H:-620}"

wait_for_eval() {
  local js="$1"
  local attempts="${2:-40}"
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

"$AOS" set content.roots.toolkit packages/toolkit >/dev/null
"$AOS" set content.roots.sigil apps/sigil >/dev/null
"$AOS" content wait --root toolkit --auto-start --timeout 15s >/dev/null
"$AOS" content wait --root sigil --auto-start --timeout 15s >/dev/null

DISPLAY_JSON="$("$AOS" graph displays --json 2>/dev/null || echo '{"data":{"displays":[]}}')"
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
panel_w = int(os.environ['PANEL_W'])
panel_h = int(os.environ['PANEL_H'])
print(max(x, x + w - panel_w), y)
" 2>/dev/null || echo "0 0")
EOF

"$AOS" show remove --id "$CANVAS_ID" 2>/dev/null || true
"$AOS" show create --id "$CANVAS_ID" \
  --at "$X,$Y,$PANEL_W,$PANEL_H" \
  --interactive \
  --scope global \
  --url 'aos://sigil/diagnostics/interaction-trace/index.html'

wait_for_eval 'document.querySelector(".sigil-interaction-trace") != null' \
  || { echo "FAIL: Sigil interaction trace panel did not initialize" >&2; exit 1; }

echo "Sigil interaction trace launched at ${X},${Y} (${PANEL_W}x${PANEL_H})."
echo "Use ./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug.interactionTrace())' to export the trace."

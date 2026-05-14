#!/usr/bin/env bash
# launch.sh - Open a generated HTML Workbench Expression metadata fixture.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$ROOT/scripts/aos-content-scope.sh"

AOS="${AOS:-$ROOT/aos}"
CANVAS_ID="${CANVAS_ID:-html-workbench-expression}"
PANEL_W="${AOS_HTML_WORKBENCH_EXPRESSION_W:-1180}"
PANEL_H="${AOS_HTML_WORKBENCH_EXPRESSION_H:-760}"
TOOLKIT_CONTENT_ROOT="${AOS_TOOLKIT_CONTENT_ROOT:-$(aos_content_root_key_for toolkit "$ROOT")}"
EXPRESSION_METADATA="${1:-$ROOT/docs/design/fixtures/aos-html-workbench-expression-v0/expression.json}"

if [[ ! -x "$AOS" ]]; then
  echo "aos binary not found at $AOS" >&2
  exit 1
fi

if [[ ! -f "$EXPRESSION_METADATA" ]]; then
  echo "HTML Workbench Expression metadata not found: $EXPRESSION_METADATA" >&2
  exit 1
fi

"$AOS" show remove --id "$CANVAS_ID" 2>/dev/null || true

aos_ensure_content_roots_live "$AOS" \
  "$TOOLKIT_CONTENT_ROOT" "$ROOT/packages/toolkit"

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
panel_w = min(int(os.environ["PANEL_W"]), max(760, w - 48))
panel_h = min(int(os.environ["PANEL_H"]), max(520, h - 96))
print(x + 24, y + 64, panel_w, panel_h)
' 2>/dev/null || echo "24 64 $PANEL_W $PANEL_H"
)"

read -r X Y W H <<<"$GEOMETRY"

"$AOS" show create \
  --id "$CANVAS_ID" \
  --at "$X,$Y,$W,$H" \
  --interactive \
  --focus \
  --scope global \
  --url "aos://$TOOLKIT_CONTENT_ROOT/components/html-workbench-expression/index.html" >/dev/null

"$AOS" show wait \
  --id "$CANVAS_ID" \
  --manifest html-workbench-expression \
  --js 'typeof window.__htmlWorkbenchExpressionState === "object"' \
  --timeout 5s >/dev/null

CONTENT_JSON="$(EXPRESSION_METADATA="$EXPRESSION_METADATA" ROOT="$ROOT" python3 -c '
import json
import os
from pathlib import Path

root = Path(os.environ["ROOT"]).resolve()
metadata_path = Path(os.environ["EXPRESSION_METADATA"]).resolve()
metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
html_path = metadata.get("html", {}).get("path")
if html_path:
    html_file = (root / html_path).resolve()
    html = html_file.read_text(encoding="utf-8")
else:
    html = ""
print(json.dumps({
    "type": "html_workbench_expression.open",
    "metadata": metadata,
    "html": html,
    "source": {
        "kind": "file",
        "path": str(metadata_path),
    },
}))
')"

"$AOS" show post --id "$CANVAS_ID" --event "$CONTENT_JSON" >/dev/null

"$AOS" show wait \
  --id "$CANVAS_ID" \
  --manifest html-workbench-expression \
  --js 'window.__htmlWorkbenchExpressionState?.last_result?.status === "opened" && window.__htmlWorkbenchExpressionState?.semantic_target_count > 0' \
  --timeout 5s >/dev/null

echo "HTML Workbench Expression launched at ${X},${Y} (${W}x${H})"
echo "Canvas: $CANVAS_ID"
echo "Metadata: $EXPRESSION_METADATA"

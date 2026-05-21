#!/usr/bin/env bash
# launch.sh - Open a local standalone HTML file in the HTML File Workbench.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$ROOT/scripts/aos-content-scope.sh"

AOS="${AOS:-$ROOT/aos}"
CANVAS_ID="${CANVAS_ID:-html-file-workbench}"
PANEL_W="${AOS_HTML_FILE_WORKBENCH_W:-1180}"
PANEL_H="${AOS_HTML_FILE_WORKBENCH_H:-760}"
TOOLKIT_CONTENT_ROOT="${AOS_TOOLKIT_CONTENT_ROOT:-$(aos_content_root_key_for toolkit "$ROOT")}"
TARGET_FILE="${1:-}"
MAX_BYTES="${AOS_HTML_FILE_WORKBENCH_MAX_BYTES:-1048576}"

if [[ ! -x "$AOS" ]]; then
  echo "aos binary not found at $AOS" >&2
  exit 1
fi

if [[ -z "$TARGET_FILE" ]]; then
  echo "usage: $0 /path/to/file.html" >&2
  exit 2
fi

if [[ ! -f "$TARGET_FILE" ]]; then
  echo "HTML file not found: $TARGET_FILE" >&2
  exit 1
fi

TARGET_FILE="$(cd "$(dirname "$TARGET_FILE")" && pwd)/$(basename "$TARGET_FILE")"
TARGET_FILE_LOWER="$(printf '%s' "$TARGET_FILE" | tr '[:upper:]' '[:lower:]')"
case "$TARGET_FILE_LOWER" in
  *.html|*.htm) ;;
  *)
    echo "Target must be a .html or .htm file: $TARGET_FILE" >&2
    exit 1
    ;;
esac

SIZE="$(wc -c < "$TARGET_FILE" | tr -d '[:space:]')"
if [[ "$SIZE" -gt "$MAX_BYTES" ]]; then
  echo "HTML file is too large for the V0 workbench: $SIZE bytes > $MAX_BYTES bytes" >&2
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
  --url "aos://$TOOLKIT_CONTENT_ROOT/components/html-file-workbench/index.html" >/dev/null

"$AOS" show wait \
  --id "$CANVAS_ID" \
  --manifest html-file-workbench \
  --js 'typeof window.__htmlFileWorkbenchState === "object"' \
  --timeout 5s >/dev/null

CONTENT_JSON="$(TARGET_FILE="$TARGET_FILE" python3 -c '
import json, os, pathlib
path = pathlib.Path(os.environ["TARGET_FILE"]).resolve()
print(json.dumps({
    "type": "html_file.open",
    "path": str(path),
    "content": path.read_text(encoding="utf-8"),
}))
')"

"$AOS" show post --id "$CANVAS_ID" --event "$CONTENT_JSON" >/dev/null

echo "HTML File Workbench launched at ${X},${Y} (${W}x${H})"
echo "Canvas: $CANVAS_ID"
echo "File: $TARGET_FILE"
echo "Agent save helper: packages/toolkit/components/html-file-workbench/save-current.sh $CANVAS_ID"

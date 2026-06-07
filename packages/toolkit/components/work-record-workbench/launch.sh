#!/usr/bin/env bash
# launch.sh - Open a fixture-backed work-record workbench.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$ROOT/scripts/aos-content-scope.sh"
AOS="${AOS:-$ROOT/aos}"
CANVAS_ID="${CANVAS_ID:-work-record-workbench}"
ALLOW_START="false"
if [[ "${1:-}" == "--allow-start" ]]; then
  ALLOW_START="true"
  shift
fi
TARGET="${1:-$ROOT/docs/design/fixtures/aos-work-records/browser-artifact-collection-step.json}"
PANEL_W="${AOS_WORK_RECORD_WORKBENCH_W:-1180}"
PANEL_H="${AOS_WORK_RECORD_WORKBENCH_H:-720}"
TOOLKIT_CONTENT_ROOT="${AOS_TOOLKIT_CONTENT_ROOT:-$(aos_content_root_key_for toolkit "$ROOT")}"
CANONICAL_REPO_ROOT="${AOS_CANONICAL_REPO_ROOT:-/Users/Michael/Code/agent-os}"

if [[ ! -x "$AOS" ]]; then
  echo "aos binary not found at $AOS" >&2
  exit 1
fi

if [[ ! -f "$TARGET" ]]; then
  echo "Work record JSON not found: $TARGET" >&2
  exit 1
fi

if [[ "$TOOLKIT_CONTENT_ROOT" != "toolkit" && -d "$CANONICAL_REPO_ROOT/packages/toolkit" ]]; then
  "$AOS" set content.roots.toolkit "$CANONICAL_REPO_ROOT/packages/toolkit" >/dev/null
fi

"$AOS" set "content.roots.$TOOLKIT_CONTENT_ROOT" "$ROOT/packages/toolkit" >/dev/null

if [[ "$ALLOW_START" == "true" ]]; then
  aos_ensure_content_roots_live "$AOS" --allow-start "$TOOLKIT_CONTENT_ROOT" "$ROOT/packages/toolkit"
else
  aos_ensure_content_roots_live "$AOS" "$TOOLKIT_CONTENT_ROOT" "$ROOT/packages/toolkit"
fi

DISPLAY_JSON="$("$AOS" graph displays 2>/dev/null || echo '{"data":{"displays":[]}}')"
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

"$AOS" show remove --id "$CANVAS_ID" 2>/dev/null || true
"$AOS" show create \
  --id "$CANVAS_ID" \
  --at "$X,$Y,$W,$H" \
  --interactive \
  --focus \
  --scope global \
  --url "aos://$TOOLKIT_CONTENT_ROOT/components/work-record-workbench/index.html" >/dev/null

"$AOS" show wait \
  --id "$CANVAS_ID" \
  --manifest work-record-workbench \
  --js 'typeof window.__workRecordWorkbenchState === "object"' \
  --timeout 5s \
  --json >/dev/null

CONTENT_JSON="$(TARGET="$TARGET" python3 -c '
import json, os, pathlib
path = pathlib.Path(os.environ["TARGET"]).resolve()
record = json.loads(path.read_text(encoding="utf-8"))
print(json.dumps({
    "type": "work_record.open",
    "record": record,
    "source": {
        "kind": "file",
        "path": str(path),
    },
}))
')"

"$AOS" show post --id "$CANVAS_ID" --event "$CONTENT_JSON" >/dev/null

echo "Work record workbench launched at ${X},${Y} (${W}x${H})"

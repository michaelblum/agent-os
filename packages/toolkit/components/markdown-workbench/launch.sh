#!/usr/bin/env bash
# launch.sh - Open a file-backed Markdown workbench.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
AOS="${AOS:-$ROOT/aos}"
CANVAS_ID="${CANVAS_ID:-markdown-workbench}"
TARGET_FILE="${1:-$DIR/sample.md}"
PANEL_W="${AOS_MARKDOWN_WORKBENCH_W:-1120}"
PANEL_H="${AOS_MARKDOWN_WORKBENCH_H:-720}"

root_key_for() {
  local prefix="$1"
  local branch suffix
  branch="$(git -C "$ROOT" branch --show-current 2>/dev/null || true)"
  if [[ -z "$branch" || "$branch" == "main" ]]; then
    printf '%s\n' "$prefix"
    return
  fi
  suffix="$(
    printf '%s' "$branch" \
      | tr '[:upper:]' '[:lower:]' \
      | sed -E 's/[^a-z0-9]+/_/g; s/^_+//; s/_+$//'
  )"
  printf '%s_%s\n' "$prefix" "${suffix:-worktree}"
}

TOOLKIT_CONTENT_ROOT="${AOS_TOOLKIT_CONTENT_ROOT:-$(root_key_for toolkit)}"
CANONICAL_REPO_ROOT="${AOS_CANONICAL_REPO_ROOT:-/Users/Michael/Code/agent-os}"

if [[ ! -x "$AOS" ]]; then
  echo "aos binary not found at $AOS" >&2
  exit 1
fi

if [[ ! -f "$TARGET_FILE" ]]; then
  echo "Markdown file not found: $TARGET_FILE" >&2
  exit 1
fi

if [[ "$TOOLKIT_CONTENT_ROOT" != "toolkit" && -d "$CANONICAL_REPO_ROOT/packages/toolkit" ]]; then
  "$AOS" set content.roots.toolkit "$CANONICAL_REPO_ROOT/packages/toolkit" >/dev/null
fi

"$AOS" set "content.roots.$TOOLKIT_CONTENT_ROOT" "$ROOT/packages/toolkit" >/dev/null

content_root_live() {
  "$AOS" content status --json 2>/dev/null \
    | TOOLKIT_CONTENT_ROOT="$TOOLKIT_CONTENT_ROOT" \
      TOOLKIT_PATH="$ROOT/packages/toolkit" \
      python3 -c '
import json, os, sys
try:
    roots = json.load(sys.stdin).get("roots", {})
except Exception:
    sys.exit(1)
sys.exit(0 if roots.get(os.environ["TOOLKIT_CONTENT_ROOT"]) == os.environ["TOOLKIT_PATH"] else 1)
'
}

if ! content_root_live; then
  echo "Refreshing repo daemon so new content root is live: $TOOLKIT_CONTENT_ROOT" >&2
  "$AOS" service restart --mode repo >/dev/null
fi

"$AOS" content wait --root "$TOOLKIT_CONTENT_ROOT" --auto-start --timeout 15s >/dev/null

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

"$AOS" show remove --id "$CANVAS_ID" 2>/dev/null || true
"$AOS" show create \
  --id "$CANVAS_ID" \
  --at "$X,$Y,$W,$H" \
  --interactive \
  --focus \
  --scope global \
  --url "aos://$TOOLKIT_CONTENT_ROOT/components/markdown-workbench/index.html" >/dev/null

"$AOS" show wait \
  --id "$CANVAS_ID" \
  --manifest markdown-workbench \
  --js 'typeof window.__markdownWorkbenchState === "object"' \
  --timeout 5s >/dev/null

CONTENT_JSON="$(TARGET_FILE="$TARGET_FILE" python3 -c '
import json, os, pathlib
path = pathlib.Path(os.environ["TARGET_FILE"]).resolve()
print(json.dumps({
    "type": "markdown_document.open",
    "path": str(path),
    "content": path.read_text(encoding="utf-8"),
}))
')"

"$AOS" show post --id "$CANVAS_ID" --event "$CONTENT_JSON" >/dev/null

echo "Markdown workbench launched at ${X},${Y} (${W}x${H})"
echo "Canvas: $CANVAS_ID"
echo "File: $(cd "$(dirname "$TARGET_FILE")" && pwd)/$(basename "$TARGET_FILE")"
echo "Save handoff: use window.__markdownWorkbenchState.content or the emitted markdown-workbench/save.requested event."
echo "Agent save helper: packages/toolkit/components/markdown-workbench/save-current.sh $CANVAS_ID"

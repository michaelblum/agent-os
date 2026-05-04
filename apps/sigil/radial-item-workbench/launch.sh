#!/usr/bin/env bash
# launch.sh - Open the Sigil radial item workbench as one split surface.

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

CONTENT_ROOT="${AOS_SIGIL_CONTENT_ROOT:-$(root_key_for sigil)}"
TOOLKIT_CONTENT_ROOT="${AOS_TOOLKIT_CONTENT_ROOT:-$(root_key_for toolkit)}"
WORKBENCH_ID="${AOS_RADIAL_ITEM_WORKBENCH_ID:-sigil-radial-item-workbench}"
ITEM_ID="${1:-${AOS_RADIAL_ITEM_ID:-wiki-graph}}"
WORKBENCH_W="${AOS_RADIAL_ITEM_WORKBENCH_W:-1280}"
WORKBENCH_H="${AOS_RADIAL_ITEM_WORKBENCH_H:-720}"

"$AOS" set "content.roots.$CONTENT_ROOT" "$ROOT/apps/sigil" >/dev/null
"$AOS" set "content.roots.$TOOLKIT_CONTENT_ROOT" "$ROOT/packages/toolkit" >/dev/null

content_roots_live() {
  "$AOS" content status --json 2>/dev/null \
    | CONTENT_ROOT="$CONTENT_ROOT" \
      TOOLKIT_CONTENT_ROOT="$TOOLKIT_CONTENT_ROOT" \
      SIGIL_PATH="$ROOT/apps/sigil" \
      TOOLKIT_PATH="$ROOT/packages/toolkit" \
      python3 -c '
import json, os, sys
try:
    roots = json.load(sys.stdin).get("roots", {})
except Exception:
    sys.exit(1)
checks = (
    (os.environ["CONTENT_ROOT"], os.environ["SIGIL_PATH"]),
    (os.environ["TOOLKIT_CONTENT_ROOT"], os.environ["TOOLKIT_PATH"]),
)
sys.exit(0 if all(roots.get(name) == path for name, path in checks) else 1)
'
}

if ! content_roots_live; then
  echo "Refreshing repo daemon so new content roots are live: $CONTENT_ROOT, $TOOLKIT_CONTENT_ROOT" >&2
  "$AOS" service restart --mode repo >/dev/null
fi

"$AOS" content wait --root "$CONTENT_ROOT" --auto-start --timeout 15s >/dev/null
"$AOS" content wait --root "$TOOLKIT_CONTENT_ROOT" --auto-start --timeout 15s >/dev/null

DISPLAY_JSON="$("$AOS" graph displays --json 2>/dev/null || echo '{"data":{"displays":[]}}')"
GEOMETRY="$(
  echo "$DISPLAY_JSON" | WORKBENCH_W="$WORKBENCH_W" WORKBENCH_H="$WORKBENCH_H" python3 -c '
import json, os, sys

payload = json.load(sys.stdin)
displays = payload.get("data", {}).get("displays", payload.get("displays", [])) if isinstance(payload, dict) else payload
main = next((entry for entry in displays if entry.get("is_main")), displays[0] if displays else None)
rect = (main or {}).get("visible_bounds") or (main or {}).get("bounds") or {}
x = int(rect.get("x", 0))
y = int(rect.get("y", 0))
w = int(rect.get("w", 1728))
h = int(rect.get("h", 1117))
workbench_w = min(int(os.environ["WORKBENCH_W"]), max(760, w - 48))
workbench_h = min(int(os.environ["WORKBENCH_H"]), max(560, h - 96))
print(x + 24, y + 64, workbench_w, workbench_h)
' 2>/dev/null || echo "24 64 $WORKBENCH_W $WORKBENCH_H"
)"

read -r WORKBENCH_X WORKBENCH_Y RESOLVED_WORKBENCH_W RESOLVED_WORKBENCH_H <<<"$GEOMETRY"

"$AOS" show remove --id "$WORKBENCH_ID" 2>/dev/null || true

"$AOS" show create \
  --id "$WORKBENCH_ID" \
  --at "$WORKBENCH_X,$WORKBENCH_Y,$RESOLVED_WORKBENCH_W,$RESOLVED_WORKBENCH_H" \
  --interactive \
  --scope global \
  --url "aos://$CONTENT_ROOT/radial-item-workbench/index.html?item=$ITEM_ID&toolkit-root=$TOOLKIT_CONTENT_ROOT" >/dev/null

"$AOS" show wait \
  --id "$WORKBENCH_ID" \
  --js 'typeof window.__sigilRadialItemWorkbench === "object" && window.__sigilRadialItemWorkbench.snapshot().panel?.objects?.length > 0' \
  --timeout 5s >/dev/null

echo "Sigil radial item workbench launched for $ITEM_ID"
echo "Content roots: $CONTENT_ROOT, $TOOLKIT_CONTENT_ROOT"
echo "Workbench: $WORKBENCH_ID at ${WORKBENCH_X},${WORKBENCH_Y} (${RESOLVED_WORKBENCH_W}x${RESOLVED_WORKBENCH_H})"

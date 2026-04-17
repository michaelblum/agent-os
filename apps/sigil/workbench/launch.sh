#!/bin/bash
# launch.sh — one-shot launcher for the Sigil workbench.
#
# Ensures the AOS daemon is running, seeds the Sigil wiki, launches the avatar
# and workbench canvases, stages the avatar, and bootstraps debug tabs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
AOS="${AOS:-$REPO_ROOT/aos}"
MODE="${MODE:-repo}"
WORKBENCH_ID="${WORKBENCH_ID:-sigil-workbench}"
AVATAR_ID="${AVATAR_ID:-avatar-main}"

# --- helpers ----------------------------------------------------------------

ensure_content_roots() {
  "$AOS" set content.roots.toolkit packages/toolkit >/dev/null
  "$AOS" set content.roots.sigil apps/sigil >/dev/null
}

# --- geometry ---------------------------------------------------------------

# Compute workbench frame + avatar home from display geometry.
# Outputs two lines: frame "x,y,w,h" and avatar home "ax,ay".
compute_geometry() {
  echo "$1" | python3 - "${2:-32}" "${3:-28}" <<'PY'
import json, sys

margin_x, margin_y = int(sys.argv[1]), int(sys.argv[2])
raw = json.load(sys.stdin)
displays = raw.get("displays", raw) if isinstance(raw, dict) else raw
main = next((d for d in displays if d.get("is_main")), None)

if not main:
    print("120,120,960,720")
    print("240,180")
    sys.exit(0)

b = main.get("visible_bounds") or main["bounds"]
usable_w = max(480, int(b["w"]) - margin_x * 2)
usable_h = max(360, int(b["h"]) - margin_y * 2)
w = max(480, round(usable_w * 2 / 3))
h = usable_h
x = int(b["x"]) + int(b["w"]) - margin_x - w
y = int(b["y"]) + margin_y
print(f"{x},{y},{w},{h}")
print(f"{b['x'] + b['w'] / 6},{b['y'] + b['h'] / 6}")
PY
}

# --- avatar staging ---------------------------------------------------------

stage_avatar() {
  local IFS=','
  read -r ax ay <<< "$1"
  local js
  js="$(cat <<JSEOF
(function(){
  if(!window.liveJs) return 'no-liveJs';
  var p={x:${ax},y:${ay},valid:true};
  liveJs.travel=null;
  liveJs.avatarPos=p; liveJs.currentCursor=p; liveJs.cursorTarget=p;
  if(typeof postLastPositionToDaemon==='function') postLastPositionToDaemon();
  return JSON.stringify(p);
})()
JSEOF
)"
  for _ in $(seq 1 10); do
    local result
    result="$("$AOS" show eval --id "$AVATAR_ID" --js "$js" 2>/dev/null || true)"
    printf '%s' "$result" | grep -q '"x"' && return 0
    sleep 0.2
  done
  echo "Warning: avatar staging timed out." >&2
}

# --- bootstrap --------------------------------------------------------------

bootstrap_tabs() {
  "$AOS" show post --id "$WORKBENCH_ID" \
    --event '{"type":"log/append","payload":{"level":"info","text":"Workbench ready."}}' >/dev/null
}

# --- main -------------------------------------------------------------------

main() {
  ensure_content_roots
  "$AOS" service start --mode "$MODE" >/dev/null 2>&1 || true
  if ! "$AOS" content wait --root toolkit --root sigil --timeout 10s >/dev/null 2>&1; then
    echo "The running daemon does not have live toolkit+sigil content roots." >&2
    echo "Restart the daemon to apply content.roots.toolkit and content.roots.sigil, then rerun launch.sh." >&2
    return 1
  fi
  "$REPO_ROOT/apps/sigil/sigilctl-seed.sh" --mode "$MODE" >/dev/null

  "$AOS" show remove --id "$WORKBENCH_ID" >/dev/null 2>&1 || true
  "$AOS" show remove --id "$AVATAR_ID" >/dev/null 2>&1 || true

  local display_json geometry frame avatar_home
  display_json="$("$AOS" graph displays --json 2>/dev/null || echo '{"displays":[]}')"
  geometry="$(compute_geometry "$display_json")"
  frame="$(echo "$geometry" | head -1)"
  avatar_home="$(echo "$geometry" | tail -1)"

  "$AOS" show create --id "$AVATAR_ID" \
    --url 'aos://sigil/renderer/index.html' --track union >/dev/null

  "$AOS" show create --id "$WORKBENCH_ID" \
    --at "$frame" --interactive --focus \
    --url 'aos://sigil/workbench/index.html' >/dev/null

  "$AOS" show wait --id "$AVATAR_ID" --js 'typeof window.liveJs === "object"' --timeout 5s >/dev/null \
    || { echo "Avatar canvas did not finish mounting." >&2; return 1; }
  "$AOS" show wait --id "$WORKBENCH_ID" --js '!!document.querySelector(".surface-frame")' --timeout 5s >/dev/null \
    || { echo "Workbench canvas did not finish mounting." >&2; return 1; }
  stage_avatar "$avatar_home"
  bootstrap_tabs

  echo "Sigil workbench launched."
  echo "  avatar:    $AVATAR_ID"
  echo "  workbench: $WORKBENCH_ID ($frame)"
}

main "$@"

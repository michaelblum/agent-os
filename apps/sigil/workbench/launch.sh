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

ensure_daemon() {
  if "$AOS" show list --json >/dev/null 2>&1; then return 0; fi
  "$AOS" service start --mode "$MODE" >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do
    "$AOS" show list --json >/dev/null 2>&1 && return 0
    sleep 0.2
  done
  echo "Failed to reach the AOS daemon." >&2
  return 1
}

ensure_content_roots() {
  "$AOS" set content.roots.toolkit packages/toolkit >/dev/null
  "$AOS" set content.roots.sigil apps/sigil >/dev/null
}

content_roots_live() {
  "$AOS" content status --json 2>/dev/null | python3 -c '
import json, sys
try:
    payload = json.load(sys.stdin)
except Exception:
    raise SystemExit(1)
port = int(payload.get("port") or 0)
roots = payload.get("roots") or {}
raise SystemExit(0 if port > 0 and "toolkit" in roots and "sigil" in roots else 1)
'
}

wait_canvas_js() {
  local canvas_id="$1"
  local js_condition="$2"
  local deadline="${3:-50}"
  for _ in $(seq 1 "$deadline"); do
    local ready_json
    ready_json="$("$AOS" show eval --id "$canvas_id" --js "(function(){ return (${js_condition}) ? 'ready' : 'wait' })()" 2>/dev/null || true)"
    if printf '%s' "$ready_json" | python3 -c '
import json, sys
try:
    payload = json.load(sys.stdin)
except Exception:
    raise SystemExit(1)
raise SystemExit(0 if payload.get("result") == "ready" else 1)
' 2>/dev/null; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

# Encode a JSON string as base64 (for headsup.receive delivery).
b64msg() { python3 -c "import base64,sys; print(base64.b64encode(sys.stdin.buffer.read()).decode())"; }

# Eval a base64-encoded message inside a canvas ($2 must be base64 — safe to
# embed in double quotes since the charset is [A-Za-z0-9+/=]).
canvas_send() { "$AOS" show eval --id "$1" --js "window.headsup && window.headsup.receive && window.headsup.receive(\"$2\")" >/dev/null; }

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

b = main["bounds"]
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
  local canvases_json displays_json
  canvases_json="$("$AOS" show list --json 2>/dev/null || echo '{"canvases":[]}')"
  displays_json="$("$AOS" graph displays --json 2>/dev/null || echo '{"displays":[]}')"

  local b64
  b64="$(CANVASES="$canvases_json" DISPLAYS="$displays_json" python3 <<'PY'
import base64, json, os
canvases = json.loads(os.environ["CANVASES"]).get("canvases", [])
raw = json.loads(os.environ["DISPLAYS"])
displays = raw.get("displays", raw) if isinstance(raw, dict) else raw
msg = {"type": "canvas-inspector/bootstrap", "payload": {"canvases": canvases, "displays": displays}}
print(base64.b64encode(json.dumps(msg).encode()).decode())
PY
)"
  canvas_send "$WORKBENCH_ID" "$b64"

  b64="$(printf '{"type":"log/append","payload":{"level":"info","text":"Workbench ready."}}' | b64msg)"
  canvas_send "$WORKBENCH_ID" "$b64"
}

# --- main -------------------------------------------------------------------

main() {
  ensure_content_roots
  ensure_daemon
  if ! content_roots_live; then
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

  wait_canvas_js "$AVATAR_ID" 'window.headsup && typeof window.headsup.receive === "function" && typeof window.liveJs === "object"' \
    || { echo "Avatar canvas did not finish mounting." >&2; return 1; }
  wait_canvas_js "$WORKBENCH_ID" 'window.headsup && typeof window.headsup.receive === "function" && !!document.querySelector(".surface-frame")' \
    || { echo "Workbench canvas did not finish mounting." >&2; return 1; }
  stage_avatar "$avatar_home"
  bootstrap_tabs

  echo "Sigil workbench launched."
  echo "  avatar:    $AVATAR_ID"
  echo "  workbench: $WORKBENCH_ID ($frame)"
}

main "$@"

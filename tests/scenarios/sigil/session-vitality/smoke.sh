#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/../../../lib/visual-harness.sh"

AVATAR_ID="${AOS_SIGIL_AVATAR_ID:-sigil-session-vitality-avatar}"
LAB_ID="${AOS_SIGIL_VITALITY_LAB_ID:-sigil-session-vitality-lab}"
INSPECTOR_ID="${AOS_SIGIL_INSPECTOR_ID:-sigil-session-vitality-inspector}"
HIT_ID="sigil-hit-$AVATAR_ID"
RADIAL_ID="sigil-radial-menu-$AVATAR_ID"
RENDERER_URL="${AOS_SIGIL_RENDERER_URL:-aos://sigil/renderer/index.html}"
LAB_URL="${AOS_SIGIL_VITALITY_LAB_URL:-aos://sigil/tests/session-vitality/index.html?target=$AVATAR_ID}"

aos_bin="$(aos_visual_aos)"

config_get_string() {
  "$aos_bin" config get "$1" --json 2>/dev/null | python3 -c '
import json
import sys
try:
    value = json.load(sys.stdin)
except Exception:
    value = ""
print("" if value is None else str(value))
' 2>/dev/null || true
}

OLD_TOOLKIT_ROOT="$(config_get_string content.roots.toolkit)"
OLD_SIGIL_ROOT="$(config_get_string content.roots.sigil)"

restore_roots() {
  if [[ -n "$OLD_TOOLKIT_ROOT" ]]; then
    "$aos_bin" set content.roots.toolkit "$OLD_TOOLKIT_ROOT" >/dev/null 2>&1 || true
  fi
  if [[ -n "$OLD_SIGIL_ROOT" ]]; then
    "$aos_bin" set content.roots.sigil "$OLD_SIGIL_ROOT" >/dev/null 2>&1 || true
  fi
}

cleanup() {
  aos_visual_remove_canvas "$LAB_ID"
  aos_visual_remove_canvas "$RADIAL_ID"
  aos_visual_remove_canvas "$HIT_ID"
  aos_visual_remove_canvas "$AVATAR_ID"
  aos_visual_remove_canvas "$INSPECTOR_ID"
  restore_roots
}
trap cleanup EXIT

echo "INFO: launching Sigil session vitality lab smoke with active repo daemon."
"$aos_bin" ready >/dev/null
aos_visual_prepare_live_roots
aos_visual_seed_sigil repo

aos_visual_remove_canvas "$LAB_ID"
aos_visual_remove_canvas "$RADIAL_ID"
aos_visual_remove_canvas "$HIT_ID"
aos_visual_remove_canvas "$AVATAR_ID"
aos_visual_remove_canvas "$INSPECTOR_ID"

aos_visual_launch_canvas_inspector "$INSPECTOR_ID"
if [[ "$RENDERER_URL" == "aos://sigil/renderer/index.html" ]]; then
  aos_visual_launch_sigil_avatar "$AVATAR_ID"
else
  "$aos_bin" show create \
    --id "$AVATAR_ID" \
    --url "$RENDERER_URL" \
    --track union >/dev/null
fi
aos_visual_wait_sigil_avatar_ready "$AVATAR_ID"
aos_visual_show_sigil_avatar "$AVATAR_ID"
aos_visual_place_sigil_avatar_for_manual_test "$AVATAR_ID"
aos_visual_avoid_sigil_avatar_overlap "$AVATAR_ID" "$INSPECTOR_ID"

"$aos_bin" show create \
  --id "$LAB_ID" \
  --url "$LAB_URL" \
  --at 80,80,760,720 \
  --interactive \
  --focus >/dev/null

"$aos_bin" show wait \
  --id "$LAB_ID" \
  --js '!!window.__sessionVitalityLab && window.headsup?.manifest?.name === "sigil-session-vitality-lab"' \
  --timeout 8s >/dev/null

"$aos_bin" show eval \
  --id "$LAB_ID" \
  --js 'window.__sessionVitalityLab.setPreset("near-full"); window.__sessionVitalityLab.applyTelemetry(); "ok"' >/dev/null

sleep 0.5

snapshot="$("$aos_bin" show eval --id "$AVATAR_ID" --js 'JSON.stringify(window.__sigilDebug.snapshot().sessionVitality?.factors || null)')"
python3 - "$snapshot" <<'PY'
import json
import sys

outer = json.loads(sys.argv[1])
factors = json.loads(outer.get("result") or "null")
if not isinstance(factors, dict):
    print("FAIL: no session vitality factors returned", file=sys.stderr)
    raise SystemExit(1)

pressure = factors.get("pressure")
aura = factors.get("auraReachMultiplier")
rotation = factors.get("rotationMultiplier")
if not (isinstance(pressure, (int, float)) and pressure >= 0.94):
    print(f"FAIL: expected pressure >= 0.94, got {pressure!r}", file=sys.stderr)
    raise SystemExit(1)
if not (isinstance(aura, (int, float)) and aura < 0.5):
    print(f"FAIL: expected compressed aura reach, got {aura!r}", file=sys.stderr)
    raise SystemExit(1)
if not (isinstance(rotation, (int, float)) and rotation < 0.35):
    print(f"FAIL: expected slowed rotation, got {rotation!r}", file=sys.stderr)
    raise SystemExit(1)

print(json.dumps({
    "pressure": pressure,
    "auraReachMultiplier": aura,
    "rotationMultiplier": rotation,
}, sort_keys=True))
PY

echo "PASS: session vitality lab delivered synthetic pressure to Sigil avatar."

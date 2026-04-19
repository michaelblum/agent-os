#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-sigil-union-stage-frame"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

if ! python3 - <<'PY'
import json, subprocess
perms = json.loads(subprocess.check_output(["./aos", "permissions", "check", "--json"], text=True)).get("permissions", {})
if not perms.get("screen_recording"):
    raise SystemExit(1)
raise SystemExit(0)
PY
then
  echo "SKIP: requires screen recording"
  exit 0
fi

./aos permissions setup --once >/dev/null

./aos set content.roots.sigil apps/sigil >/dev/null
./aos set status_item.enabled true >/dev/null
./aos set status_item.toggle_id sigil-status-demo >/dev/null
./aos set status_item.toggle_url 'aos://sigil/renderer/index.html' >/dev/null
./aos set status_item.toggle_track union >/dev/null

aos_test_start_daemon "$ROOT" sigil apps/sigil \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

./aos show wait \
  --id sigil-status-demo \
  --js 'window.__sigilStage && window.liveJs && window.liveJs.avatarId === "default" && window.liveJs.avatarPos && window.liveJs.avatarPos.valid === true && Array.isArray(window.liveJs.displays) && window.liveJs.displays.length > 0 && !!window.headsup && window.__sigilBootError == null' \
  --timeout 10s >/dev/null

python3 - <<'PY'
import json, subprocess

def run(*args):
    return subprocess.check_output(["./aos", *args], text=True)

union = [round(float(v)) for v in run("runtime", "display-union").strip().split(",")]
show = json.loads(run("show", "list", "--json"))
canvas = next((c for c in show.get("canvases", []) if c.get("id") == "sigil-status-demo"), None)
if canvas is None:
    raise SystemExit("FAIL: sigil-status-demo canvas missing from show list")
at = [round(float(v)) for v in canvas["at"]]

capture = json.loads(run("see", "capture", "--canvas", "sigil-status-demo", "--perception"))
surface = next((s for s in capture.get("surfaces", []) if s.get("id") == "sigil-status-demo"), None)
if surface is None:
    raise SystemExit("FAIL: sigil-status-demo missing from see capture surfaces")
bounds = surface["bounds_global"]
captured = [
    round(float(bounds["x"])),
    round(float(bounds["y"])),
    round(float(bounds["width"])),
    round(float(bounds["height"])),
]

if at != union:
    raise SystemExit(f"FAIL: show list frame {at} != display union {union}")
if captured != union:
    raise SystemExit(f"FAIL: captured frame {captured} != display union {union}")

print("PASS")
PY

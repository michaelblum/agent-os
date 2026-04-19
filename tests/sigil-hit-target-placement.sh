#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-sigil-hit-target-placement"
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
raise SystemExit(0 if perms.get("screen_recording") else 1)
PY
then
  echo "SKIP: requires screen recording"
  exit 0
fi

./aos permissions setup --once >/dev/null
AOS_BIN="$(pwd)/aos" AOS_RUNTIME_MODE=repo apps/sigil/sigilctl-seed.sh >/dev/null

aos_test_start_daemon "$ROOT" sigil apps/sigil \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

./aos show create \
  --id avatar-main \
  --url 'aos://sigil/renderer/index.html?visible=1' \
  --track union >/dev/null

./aos show wait \
  --id avatar-main \
  --js 'window.liveJs && window.liveJs.visible === true && window.liveJs.avatarPos && window.liveJs.avatarPos.valid === true && window.__sigilHitDebug && window.__sigilHitDebug.ready === true' \
  --timeout 10s >/dev/null

python3 - <<'PY'
import json, math, subprocess, time

def run(*args):
    return subprocess.check_output(["./aos", *args], text=True)

def show_eval_json(js):
    payload = json.loads(run("show", "eval", "--id", "avatar-main", "--js", js))
    assert payload["status"] == "success", payload
    return json.loads(payload["result"])

deadline = time.time() + 5
snapshot = None
while time.time() < deadline:
    snapshot = show_eval_json("JSON.stringify({avatarPos: window.liveJs.avatarPos, hit: window.__sigilHitDebug, visible: window.liveJs.visible})")
    if snapshot["visible"] and snapshot["hit"] and snapshot["hit"]["ready"]:
        break
    time.sleep(0.1)
else:
    raise SystemExit(f"FAIL: avatar/hit target not ready: {snapshot}")

show = json.loads(run("show", "list", "--json"))
avatar_canvas = next((c for c in show.get("canvases", []) if c.get("id") == "avatar-main"), None)
if avatar_canvas is None:
    raise SystemExit("FAIL: avatar-main missing from show list")

hit_id = snapshot["hit"]["id"]
capture = json.loads(run("see", "capture", "--canvas", hit_id, "--perception"))
surface = next((s for s in capture.get("surfaces", []) if s.get("id") == hit_id), None)
if surface is None:
    raise SystemExit(f"FAIL: {hit_id} missing from see capture surfaces")

bounds = surface["bounds_global"]
actual = [
    float(bounds["x"]),
    float(bounds["y"]),
    float(bounds["width"]),
    float(bounds["height"]),
]

avatar_at = avatar_canvas["at"]
avatar_pos = snapshot["avatarPos"]
hit_size = float(snapshot["hit"]["size"])
expected = [
    float(avatar_at[0]) + float(avatar_pos["x"]) - (hit_size / 2.0),
    float(avatar_at[1]) + float(avatar_pos["y"]) - (hit_size / 2.0),
    hit_size,
    hit_size,
]

tolerance = 2.0
for idx, (exp, got) in enumerate(zip(expected, actual)):
    if abs(exp - got) > tolerance:
        raise SystemExit(f"FAIL: hit target capture mismatch idx={idx} expected={expected} actual={actual}")

print("PASS")
PY

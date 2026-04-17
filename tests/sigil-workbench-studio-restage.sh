#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-sigil-workbench-restage"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

aos_test_start_daemon "$ROOT" toolkit packages/toolkit sigil apps/sigil \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

AOS_BIN="$(pwd)/aos" AOS_RUNTIME_MODE=repo apps/sigil/sigilctl-seed.sh >/dev/null

./aos show create \
  --id avatar-main \
  --url 'aos://sigil/renderer/index.html' \
  --track union >/dev/null

./aos show create \
  --id sigil-workbench \
  --at 180,120,980,720 \
  --interactive \
  --url 'aos://sigil/workbench/index.html' >/dev/null

./aos show wait \
  --id avatar-main \
  --js 'window.liveJs && window.liveJs.currentAgentId === "default" && window.liveJs.avatarPos && window.liveJs.avatarPos.valid === true && Array.isArray(window.liveJs.displays) && window.liveJs.displays.length > 0 && window.__sigilBootError == null' \
  --timeout 10s >/dev/null

./aos show wait \
  --id sigil-workbench \
  --js 'window.__sigilWorkbenchState && window.__sigilWorkbenchState.activationCount === 1 && window.__sigilWorkbenchState.lastActivation && window.__sigilWorkbenchState.lastActivation.title === "Studio" && Array.isArray(window.__sigilWorkbenchState.displays) && window.__sigilWorkbenchState.displays.length > 0' \
  --timeout 10s >/dev/null

./aos show eval --id sigil-workbench --js '
(() => {
  const btn = [...document.querySelectorAll(".aos-tab")].find((el) => el.textContent === "Chat")
  if (!btn) throw new Error("missing Chat tab")
  btn.click()
  return "ok"
})()
' >/dev/null

./aos show wait \
  --id sigil-workbench \
  --js 'window.__sigilWorkbenchState && window.__sigilWorkbenchState.activationCount === 2 && window.__sigilWorkbenchState.lastActivation && window.__sigilWorkbenchState.lastActivation.title === "Chat"' \
  --timeout 5s >/dev/null

./aos show eval --id avatar-main --js '
(() => {
  const p = { x: 480, y: 420, valid: true }
  liveJs.travel = null
  liveJs.avatarPos = p
  liveJs.currentCursor = p
  liveJs.cursorTarget = p
  if (typeof postLastPositionToDaemon === "function") postLastPositionToDaemon()
  return JSON.stringify(p)
})()
' >/dev/null

./aos show eval --id sigil-workbench --js '
(() => {
  const btn = [...document.querySelectorAll(".aos-tab")].find((el) => el.textContent === "Studio")
  if (!btn) throw new Error("missing Studio tab")
  btn.click()
  return "ok"
})()
' >/dev/null

./aos show wait \
  --id sigil-workbench \
  --js 'window.__sigilWorkbenchState && window.__sigilWorkbenchState.activationCount === 3 && window.__sigilWorkbenchState.lastActivation && window.__sigilWorkbenchState.lastActivation.title === "Studio" && window.__sigilWorkbenchState.lastStage && window.__sigilWorkbenchState.lastStage.status === "ok"' \
  --timeout 5s >/dev/null

python3 - <<'PY'
import json
import math
import subprocess
import time


def run(*args):
    return subprocess.check_output(["./aos", *args], text=True)


def eval_json(canvas_id, js):
    payload = json.loads(run("show", "eval", "--id", canvas_id, "--js", js))
    return json.loads(payload["result"])


deadline = time.time() + 3.0
last_avatar = None
last_stage = None
while time.time() < deadline:
    workbench = eval_json("sigil-workbench", "JSON.stringify(window.__sigilWorkbenchState)")
    avatar = eval_json("avatar-main", "JSON.stringify(window.liveJs.avatarPos)")
    last_avatar = avatar
    last_stage = workbench.get("lastStage")
    target = (last_stage or {}).get("target")
    if target and math.isclose(avatar["x"], target["x"], abs_tol=1e-6) and math.isclose(avatar["y"], target["y"], abs_tol=1e-6):
        print("PASS")
        raise SystemExit(0)
    time.sleep(0.1)

raise SystemExit(f"FAIL: avatar did not restage to Studio target: avatar={last_avatar} lastStage={last_stage}")
PY

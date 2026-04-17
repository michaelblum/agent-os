#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-panel-tabs-activation"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

./aos set content.roots.toolkit packages/toolkit >/dev/null
./aos serve --idle-timeout none >"$ROOT/daemon.stdout" 2>"$ROOT/daemon.stderr" &
aos_test_wait_for_socket "$ROOT" || { echo "FAIL: isolated daemon socket did not become reachable"; exit 1; }
./aos content wait --root toolkit --timeout 10s >/dev/null

CANVAS_ID="tabs-activation-smoke"

./aos show create \
  --id "$CANVAS_ID" \
  --at 160,120,420,260 \
  --interactive \
  --url 'aos://toolkit/panel/_smoke/tabs.html' >/dev/null

./aos show wait \
  --id "$CANVAS_ID" \
  --js 'window.__tabsSmokeState && window.__tabsSmokeState.title === "Alpha" && window.__tabsSmokeState.count === 1' \
  --timeout 5s >/dev/null

./aos show eval --id "$CANVAS_ID" --js '
(() => {
  const btn = [...document.querySelectorAll(".aos-tab")].find((el) => el.textContent === "Beta")
  if (!btn) throw new Error("missing Beta tab")
  btn.click()
  return "ok"
})()
' >/dev/null

./aos show wait \
  --id "$CANVAS_ID" \
  --js 'window.__tabsSmokeState && window.__tabsSmokeState.title === "Beta" && window.__tabsSmokeState.count === 2 && document.body.dataset.activeTab === "Beta" && [...document.querySelectorAll(".aos-tab")].find((el) => el.dataset.active === "true")?.textContent === "Beta"' \
  --timeout 5s >/dev/null

./aos show eval --id "$CANVAS_ID" --js '
(() => {
  const btn = [...document.querySelectorAll(".aos-tab")].find((el) => el.textContent === "Beta")
  if (!btn) throw new Error("missing Beta tab")
  btn.click()
  return "ok"
})()
' >/dev/null

python3 - "$CANVAS_ID" <<'PY'
import json, subprocess, sys, time

canvas_id = sys.argv[1]
deadline = time.time() + 3
last_state = None
while time.time() < deadline:
    payload = json.loads(subprocess.check_output([
        "./aos", "show", "eval", "--id", canvas_id, "--js",
        'JSON.stringify(window.__tabsSmokeState)'
    ], text=True))
    last_state = json.loads(payload["result"])
    if last_state["title"] == "Beta" and last_state["count"] == 2:
        time.sleep(0.2)
        confirm = json.loads(subprocess.check_output([
            "./aos", "show", "eval", "--id", canvas_id, "--js",
            'JSON.stringify(window.__tabsSmokeState)'
        ], text=True))
        confirm_state = json.loads(confirm["result"])
        if confirm_state["title"] == "Beta" and confirm_state["count"] == 2:
            print("PASS")
            raise SystemExit(0)
    time.sleep(0.1)

raise SystemExit(f"FAIL: repeated active-tab click retriggered activation or lost state: {last_state}")
PY

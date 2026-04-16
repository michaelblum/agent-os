#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-lifecycle-complete-timeout"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

./aos set content.roots.toolkit packages/toolkit >/dev/null
./aos content wait --root toolkit --auto-start --timeout 10s >/dev/null

./aos show create \
  --id lifecycle-timeout-smoke \
  --at 80,80,320,220 \
  --url 'aos://toolkit/runtime/_smoke/lifecycle.html?resume_delay_ms=100&emit_resume_complete=0' >/dev/null

./aos show wait \
  --id lifecycle-timeout-smoke \
  --manifest runtime-lifecycle-smoke \
  --js 'document.body.dataset.ready === "1"' \
  --timeout 5s >/dev/null

./aos show eval --id lifecycle-timeout-smoke --js 'window.startResumeCycle(50)' >/dev/null

python3 - <<'PY'
import json
import subprocess
import time


def run(*args):
    return subprocess.check_output(args, text=True)


def canvas_info():
    payload = json.loads(run("./aos", "show", "list"))
    for canvas in payload.get("canvases", []):
        if canvas.get("id") == "lifecycle-timeout-smoke":
            return canvas
    raise SystemExit("FAIL: lifecycle-timeout-smoke canvas missing")


def smoke_state():
    payload = json.loads(
        run("./aos", "show", "eval", "--id", "lifecycle-timeout-smoke", "--js", "JSON.stringify(window.__smokeState)")
    )
    return json.loads(payload["result"])


deadline = time.time() + 1.0
while time.time() < deadline:
    if canvas_info().get("suspended") is True and smoke_state().get("resumeRequestedAt"):
        break
    time.sleep(0.05)
else:
    raise SystemExit("FAIL: canvas never entered suspended state with a resume request")

state = smoke_state()
resume_requested = state.get("resumeRequestedAt")
if not resume_requested:
    raise SystemExit(f"FAIL: missing resumeRequestedAt: {state}")

resumed_at = None
deadline = time.time() + 2.0
while time.time() < deadline:
    if canvas_info().get("suspended") is False:
        resumed_at = int(time.time() * 1000)
        break
    time.sleep(0.05)
else:
    raise SystemExit("FAIL: canvas did not resume after timeout fallback")

delay = resumed_at - resume_requested
if delay < 900:
    raise SystemExit(f"FAIL: canvas resumed too early without lifecycle.complete ({delay}ms)")
if delay > 1700:
    raise SystemExit(f"FAIL: canvas resumed too late after timeout fallback ({delay}ms)")

print("PASS")
PY

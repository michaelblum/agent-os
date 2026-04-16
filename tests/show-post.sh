#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-show-post"
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

./aos show create \
  --id post-smoke \
  --at 40,40,320,220 \
  --interactive \
  --url 'aos://toolkit/runtime/_smoke/index.html' >/dev/null

./aos show wait \
  --id post-smoke \
  --manifest runtime-smoke \
  --js 'document.body.textContent.includes("subscribed to display_geometry")' \
  --timeout 5s >/dev/null

./aos show post --id post-smoke --event '{"type":"ping","payload":{"n":42}}' >/dev/null

python3 - <<'PY'
import json, subprocess, time

for _ in range(30):
    payload = json.loads(subprocess.check_output([
        "./aos", "show", "eval", "--id", "post-smoke", "--js",
        'document.body.textContent.replace(/\\s+/g," ").trim()'
    ], text=True))
    text = payload.get("result") or ""
    if '"type":"ping"' in text or '"type": "ping"' in text:
        print("PASS")
        raise SystemExit(0)
    time.sleep(0.1)

print("FAIL: show post did not reach the canvas bridge", flush=True)
raise SystemExit(1)
PY

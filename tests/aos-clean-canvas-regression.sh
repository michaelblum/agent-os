#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

source tests/lib/isolated-daemon.sh

PREFIX="aos-clean-canvas-regression"
aos_test_cleanup_prefix "$PREFIX"

STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$STATE_ROOT"
export AOS_RUNTIME_MODE=repo

cleanup() {
  aos_test_kill_root "$STATE_ROOT"
  rm -rf "$STATE_ROOT"
}
trap cleanup EXIT

aos_test_start_daemon "$STATE_ROOT" repo "$ROOT_DIR" toolkit "$ROOT_DIR/packages/toolkit" \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

./aos show create \
  --id clean-regression-canvas \
  --at 80,80,240,120 \
  --html '<html><body>clean regression</body></html>' \
  >/dev/null

DRY_RUN="$(./aos clean --dry-run --json)"
DRY_RUN="$DRY_RUN" python3 - <<'PY'
import json, os

payload = json.loads(os.environ["DRY_RUN"])
assert payload["status"] == "dirty", payload
assert any(canvas.get("id") == "clean-regression-canvas" for canvas in payload.get("canvases", [])), payload
PY

CLEANED="$(./aos clean --json)"
CLEANED="$CLEANED" python3 - <<'PY'
import json, os

payload = json.loads(os.environ["CLEANED"])
assert payload["status"] in {"clean", "cleaned"}, payload
assert not payload.get("canvases"), payload
assert any("removed canvas id=clean-regression-canvas" in action for action in payload.get("actions_taken", [])), payload
PY

mkdir -p "$STATE_ROOT/installed"
cat >"$STATE_ROOT/installed/daemon.lock" <<'JSON'
{"pid":999999,"mode":"installed","socket_path":"/tmp/aos-missing.sock"}
JSON

LOCK_DRY_RUN="$(./aos clean --dry-run --json)"
LOCK_DRY_RUN="$LOCK_DRY_RUN" python3 - <<'PY'
import json, os

payload = json.loads(os.environ["LOCK_DRY_RUN"])
assert payload["status"] == "dirty", payload
assert any(lock.get("mode") == "installed" and lock.get("pid") == 999999 for lock in payload.get("stale_locks", [])), payload
PY

./aos clean --json >/dev/null
test ! -e "$STATE_ROOT/installed/daemon.lock"

echo "PASS"

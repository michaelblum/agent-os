#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-graph-visible-bounds"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

./aos serve --idle-timeout none >"$ROOT/daemon.stdout" 2>"$ROOT/daemon.stderr" &
aos_test_wait_for_socket "$ROOT" || { echo "FAIL: isolated daemon socket did not become reachable"; exit 1; }

python3 - <<'PY'
import json
import subprocess

payload = json.loads(subprocess.check_output(["./aos", "graph", "displays", "--json"], text=True))
displays = payload.get("displays") or []
if not displays:
    raise SystemExit("FAIL: no displays returned")

for display in displays:
    if "visible_bounds" not in display:
        raise SystemExit(f"FAIL: display missing visible_bounds: {display}")
    vb = display["visible_bounds"]
    required = {"x", "y", "w", "h"}
    if set(vb.keys()) != required:
        raise SystemExit(f"FAIL: visible_bounds shape mismatch: {display}")
    if vb["w"] <= 0 or vb["h"] <= 0:
        raise SystemExit(f"FAIL: visible_bounds must be positive: {display}")

print("PASS")
PY

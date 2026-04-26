#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

PREFIX="aos-ready-ownership-mismatch"
STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$STATE_ROOT"
export AOS_BYPASS_PERMISSIONS_SETUP=1
export AOS_TEST_SKIP_READY_SERVICE_START=1

SOCK="$STATE_ROOT/repo/sock"
LOCK="$STATE_ROOT/repo/daemon.lock"
mkdir -p "$(dirname "$SOCK")"

cleanup() {
  if [[ -n "${MOCK_PID:-}" ]] && kill -0 "$MOCK_PID" 2>/dev/null; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
  fi
  rm -rf "$STATE_ROOT"
}
trap cleanup EXIT

python3 tests/lib/mock-daemon.py \
    --socket "$SOCK" \
    --tap-status active \
    --listen-access true \
    --post-access true \
    --accessibility true \
    >"$STATE_ROOT/mock.stdout" 2>"$STATE_ROOT/mock.stderr" &
MOCK_PID=$!

for _ in $(seq 1 20); do
  if [[ -S "$SOCK" ]]; then break; fi
  sleep 0.1
done
if ! [[ -S "$SOCK" ]]; then
  echo "FAIL: mock daemon did not bind socket $SOCK"
  exit 1
fi

python3 - "$LOCK" <<'PY'
import json
import pathlib
import sys

lock = pathlib.Path(sys.argv[1])
lock.write_text(json.dumps({"pid": 99999}), encoding="utf-8")
PY

set +e
OUT="$(./aos ready --json)"
RC=$?
set -e

echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
runtime = d.get("runtime", {})
blockers = d.get("blockers", [])
ids = {b.get("id") for b in blockers}

assert d.get("ready") is False, d
assert d.get("status") == "degraded", d
assert d.get("phase") == "runtime_blocked", d
assert d.get("diagnosis") == "daemon_ownership_mismatch", d
assert runtime.get("socket_reachable") is True, runtime
assert runtime.get("ownership_state") == "mismatch", runtime
assert runtime.get("lock_owner_pid") == 99999, runtime
assert "daemon_ownership_mismatch" in ids, blockers

ownership = next(b for b in blockers if b.get("id") == "daemon_ownership_mismatch")
assert set(ownership.get("blocks", [])) == {"see", "do", "show", "tell", "listen"}, ownership
assert any(
    a.get("command", "").endswith("ready --repair")
    for a in d.get("next_actions", [])
), d.get("next_actions", [])
'

if [[ "$RC" -eq 0 ]]; then
  echo "FAIL: ready exited 0 despite daemon ownership mismatch"
  exit 1
fi

echo "PASS"

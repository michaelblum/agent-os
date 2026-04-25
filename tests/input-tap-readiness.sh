#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

# Spin up the mock under an isolated AOS_STATE_ROOT so this test never touches
# the developer's real daemon.
PREFIX="aos-input-tap-readiness"
STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$STATE_ROOT"
SOCK="$STATE_ROOT/repo/sock"
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
    --tap-status retrying \
    --listen-access false \
    --post-access false \
    --attempts 3 \
    --accessibility true \
    >"$STATE_ROOT/mock.stdout" 2>"$STATE_ROOT/mock.stderr" &
MOCK_PID=$!

# Wait for the mock to bind.
for _ in $(seq 1 20); do
  if [[ -S "$SOCK" ]]; then break; fi
  sleep 0.1
done
if ! [[ -S "$SOCK" ]]; then
  echo "FAIL: mock daemon did not bind socket $SOCK"
  exit 1
fi

# permissions check should report ready_for_testing=false sourced from the daemon view.
OUT="$(./aos permissions check --json)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") == "degraded", f"status: {d}"
dv = d.get("daemon_view", {})
assert dv.get("reachable") is True, f"daemon_view.reachable: {d}"
tap = dv.get("input_tap", {})
assert tap.get("status") == "retrying", f"daemon_view.input_tap.status: {d}"
assert tap.get("listen_access") is False, f"daemon_view.input_tap.listen_access: {d}"
assert tap.get("post_access") is False, f"daemon_view.input_tap.post_access: {d}"
assert d.get("ready_for_testing") is False, f"ready_for_testing: {d}"
assert d.get("ready_source") == "daemon", f"ready_source: {d}"

# Recovery notes must mention the inactive-tap headline + restart command.
notes = d.get("notes", [])
joined = "\n".join(notes)
assert "Input tap is not active" in joined, f"missing tap headline: {notes}"
assert "./aos service restart" in joined, f"missing restart suggestion: {notes}"
'
echo "PASS: permissions check (degraded tap)"

echo "PASS"

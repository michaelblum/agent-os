#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

PREFIX="aos-show-command-preflight"
STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$STATE_ROOT"
SOCK="$STATE_ROOT/repo/sock"
REQUEST_LOG="$STATE_ROOT/requests.log"
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
    --request-log "$REQUEST_LOG" \
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

run_against_limited_mock() {
  local label="$1"
  shift
  set +e
  "$@" >/dev/null 2>"$STATE_ROOT/${label}.stderr"
  set -e
}

run_against_limited_mock "post" ./aos show post --id demo --event '{"type":"test"}'
run_against_limited_mock "to-front" ./aos show to-front --id demo
run_against_limited_mock "wait" ./aos show wait --id demo --timeout 0.001s --auto-start --json
run_against_limited_mock "ping" ./aos show ping

python3 - "$REQUEST_LOG" <<'PY'
import sys
from pathlib import Path

lines = Path(sys.argv[1]).read_text().splitlines()
expected = [
    ("system.preflight aos show post", "show.post"),
    ("system.preflight aos show to-front", "show.to_front"),
    ("system.preflight aos show wait", "show.eval"),
    ("system.preflight aos show ping", "show.ping"),
]
cursor = 0
for preflight, action in expected:
    try:
        preflight_index = lines.index(preflight, cursor)
        action_index = lines.index(action, preflight_index + 1)
    except ValueError as exc:
        raise SystemExit(f"FAIL: missing ordered requests {preflight!r} then {action!r}; got {lines}") from exc
    if preflight_index >= action_index:
        raise SystemExit(f"FAIL: preflight did not precede action; got {lines}")
    cursor = action_index + 1
PY

echo "PASS: show commands preflight projection.canvas before IPC"
echo "PASS"

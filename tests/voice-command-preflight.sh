#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

PREFIX="aos-voice-command-preflight"
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

run_against_limited_mock "list" ./aos voice list --provider mock
run_against_limited_mock "assignments" ./aos voice assignments
run_against_limited_mock "refresh" ./aos voice refresh
run_against_limited_mock "providers" ./aos voice providers
run_against_limited_mock "bind" ./aos voice bind --session-id session-1 --voice voice://mock/mock-alpha
run_against_limited_mock "next" ./aos voice next --session-id session-1
printf '{}' | run_against_limited_mock "final-response" ./aos voice final-response --harness codex

python3 - "$REQUEST_LOG" <<'PY'
import sys
from pathlib import Path

lines = Path(sys.argv[1]).read_text().splitlines()
expected = [
    ("system.preflight aos voice list", "voice.list"),
    ("system.preflight aos voice assignments", "voice.assignments"),
    ("system.preflight aos voice refresh", "voice.refresh"),
    ("system.preflight aos voice providers", "voice.providers"),
    ("system.preflight aos voice bind", "voice.bind"),
    ("system.preflight aos voice next", "voice.next"),
    ("system.preflight aos voice final-response", "voice.final_response"),
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

echo "PASS: voice commands preflight runtime.daemon before IPC"
echo "PASS"

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

PREFIX="aos-see-observe-preflight"
STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$STATE_ROOT"
SOCK="$STATE_ROOT/repo/sock"
mkdir -p "$(dirname "$SOCK")"

export AOS_BYPASS_PERMISSIONS_SETUP=1

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
    --accessibility false \
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

set +e
OUT="$(./aos see observe --depth 1 2>&1)"
RC=$?
set -e
if [ "$RC" -eq 0 ]; then
  echo "FAIL: see observe unexpectedly exited 0 against missing daemon Accessibility: $OUT"
  exit 1
fi

echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("code") == "CAPABILITY_PREFLIGHT_FAILED", d
preflight = d.get("preflight", {})
assert preflight.get("repair_attempted") is False, preflight
assert preflight.get("blocked_capabilities") == ["perception.ax"], preflight
blockers = preflight.get("blockers", [])
assert blockers and blockers[0].get("id") == "accessibility", blockers
assert blockers[0].get("source") == "daemon", blockers
assert preflight.get("command") == "aos see observe", preflight
'
echo "PASS: see observe exits with CAPABILITY_PREFLIGHT_FAILED"

echo "PASS"

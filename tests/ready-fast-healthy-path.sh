#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

PREFIX="aos-ready-fast-healthy-path"
STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$STATE_ROOT"
export AOS_TEST_ASSUME_PERMISSIONS_GRANTED=1

SOCK="$STATE_ROOT/repo/sock"
MARKER="$STATE_ROOT/repo/permissions-onboarding.json"
mkdir -p "$(dirname "$SOCK")"

cleanup() {
  if [[ -n "${MOCK_PID:-}" ]] && kill -0 "$MOCK_PID" 2>/dev/null; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
  fi
  rm -rf "$STATE_ROOT"
}
trap cleanup EXIT

python3 - "$MARKER" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
path.write_text(json.dumps({"completed_at": "2026-05-25T00:00:00Z"}), encoding="utf-8")
PY

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

OUT="$(./aos ready --json)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
trace = d.get("action_trace", [])
steps = [s.get("step") for s in trace]

assert d.get("ready") is True, d
assert d.get("status") == "ok", d
assert d.get("phase") == "ready", d
assert d.get("diagnosis") == "ready", d
assert d.get("startup", {}).get("attempted") is False, d.get("startup")
assert d.get("startup", {}).get("status") == "skipped", d.get("startup")
assert "ready_preflight" in steps, trace
assert "service_start" not in steps, trace
assert "service_restart" not in steps, trace
runtime = d.get("runtime", {})
assert runtime.get("socket_reachable") is True, runtime
assert runtime.get("input_tap_status") == "active", runtime
assert runtime.get("ownership_state") in ("consistent", "unknown"), runtime
assert runtime.get("ownership_kind") in ("foreground_dev", "unknown"), runtime
tap = runtime.get("input_tap", {})
assert tap.get("owner_kind") in ("foreground_dev", "unknown"), tap
assert tap.get("duplicate_tcc_rows_observable") is False, tap
assert "unavailable" in tap.get("duplicate_tcc_rows_observability", ""), tap
'

echo "PASS"

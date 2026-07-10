#!/usr/bin/env bash
# Future acceptance test for private runtime/readiness broker primitives.
# This test intentionally requires a rebuilt native ./aos after the source route
# exists. Before a native build is available, validate this file with bash -n only.
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

PREFIX="aos-runtime-readiness-broker-primitives"
STATE_ROOT="$(mktemp -d "/tmp/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$STATE_ROOT"
export AOS_TEST_CLASSIFY_STATE_ROOT_AS_NORMAL=1
export AOS_TEST_IGNORE_LAUNCHD=1

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

start_mock() {
  local status="$1"
  local legacy="${2:-}"
  if [[ -n "$legacy" ]]; then
    python3 tests/lib/mock-daemon.py \
      --socket "$SOCK" \
      --tap-status "$status" \
      --listen-access false \
      --post-access true \
      --accessibility false \
      "$legacy" \
      >"$STATE_ROOT/mock.stdout" 2>"$STATE_ROOT/mock.stderr" &
  else
    python3 tests/lib/mock-daemon.py \
      --socket "$SOCK" \
      --tap-status "$status" \
      --listen-access false \
      --post-access true \
      --accessibility false \
      >"$STATE_ROOT/mock.stdout" 2>"$STATE_ROOT/mock.stderr" &
  fi
  MOCK_PID=$!

  for _ in $(seq 1 50); do
    if [[ -S "$SOCK" ]]; then return 0; fi
    if ! kill -0 "$MOCK_PID" 2>/dev/null; then
      echo "FAIL: mock daemon exited before binding $SOCK"
      cat "$STATE_ROOT/mock.stderr" 2>/dev/null || true
      exit 1
    fi
    sleep 0.1
  done
  echo "FAIL: mock daemon did not bind socket $SOCK"
  cat "$STATE_ROOT/mock.stderr" 2>/dev/null || true
  exit 1
}

stop_mock() {
  if [[ -n "${MOCK_PID:-}" ]] && kill -0 "$MOCK_PID" 2>/dev/null; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
  fi
  MOCK_PID=""
  rm -f "$SOCK"
}

start_mock retrying

HEALTH_JSON="$(./aos __daemon health --json)"
python3 - "$HEALTH_JSON" "$SOCK" <<'PY'
import json
import sys

d = json.loads(sys.argv[1])
sock = sys.argv[2]
assert d.get("mode") == "repo", d
assert d.get("socket_path") == sock, d
assert d.get("socket_exists") is True, d
assert d.get("reachable") is True, d
assert isinstance(d.get("pid"), int), d
assert d.get("uptime_seconds") == 1.0, d
tap = d.get("input_tap") or {}
assert tap.get("status") == "retrying", tap
assert tap.get("attempts") == 1, tap
assert tap.get("listen_access") is False, tap
assert tap.get("post_access") is True, tap
assert tap.get("last_error_at") == "2026-04-24T00:00:00Z", tap
assert d.get("permissions", {}).get("accessibility") is False, d
for policy_key in ("ready", "phase", "diagnosis", "blockers", "next_actions", "notes"):
    assert policy_key not in d, (policy_key, d)
PY
echo "PASS: __daemon health --json structured facts"

RUNTIME_JSON="$(./aos __runtime status-facts --json)"
python3 - "$RUNTIME_JSON" "$SOCK" <<'PY'
import json
import sys

d = json.loads(sys.argv[1])
sock = sys.argv[2]
assert d.get("mode") == "repo", d
assert d.get("socket_path") == sock, d
assert d.get("socket_exists") is True, d
assert d.get("socket_reachable") is True, d
assert d.get("other_mode_socket_reachable") is False, d
assert d.get("ownership_state") == "unmanaged", d
assert d.get("ownership_kind") == "unmanaged", d
assert d.get("owner_launchd_managed") is False, d
assert d.get("owner_pid") == d.get("serving_pid"), d
tap = d.get("input_tap") or {}
assert tap.get("status") == "retrying", tap
assert tap.get("listen_access") is False, tap
assert tap.get("post_access") is True, tap
for policy_key in ("ready", "phase", "diagnosis", "blockers", "next_actions", "notes"):
    assert policy_key not in d, (policy_key, d)
PY
echo "PASS: __runtime status-facts --json runtime facts"

stop_mock
start_mock active --legacy

LEGACY_HEALTH_JSON="$(./aos __daemon health --json)"
python3 - "$LEGACY_HEALTH_JSON" <<'PY'
import json
import sys

d = json.loads(sys.argv[1])
assert d.get("reachable") is True, d
tap = d.get("input_tap") or {}
assert tap.get("status") == "active", tap
assert tap.get("attempts") == 1, tap
assert "listen_access" not in tap, tap
assert "post_access" not in tap, tap
assert "last_error_at" not in tap, tap
assert d.get("permissions") == {}, d
PY
echo "PASS: __daemon health --json legacy absent-field preservation"

echo "PASS"

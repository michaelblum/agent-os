#!/usr/bin/env bash
# Verifies the parser fallback for legacy daemons: a daemon binary that
# predates the input-tap readiness contract emits only the flat
# `input_tap_status`/`input_tap_attempts` keys (no structured `input_tap` or
# `permissions` blocks). The CLI's parser must still classify status correctly
# so the readiness probe and do-family preflight work; field-by-field views
# (listen/post/accessibility) must propagate as "unknown" rather than be
# fabricated. See shared/schemas/CONTRACT-GOVERNANCE.md rule 4.
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

PREFIX="aos-readiness-legacy"
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

start_legacy_mock() {
  local status="$1"
  python3 tests/lib/mock-daemon.py \
      --socket "$SOCK" \
      --tap-status "$status" \
      --legacy \
      >"$STATE_ROOT/mock.stdout" 2>"$STATE_ROOT/mock.stderr" &
  MOCK_PID=$!
  for _ in $(seq 1 20); do
    if [[ -S "$SOCK" ]]; then return 0; fi
    sleep 0.1
  done
  echo "FAIL: mock did not bind"; exit 1
}

stop_mock() {
  if kill -0 "$MOCK_PID" 2>/dev/null; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
  fi
  rm -f "$SOCK"
}

# Case 1: legacy active tap -> readiness probe returns .ok.
# Before the parser fallback existed, parseDaemonHealthView returned nil for
# legacy payloads, which collapsed verifyServiceReadiness to .socketUnreachable
# even though the socket WAS reachable. Now status comes through; listen/post
# fields are absent (omitted via encodeIfPresent).
start_legacy_mock active
set +e
OUT="$(./aos service _verify-readiness --json --budget-ms 1000)"
RC=$?
set -e
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("input_tap", {}).get("status") == "active", d
assert "reason" not in d or d.get("reason") is None, d
tap = d.get("input_tap", {})
# Legacy daemon does not expose listen/post; these must be ABSENT, not false.
assert "listen_access" not in tap, f"listen_access leaked from legacy daemon: {tap}"
assert "post_access" not in tap, f"post_access leaked from legacy daemon: {tap}"
'
[ "$RC" -eq 0 ] || { echo "FAIL: legacy active case exit=$RC"; exit 1; }
echo "PASS: legacy active -> ok (tap status threaded, listen/post absent)"
stop_mock

# Case 2: legacy retrying tap -> readiness probe returns inputTapInactive.
start_legacy_mock retrying
set +e
OUT="$(./aos service _verify-readiness --json --budget-ms 1000)"
RC=$?
set -e
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") == "degraded", d
assert d.get("reason") == "input_tap_not_active", d
assert d.get("input_tap", {}).get("status") == "retrying", d
'
[ "$RC" -eq 1 ] || { echo "FAIL: legacy retrying case exit=$RC"; exit 1; }
echo "PASS: legacy retrying -> input_tap_not_active"
stop_mock

# Case 3: legacy daemon, permissions check should:
#   - report daemon_view.reachable=true
#   - report daemon_view.input_tap.status=active (parser threaded it)
#   - omit daemon_view.input_tap.listen_access / post_access (unknown)
#   - omit daemon_view.accessibility (unknown)
#   - fall back to ready_source="cli" for ready_for_testing
#   - emit no disagreement entries (legacy fields are not "comparable")
export AOS_BYPASS_PERMISSIONS_SETUP=1
start_legacy_mock active
OUT="$(./aos permissions check --json)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
dv = d.get("daemon_view", {})
assert dv.get("reachable") is True, f"daemon_view.reachable: {dv}"
assert dv.get("accessibility") is None, f"daemon_view.accessibility leaked: {dv}"
tap = dv.get("input_tap") or {}
assert tap.get("status") == "active", f"daemon_view.input_tap.status: {tap}"
assert "listen_access" not in tap, f"listen_access leaked: {tap}"
assert "post_access" not in tap, f"post_access leaked: {tap}"
# Per CONTRACT-GOVERNANCE rule 1+2: with no daemon-sourced accessibility,
# ready_for_testing must NOT silently merge daemon tap status with CLI
# accessibility — fall back to CLI source entirely.
rs = d.get("ready_source")
assert rs == "cli", f"ready_source should fall back to cli, got: {rs}"
# Legacy fields are unknown, not comparable → no disagreement entries.
disagreement = d.get("disagreement")
assert disagreement in (None, {}), f"disagreement should be empty, got: {disagreement}"
'
echo "PASS: permissions check (legacy daemon) → ready_source=cli, no fabricated fields"
stop_mock

echo "PASS"

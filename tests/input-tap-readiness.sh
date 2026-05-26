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

# Bypass the permissions-onboarding gate so the test can exercise the input-tap
# gate without depending on live macOS TCC grants for the running ./aos binary.
# This isolates the test from developer-machine state and makes it portable.
export AOS_BYPASS_PERMISSIONS_SETUP=1
export AOS_TEST_SKIP_READY_SERVICE_START=1

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

# status --json should expose runtime.input_tap with daemon-sourced fields.
OUT="$(./aos status --json)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
runtime = d.get("runtime", {})
tap = runtime.get("input_tap")
assert isinstance(tap, dict), f"runtime.input_tap missing: {d}"
assert tap.get("status") == "retrying", f"runtime.input_tap.status: {tap}"
assert tap.get("listen_access") is False, f"listen_access: {tap}"
assert tap.get("post_access") is False, f"post_access: {tap}"

notes = d.get("notes", [])
joined = "\n".join(notes)
assert "Input tap is not active" in joined, f"missing tap headline: {notes}"
assert "Input Monitoring" in joined, f"missing Input Monitoring sub-guidance: {notes}"
'
echo "PASS: status --json (degraded tap)"

# status (text) one-liner should include tap=retrying.
OUT_TEXT="$(./aos status 2>&1 | head -1)"
case "$OUT_TEXT" in
  *"tap=retrying"*) echo "PASS: status text one-liner" ;;
  *) echo "FAIL: status text one-liner missing tap=retrying: $OUT_TEXT"; exit 1 ;;
esac

# do click should fail at the preflight gate with INPUT_TAP_NOT_ACTIVE.
set +e
DO_OUT="$(./aos do click 500,300 2>&1)"
DO_RC=$?
set -e
if [ "$DO_RC" -eq 0 ]; then
  echo "FAIL: do click unexpectedly exited 0 against degraded tap: $DO_OUT"
  exit 1
fi
case "$DO_OUT" in
  *INPUT_TAP_NOT_ACTIVE*) echo "PASS: do click exits with INPUT_TAP_NOT_ACTIVE" ;;
  *) echo "FAIL: do click error code missing INPUT_TAP_NOT_ACTIVE: $DO_OUT (rc=$DO_RC)"; exit 1 ;;
esac

# ready --json should prefer the targeted reset transaction over direct
# Settings actions when stale daemon-owned TCC/input tap grants require recovery.
set +e
READY_JSON="$(./aos ready --json)"
READY_RC=$?
set -e
python3 - "$ROOT/aos" "$READY_JSON" <<'PY'
import json
import sys

d = json.loads(sys.argv[2])
target = sys.argv[1]
assert d.get("ready") is False, d
assert d.get("phase") == "human_required", d
assert d.get("diagnosis") == "daemon_tcc_grant_stale_or_missing", d
actions = d.get("next_actions", [])
commands = [a.get("command", "") for a in actions]
assert "./aos permissions reset-runtime --mode repo" in commands, actions
assert "./aos permissions setup --once" in commands, actions
assert "./aos ready --post-permission" in commands, actions
reset_index = commands.index("./aos permissions reset-runtime --mode repo")
setup_index = commands.index("./aos permissions setup --once")
post_index = commands.index("./aos ready --post-permission")
assert reset_index < setup_index < post_index, actions
assert not any(a.get("type") == "open_settings" for a in actions), actions
blockers = d.get("blockers", [])
assert any(b.get("target_path") == target for b in blockers), blockers
PY
if [[ "$READY_RC" -eq 0 ]]; then
  echo "FAIL: ready --json unexpectedly exited 0 against stale daemon permissions"
  exit 1
fi
echo "PASS: ready --json safe permission reset next_actions"

set +e
READY_TEXT="$(./aos ready 2>&1)"
READY_TEXT_RC=$?
set -e
if [[ "$READY_TEXT" == *"Preferred permission reset sequence:"* ]] &&
   [[ "$READY_TEXT" == *"Runtime mode: repo"* ]] &&
   [[ "$READY_TEXT" == *"Target binary: $ROOT/aos"* ]] &&
   [[ "$READY_TEXT" == *"1. Agent: run ./aos permissions reset-runtime --mode repo"* ]] &&
   [[ "$READY_TEXT" == *"2. Agent: run ./aos permissions setup --once"* ]] &&
   [[ "$READY_TEXT" == *"4. Human: return to the waiting session and say: finished"* ]] &&
   [[ "$READY_TEXT" == *"5. Session: run ./aos ready --post-permission"* ]] &&
   [[ "$READY_TEXT" == *"Manual Settings removal is required when reset-runtime reports targeted reset unavailable or the grant remains stale."* ]]; then
  echo "PASS: ready text safe permission reset handoff"
else
  echo "FAIL: ready text missing safe permission reset handoff:"
  echo "$READY_TEXT"
  exit 1
fi
if [[ "$READY_TEXT_RC" -eq 0 ]]; then
  echo "FAIL: ready text unexpectedly exited 0 against stale daemon permissions"
  exit 1
fi

DRY_RUN="$(./aos permissions reset-runtime --mode repo --dry-run --json)"
python3 - "$DRY_RUN" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
assert d.get("status") == "ok", d
assert d.get("dry_run") is True, d
assert d.get("mode") == "repo", d
assert d.get("tcc_identifier"), d
assert d.get("service_stop", {}).get("status") == "planned", d
assert d.get("tcc_reset", {}).get("status") == "unavailable", d
assert "bare repo" in (d.get("tcc_reset", {}).get("stderr") or ""), d
assert d.get("service_resets", []) == [], d
assert any("emergency-only" in note for note in d.get("notes", [])), d
commands = [a.get("command") for a in d.get("next_actions", [])]
assert "./aos permissions setup --once" in commands, d
assert "./aos ready --post-permission" in commands, d
PY
echo "PASS: permissions reset-runtime dry-run"

set +e
MISSING_EMERGENCY_ACK="$(./aos permissions reset-runtime --mode repo --allow-service-reset --dry-run --json 2>&1)"
MISSING_EMERGENCY_ACK_RC=$?
set -e
if [[ "$MISSING_EMERGENCY_ACK_RC" -eq 0 ]] ||
   [[ "$MISSING_EMERGENCY_ACK" != *"EMERGENCY_ACK_REQUIRED"* ]]; then
  echo "FAIL: --allow-service-reset did not require emergency acknowledgement: $MISSING_EMERGENCY_ACK"
  exit 1
fi
echo "PASS: permissions reset-runtime emergency ack guard"

EMERGENCY_DRY_RUN="$(./aos permissions reset-runtime --mode repo --allow-service-reset --emergency-ack-other-apps --dry-run --json)"
python3 - "$EMERGENCY_DRY_RUN" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
assert d.get("status") == "ok", d
assert any("Emergency dry run" in note for note in d.get("notes", [])), d
assert all(s.get("status") == "planned" for s in d.get("service_resets", [])), d
PY
echo "PASS: permissions reset-runtime emergency dry-run"

echo "PASS"

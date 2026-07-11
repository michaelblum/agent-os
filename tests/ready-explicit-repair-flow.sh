#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

source tests/lib/process-cleanup-serial.sh
trap aos_process_cleanup_release_serial_lock EXIT
aos_process_cleanup_acquire_serial_lock "tests/ready-explicit-repair-flow.sh"

PREFIX="aos-ready-explicit"

run_case() {
  local name="$1"
  local ready_after="$2"
  local expectation="$3"
  shift 3
  local ready_command=(./aos ready)
  if [[ "$#" -gt 0 ]]; then
    ready_command+=("$@")
  fi

  local state_root
  state_root="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}-${name}.XXXXXX")"
  local sock="$state_root/repo/sock"
  local marker="$state_root/repo/permissions-onboarding.json"
  local action_log="$state_root/actions.jsonl"
  local out="$state_root/ready.json"
  local mock_pid=""

  cleanup_case() {
    if [[ -n "$mock_pid" ]] && kill -0 "$mock_pid" 2>/dev/null; then
      kill "$mock_pid" 2>/dev/null || true
      wait "$mock_pid" 2>/dev/null || true
    fi
    rm -rf "$state_root"
  }
  trap cleanup_case RETURN

  mkdir -p "$(dirname "$sock")"
  python3 - "$marker" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
path.write_text(json.dumps({"completed_at": "2026-05-25T00:00:00Z"}), encoding="utf-8")
PY

  if [[ "$ready_after" == "absent" ]]; then
    :
  elif [[ "$ready_after" != "never" ]]; then
    python3 tests/lib/mock-daemon.py \
        --socket "$sock" \
        --tap-status retrying \
        --listen-access true \
        --post-access true \
        --accessibility true \
        --ready-after-pings "$ready_after" \
        >"$state_root/mock.stdout" 2>"$state_root/mock.stderr" &
  else
    python3 tests/lib/mock-daemon.py \
        --socket "$sock" \
        --tap-status retrying \
        --listen-access true \
        --post-access true \
        --accessibility true \
        >"$state_root/mock.stdout" 2>"$state_root/mock.stderr" &
  fi
  if [[ "$ready_after" != "absent" ]]; then
    mock_pid=$!
    for _ in $(seq 1 20); do
      if [[ -S "$sock" ]]; then break; fi
      sleep 0.1
    done
    if ! [[ -S "$sock" ]]; then
      echo "FAIL: mock daemon did not bind socket $sock"
      exit 1
    fi
  fi

  set +e
  AOS_STATE_ROOT="$state_root" \
    AOS_TEST_ASSUME_PERMISSIONS_GRANTED=1 \
    AOS_TEST_READY_MOCK_SERVICE_ACTIONS=1 \
    AOS_TEST_READY_SERVICE_ACTION_LOG="$action_log" \
    AOS_TEST_READY_WAIT_BUDGET_MS=400 \
    AOS_TEST_READY_WAIT_POLL_MS=20 \
    "${ready_command[@]}" --json >"$out"
  local rc=$?
  set -e

  python3 - "$out" "$action_log" "$expectation" "$rc" <<'PY'
import json
import pathlib
import sys

response = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
action_path = pathlib.Path(sys.argv[2])
actions = [
    json.loads(line)
    for line in (action_path.read_text(encoding="utf-8") if action_path.exists() else "").splitlines()
    if line.strip()
]
expectation = sys.argv[3]
rc = int(sys.argv[4])
trace = response.get("action_trace", [])
steps = [(item.get("step"), item.get("result")) for item in trace]

if expectation == "ready":
    assert all(action["action"] in {"start", "restart"} for action in actions), actions
    assert any(action == {"action": "start", "mode": "repo"} for action in actions), actions
    restarted = any(action == {"action": "restart", "mode": "repo"} for action in actions)
    if restarted:
        assert ("service_restart", "ok") in steps, trace
        assert ("wait_for_recovery", "ready") in steps, trace
    assert rc == 0, response
    assert response.get("ready") is True, response
else:
    assert expectation == "diagnostic", expectation
    assert rc != 0, response
    assert response.get("ready") is False, response
    assert actions == [], actions
    assert response.get("startup", {}).get("attempted") is False, response
    assert response.get("startup", {}).get("status") == "skipped", response
    assert ("ready_preflight", "diagnosed") in steps, trace
    assert any(action.get("command", "").endswith("ready --repair") for action in response.get("next_actions", [])), response
    assert not any(step in {"service_start", "service_restart", "clean"} for step, _ in steps), trace
PY

  trap - RETURN
  cleanup_case
}

run_case plain-absent absent diagnostic
run_case plain-retry never diagnostic
run_case post-absent absent diagnostic --post-permission
run_case repair-recovery 2 ready --repair

run_stale_preflight_case() {
  local name="$1"
  local expect_clean="$2"
  shift 2
  local ready_command=(./aos ready)
  if [[ "$#" -gt 0 ]]; then
    ready_command+=("$@")
  fi

  local state_root stale_root
  state_root="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}-${name}.XXXXXX")"
  stale_root="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}-${name}-stale-daemon.XXXXXX")"
  local sock="$state_root/repo/sock"
  local marker="$state_root/repo/permissions-onboarding.json"
  local action_log="$state_root/actions.jsonl"
  local out="$state_root/ready.json"
  local mock_pid=""
  local stale_pid=""

  cleanup_stale_case() {
    if [[ -n "$mock_pid" ]] && kill -0 "$mock_pid" 2>/dev/null; then
      kill "$mock_pid" 2>/dev/null || true
      wait "$mock_pid" 2>/dev/null || true
    fi
    if [[ -n "$stale_pid" ]] && kill -0 "$stale_pid" 2>/dev/null; then
      kill -9 "$stale_pid" 2>/dev/null || true
      wait "$stale_pid" 2>/dev/null || true
    fi
    rm -rf "$state_root" "$stale_root"
  }
  trap cleanup_stale_case RETURN

  mkdir -p "$(dirname "$sock")"
  printf '{"completed_at":"2026-05-25T00:00:00Z"}\n' >"$marker"

  python3 tests/lib/mock-daemon.py \
      --socket "$sock" \
      --tap-status active \
      --listen-access true \
      --post-access true \
      --accessibility true \
      >"$state_root/mock.stdout" 2>"$state_root/mock.stderr" &
  mock_pid=$!

  for _ in $(seq 1 20); do
    if [[ -S "$sock" ]]; then break; fi
    sleep 0.1
  done
  if ! [[ -S "$sock" ]]; then
    echo "FAIL: mock daemon did not bind socket $sock"
    exit 1
  fi

  cat >"$stale_root/aos" <<'SH'
#!/usr/bin/env bash
trap '' TERM
while true; do
  sleep 10
done
SH
  chmod +x "$stale_root/aos"
  "$stale_root/aos" serve --idle-timeout 5m \
    >"$stale_root/stale.stdout" 2>"$stale_root/stale.stderr" &
  stale_pid=$!

  local found_stale=0
  for _ in $(seq 1 20); do
    if AOS_STATE_ROOT="$state_root" ./aos clean --dry-run --json | STALE_PID="$stale_pid" python3 -c '
import json
import os
import sys

payload = json.loads(sys.stdin.read())
pid = int(os.environ["STALE_PID"])
raise SystemExit(0 if any(item.get("pid") == pid for item in payload.get("stale_daemons", [])) else 1)
'; then
      found_stale=1
      break
    fi
    sleep 0.1
  done
  if [[ "$found_stale" -ne 1 ]]; then
    echo "FAIL: clean dry-run did not detect stale daemon pid=$stale_pid"
    exit 1
  fi

  set +e
  AOS_STATE_ROOT="$state_root" \
    AOS_TEST_ASSUME_PERMISSIONS_GRANTED=1 \
    AOS_TEST_READY_MOCK_SERVICE_ACTIONS=1 \
    AOS_TEST_READY_SERVICE_ACTION_LOG="$action_log" \
    "${ready_command[@]}" --json >"$out"
  local rc=$?
  set -e

  python3 - "$out" "$action_log" "$stale_pid" "$rc" "$expect_clean" <<'PY'
import json
import pathlib
import sys

response = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
action_path = pathlib.Path(sys.argv[2])
actions = [
    json.loads(line)
    for line in (action_path.read_text(encoding="utf-8") if action_path.exists() else "").splitlines()
    if line.strip()
]
stale_pid = int(sys.argv[3])
rc = int(sys.argv[4])
expect_clean = sys.argv[5] == "clean"
trace = response.get("action_trace", [])
steps = [(item.get("step"), item.get("result")) for item in trace]
blockers = response.get("blockers", [])

assert rc != 0, response
assert response.get("ready") is False, response
assert response.get("diagnosis") == "stale_daemons", response
assert response.get("startup", {}).get("attempted") is False, response
assert any(item.get("id") == "stale_daemons" and str(stale_pid) in item.get("message", "") for item in blockers), response
if expect_clean:
    assert ("clean", "ok") in steps, trace
else:
    assert ("clean", "ok") not in steps, trace
assert not any(step == "service_start" for step, _ in steps), trace
assert not any(step == "service_restart" for step, _ in steps), trace
assert not any(action.get("action") == "start" for action in actions), actions
assert not any(action.get("action") == "restart" for action in actions), actions
PY

  trap - RETURN
  cleanup_stale_case
}

run_stale_preflight_case stale-plain no-clean
run_stale_preflight_case stale-repair clean --repair

echo "PASS"

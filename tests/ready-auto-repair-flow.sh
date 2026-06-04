#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

PREFIX="aos-ready-auto-repair-flow"

run_case() {
  local name="$1"
  local ready_after="$2"
  local expect_ready="$3"

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

  if [[ "$ready_after" != "never" ]]; then
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
  mock_pid=$!

  for _ in $(seq 1 20); do
    if [[ -S "$sock" ]]; then break; fi
    sleep 0.1
  done
  if ! [[ -S "$sock" ]]; then
    echo "FAIL: mock daemon did not bind socket $sock"
    exit 1
  fi

  set +e
  AOS_STATE_ROOT="$state_root" \
    AOS_TEST_ASSUME_PERMISSIONS_GRANTED=1 \
    AOS_TEST_READY_MOCK_SERVICE_ACTIONS=1 \
    AOS_TEST_READY_SERVICE_ACTION_LOG="$action_log" \
    AOS_TEST_READY_WAIT_BUDGET_MS=400 \
    AOS_TEST_READY_WAIT_POLL_MS=20 \
    ./aos ready --json >"$out"
  local rc=$?
  set -e

  python3 - "$out" "$action_log" "$expect_ready" "$rc" <<'PY'
import json
import pathlib
import sys

response = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
actions = [
    json.loads(line)
    for line in pathlib.Path(sys.argv[2]).read_text(encoding="utf-8").splitlines()
    if line.strip()
]
expect_ready = sys.argv[3] == "ready"
rc = int(sys.argv[4])
trace = response.get("action_trace", [])
steps = [(item.get("step"), item.get("result")) for item in trace]

assert any(action == {"action": "restart", "mode": "repo"} for action in actions), actions
assert all(action["action"] in {"start", "restart"} for action in actions), actions
assert ("service_restart", "ok") in steps, trace

if expect_ready:
    assert rc == 0, response
    assert response.get("ready") is True, response
    assert ("wait_for_recovery", "ready") in steps, trace
else:
    assert rc != 0, response
    assert response.get("ready") is False, response
    assert ("wait_for_recovery", "timed_out") in steps, trace
PY

  trap - RETURN
  cleanup_case
}

run_case recovery 4 ready
run_case timeout never timed_out

echo "PASS"

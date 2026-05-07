#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

source tests/lib/supervised-run.sh

PREFIX="aos-supervised-run-dry-run"
SCRATCH_PARENT="${AOS_TEST_STATE_PARENT:-$(pwd -P)/.aos-test-tmp}"
mkdir -p "$SCRATCH_PARENT"

AOS_STATE_ROOT="$(mktemp -d "$SCRATCH_PARENT/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT

HARNESS_PID=""
cleanup() {
  if [[ -n "$HARNESS_PID" ]]; then
    kill "$HARNESS_PID" 2>/dev/null || true
    wait "$HARNESS_PID" 2>/dev/null || true
  fi
  rm -rf "$AOS_STATE_ROOT"
}
trap cleanup EXIT

RUN_DIR="$(aos_supervised_run_create_dir "$PREFIX-run")"
case "$RUN_DIR" in
  "$AOS_STATE_ROOT"/supervised-runs/*) ;;
  *)
    echo "FAIL: run directory is not under AOS_STATE_ROOT/supervised-runs: $RUN_DIR" >&2
    exit 1
    ;;
esac

aos_supervised_run_init "$RUN_DIR" dry-run

HARNESS_SUMMARY="$RUN_DIR/harness-summary.json"
aos_supervised_run_run_dry_plan "$RUN_DIR" 5 >"$HARNESS_SUMMARY" &
HARNESS_PID=$!

python3 - "$RUN_DIR/state/current-step.json" <<'PY'
import json
import pathlib
import sys
import time

path = pathlib.Path(sys.argv[1])
deadline = time.monotonic() + 3
while time.monotonic() < deadline:
    if path.exists():
        payload = json.loads(path.read_text())
        if payload.get("status") == "waiting_for_human":
            raise SystemExit(0)
    time.sleep(0.05)
raise SystemExit("timed out waiting for current-step.json waiting_for_human state")
PY

if ! kill -0 "$HARNESS_PID" 2>/dev/null; then
  wait "$HARNESS_PID" || true
  HARNESS_PID=""
  echo "FAIL: dry-run harness exited before a human response was sent" >&2
  exit 1
fi

aos_supervised_run_dry_run_response_json confirmed \
  | aos_supervised_run_send_human_response "$RUN_DIR"

wait "$HARNESS_PID"
HARNESS_PID=""

aos_supervised_run_validate "$RUN_DIR" >/dev/null

python3 - "$AOS_STATE_ROOT" "$RUN_DIR" "$HARNESS_SUMMARY" <<'PY'
import json
import pathlib
import sys

state_root = pathlib.Path(sys.argv[1])
run_dir = pathlib.Path(sys.argv[2])
harness_summary_path = pathlib.Path(sys.argv[3])

run = json.loads((run_dir / "run.json").read_text())
summary = json.loads((run_dir / "summary.json").read_text())
harness_summary = json.loads(harness_summary_path.read_text())
current_step = json.loads((run_dir / "state" / "current-step.json").read_text())
events = [
    json.loads(line)
    for line in (run_dir / "events.jsonl").read_text().splitlines()
    if line.strip()
]

expected_types = [
    "supervised.run.started",
    "supervised.step.started",
    "supervised.step.instruction",
    "supervised.step.expectation",
    "supervised.step.automated_check",
    "supervised.human.requested",
    "supervised.human.confirmed",
    "supervised.step.completed",
    "supervised.run.completed",
]
assert [event["type"] for event in events] == expected_types, events
assert [event["sequence"] for event in events] == list(range(1, 10)), events
assert run["status"] == "completed", run
assert current_step["status"] == "completed", current_step
assert summary == harness_summary, (summary, harness_summary)
assert summary["evidence_refs"] == [
    "evidence:dry-run-automated-check",
    "evidence:dry-run-human-confirmation",
    "evidence:dry-run-step-completion",
], summary
assert summary["work_record_projection"]["target_schema"] == "2026-05-work-record-v0", summary
assert not (state_root / "repo" / "daemon.lock").exists(), "dry-run plan unexpectedly started an isolated daemon"
print("PASS")
PY

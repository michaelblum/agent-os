#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

source tests/lib/supervised-run.sh

PREFIX="aos-supervised-run-file-bridge"
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
aos_supervised_run_init "$RUN_DIR" dry-run

HARNESS_SUMMARY="$RUN_DIR/harness-summary.json"
AOS_SUPERVISED_RUN_RESPONSE_TRANSPORT=jsonl \
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
  echo "FAIL: dry-run harness exited before a bridge response was sent" >&2
  exit 1
fi

CONSOLE_PAYLOAD="$RUN_DIR/console-payload.json"
CONSOLE_EMISSION="$RUN_DIR/console-emission.json"
BRIDGE_RESPONSE="$RUN_DIR/bridge-response.json"

aos_supervised_run_console_payload_json "$RUN_DIR" >"$CONSOLE_PAYLOAD"

node --input-type=module - "$CONSOLE_PAYLOAD" >"$CONSOLE_EMISSION" <<'JS'
import fs from 'node:fs';
import {
  createTestConsoleHumanResponse,
  createTestConsoleState,
} from './packages/toolkit/components/test-console/model.js';

const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const state = createTestConsoleState(payload);
const result = createTestConsoleHumanResponse(state, {
  response: 'confirmed',
  summary: 'The ready status is visible through the file-backed console bridge.',
  now: '2026-05-06T18:00:40Z',
});

console.log(JSON.stringify(result));
JS

aos_supervised_run_append_response_event "$RUN_DIR" <"$CONSOLE_EMISSION" >"$BRIDGE_RESPONSE"

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
response_events = [
    json.loads(line)
    for line in (run_dir / "response-events.jsonl").read_text().splitlines()
    if line.strip()
]
human_responses = [
    json.loads(line)
    for line in (run_dir / "human-responses.jsonl").read_text().splitlines()
    if line.strip()
]

assert run["status"] == "completed", run
assert current_step["status"] == "completed", current_step
assert summary == harness_summary, (summary, harness_summary)
assert summary["response_events_jsonl"] == str(run_dir / "response-events.jsonl"), summary
assert len(response_events) == 1, response_events
assert response_events[0]["type"] == "test_console.human_response.captured", response_events
assert response_events[0]["bridge"]["kind"] == "file_backed", response_events
assert human_responses[0]["source"]["kind"] == "console", human_responses
assert human_responses[0]["metadata"]["bridge"]["response_events_jsonl"] == str(run_dir / "response-events.jsonl"), human_responses
assert run["metadata"]["bridge"]["response_events_jsonl"] == str(run_dir / "response-events.jsonl"), run
assert not (state_root / "repo" / "daemon.lock").exists(), "file bridge dry run unexpectedly started an isolated daemon"
print("PASS")
PY

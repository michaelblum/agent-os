#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

source tests/lib/supervised-run.sh
source tests/lib/isolated-daemon.sh
source scripts/aos-content-scope.sh

PREFIX="aos-run-puck-hitl-plan"
SCRATCH_PARENT="${AOS_TEST_STATE_PARENT:-$(pwd -P)/.aos-test-tmp}"
mkdir -p "$SCRATCH_PARENT"

AOS_STATE_ROOT="$(mktemp -d "$SCRATCH_PARENT/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT

AOS="${AOS:-$ROOT/aos}"
TOOLKIT_CONTENT_ROOT="${AOS_TOOLKIT_CONTENT_ROOT:-$(aos_content_root_key_for toolkit "$ROOT")}"
CONSOLE_CANVAS_ID="${CONSOLE_CANVAS_ID:-supervised-run-test-console-v0}"
PUCK_CANVAS_ID="${PUCK_CANVAS_ID:-supervised-run-puck-v0}"
HUMAN_RESPONSE_MODE="${AOS_RUN_PUCK_HITL_HUMAN_RESPONSE_MODE:-fixture_file_bridge}"
INPUT_METHOD="${AOS_RUN_PUCK_HITL_INPUT_METHOD:-do_click}"
KEEP_STATE="${AOS_RUN_PUCK_KEEP_STATE:-1}"
PUCK_FIXTURE="$ROOT/tests/fixtures/supervised-run/run-puck-pilot-v0.html"
ARTIFACT_HELPER="$ROOT/tests/lib/supervised-run-artifact.py"

RUN_DIR="$(aos_supervised_run_create_dir "$PREFIX-run")"
ARTIFACT_DIR="$RUN_DIR/artifacts"
mkdir -p "$ARTIFACT_DIR"

CLEANED_UP=""
cleanup() {
  if [[ -z "$CLEANED_UP" ]]; then
    "$AOS" show remove --id "$CONSOLE_CANVAS_ID" >/dev/null 2>&1 || true
    "$AOS" show remove --id "$PUCK_CANVAS_ID" >/dev/null 2>&1 || true
  fi
  aos_test_kill_root "$AOS_STATE_ROOT" >/dev/null 2>&1 || true
  if [[ "$KEEP_STATE" != "1" ]]; then
    rm -rf "$AOS_STATE_ROOT"
  fi
}
trap cleanup EXIT

json_string() {
  python3 -c 'import json, sys; print(json.dumps(sys.argv[1]))' "$1"
}

artifact_helper() {
  python3 "$ARTIFACT_HELPER" "$@" \
    --run-dir "$RUN_DIR" \
    --console-canvas-id "$CONSOLE_CANVAS_ID" \
    --puck-canvas-id "$PUCK_CANVAS_ID" \
    --input-method "$INPUT_METHOD" \
    --human-response-mode "$HUMAN_RESPONSE_MODE" \
    --state-root "$AOS_STATE_ROOT" \
    --toolkit-content-root "$TOOLKIT_CONTENT_ROOT"
}

write_step() {
  local step_id="$1"
  local status="$2"
  local checks_flag="$3"
  local response_id="${4:-}"
  local args=(
    write-step
    --step-id "$step_id"
    --status "$status"
    --response-id "$response_id"
  )
  if [[ "$checks_flag" == "checks-ready" ]]; then
    args+=(--checks-ready)
  fi
  artifact_helper "${args[@]}"
}

append_event() {
  aos_supervised_run_append_structured_event "$RUN_DIR" "$@"
}

post_console_payload() {
  local wait_js="$1"
  local out_path="$2"
  local content_json

  content_json="$(aos_supervised_run_console_payload_json "$RUN_DIR")"
  "$AOS" show post --id "$CONSOLE_CANVAS_ID" --event "$content_json" >/dev/null
  "$AOS" show wait \
    --id "$CONSOLE_CANVAS_ID" \
    --manifest test-console-v0 \
    --js "$wait_js" \
    --timeout 5s \
    --json >"$out_path"
}

record_console_confirmation() {
  local request_ref="$1"
  local summary="$2"
  local eval_out="$3"
  local response_out="$4"
  local summary_json
  local metadata_json

  summary_json="$(json_string "$summary")"
  "$AOS" show eval \
    --id "$CONSOLE_CANVAS_ID" \
    --js "(() => { const summary = ${summary_json}; const note = document.querySelector('#test-console-note'); if (note) { note.value = summary; note.dispatchEvent(new Event('input', { bubbles: true })); } document.querySelector('[data-aos-ref=\"test-console-v0:response-confirm\"]')?.click(); return JSON.stringify(window.__testConsoleLastEmission || null); })()" \
    >"$eval_out"

  RUN_DIR="$RUN_DIR" \
  CANVAS_ID="$CONSOLE_CANVAS_ID" \
  AOS="$AOS" \
  TIMEOUT_SECONDS=5 \
    "$ROOT/packages/toolkit/components/test-console/write-response.sh" >"$response_out"

  aos_supervised_run_record_human_response "$RUN_DIR" "$response_out" "$request_ref" confirmed >/dev/null
  metadata_json="$(HUMAN_RESPONSE_MODE="$HUMAN_RESPONSE_MODE" python3 - <<'PY'
import json
import os
print(json.dumps({"human_response_mode": os.environ["HUMAN_RESPONSE_MODE"]}))
PY
)"
  aos_supervised_run_append_human_response_event "$RUN_DIR" "$response_out" "$metadata_json"
}

response_id() {
  python3 "$ARTIFACT_HELPER" response-id --response-file "$1"
}

puck_geometry() {
  AOS_RUN_PUCK_DISPLAY_JSON="$("$AOS" graph displays 2>/dev/null || echo '{"data":{"displays":[]}}')" python3 - <<'PY'
import json
import os

try:
    payload = json.loads(os.environ["AOS_RUN_PUCK_DISPLAY_JSON"])
except Exception:
    payload = {"data": {"displays": []}}
displays = payload.get("data", {}).get("displays", payload.get("displays", [])) if isinstance(payload, dict) else []
main = next((entry for entry in displays if entry.get("is_main")), displays[0] if displays else {})
rect = main.get("visible_bounds") or main.get("bounds") or {}
x = int(rect.get("x", 0))
y = int(rect.get("y", 0))
w = int(rect.get("w", 1280))
size = 190
print(f"{x + max(24, w - size - 48)},{y + 88},{size},{size}")
PY
}

do_target_from_xray() {
  python3 - "$ARTIFACT_DIR/run-puck-xray-paused.json" "$PUCK_CANVAS_ID" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
canvas_id = sys.argv[2]
expected = f"canvas:{canvas_id}/run-puck-v0:advance"
for target in payload.get("semantic_targets") or []:
    if target.get("do_target") == expected and target.get("enabled") is True:
        print(expected)
        raise SystemExit(0)
raise SystemExit(f"missing enabled run puck advance do_target {expected}")
PY
}

state_id_from_xray() {
  python3 - "$ARTIFACT_DIR/run-puck-xray-paused.json" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
print(payload.get("state_id", ""))
PY
}

input_extra_json() {
  local do_target="$1"
  local state_id="$2"
  AOS_RUN_PUCK_INPUT_METHOD="$INPUT_METHOD" \
  AOS_RUN_PUCK_DO_TARGET="$do_target" \
  AOS_RUN_PUCK_STATE_ID="$state_id" \
  python3 - <<'PY'
import json
import os
print(json.dumps({
    "step_ref": "step:run-puck-confirm-advanced",
    "automated_check_ref": "check:run-puck-input-advance",
    "status": "passed",
    "evidence_refs": ["evidence:run-puck-input-advance"],
    "metadata": {
        "input_method": os.environ["AOS_RUN_PUCK_INPUT_METHOD"],
        "do_target": os.environ["AOS_RUN_PUCK_DO_TARGET"],
        "state_id": os.environ["AOS_RUN_PUCK_STATE_ID"],
    },
}))
PY
}

assert_cleanup() {
  python3 - "$ARTIFACT_DIR/cleanup-show-list.json" "$CONSOLE_CANVAS_ID" "$PUCK_CANVAS_ID" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
ids = {entry.get("id") for entry in payload.get("canvases", [])}
left = [canvas_id for canvas_id in sys.argv[2:] if canvas_id in ids]
if left:
    raise SystemExit(f"cleanup did not remove canvases: {left}")
PY
}

if [[ ! -x "$AOS" ]]; then
  echo "FAIL: aos binary not found at $AOS" >&2
  exit 1
fi
if [[ ! -f "$PUCK_FIXTURE" ]]; then
  echo "FAIL: run puck fixture not found: $PUCK_FIXTURE" >&2
  exit 1
fi

case "$HUMAN_RESPONSE_MODE" in
  fixture_file_bridge) ;;
  *)
    echo "FAIL: unsupported run-puck HITL human response mode: $HUMAN_RESPONSE_MODE" >&2
    exit 2
    ;;
esac

case "$INPUT_METHOD" in
  do_click | synthetic_hotkey) ;;
  *)
    echo "FAIL: unsupported run-puck HITL input method: $INPUT_METHOD" >&2
    exit 2
    ;;
esac

aos_supervised_run_init "$RUN_DIR" run-puck-hitl
artifact_helper write-discovery

aos_test_start_daemon "$AOS_STATE_ROOT" "$TOOLKIT_CONTENT_ROOT" "$ROOT/packages/toolkit"
"$AOS" status --json >"$ARTIFACT_DIR/isolated-status.json"
"$AOS" content status --json >"$ARTIFACT_DIR/content-status.json"

append_event \
  "event:run-puck-run-started" \
  "supervised.run.started" \
  "harness" \
  "harness:run-puck-hitl-pilot-v0" \
  "The run-puck HITL pilot started in isolated AOS state."

write_step "step:run-puck-confirm-paused" waiting_for_human no-checks
append_event \
  "event:run-puck-paused-step-started" \
  "supervised.step.started" \
  "harness" \
  "harness:run-puck-hitl-pilot-v0" \
  "The paused-state confirmation step started." \
  '{"step_ref":"step:run-puck-confirm-paused"}'
append_event \
  "event:run-puck-paused-instruction" \
  "supervised.step.instruction" \
  "agent" \
  "agent:codex" \
  "Observe the run puck placement and paused state." \
  '{"step_ref":"step:run-puck-confirm-paused","instruction_ref":"instruction:run-puck-observe-paused"}'
append_event \
  "event:run-puck-paused-expectation" \
  "supervised.step.expectation" \
  "agent" \
  "agent:codex" \
  "The run puck should be visible and paused." \
  '{"step_ref":"step:run-puck-confirm-paused","expectation_ref":"expectation:run-puck-paused-visible"}'

RUN_DIR="$RUN_DIR" \
AOS="$AOS" \
AOS_TOOLKIT_CONTENT_ROOT="$TOOLKIT_CONTENT_ROOT" \
CANVAS_ID="$CONSOLE_CANVAS_ID" \
  "$ROOT/packages/toolkit/components/test-console/launch.sh" >"$ARTIFACT_DIR/test-console-launch.txt"
"$AOS" show wait \
  --id "$CONSOLE_CANVAS_ID" \
  --manifest test-console-v0 \
  --js "window.__testConsoleState?.step_id === 'step:run-puck-confirm-paused'" \
  --timeout 5s \
  --json >"$ARTIFACT_DIR/test-console-show-wait-paused.json"

PUCK_AT="$(puck_geometry)"
printf '{"at":%s}\n' "$(json_string "$PUCK_AT")" >"$ARTIFACT_DIR/run-puck-placement.json"
"$AOS" show create \
  --id "$PUCK_CANVAS_ID" \
  --at "$PUCK_AT" \
  --interactive \
  --focus \
  --scope global \
  --file "$PUCK_FIXTURE" >/dev/null
"$AOS" show wait \
  --id "$PUCK_CANVAS_ID" \
  --manifest run-puck-v0 \
  --js "window.__runPuckState?.status === 'paused' && !!document.querySelector('[data-aos-ref=\"run-puck-v0:advance\"]')" \
  --timeout 5s \
  --json >"$ARTIFACT_DIR/run-puck-show-wait-paused.json"
append_event \
  "event:run-puck-paused-show-wait" \
  "supervised.step.automated_check" \
  "verifier" \
  "verifier:aos-show-wait" \
  "show wait verified the run puck paused canvas." \
  '{"step_ref":"step:run-puck-confirm-paused","automated_check_ref":"check:run-puck-show-wait-paused","status":"passed","evidence_refs":["evidence:run-puck-show-wait-paused"]}'

"$AOS" see capture --canvas "$PUCK_CANVAS_ID" --xray --out "$ARTIFACT_DIR/run-puck-xray-paused.png" >"$ARTIFACT_DIR/run-puck-xray-paused.json"
append_event \
  "event:run-puck-paused-xray" \
  "supervised.step.automated_check" \
  "verifier" \
  "verifier:aos-see-xray" \
  "see --xray captured the run puck advance semantic target." \
  '{"step_ref":"step:run-puck-confirm-paused","automated_check_ref":"check:run-puck-xray-paused","status":"passed","evidence_refs":["evidence:run-puck-xray-paused"]}'

write_step "step:run-puck-confirm-paused" waiting_for_human checks-ready
post_console_payload \
  "window.__testConsoleState?.step_id === 'step:run-puck-confirm-paused' && window.__testConsoleState?.automated_checks?.length === 2" \
  "$ARTIFACT_DIR/test-console-show-wait-paused-updated.json"
append_event \
  "event:run-puck-paused-human-requested" \
  "supervised.human.requested" \
  "agent" \
  "agent:codex" \
  "The agent requested confirmation for the visual placement and paused state." \
  '{"step_ref":"step:run-puck-confirm-paused","human_request_ref":"request:run-puck-confirm-paused","evidence_refs":["evidence:run-puck-human-paused-confirmation"]}'
record_console_confirmation \
  "request:run-puck-confirm-paused" \
  "Fixture confirmation: the run puck is visible at the pilot placement and reads Paused." \
  "$ARTIFACT_DIR/test-console-paused-eval.json" \
  "$ARTIFACT_DIR/test-console-paused-response.json"
PAUSED_RESPONSE_ID="$(response_id "$ARTIFACT_DIR/test-console-paused-response.json")"
write_step "step:run-puck-confirm-paused" completed checks-ready "$PAUSED_RESPONSE_ID"
append_event \
  "event:run-puck-confirm-paused:completed" \
  "supervised.step.completed" \
  "harness" \
  "harness:run-puck-hitl-pilot-v0" \
  "The paused-state confirmation step completed." \
  '{"step_ref":"step:run-puck-confirm-paused","status":"completed","evidence_refs":["evidence:run-puck-show-wait-paused","evidence:run-puck-xray-paused","evidence:run-puck-human-paused-confirmation"]}'

write_step "step:run-puck-confirm-advanced" waiting_for_human no-checks
append_event \
  "event:run-puck-advanced-step-started" \
  "supervised.step.started" \
  "harness" \
  "harness:run-puck-hitl-pilot-v0" \
  "The advanced-state confirmation step started." \
  '{"step_ref":"step:run-puck-confirm-advanced"}'
append_event \
  "event:run-puck-advanced-instruction" \
  "supervised.step.instruction" \
  "agent" \
  "agent:codex" \
  "Observe the run puck after the recorded input advance." \
  '{"step_ref":"step:run-puck-confirm-advanced","instruction_ref":"instruction:run-puck-observe-advanced"}'
append_event \
  "event:run-puck-advanced-expectation" \
  "supervised.step.expectation" \
  "agent" \
  "agent:codex" \
  "The run puck should show Advanced with one advance." \
  '{"step_ref":"step:run-puck-confirm-advanced","expectation_ref":"expectation:run-puck-advanced-visible"}'

DO_TARGET="$(do_target_from_xray)"
STATE_ID="$(state_id_from_xray)"
case "$INPUT_METHOD" in
  do_click)
    "$AOS" do click "$DO_TARGET" --state-id "$STATE_ID" >"$ARTIFACT_DIR/run-puck-input-advance.json"
    ;;
  synthetic_hotkey)
    "$AOS" show eval --id "$PUCK_CANVAS_ID" --js "window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })); JSON.stringify(window.__runPuckState)" >"$ARTIFACT_DIR/run-puck-input-advance.json"
    ;;
esac
append_event \
  "event:run-puck-input-advance" \
  "supervised.step.automated_check" \
  "harness" \
  "harness:run-puck-input" \
  "The run puck advanced through the recorded input method." \
  "$(input_extra_json "$DO_TARGET" "$STATE_ID")"

"$AOS" show wait \
  --id "$PUCK_CANVAS_ID" \
  --manifest run-puck-v0 \
  --js "window.__runPuckState?.status === 'advanced' && window.__runPuckState?.advances === 1" \
  --timeout 5s \
  --json >"$ARTIFACT_DIR/run-puck-show-wait-advanced.json"
"$AOS" show eval --id "$PUCK_CANVAS_ID" --js "JSON.stringify(window.__runPuckState)" >"$ARTIFACT_DIR/run-puck-state-advanced.json"
append_event \
  "event:run-puck-advanced-show-wait" \
  "supervised.step.automated_check" \
  "verifier" \
  "verifier:aos-show-wait" \
  "show wait verified the run puck advanced state." \
  '{"step_ref":"step:run-puck-confirm-advanced","automated_check_ref":"check:run-puck-show-wait-advanced","status":"passed","evidence_refs":["evidence:run-puck-show-wait-advanced"]}'

write_step "step:run-puck-confirm-advanced" waiting_for_human checks-ready
post_console_payload \
  "window.__testConsoleState?.step_id === 'step:run-puck-confirm-advanced' && window.__testConsoleState?.automated_checks?.length === 2" \
  "$ARTIFACT_DIR/test-console-show-wait-advanced.json"
append_event \
  "event:run-puck-advanced-human-requested" \
  "supervised.human.requested" \
  "agent" \
  "agent:codex" \
  "The agent requested confirmation for the advanced run puck state." \
  '{"step_ref":"step:run-puck-confirm-advanced","human_request_ref":"request:run-puck-confirm-advanced","evidence_refs":["evidence:run-puck-human-advanced-confirmation"]}'
record_console_confirmation \
  "request:run-puck-confirm-advanced" \
  "Fixture confirmation: the run puck reads Advanced and reports one advance." \
  "$ARTIFACT_DIR/test-console-advanced-eval.json" \
  "$ARTIFACT_DIR/test-console-advanced-response.json"
ADVANCED_RESPONSE_ID="$(response_id "$ARTIFACT_DIR/test-console-advanced-response.json")"
write_step "step:run-puck-confirm-advanced" completed checks-ready "$ADVANCED_RESPONSE_ID"
append_event \
  "event:run-puck-confirm-advanced:completed" \
  "supervised.step.completed" \
  "harness" \
  "harness:run-puck-hitl-pilot-v0" \
  "The advanced-state confirmation step completed." \
  '{"step_ref":"step:run-puck-confirm-advanced","status":"completed","evidence_refs":["evidence:run-puck-input-advance","evidence:run-puck-show-wait-advanced","evidence:run-puck-human-advanced-confirmation"]}'

"$AOS" show remove --id "$CONSOLE_CANVAS_ID" >"$ARTIFACT_DIR/remove-test-console.json"
"$AOS" show remove --id "$PUCK_CANVAS_ID" >"$ARTIFACT_DIR/remove-run-puck.json"
"$AOS" show list --json >"$ARTIFACT_DIR/cleanup-show-list.json"
CLEANED_UP="1"
assert_cleanup

append_event \
  "event:run-puck-run-completed" \
  "supervised.run.completed" \
  "harness" \
  "harness:run-puck-hitl-pilot-v0" \
  "The run-puck HITL pilot completed and wrote cleanup evidence." \
  '{"status":"completed","evidence_refs":["evidence:run-puck-live-equivalent-discovery","evidence:isolated-daemon-start","evidence:toolkit-content-root","evidence:test-console-show-wait","evidence:run-puck-show-wait-paused","evidence:run-puck-xray-paused","evidence:run-puck-human-paused-confirmation","evidence:run-puck-input-advance","evidence:run-puck-show-wait-advanced","evidence:run-puck-human-advanced-confirmation","evidence:run-puck-cleanup"]}'

artifact_helper finalize --status completed --cleanup-status cleaned
aos_supervised_run_validate "$RUN_DIR" >/dev/null
cat "$RUN_DIR/summary.json"

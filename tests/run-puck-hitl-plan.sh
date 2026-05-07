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

aos_run_puck_now() {
  date -u '+%Y-%m-%dT%H:%M:%SZ'
}

aos_run_puck_append_event() {
  local event_id="$1"
  local event_type="$2"
  local source_kind="$3"
  local source_id="$4"
  local summary="$5"
  local extra_json="{}"
  local at
  if (( $# >= 6 )); then
    extra_json="$6"
  fi
  at="$(aos_run_puck_now)"

  AOS_RUN_PUCK_EVENT_ID="$event_id" \
  AOS_RUN_PUCK_EVENT_TYPE="$event_type" \
  AOS_RUN_PUCK_EVENT_AT="$at" \
  AOS_RUN_PUCK_SOURCE_KIND="$source_kind" \
  AOS_RUN_PUCK_SOURCE_ID="$source_id" \
  AOS_RUN_PUCK_EVENT_SUMMARY="$summary" \
  AOS_RUN_PUCK_EVENT_EXTRA="$extra_json" \
  python3 - <<'PY' | aos_supervised_run_append_event "$RUN_DIR"
import json
import os

event = {
    "id": os.environ["AOS_RUN_PUCK_EVENT_ID"],
    "type": os.environ["AOS_RUN_PUCK_EVENT_TYPE"],
    "at": os.environ["AOS_RUN_PUCK_EVENT_AT"],
    "source": {
        "kind": os.environ["AOS_RUN_PUCK_SOURCE_KIND"],
        "id": os.environ["AOS_RUN_PUCK_SOURCE_ID"],
    },
    "summary": os.environ["AOS_RUN_PUCK_EVENT_SUMMARY"],
}
event.update(json.loads(os.environ.get("AOS_RUN_PUCK_EVENT_EXTRA") or "{}"))
print(json.dumps(event, sort_keys=True, indent=2))
PY
}

aos_run_puck_json_string() {
  python3 -c 'import json, sys; print(json.dumps(sys.argv[1]))' "$1"
}

aos_run_puck_response_id_from_file() {
  python3 - "$1" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
print(payload["id"])
PY
}

aos_run_puck_record_response_line() {
  local response_file="$1"
  local request_ref="$2"
  local responses_file
  responses_file="$(aos_supervised_run_human_responses_file "$RUN_DIR")"

  python3 - "$response_file" "$responses_file" "$request_ref" <<'PY'
import json
import pathlib
import sys

response_path = pathlib.Path(sys.argv[1])
responses_path = pathlib.Path(sys.argv[2])
request_ref = sys.argv[3]
response = json.loads(response_path.read_text())
if response.get("request_ref") != request_ref:
    raise SystemExit(f"response request_ref {response.get('request_ref')} did not match {request_ref}")
if response.get("response") != "confirmed":
    raise SystemExit(f"expected confirmed response, got {response.get('response')}")

existing_ids = set()
if responses_path.exists():
    for line in responses_path.read_text().splitlines():
        if not line.strip():
            continue
        existing_ids.add(json.loads(line).get("id"))

if response["id"] not in existing_ids:
    with responses_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(response, sort_keys=True, separators=(",", ":")) + "\n")
PY
}

aos_run_puck_append_human_event_from_response() {
  local response_file="$1"

  AOS_RUN_PUCK_HUMAN_RESPONSE_MODE="$HUMAN_RESPONSE_MODE" python3 - "$response_file" <<'PY' | aos_supervised_run_append_event "$RUN_DIR"
import json
import os
import pathlib
import sys

response = json.loads(pathlib.Path(sys.argv[1]).read_text())
kind = response["response"]
event = {
    "id": response["event_ref"],
    "type": f"supervised.human.{kind}",
    "at": response["responded_at"],
    "source": {
        "kind": "human",
        "id": response["author"]["id"],
        "display_name": response["author"].get("display_name", ""),
    },
    "step_ref": response["step_ref"],
    "human_response_ref": response["id"],
    "evidence_refs": response.get("evidence_refs", []),
    "summary": response["summary"],
    "metadata": {
        "human_response_mode": os.environ["AOS_RUN_PUCK_HUMAN_RESPONSE_MODE"],
        "response_source": response.get("source", {}),
    },
}
print(json.dumps(event, sort_keys=True, indent=2))
PY
}

aos_run_puck_write_step_state() {
  local step_id="$1"
  local status="$2"
  local checks_ready="${3:-0}"
  local response_id="${4:-}"
  local output_path="$RUN_DIR/state/current-step.json"

  mkdir -p "$RUN_DIR/state"
  AOS_RUN_PUCK_STEP_ID="$step_id" \
  AOS_RUN_PUCK_STEP_STATUS="$status" \
  AOS_RUN_PUCK_CHECKS_READY="$checks_ready" \
  AOS_RUN_PUCK_RESPONSE_ID="$response_id" \
  AOS_RUN_PUCK_RUN_DIR="$RUN_DIR" \
  AOS_RUN_PUCK_CONSOLE_CANVAS_ID="$CONSOLE_CANVAS_ID" \
  AOS_RUN_PUCK_PUCK_CANVAS_ID="$PUCK_CANVAS_ID" \
  AOS_RUN_PUCK_INPUT_METHOD="$INPUT_METHOD" \
  AOS_RUN_PUCK_HUMAN_RESPONSE_MODE="$HUMAN_RESPONSE_MODE" \
  python3 - "$output_path" <<'PY'
import json
import os
import pathlib
import sys

step_id = os.environ["AOS_RUN_PUCK_STEP_ID"]
status = os.environ["AOS_RUN_PUCK_STEP_STATUS"]
checks_ready = os.environ["AOS_RUN_PUCK_CHECKS_READY"] == "1"
response_id = os.environ.get("AOS_RUN_PUCK_RESPONSE_ID", "")
run_dir = pathlib.Path(os.environ["AOS_RUN_PUCK_RUN_DIR"])
output_path = pathlib.Path(sys.argv[1])
console_canvas_id = os.environ["AOS_RUN_PUCK_CONSOLE_CANVAS_ID"]
puck_canvas_id = os.environ["AOS_RUN_PUCK_PUCK_CANVAS_ID"]
input_method = os.environ["AOS_RUN_PUCK_INPUT_METHOD"]
human_response_mode = os.environ["AOS_RUN_PUCK_HUMAN_RESPONSE_MODE"]

bridge = {
    "kind": "file_backed",
    "run_dir": str(run_dir),
    "events_jsonl": str(run_dir / "events.jsonl"),
    "current_step_json": str(output_path),
    "response_events_jsonl": str(run_dir / "response-events.jsonl"),
    "human_responses_jsonl": str(run_dir / "human-responses.jsonl"),
}

steps = {
    "step:run-puck-confirm-paused": {
        "label": "Confirm run puck placement and paused state",
        "instruction": {
            "id": "instruction:run-puck-observe-paused",
            "event_ref": "event:run-puck-paused-instruction",
            "text": "Observe the run puck pilot canvas and confirm that it is visible, placed intentionally, and paused.",
        },
        "expectation": {
            "id": "expectation:run-puck-paused-visible",
            "event_ref": "event:run-puck-paused-expectation",
            "text": "The run puck canvas is visible and its status reads Paused.",
            "acceptance": "The automated show wait passes for the run puck canvas and the supervisor confirms the paused visual state.",
        },
        "human_request": {
            "id": "request:run-puck-confirm-paused",
            "event_ref": "event:run-puck-paused-human-requested",
            "prompt": "Confirm that the run puck is visually placed and paused.",
            "requested_at": "2026-05-06T18:10:30Z",
            "response_options": ["confirmed", "failed", "blocked", "note"],
            "evidence_refs": ["evidence:run-puck-human-paused-confirmation"],
        },
        "checks": [
            {
                "id": "check:run-puck-show-wait-paused",
                "event_ref": "event:run-puck-paused-show-wait",
                "description": "show wait verified the run puck canvas exists and is paused.",
                "status": "passed",
                "check": {
                    "kind": "aos_show_wait",
                    "command": f"./aos show wait --id {puck_canvas_id} --manifest run-puck-v0 --js window.__runPuckState?.status === 'paused'",
                    "expected": "canvas exists with paused state",
                    "actual": "passed",
                },
                "evidence_refs": ["evidence:run-puck-show-wait-paused"],
            },
            {
                "id": "check:run-puck-xray-paused",
                "event_ref": "event:run-puck-paused-xray",
                "description": "see --xray captured the run puck advance semantic target before input.",
                "status": "passed",
                "check": {
                    "kind": "aos_see_xray",
                    "expected": "semantic do_target for run-puck-v0:advance",
                    "actual": f"canvas:{puck_canvas_id}/run-puck-v0:advance",
                },
                "evidence_refs": ["evidence:run-puck-xray-paused"],
            },
        ],
        "completion_evidence_refs": [
            "evidence:run-puck-show-wait-paused",
            "evidence:run-puck-xray-paused",
            "evidence:run-puck-human-paused-confirmation",
        ],
    },
    "step:run-puck-confirm-advanced": {
        "label": "Confirm run puck advanced state",
        "instruction": {
            "id": "instruction:run-puck-observe-advanced",
            "event_ref": "event:run-puck-advanced-instruction",
            "text": "Observe the run puck after the recorded input advance and confirm the expected advanced state.",
        },
        "expectation": {
            "id": "expectation:run-puck-advanced-visible",
            "event_ref": "event:run-puck-advanced-expectation",
            "text": "The run puck status reads Advanced and reports one advance.",
            "acceptance": "The input method is recorded in the timeline, show wait verifies advanced state, and the supervisor confirms the result.",
        },
        "human_request": {
            "id": "request:run-puck-confirm-advanced",
            "event_ref": "event:run-puck-advanced-human-requested",
            "prompt": "Confirm that the run puck advanced to the expected state.",
            "requested_at": "2026-05-06T18:11:10Z",
            "response_options": ["confirmed", "failed", "blocked", "note"],
            "evidence_refs": ["evidence:run-puck-human-advanced-confirmation"],
        },
        "checks": [
            {
                "id": "check:run-puck-input-advance",
                "event_ref": "event:run-puck-input-advance",
                "description": "The run puck was advanced through the recorded input method.",
                "status": "passed",
                "check": {
                    "kind": input_method,
                    "expected": "one run puck advance",
                    "actual": "advanced once",
                },
                "evidence_refs": ["evidence:run-puck-input-advance"],
            },
            {
                "id": "check:run-puck-show-wait-advanced",
                "event_ref": "event:run-puck-advanced-show-wait",
                "description": "show wait verified the run puck advanced state.",
                "status": "passed",
                "check": {
                    "kind": "aos_show_wait",
                    "command": f"./aos show wait --id {puck_canvas_id} --manifest run-puck-v0 --js window.__runPuckState?.status === 'advanced'",
                    "expected": "canvas exists with advanced state",
                    "actual": "passed",
                },
                "evidence_refs": ["evidence:run-puck-show-wait-advanced"],
            },
        ],
        "completion_evidence_refs": [
            "evidence:run-puck-input-advance",
            "evidence:run-puck-show-wait-advanced",
            "evidence:run-puck-human-advanced-confirmation",
        ],
    },
}

if step_id not in steps:
    raise SystemExit(f"unknown run-puck HITL step: {step_id}")

template = steps[step_id]
step = {
    "id": step_id,
    "label": template["label"],
    "status": status,
    "instruction": template["instruction"],
    "expectation": template["expectation"],
    "automated_checks": template["checks"] if checks_ready else [],
    "human_request": template["human_request"],
    "human_response_refs": [response_id] if response_id else [],
    "metadata": {
        "bridge": bridge,
        "canvas_ids": {
            "test_console": console_canvas_id,
            "run_puck": puck_canvas_id,
        },
        "human_response_mode": human_response_mode,
        "input_method": input_method,
    },
}

if status in {"completed", "failed", "blocked"}:
    step["completion"] = {
        "status": status,
        "event_ref": f"event:{step_id.removeprefix('step:')}:completed",
        "completed_at": "2026-05-06T18:12:00Z",
        "automated_check_refs": [check["id"] for check in step["automated_checks"]],
        "human_response_refs": [response_id] if response_id else [],
        "evidence_refs": template["completion_evidence_refs"],
    }

tmp_path = output_path.with_suffix(output_path.suffix + ".tmp")
tmp_path.write_text(json.dumps(step, sort_keys=True, indent=2) + "\n")
tmp_path.replace(output_path)
step_path = run_dir / "state" / f"{step_id.replace(':', '-')}.json"
step_path.write_text(json.dumps(step, sort_keys=True, indent=2) + "\n")
PY
}

aos_run_puck_post_console_payload() {
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

aos_run_puck_capture_console_confirmation() {
  local request_ref="$1"
  local summary="$2"
  local emission_out="$3"
  local response_out="$4"
  local payload_file
  payload_file="${emission_out%.json}-payload.json"

  aos_supervised_run_console_payload_json "$RUN_DIR" >"$payload_file"
  node --input-type=module - "$payload_file" "$summary" >"$emission_out" <<'JS'
import fs from 'node:fs';
import {
  createTestConsoleHumanResponse,
  createTestConsoleState,
} from './packages/toolkit/components/test-console/model.js';

const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const summary = process.argv[3];
const state = createTestConsoleState(payload);
const result = createTestConsoleHumanResponse(state, {
  response: 'confirmed',
  summary,
});

console.log(JSON.stringify(result));
JS

  aos_supervised_run_append_response_event "$RUN_DIR" <"$emission_out" >"$response_out"

  aos_run_puck_record_response_line "$response_out" "$request_ref"
  aos_run_puck_append_human_event_from_response "$response_out"
}

aos_run_puck_write_live_equivalent_discovery() {
  python3 - "$ARTIFACT_DIR/live-equivalent-discovery.json" "$PUCK_CANVAS_ID" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
puck_canvas_id = sys.argv[2]
payload = {
    "searched_terms": ["run puck", "run-puck", "puck"],
    "exact_surface_found": False,
    "live_equivalent": {
        "kind": "pilot_inline_aos_canvas",
        "canvas_id": puck_canvas_id,
        "surface": "run-puck-v0",
        "semantic_advance_ref": "run-puck-v0:advance",
    },
    "rationale": "No literal run-puck surface exists in the live repo. The pilot uses the nearest minimal equivalent: an AOS-owned canvas with a paused state, an advance control, semantic target metadata, and observable state for show wait.",
}
path.write_text(json.dumps(payload, sort_keys=True, indent=2) + "\n")
PY
}

aos_run_puck_write_inline_surface() {
  local html_path="$ARTIFACT_DIR/run-puck.html"

  cat >"$html_path" <<'HTML'
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Run Puck Pilot V0</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        width: 100vw;
        height: 100vh;
        display: grid;
        place-items: center;
        background: rgba(17, 24, 39, 0.94);
        color: #f8fafc;
      }
      .puck {
        width: 148px;
        height: 148px;
        border-radius: 50%;
        border: 1px solid rgba(148, 163, 184, 0.5);
        background: radial-gradient(circle at 36% 30%, rgba(255,255,255,0.18), transparent 36%),
          linear-gradient(145deg, #1f2937, #0f172a);
        box-shadow: 0 18px 42px rgba(0, 0, 0, 0.42);
        display: grid;
        place-items: center;
        text-align: center;
      }
      .status {
        display: block;
        color: #93c5fd;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .count {
        display: block;
        margin-top: 4px;
        color: #cbd5e1;
        font-size: 12px;
      }
      button {
        margin-top: 14px;
        border: 1px solid rgba(59, 130, 246, 0.55);
        border-radius: 999px;
        background: #2563eb;
        color: white;
        font: inherit;
        font-size: 13px;
        font-weight: 700;
        padding: 7px 13px;
      }
      button:disabled {
        border-color: rgba(148, 163, 184, 0.35);
        background: #334155;
        color: #cbd5e1;
      }
    </style>
  </head>
  <body data-status="paused">
    <main
      class="puck"
      data-aos-ref="run-puck-v0:root"
      data-aos-action="inspect_run"
      data-aos-surface="run-puck-v0"
      data-semantic-target-id="root"
      aria-label="Run puck pilot"
    >
      <div>
        <span class="status" data-role="status">Paused</span>
        <span class="count" data-role="count">0 advances</span>
        <button
          type="button"
          data-aos-ref="run-puck-v0:advance"
          data-aos-action="advance_run"
          data-aos-surface="run-puck-v0"
          data-semantic-target-id="advance"
          aria-label="Advance supervised run"
        >Advance</button>
      </div>
    </main>
    <script>
      const state = {
        status: 'paused',
        advances: 0,
        lastInput: null,
        advancedAt: null,
      };
      const statusEl = document.querySelector('[data-role="status"]');
      const countEl = document.querySelector('[data-role="count"]');
      const advanceButton = document.querySelector('[data-aos-ref="run-puck-v0:advance"]');

      function sync() {
        document.body.dataset.status = state.status;
        statusEl.textContent = state.status === 'advanced' ? 'Advanced' : 'Paused';
        countEl.textContent = `${state.advances} ${state.advances === 1 ? 'advance' : 'advances'}`;
        advanceButton.disabled = state.status === 'advanced';
        window.__runPuckState = { ...state };
      }

      function advance(input = 'button') {
        if (state.status === 'advanced') return;
        state.status = 'advanced';
        state.advances += 1;
        state.lastInput = input;
        state.advancedAt = new Date().toISOString();
        sync();
      }

      advanceButton.addEventListener('click', () => advance('do_click'));
      window.addEventListener('keydown', (event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          advance('synthetic_hotkey');
        }
      });
      window.__runPuckAdvance = advance;
      sync();
      window.headsup = window.headsup || {};
      window.headsup.receive = window.headsup.receive || function () {};
      window.headsup.manifest = {
        name: 'run-puck-v0',
        title: 'Run Puck Pilot V0',
        accepts: [],
        emits: ['run_puck.advanced'],
        channelPrefix: 'run-puck-v0',
        defaultSize: { w: 190, h: 190 },
      };
      function emitReady() {
        window.webkit?.messageHandlers?.headsup?.postMessage({
          type: 'ready',
          payload: window.headsup.manifest,
        });
      }
      window.addEventListener('load', emitReady, { once: true });
      setTimeout(emitReady, 50);
      setTimeout(emitReady, 250);
    </script>
  </body>
</html>
HTML

  printf '%s\n' "$html_path"
}

aos_run_puck_finalize() {
  local final_status="$1"
  local cleanup_status="$2"

  AOS_RUN_PUCK_FINAL_STATUS="$final_status" \
  AOS_RUN_PUCK_CLEANUP_STATUS="$cleanup_status" \
  AOS_RUN_PUCK_INPUT_METHOD="$INPUT_METHOD" \
  AOS_RUN_PUCK_HUMAN_RESPONSE_MODE="$HUMAN_RESPONSE_MODE" \
  AOS_RUN_PUCK_STATE_ROOT="$AOS_STATE_ROOT" \
  AOS_RUN_PUCK_TOOLKIT_ROOT="$TOOLKIT_CONTENT_ROOT" \
  AOS_RUN_PUCK_CONSOLE_CANVAS_ID="$CONSOLE_CANVAS_ID" \
  AOS_RUN_PUCK_PUCK_CANVAS_ID="$PUCK_CANVAS_ID" \
  python3 - "$RUN_DIR" <<'PY'
import json
import os
import pathlib
import sys

run_dir = pathlib.Path(sys.argv[1])
status = os.environ["AOS_RUN_PUCK_FINAL_STATUS"]
cleanup_status = os.environ["AOS_RUN_PUCK_CLEANUP_STATUS"]
input_method = os.environ["AOS_RUN_PUCK_INPUT_METHOD"]
human_response_mode = os.environ["AOS_RUN_PUCK_HUMAN_RESPONSE_MODE"]
state_root = os.environ["AOS_RUN_PUCK_STATE_ROOT"]
toolkit_root = os.environ["AOS_RUN_PUCK_TOOLKIT_ROOT"]
console_canvas_id = os.environ["AOS_RUN_PUCK_CONSOLE_CANVAS_ID"]
puck_canvas_id = os.environ["AOS_RUN_PUCK_PUCK_CANVAS_ID"]

events_path = run_dir / "events.jsonl"
responses_path = run_dir / "human-responses.jsonl"
run_path = run_dir / "run.json"
summary_path = run_dir / "summary.json"
artifacts = run_dir / "artifacts"

events = [json.loads(line) for line in events_path.read_text().splitlines() if line.strip()]
responses = [json.loads(line) for line in responses_path.read_text().splitlines() if line.strip()]
steps = [
    json.loads((run_dir / "state" / "step-run-puck-confirm-paused.json").read_text()),
    json.loads((run_dir / "state" / "step-run-puck-confirm-advanced.json").read_text()),
]

evidence_refs = [
    ("evidence:run-puck-live-equivalent-discovery", "surface_discovery", "Documented the live run-puck equivalent used by the pilot."),
    ("evidence:isolated-daemon-start", "runtime_setup", "Isolated daemon/test state and runtime status evidence."),
    ("evidence:toolkit-content-root", "runtime_setup", "Toolkit content root registration evidence."),
    ("evidence:test-console-show-wait", "automated_check_receipt", "Test console show wait evidence."),
    ("evidence:run-puck-show-wait-paused", "automated_check_receipt", "show wait evidence for the paused run puck canvas."),
    ("evidence:run-puck-xray-paused", "automated_check_receipt", "see --xray evidence for the run puck advance target."),
    ("evidence:run-puck-human-paused-confirmation", "human_feedback", "Human/fixture confirmation for visual placement and paused state."),
    ("evidence:run-puck-input-advance", "input_execution", "Recorded input method evidence for advancing the run puck."),
    ("evidence:run-puck-show-wait-advanced", "automated_check_receipt", "show wait evidence for the advanced run puck canvas."),
    ("evidence:run-puck-human-advanced-confirmation", "human_feedback", "Human/fixture confirmation for expected advanced state."),
    ("evidence:run-puck-cleanup", "cleanup", "Canvas cleanup and show list evidence."),
]
evidence = [
    {
        "id": f"evidence-ref:{ref.replace(':', '-')}",
        "ref": ref,
        "relationship": relationship,
        "kind": "work_record_evidence_ref",
        "summary": summary,
    }
    for ref, relationship, summary in evidence_refs
]

run = {
    "type": "aos.supervised_run",
    "schema_version": "2026-05-supervised-run-v0",
    "id": "supervised-run:run-puck-hitl-pilot-v0",
    "label": "Supervised Run Puck HITL Pilot V0",
    "created_at": events[0]["at"],
    "status": status,
    "operating_path": "agent/dev/testing/headed/real-input/hitl-sidecar",
    "origin": {
        "kind": "ad_hoc",
        "ref": None,
        "description": "Issue #154 run-puck HITL pilot shell scenario.",
    },
    "references": [
        {
            "id": "github-issue-154",
            "relationship": "guided_by",
            "ref": "https://github.com/michaelblum/agent-os/issues/154",
            "subject_type": "github.issue",
            "layer": "narrative",
            "role": "tracker",
        },
        {
            "id": "github-issue-149",
            "relationship": "parent_epic",
            "ref": "https://github.com/michaelblum/agent-os/issues/149",
            "subject_type": "github.issue",
            "layer": "narrative",
            "role": "epic",
        },
        {
            "id": "supervised-run-schema",
            "relationship": "validated_by",
            "ref": "repo:shared/schemas/aos-supervised-run-v0.schema.json",
            "subject_type": "schema",
            "layer": "descriptor",
            "role": "coordination_contract",
        },
        {
            "id": "test-console",
            "relationship": "uses",
            "ref": "repo:packages/toolkit/components/test-console/",
            "subject_type": "toolkit.component",
            "layer": "controls",
            "role": "hitl_sidecar",
        },
        {
            "id": "pilot-plan",
            "relationship": "implemented_by",
            "ref": "repo:tests/run-puck-hitl-plan.sh",
            "subject_type": "test.harness",
            "layer": "execution_map",
            "role": "pilot_plan",
        },
    ],
    "intent": {
        "summary": "Coordinate one real supervised-run pilot around a run-puck-like AOS canvas and file-backed HITL console.",
        "purpose": "Prove the pilot can launch isolated runtime state, verify a target canvas with show wait, collect two console-backed human responses, record the input method that advanced state, and leave Work Record-compatible evidence refs without adding public commands or replay/repair machinery.",
        "acceptance": "The run writes summary.json, run.json, contiguous supervised.* timeline events, response-events.jsonl, human-responses.jsonl, input evidence, and cleanup evidence.",
        "constraints": [
            "No public aos test run command.",
            "No daemon-backed event channel.",
            "No broad pub/sub.",
            "No replay, repair, or macro playback.",
            "No autonomous repair.",
            "No Work Record mutation or second evidence viewer.",
        ],
        "step_refs": [step["id"] for step in steps],
    },
    "timeline_transport": {
        "kind": "jsonl_file",
        "ordering": "sequence",
        "single_writer": True,
        "path": str(events_path),
        "notes": "Single-writer shell pilot appends one supervised-run timeline event per JSONL row.",
    },
    "timeline": events,
    "steps": steps,
    "human_responses": responses,
    "evidence_refs": evidence,
    "work_record_projection": {
        "target_schema": "2026-05-work-record-v0",
        "handoff_kind": "report_only",
        "candidate_work_record_id": "work-record:run-puck-hitl-pilot-v0",
        "evidence_refs": [entry["ref"] for entry in evidence],
        "claim_promotions": [
            {
                "id": "claim-promotion:run-puck-paused",
                "step_ref": "step:run-puck-confirm-paused",
                "claim_id_template": "claim:{{record_slug}}-run-puck-paused",
                "claim_text": "The run puck pilot canvas was visible and paused before input.",
                "postcondition_hint": "show wait passed and the supervisor confirmed visual placement and paused state.",
                "evidence_refs": [
                    "evidence:run-puck-show-wait-paused",
                    "evidence:run-puck-human-paused-confirmation",
                ],
            },
            {
                "id": "claim-promotion:run-puck-advanced",
                "step_ref": "step:run-puck-confirm-advanced",
                "claim_id_template": "claim:{{record_slug}}-run-puck-advanced",
                "claim_text": "The run puck advanced through the recorded input method and displayed the expected state.",
                "postcondition_hint": "The input event evidence and show wait advanced evidence agree with the supervisor confirmation.",
                "evidence_refs": [
                    "evidence:run-puck-input-advance",
                    "evidence:run-puck-show-wait-advanced",
                    "evidence:run-puck-human-advanced-confirmation",
                ],
            },
        ],
        "notes": "The pilot leaves refs for a future Work Record builder; it does not mutate Work Records.",
    },
    "metadata": {
        "plan": "run-puck-hitl",
        "plan_file": str(run_dir / "plan.json"),
        "state_root": state_root,
        "toolkit_content_root": toolkit_root,
        "canvas_ids": {
            "test_console": console_canvas_id,
            "run_puck": puck_canvas_id,
        },
        "human_response_mode": human_response_mode,
        "input_method": input_method,
        "cleanup_status": cleanup_status,
        "live_equivalent": {
            "kind": "pilot_inline_aos_canvas",
            "source": str(artifacts / "live-equivalent-discovery.json"),
        },
    },
}

if status == "completed":
    run["completed_at"] = events[-1]["at"]

run_path.write_text(json.dumps(run, sort_keys=True, indent=2) + "\n")

summary = {
    "id": run["id"],
    "status": status,
    "run_dir": str(run_dir),
    "state_root": state_root,
    "events_jsonl": str(events_path),
    "response_events_jsonl": str(run_dir / "response-events.jsonl"),
    "human_responses_jsonl": str(responses_path),
    "run_json": str(run_path),
    "summary_json": str(summary_path),
    "input_method": input_method,
    "human_response_mode": human_response_mode,
    "live_equivalent": run["metadata"]["live_equivalent"],
    "evidence_refs": [entry["ref"] for entry in evidence],
    "work_record_projection": run["work_record_projection"],
    "artifacts": {
        "live_equivalent_discovery": str(artifacts / "live-equivalent-discovery.json"),
        "isolated_status": str(artifacts / "isolated-status.json"),
        "content_status": str(artifacts / "content-status.json"),
        "test_console_show_wait": str(artifacts / "test-console-show-wait-paused.json"),
        "run_puck_show_wait_paused": str(artifacts / "run-puck-show-wait-paused.json"),
        "run_puck_placement": str(artifacts / "run-puck-placement.json"),
        "run_puck_xray_json": str(artifacts / "run-puck-xray-paused.json"),
        "run_puck_xray_png": str(artifacts / "run-puck-xray-paused.png"),
        "input_advance": str(artifacts / "run-puck-input-advance.json"),
        "run_puck_show_wait_advanced": str(artifacts / "run-puck-show-wait-advanced.json"),
        "cleanup": str(artifacts / "cleanup-show-list.json"),
    },
    "cleanup": {
        "status": cleanup_status,
        "show_list_json": str(artifacts / "cleanup-show-list.json"),
        "removed_canvas_ids": [console_canvas_id, puck_canvas_id],
    },
    "manual_follow_up": "Live human click-through remains the next manual check when fixture_file_bridge is used for unattended HITL responses.",
}
summary_path.write_text(json.dumps(summary, sort_keys=True, indent=2) + "\n")
PY
}

if [[ ! -x "$AOS" ]]; then
  echo "FAIL: aos binary not found at $AOS" >&2
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
aos_run_puck_write_live_equivalent_discovery

aos_test_start_daemon "$AOS_STATE_ROOT" "$TOOLKIT_CONTENT_ROOT" "$ROOT/packages/toolkit"
"$AOS" status --json >"$ARTIFACT_DIR/isolated-status.json"
"$AOS" content status --json >"$ARTIFACT_DIR/content-status.json"

aos_run_puck_append_event \
  "event:run-puck-run-started" \
  "supervised.run.started" \
  "harness" \
  "harness:run-puck-hitl-pilot-v0" \
  "The run-puck HITL pilot started in isolated AOS state."

aos_run_puck_write_step_state "step:run-puck-confirm-paused" waiting_for_human 0
aos_run_puck_append_event \
  "event:run-puck-paused-step-started" \
  "supervised.step.started" \
  "harness" \
  "harness:run-puck-hitl-pilot-v0" \
  "The paused-state confirmation step started." \
  '{"step_ref":"step:run-puck-confirm-paused"}'
aos_run_puck_append_event \
  "event:run-puck-paused-instruction" \
  "supervised.step.instruction" \
  "agent" \
  "agent:codex" \
  "Observe the run puck placement and paused state." \
  '{"step_ref":"step:run-puck-confirm-paused","instruction_ref":"instruction:run-puck-observe-paused"}'
aos_run_puck_append_event \
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

PUCK_HTML="$(aos_run_puck_write_inline_surface)"
DISPLAY_JSON="$("$AOS" graph displays --json 2>/dev/null || echo '{"data":{"displays":[]}}')"
PUCK_AT="$(
  AOS_RUN_PUCK_DISPLAY_JSON="$DISPLAY_JSON" python3 - <<'PY'
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
left = x + max(24, w - size - 48)
top = y + 88
print(f"{left},{top},{size},{size}")
PY
)"
printf '{"at":%s}\n' "$(aos_run_puck_json_string "$PUCK_AT")" >"$ARTIFACT_DIR/run-puck-placement.json"
"$AOS" show create \
  --id "$PUCK_CANVAS_ID" \
  --at "$PUCK_AT" \
  --interactive \
  --focus \
  --scope global \
  --file "$PUCK_HTML" >/dev/null
"$AOS" show wait \
  --id "$PUCK_CANVAS_ID" \
  --manifest run-puck-v0 \
  --js "window.__runPuckState?.status === 'paused' && !!document.querySelector('[data-aos-ref=\"run-puck-v0:advance\"]')" \
  --timeout 5s \
  --json >"$ARTIFACT_DIR/run-puck-show-wait-paused.json"
aos_run_puck_append_event \
  "event:run-puck-paused-show-wait" \
  "supervised.step.automated_check" \
  "verifier" \
  "verifier:aos-show-wait" \
  "show wait verified the run puck paused canvas." \
  '{"step_ref":"step:run-puck-confirm-paused","automated_check_ref":"check:run-puck-show-wait-paused","status":"passed","evidence_refs":["evidence:run-puck-show-wait-paused"]}'

"$AOS" see capture --canvas "$PUCK_CANVAS_ID" --xray --out "$ARTIFACT_DIR/run-puck-xray-paused.png" >"$ARTIFACT_DIR/run-puck-xray-paused.json"
aos_run_puck_append_event \
  "event:run-puck-paused-xray" \
  "supervised.step.automated_check" \
  "verifier" \
  "verifier:aos-see-xray" \
  "see --xray captured the run puck advance semantic target." \
  '{"step_ref":"step:run-puck-confirm-paused","automated_check_ref":"check:run-puck-xray-paused","status":"passed","evidence_refs":["evidence:run-puck-xray-paused"]}'

aos_run_puck_write_step_state "step:run-puck-confirm-paused" waiting_for_human 1
aos_run_puck_post_console_payload \
  "window.__testConsoleState?.step_id === 'step:run-puck-confirm-paused' && window.__testConsoleState?.automated_checks?.length === 2" \
  "$ARTIFACT_DIR/test-console-show-wait-paused-updated.json"
aos_run_puck_append_event \
  "event:run-puck-paused-human-requested" \
  "supervised.human.requested" \
  "agent" \
  "agent:codex" \
  "The agent requested confirmation for the visual placement and paused state." \
  '{"step_ref":"step:run-puck-confirm-paused","human_request_ref":"request:run-puck-confirm-paused","evidence_refs":["evidence:run-puck-human-paused-confirmation"]}'

aos_run_puck_capture_console_confirmation \
  "request:run-puck-confirm-paused" \
  "Fixture confirmation: the run puck is visible at the pilot placement and reads Paused." \
  "$ARTIFACT_DIR/test-console-paused-emission.json" \
  "$ARTIFACT_DIR/test-console-paused-response.json"
PAUSED_RESPONSE_ID="$(aos_run_puck_response_id_from_file "$ARTIFACT_DIR/test-console-paused-response.json")"
aos_run_puck_write_step_state "step:run-puck-confirm-paused" completed 1 "$PAUSED_RESPONSE_ID"
aos_run_puck_append_event \
  "event:run-puck-confirm-paused:completed" \
  "supervised.step.completed" \
  "harness" \
  "harness:run-puck-hitl-pilot-v0" \
  "The paused-state confirmation step completed." \
  '{"step_ref":"step:run-puck-confirm-paused","status":"completed","evidence_refs":["evidence:run-puck-show-wait-paused","evidence:run-puck-xray-paused","evidence:run-puck-human-paused-confirmation"]}'

aos_run_puck_write_step_state "step:run-puck-confirm-advanced" waiting_for_human 0
aos_run_puck_append_event \
  "event:run-puck-advanced-step-started" \
  "supervised.step.started" \
  "harness" \
  "harness:run-puck-hitl-pilot-v0" \
  "The advanced-state confirmation step started." \
  '{"step_ref":"step:run-puck-confirm-advanced"}'
aos_run_puck_append_event \
  "event:run-puck-advanced-instruction" \
  "supervised.step.instruction" \
  "agent" \
  "agent:codex" \
  "Observe the run puck after the recorded input advance." \
  '{"step_ref":"step:run-puck-confirm-advanced","instruction_ref":"instruction:run-puck-observe-advanced"}'
aos_run_puck_append_event \
  "event:run-puck-advanced-expectation" \
  "supervised.step.expectation" \
  "agent" \
  "agent:codex" \
  "The run puck should show Advanced with one advance." \
  '{"step_ref":"step:run-puck-confirm-advanced","expectation_ref":"expectation:run-puck-advanced-visible"}'

DO_TARGET="$(python3 - "$ARTIFACT_DIR/run-puck-xray-paused.json" "$PUCK_CANVAS_ID" <<'PY'
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
)"
STATE_ID="$(python3 - "$ARTIFACT_DIR/run-puck-xray-paused.json" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
print(payload.get("state_id", ""))
PY
)"

case "$INPUT_METHOD" in
  do_click)
    "$AOS" do click "$DO_TARGET" --state-id "$STATE_ID" >"$ARTIFACT_DIR/run-puck-input-advance.json"
    ;;
  synthetic_hotkey)
    "$AOS" show eval --id "$PUCK_CANVAS_ID" --js "window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })); JSON.stringify(window.__runPuckState)" >"$ARTIFACT_DIR/run-puck-input-advance.json"
    ;;
esac
aos_run_puck_append_event \
  "event:run-puck-input-advance" \
  "supervised.step.automated_check" \
  "harness" \
  "harness:run-puck-input" \
  "The run puck advanced through the recorded input method." \
  "$(AOS_RUN_PUCK_INPUT_METHOD="$INPUT_METHOD" AOS_RUN_PUCK_DO_TARGET="$DO_TARGET" AOS_RUN_PUCK_STATE_ID="$STATE_ID" python3 - <<'PY'
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
)"

"$AOS" show wait \
  --id "$PUCK_CANVAS_ID" \
  --manifest run-puck-v0 \
  --js "window.__runPuckState?.status === 'advanced' && window.__runPuckState?.advances === 1" \
  --timeout 5s \
  --json >"$ARTIFACT_DIR/run-puck-show-wait-advanced.json"
"$AOS" show eval --id "$PUCK_CANVAS_ID" --js "JSON.stringify(window.__runPuckState)" >"$ARTIFACT_DIR/run-puck-state-advanced.json"
aos_run_puck_append_event \
  "event:run-puck-advanced-show-wait" \
  "supervised.step.automated_check" \
  "verifier" \
  "verifier:aos-show-wait" \
  "show wait verified the run puck advanced state." \
  '{"step_ref":"step:run-puck-confirm-advanced","automated_check_ref":"check:run-puck-show-wait-advanced","status":"passed","evidence_refs":["evidence:run-puck-show-wait-advanced"]}'

aos_run_puck_write_step_state "step:run-puck-confirm-advanced" waiting_for_human 1
aos_run_puck_post_console_payload \
  "window.__testConsoleState?.step_id === 'step:run-puck-confirm-advanced' && window.__testConsoleState?.automated_checks?.length === 2" \
  "$ARTIFACT_DIR/test-console-show-wait-advanced.json"
aos_run_puck_append_event \
  "event:run-puck-advanced-human-requested" \
  "supervised.human.requested" \
  "agent" \
  "agent:codex" \
  "The agent requested confirmation for the advanced run puck state." \
  '{"step_ref":"step:run-puck-confirm-advanced","human_request_ref":"request:run-puck-confirm-advanced","evidence_refs":["evidence:run-puck-human-advanced-confirmation"]}'

aos_run_puck_capture_console_confirmation \
  "request:run-puck-confirm-advanced" \
  "Fixture confirmation: the run puck reads Advanced and reports one advance." \
  "$ARTIFACT_DIR/test-console-advanced-emission.json" \
  "$ARTIFACT_DIR/test-console-advanced-response.json"
ADVANCED_RESPONSE_ID="$(aos_run_puck_response_id_from_file "$ARTIFACT_DIR/test-console-advanced-response.json")"
aos_run_puck_write_step_state "step:run-puck-confirm-advanced" completed 1 "$ADVANCED_RESPONSE_ID"
aos_run_puck_append_event \
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

python3 - "$ARTIFACT_DIR/cleanup-show-list.json" "$CONSOLE_CANVAS_ID" "$PUCK_CANVAS_ID" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
ids = {entry.get("id") for entry in payload.get("canvases", [])}
missing = [canvas_id for canvas_id in sys.argv[2:] if canvas_id in ids]
if missing:
    raise SystemExit(f"cleanup did not remove canvases: {missing}")
PY

aos_run_puck_append_event \
  "event:run-puck-run-completed" \
  "supervised.run.completed" \
  "harness" \
  "harness:run-puck-hitl-pilot-v0" \
  "The run-puck HITL pilot completed and wrote cleanup evidence." \
  '{"status":"completed","evidence_refs":["evidence:run-puck-live-equivalent-discovery","evidence:isolated-daemon-start","evidence:toolkit-content-root","evidence:test-console-show-wait","evidence:run-puck-show-wait-paused","evidence:run-puck-xray-paused","evidence:run-puck-human-paused-confirmation","evidence:run-puck-input-advance","evidence:run-puck-show-wait-advanced","evidence:run-puck-human-advanced-confirmation","evidence:run-puck-cleanup"]}'

aos_run_puck_finalize completed cleaned
aos_supervised_run_validate "$RUN_DIR" >/dev/null
cat "$RUN_DIR/summary.json"

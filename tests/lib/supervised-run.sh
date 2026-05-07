#!/usr/bin/env bash

SUPERVISED_RUN_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$SUPERVISED_RUN_LIB_DIR/supervised-run-events.sh"
source "$SUPERVISED_RUN_LIB_DIR/supervised-run-plan.sh"
source "$SUPERVISED_RUN_LIB_DIR/supervised-run-assert.sh"

aos_supervised_run_state_root() {
  if [[ -n "${AOS_SUPERVISED_RUN_STATE_ROOT:-}" ]]; then
    printf '%s\n' "$AOS_SUPERVISED_RUN_STATE_ROOT"
  elif [[ -n "${AOS_STATE_ROOT:-}" ]]; then
    printf '%s/supervised-runs\n' "$AOS_STATE_ROOT"
  else
    printf '%s/supervised-runs\n' "${AOS_TEST_STATE_PARENT:-$(pwd -P)/.aos-test-tmp}"
  fi
}

aos_supervised_run_create_dir() {
  local prefix="${1:-aos-supervised-run}"
  local parent

  parent="$(aos_supervised_run_state_root)"
  mkdir -p "$parent"
  mktemp -d "$parent/${prefix}.XXXXXX"
}

aos_supervised_run_init() {
  local run_dir="$1"
  local plan_name="${2:-dry-run}"

  mkdir -p "$run_dir/state" "$run_dir/artifacts"
  : >"$(aos_supervised_run_events_file "$run_dir")"
  : >"$(aos_supervised_run_human_responses_file "$run_dir")"
  : >"$(aos_supervised_run_response_events_file "$run_dir")"
  aos_supervised_run_prepare_response_pipe "$run_dir"
  aos_supervised_run_write_plan "$run_dir" "$plan_name"
}

aos_supervised_run_start_daemon_if_required() {
  local run_dir="$1"
  local plan_name="$2"
  local requires_rc
  local plan_requires_runtime

  if [[ -f "$run_dir/plan.json" ]]; then
    plan_requires_runtime="$(python3 - "$run_dir/plan.json" <<'PY'
import json
import pathlib
import sys

plan = json.loads(pathlib.Path(sys.argv[1]).read_text())
print("true" if plan.get("requires_runtime_aos") is True else "false")
PY
)"
    if [[ "$plan_requires_runtime" == "false" ]]; then
      return 0
    fi
    requires_rc=0
  else
    if aos_supervised_run_plan_requires_runtime "$plan_name"; then
      requires_rc=0
    else
      requires_rc=$?
    fi
  fi

  case "$requires_rc" in
    0)
      if [[ -z "${AOS_STATE_ROOT:-}" ]]; then
        echo "FAIL: runtime AOS supervised-run plans require AOS_STATE_ROOT" >&2
        return 2
      fi
      if ! declare -F aos_test_start_daemon >/dev/null 2>&1; then
        source "$SUPERVISED_RUN_LIB_DIR/isolated-daemon.sh"
      fi
      if aos_test_socket_reachable "$AOS_STATE_ROOT"; then
        return 0
      fi
      aos_test_start_daemon "$AOS_STATE_ROOT"
      ;;
    1)
      return 0
      ;;
    *)
      return "$requires_rc"
      ;;
  esac
}

aos_supervised_run_write_dry_run_step_state() {
  local run_dir="$1"
  local status="$2"
  local response_id="${3:-}"
  local output_path="$run_dir/state/current-step.json"

  mkdir -p "$(dirname "$output_path")"
  AOS_SUPERVISED_RUN_STEP_STATUS="$status" \
  AOS_SUPERVISED_RUN_RESPONSE_ID="$response_id" \
  AOS_SUPERVISED_RUN_DIR="$run_dir" \
  python3 - "$output_path" <<'PY'
import json
import os
import pathlib
import sys

status = os.environ["AOS_SUPERVISED_RUN_STEP_STATUS"]
response_id = os.environ.get("AOS_SUPERVISED_RUN_RESPONSE_ID", "")
run_dir = pathlib.Path(os.environ["AOS_SUPERVISED_RUN_DIR"])
output_path = pathlib.Path(sys.argv[1])

step = {
    "id": "step:dry-run-confirm-status",
    "label": "Confirm deterministic fixture status",
    "status": status,
    "instruction": {
        "id": "instruction:dry-run-observe-status",
        "event_ref": "event:dry-run-step-instruction",
        "text": "Observe the deterministic fixture status output.",
    },
    "expectation": {
        "id": "expectation:dry-run-status-visible",
        "event_ref": "event:dry-run-step-expectation",
        "text": "The fixture status output reads ready.",
        "acceptance": "The automated check reports fixture.status == ready and the supervisor confirms the same outcome.",
    },
    "automated_checks": [
        {
            "id": "check:dry-run-status-ready",
            "event_ref": "event:dry-run-automated-check",
            "description": "The deterministic fixture status equals ready.",
            "status": "passed",
            "check": {
                "kind": "fixture_value_equals",
                "path": "fixture.status",
                "expected": "ready",
                "actual": "ready",
            },
            "evidence_refs": ["evidence:dry-run-automated-check"],
        }
    ],
    "human_request": {
        "id": "request:dry-run-confirm-status",
        "event_ref": "event:dry-run-human-requested",
        "prompt": "Confirm whether the deterministic fixture status reads ready.",
        "requested_at": "2026-05-06T18:00:25Z",
        "response_options": ["confirmed", "failed", "blocked", "note"],
    },
    "human_response_refs": [response_id] if response_id else [],
    "metadata": {
        "bridge": {
            "kind": "file_backed",
            "run_dir": str(run_dir),
            "events_jsonl": str(run_dir / "events.jsonl"),
            "current_step_json": str(output_path),
            "response_events_jsonl": str(run_dir / "response-events.jsonl"),
            "human_responses_jsonl": str(run_dir / "human-responses.jsonl"),
        },
    },
}

if status in {"completed", "failed", "blocked"}:
    step["completion"] = {
        "status": status,
        "event_ref": "event:dry-run-step-completed",
        "completed_at": "2026-05-06T18:00:50Z",
        "automated_check_refs": ["check:dry-run-status-ready"],
        "human_response_refs": [response_id] if response_id else [],
        "evidence_refs": [
            "evidence:dry-run-automated-check",
            "evidence:dry-run-human-confirmation",
            "evidence:dry-run-step-completion",
        ],
    }

tmp_path = output_path.with_suffix(output_path.suffix + ".tmp")
tmp_path.write_text(json.dumps(step, sort_keys=True, indent=2) + "\n")
tmp_path.replace(output_path)
PY
}

aos_supervised_run_console_payload_json() {
  local run_dir="$1"

  python3 - "$run_dir" <<'PY'
import json
import pathlib
import sys

run_dir = pathlib.Path(sys.argv[1])
plan_path = run_dir / "plan.json"
events_path = run_dir / "events.jsonl"
responses_path = run_dir / "human-responses.jsonl"
response_events_path = run_dir / "response-events.jsonl"
step_path = run_dir / "state" / "current-step.json"

plan = json.loads(plan_path.read_text()) if plan_path.exists() else {}
events = [
    json.loads(line)
    for line in events_path.read_text().splitlines()
    if line.strip()
] if events_path.exists() else []
responses = [
    json.loads(line)
    for line in responses_path.read_text().splitlines()
    if line.strip()
] if responses_path.exists() else []
step = json.loads(step_path.read_text())

bridge = {
    "kind": "file_backed",
    "run_dir": str(run_dir),
    "events_jsonl": str(events_path),
    "current_step_json": str(step_path),
    "response_events_jsonl": str(response_events_path),
    "human_responses_jsonl": str(responses_path),
}

evidence_refs = []
seen = set()
for check in step.get("automated_checks", []):
    for ref in check.get("evidence_refs", []):
        if ref in seen:
            continue
        seen.add(ref)
        evidence_refs.append({
            "id": f"evidence-ref:{ref.replace(':', '-')}",
            "ref": ref,
            "relationship": "automated_check_receipt",
            "kind": "work_record_evidence_ref",
            "summary": check.get("description") or ref,
        })

run = {
    "type": "aos.supervised_run",
    "schema_version": "2026-05-supervised-run-v0",
    "id": plan.get("run_id") or "supervised-run:dry-run-shell-harness-kernel-v0",
    "label": plan.get("label") or "Supervised run deterministic dry run",
    "created_at": events[0].get("at") if events else "2026-05-06T18:00:00Z",
    "status": step.get("status", "waiting_for_human"),
    "operating_path": plan.get("operating_path") or "agent/dev/testing/headed/real-input/hitl-sidecar",
    "timeline_transport": {
        "kind": "jsonl_file",
        "ordering": "sequence",
        "single_writer": True,
        "path": str(events_path),
        "notes": "Partial supervised-run timeline for a file-backed test console bridge.",
    },
    "timeline": events,
    "steps": [step],
    "human_responses": responses,
    "evidence_refs": evidence_refs,
    "metadata": {
        "plan": plan.get("kind") or "dry-run",
        "plan_file": str(plan_path),
        "bridge": bridge,
    },
}

payload = {
    "type": "test_console.load",
    "run": run,
    "step": step,
    "bridge": bridge,
    "artifact_refs": [
        {
            "id": "artifact-ref:supervised-run-dir",
            "ref": f"artifact:{run_dir.name}",
            "kind": "artifact_ref",
            "relationship": "run_directory",
            "summary": str(run_dir),
        }
    ],
}
print(json.dumps(payload, sort_keys=True, separators=(",", ":")))
PY
}

aos_supervised_run_finalize_dry_run() {
  local run_dir="$1"
  local run_status="$2"
  local response_kind="$3"

  AOS_SUPERVISED_RUN_STATUS="$run_status" \
  AOS_SUPERVISED_RUN_RESPONSE_KIND="$response_kind" \
  python3 - "$run_dir" <<'PY'
import json
import os
import pathlib
import sys

run_dir = pathlib.Path(sys.argv[1])
run_status = os.environ["AOS_SUPERVISED_RUN_STATUS"]
response_kind = os.environ["AOS_SUPERVISED_RUN_RESPONSE_KIND"]
events_path = run_dir / "events.jsonl"
responses_path = run_dir / "human-responses.jsonl"
run_path = run_dir / "run.json"
summary_path = run_dir / "summary.json"
step_path = run_dir / "state" / "current-step.json"

events = [json.loads(line) for line in events_path.read_text().splitlines() if line.strip()]
responses = [json.loads(line) for line in responses_path.read_text().splitlines() if line.strip()]
step = json.loads(step_path.read_text())

evidence_refs = [
    {
        "id": "evidence-ref:dry-run-automated-check",
        "ref": "evidence:dry-run-automated-check",
        "relationship": "automated_check_receipt",
        "kind": "work_record_evidence_ref",
        "summary": "Deterministic automated check output that can become Work Record evidence.",
    },
    {
        "id": "evidence-ref:dry-run-human-confirmation",
        "ref": "evidence:dry-run-human-confirmation",
        "relationship": "human_feedback",
        "kind": "work_record_evidence_ref",
        "summary": "Human feedback that can become Work Record evidence or verifier feedback.",
    },
    {
        "id": "evidence-ref:dry-run-step-completion",
        "ref": "evidence:dry-run-step-completion",
        "relationship": "step_completion",
        "kind": "work_record_evidence_ref",
        "summary": "Step completion receipt for a later Work Record builder.",
    },
]

run = {
    "type": "aos.supervised_run",
    "schema_version": "2026-05-supervised-run-v0",
    "id": "supervised-run:dry-run-shell-harness-kernel-v0",
    "label": "Shell harness kernel deterministic dry run",
    "created_at": "2026-05-06T18:00:00Z",
    "status": run_status,
    "operating_path": "agent/dev/testing/headed/real-input/hitl-sidecar",
    "origin": {
        "kind": "ad_hoc",
        "ref": None,
        "description": "Deterministic shell-first supervised-run harness dry run.",
    },
    "references": [
        {
            "id": "github-issue-151",
            "relationship": "guided_by",
            "ref": "https://github.com/michaelblum/agent-os/issues/151",
            "subject_type": "github.issue",
            "layer": "narrative",
            "role": "kernel_tracker",
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
            "id": "work-record-schema",
            "relationship": "bridges_to",
            "ref": "repo:shared/schemas/aos-work-record-v0.md",
            "subject_type": "schema.sketch",
            "layer": "descriptor",
            "role": "durable_run_artifact",
        },
    ],
    "intent": {
        "summary": "Coordinate one deterministic supervised shell step with one automated check and one human response.",
        "purpose": "Prove the v0 shell harness can emit schema-backed JSONL timeline events without UI, daemon event bus, replay, repair, or Work Record mutation.",
        "acceptance": "The dry-run plan produces contiguous supervised.* events, current step state, human response sidecar data, summary output, and Work Record-compatible evidence refs.",
        "constraints": [
            "Keep the harness shell/test-helper scoped.",
            "Do not expose a public aos test run command.",
            "Do not mutate Work Records.",
        ],
        "step_refs": ["step:dry-run-confirm-status"],
    },
    "timeline_transport": {
        "kind": "jsonl_file",
        "ordering": "sequence",
        "single_writer": True,
        "path": str(events_path),
        "notes": "Single-writer shell helper appends one supervised-run timeline event per JSONL row.",
    },
    "timeline": events,
    "steps": [step],
    "human_responses": responses,
    "evidence_refs": evidence_refs,
    "work_record_projection": {
        "target_schema": "2026-05-work-record-v0",
        "handoff_kind": "report_only",
        "candidate_work_record_id": "work-record:dry-run-shell-harness-kernel-v0",
        "evidence_refs": [entry["ref"] for entry in evidence_refs],
        "claim_promotions": [
            {
                "id": "claim-promotion:dry-run-human-response",
                "step_ref": "step:dry-run-confirm-status",
                "claim_id_template": "claim:{{record_slug}}-human-response",
                "claim_text": f"The human supervisor response for the deterministic fixture status was {response_kind}.",
                "postcondition_hint": "Human response response:dry-run-human-confirmed is confirmed.",
                "evidence_refs": ["evidence:dry-run-human-confirmation"],
            }
        ],
        "notes": "A future Work Record builder may promote these refs into Work Record evidence, Claims, verifier feedback, and Health.",
    },
    "metadata": {
        "plan": "dry-run",
        "plan_file": str(run_dir / "plan.json"),
        "bridge": {
            "kind": "file_backed",
            "run_dir": str(run_dir),
            "events_jsonl": str(events_path),
            "current_step_json": str(step_path),
            "response_events_jsonl": str(run_dir / "response-events.jsonl"),
            "human_responses_jsonl": str(responses_path),
        },
        "scope": "shell_harness_kernel_v0",
    },
}

if run_status == "completed":
    run["completed_at"] = "2026-05-06T18:01:00Z"

run_path.write_text(json.dumps(run, sort_keys=True, indent=2) + "\n")
summary = {
    "id": run["id"],
    "status": run_status,
    "run_dir": str(run_dir),
    "events_jsonl": str(events_path),
    "response_events_jsonl": str(run_dir / "response-events.jsonl"),
    "human_responses_jsonl": str(responses_path),
    "current_step_json": str(step_path),
    "run_json": str(run_path),
    "evidence_refs": [entry["ref"] for entry in evidence_refs],
    "work_record_projection": run["work_record_projection"],
}
summary_path.write_text(json.dumps(summary, sort_keys=True, indent=2) + "\n")
PY
}

aos_supervised_run_run_dry_plan() {
  local run_dir="$1"
  local timeout_seconds="${2:-30}"
  local response_line
  local response_kind
  local response_id
  local response_transport
  local final_status
  local run_event_type

  if [[ ! -f "$run_dir/plan.json" ]]; then
    aos_supervised_run_init "$run_dir" dry-run
  fi
  aos_supervised_run_start_daemon_if_required "$run_dir" dry-run

  aos_supervised_run_append_event "$run_dir" <<'JSON'
{
  "id": "event:dry-run-run-started",
  "type": "supervised.run.started",
  "at": "2026-05-06T18:00:00Z",
  "source": {
    "kind": "harness",
    "id": "harness:shell-supervised-run-v0"
  },
  "summary": "The supervised run started."
}
JSON

  aos_supervised_run_append_event "$run_dir" <<'JSON'
{
  "id": "event:dry-run-step-started",
  "type": "supervised.step.started",
  "at": "2026-05-06T18:00:05Z",
  "source": {
    "kind": "harness",
    "id": "harness:shell-supervised-run-v0"
  },
  "step_ref": "step:dry-run-confirm-status",
  "summary": "The supervised step started."
}
JSON

  aos_supervised_run_append_event "$run_dir" <<'JSON'
{
  "id": "event:dry-run-step-instruction",
  "type": "supervised.step.instruction",
  "at": "2026-05-06T18:00:06Z",
  "source": {
    "kind": "agent",
    "id": "agent:codex"
  },
  "step_ref": "step:dry-run-confirm-status",
  "instruction_ref": "instruction:dry-run-observe-status",
  "summary": "Observe the fixture status output."
}
JSON

  aos_supervised_run_append_event "$run_dir" <<'JSON'
{
  "id": "event:dry-run-step-expectation",
  "type": "supervised.step.expectation",
  "at": "2026-05-06T18:00:07Z",
  "source": {
    "kind": "agent",
    "id": "agent:codex"
  },
  "step_ref": "step:dry-run-confirm-status",
  "expectation_ref": "expectation:dry-run-status-visible",
  "summary": "The fixture status should read ready."
}
JSON

  aos_supervised_run_append_event "$run_dir" <<'JSON'
{
  "id": "event:dry-run-automated-check",
  "type": "supervised.step.automated_check",
  "at": "2026-05-06T18:00:20Z",
  "source": {
    "kind": "verifier",
    "id": "verifier:shell-dry-run"
  },
  "step_ref": "step:dry-run-confirm-status",
  "automated_check_ref": "check:dry-run-status-ready",
  "status": "passed",
  "evidence_refs": [
    "evidence:dry-run-automated-check"
  ],
  "summary": "The deterministic check passed."
}
JSON

  aos_supervised_run_append_event "$run_dir" <<'JSON'
{
  "id": "event:dry-run-human-requested",
  "type": "supervised.human.requested",
  "at": "2026-05-06T18:00:25Z",
  "source": {
    "kind": "agent",
    "id": "agent:codex"
  },
  "step_ref": "step:dry-run-confirm-status",
  "human_request_ref": "request:dry-run-confirm-status",
  "summary": "The agent requested human confirmation."
}
JSON

  aos_supervised_run_write_dry_run_step_state "$run_dir" waiting_for_human
  response_transport="${AOS_SUPERVISED_RUN_RESPONSE_TRANSPORT:-fifo}"
  case "$response_transport" in
    fifo)
      response_line="$(aos_supervised_run_wait_for_human_response "$run_dir" "request:dry-run-confirm-status" "$timeout_seconds")"
      ;;
    file | jsonl | response-events)
      response_line="$(aos_supervised_run_wait_for_human_response_event "$run_dir" "request:dry-run-confirm-status" "$timeout_seconds")"
      ;;
    *)
      echo "FAIL: unsupported supervised-run response transport: $response_transport" >&2
      return 2
      ;;
  esac

  response_kind="$(AOS_SUPERVISED_RUN_RESPONSE_LINE="$response_line" python3 -c 'import json, os; print(json.loads(os.environ["AOS_SUPERVISED_RUN_RESPONSE_LINE"])["response"])')"
  response_id="$(AOS_SUPERVISED_RUN_RESPONSE_LINE="$response_line" python3 -c 'import json, os; print(json.loads(os.environ["AOS_SUPERVISED_RUN_RESPONSE_LINE"])["id"])')"

  AOS_SUPERVISED_RUN_RESPONSE_LINE="$response_line" python3 -c '
import json
import os

response = json.loads(os.environ["AOS_SUPERVISED_RUN_RESPONSE_LINE"])
response_kind = response["response"]
print(json.dumps({
    "id": response["event_ref"],
    "type": f"supervised.human.{response_kind}",
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
}, sort_keys=True, indent=2))
' | aos_supervised_run_append_event "$run_dir"

  case "$response_kind" in
    confirmed)
      final_status="completed"
      run_event_type="supervised.run.completed"
      ;;
    failed)
      final_status="failed"
      run_event_type="supervised.run.failed"
      ;;
    blocked | note)
      final_status="blocked"
      run_event_type="supervised.run.blocked"
      ;;
    *)
      echo "FAIL: unsupported dry-run response kind: $response_kind" >&2
      return 2
      ;;
  esac

  aos_supervised_run_write_dry_run_step_state "$run_dir" "$final_status" "$response_id"

  AOS_SUPERVISED_RUN_FINAL_STATUS="$final_status" python3 -c '
import json
import os

status = os.environ["AOS_SUPERVISED_RUN_FINAL_STATUS"]
print(json.dumps({
    "id": "event:dry-run-step-completed",
    "type": "supervised.step.completed",
    "at": "2026-05-06T18:00:50Z",
    "source": {
        "kind": "harness",
        "id": "harness:shell-supervised-run-v0",
    },
    "step_ref": "step:dry-run-confirm-status",
    "status": status,
    "evidence_refs": [
        "evidence:dry-run-automated-check",
        "evidence:dry-run-human-confirmation",
        "evidence:dry-run-step-completion",
    ],
    "summary": f"The step finished with status {status}.",
}, sort_keys=True, indent=2))
' | aos_supervised_run_append_event "$run_dir"

  AOS_SUPERVISED_RUN_FINAL_STATUS="$final_status" \
  AOS_SUPERVISED_RUN_EVENT_TYPE="$run_event_type" \
  python3 -c '
import json
import os

status = os.environ["AOS_SUPERVISED_RUN_FINAL_STATUS"]
event_type = os.environ["AOS_SUPERVISED_RUN_EVENT_TYPE"]
print(json.dumps({
    "id": f"event:dry-run-run-{status}",
    "type": event_type,
    "at": "2026-05-06T18:01:00Z",
    "source": {
        "kind": "harness",
        "id": "harness:shell-supervised-run-v0",
    },
    "status": status,
    "evidence_refs": [
        "evidence:dry-run-automated-check",
        "evidence:dry-run-human-confirmation",
        "evidence:dry-run-step-completion",
    ],
    "summary": f"The supervised run finished with status {status}.",
}, sort_keys=True, indent=2))
' | aos_supervised_run_append_event "$run_dir"

  aos_supervised_run_finalize_dry_run "$run_dir" "$final_status" "$response_kind"
  aos_supervised_run_validate "$run_dir" >/dev/null
  cat "$run_dir/summary.json"
}

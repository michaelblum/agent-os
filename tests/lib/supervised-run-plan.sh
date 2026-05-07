#!/usr/bin/env bash

aos_supervised_run_plan_requires_runtime() {
  local plan_name="$1"

  case "$plan_name" in
    dry-run)
      return 1
      ;;
    run-puck-hitl)
      return 0
      ;;
    *)
      echo "FAIL: unknown supervised-run plan: $plan_name" >&2
      return 2
      ;;
  esac
}

aos_supervised_run_write_plan() {
  local run_dir="$1"
  local plan_name="$2"

  case "$plan_name" in
    dry-run)
      mkdir -p "$run_dir"
      cat >"$run_dir/plan.json" <<'JSON'
{
  "id": "plan:supervised-run-dry-run",
  "label": "Supervised run deterministic dry run",
  "kind": "dry-run",
  "requires_runtime_aos": false,
  "operating_path": "agent/dev/testing/headed/real-input/hitl-sidecar",
  "intent_summary": "Execute one deterministic shell-only supervised step with one automated check and one human confirmation.",
  "step": {
    "id": "step:dry-run-confirm-status",
    "label": "Confirm deterministic fixture status",
    "instruction_id": "instruction:dry-run-observe-status",
    "expectation_id": "expectation:dry-run-status-visible",
    "check_id": "check:dry-run-status-ready",
    "human_request_id": "request:dry-run-confirm-status"
  }
}
JSON
      ;;
    run-puck-hitl)
      mkdir -p "$run_dir"
      cat >"$run_dir/plan.json" <<'JSON'
{
  "id": "plan:run-puck-hitl-pilot-v0",
  "label": "Supervised Run Puck HITL Pilot V0",
  "kind": "run-puck-hitl",
  "run_id": "supervised-run:run-puck-hitl-pilot-v0",
  "requires_runtime_aos": true,
  "operating_path": "agent/dev/testing/headed/real-input/hitl-sidecar",
  "intent_summary": "Execute the first real supervised-run HITL pilot around a run-puck-like AOS canvas, a file-backed test console, an automated canvas wait, a recorded input advance, and two human confirmations.",
  "steps": [
    {
      "id": "step:run-puck-confirm-paused",
      "label": "Confirm run puck placement and paused state",
      "instruction_id": "instruction:run-puck-observe-paused",
      "expectation_id": "expectation:run-puck-paused-visible",
      "check_id": "check:run-puck-show-wait-paused",
      "human_request_id": "request:run-puck-confirm-paused"
    },
    {
      "id": "step:run-puck-confirm-advanced",
      "label": "Confirm run puck advanced state",
      "instruction_id": "instruction:run-puck-observe-advanced",
      "expectation_id": "expectation:run-puck-advanced-visible",
      "check_id": "check:run-puck-show-wait-advanced",
      "human_request_id": "request:run-puck-confirm-advanced"
    }
  ]
}
JSON
      ;;
    *)
      echo "FAIL: unknown supervised-run plan: $plan_name" >&2
      return 2
      ;;
  esac
}

aos_supervised_run_dry_run_response_json() {
  local response_kind="${1:-confirmed}"
  local event_suffix
  local evidence_ref
  local summary

  case "$response_kind" in
    confirmed)
      event_suffix="confirmed"
      evidence_ref="evidence:dry-run-human-confirmation"
      summary="The supervisor confirmed the expected ready status."
      ;;
    failed)
      event_suffix="failed"
      evidence_ref="evidence:dry-run-human-failure"
      summary="The supervisor reported that the expected ready status was not present."
      ;;
    blocked)
      event_suffix="blocked"
      evidence_ref="evidence:dry-run-human-blocker"
      summary="The supervisor reported a blocker while checking the ready status."
      ;;
    note)
      event_suffix="note"
      evidence_ref="evidence:dry-run-human-note"
      summary="The supervisor added a note about the ready status."
      ;;
    *)
      echo "FAIL: unsupported dry-run response kind: $response_kind" >&2
      return 2
      ;;
  esac

  AOS_SUPERVISED_RUN_RESPONSE_KIND="$response_kind" \
  AOS_SUPERVISED_RUN_EVENT_SUFFIX="$event_suffix" \
  AOS_SUPERVISED_RUN_EVIDENCE_REF="$evidence_ref" \
  AOS_SUPERVISED_RUN_RESPONSE_SUMMARY="$summary" \
  python3 -c '
import json
import os

response_kind = os.environ["AOS_SUPERVISED_RUN_RESPONSE_KIND"]
event_suffix = os.environ["AOS_SUPERVISED_RUN_EVENT_SUFFIX"]
evidence_ref = os.environ["AOS_SUPERVISED_RUN_EVIDENCE_REF"]
summary = os.environ["AOS_SUPERVISED_RUN_RESPONSE_SUMMARY"]

print(json.dumps({
    "id": f"response:dry-run-human-{event_suffix}",
    "event_ref": f"event:dry-run-human-{event_suffix}",
    "step_ref": "step:dry-run-confirm-status",
    "request_ref": "request:dry-run-confirm-status",
    "response": response_kind,
    "author": {
        "kind": "human",
        "id": "human:operator",
        "display_name": "Operator",
    },
    "source": {
        "kind": "fixture",
        "id": f"fixture:dry-run-human-{event_suffix}",
    },
    "responded_at": "2026-05-06T18:00:40Z",
    "summary": summary,
    "evidence_refs": [evidence_ref],
}, sort_keys=True, indent=2))
'
}

#!/usr/bin/env bash

aos_supervised_run_validate() {
  local run_dir="$1"
  local schema_path="${2:-shared/schemas/aos-supervised-run-v0.schema.json}"

  python3 - "$run_dir" "$schema_path" <<'PY'
import json
import pathlib
import sys
from jsonschema import Draft202012Validator

run_dir = pathlib.Path(sys.argv[1])
schema_path = pathlib.Path(sys.argv[2])
run_path = run_dir / "run.json"
events_path = run_dir / "events.jsonl"
responses_path = run_dir / "human-responses.jsonl"

schema = json.loads(schema_path.read_text())
run = json.loads(run_path.read_text())
events = [
    json.loads(line)
    for line in events_path.read_text().splitlines()
    if line.strip()
]
responses = []
if responses_path.exists():
    responses = [
        json.loads(line)
        for line in responses_path.read_text().splitlines()
        if line.strip()
    ]

Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
errors = sorted(validator.iter_errors(run), key=lambda error: list(error.path))
if errors:
    for error in errors[:8]:
        print(error.message, file=sys.stderr)
    raise SystemExit(1)

if run["timeline"] != events:
    raise SystemExit("run.json timeline does not match events.jsonl")
if run["human_responses"] != responses:
    raise SystemExit("run.json human_responses does not match human-responses.jsonl")

for index, event in enumerate(events, start=1):
    if event.get("sequence") != index:
        raise SystemExit(f"event {event.get('id')} sequence is not contiguous")
    event_type = event.get("type", "")
    if not event_type.startswith("supervised."):
        raise SystemExit(f"event {event.get('id')} does not use supervised.* naming")
    if event_type.startswith("test."):
        raise SystemExit(f"event {event.get('id')} uses forbidden test.* naming")

evidence_refs = {entry["ref"] for entry in run.get("evidence_refs", [])}
for ref in evidence_refs:
    if not ref.startswith("evidence:"):
        raise SystemExit(f"evidence ref is not Work Record-compatible: {ref}")

for step in run.get("steps", []):
    completion = step.get("completion")
    if step.get("status") == "completed" and not completion:
        raise SystemExit(f"completed step lacks completion: {step.get('id')}")
    if completion:
        for ref in completion.get("evidence_refs", []):
            if ref not in evidence_refs:
                raise SystemExit(f"completion evidence ref does not resolve: {ref}")

projection = run.get("work_record_projection") or {}
if projection:
    if projection.get("target_schema") != "2026-05-work-record-v0":
        raise SystemExit("work_record_projection does not target Work Record v0")
    for ref in projection.get("evidence_refs", []):
        if ref not in evidence_refs:
            raise SystemExit(f"projection evidence ref does not resolve: {ref}")

summary_path = run_dir / "summary.json"
summary = json.loads(summary_path.read_text())
if summary.get("status") != run.get("status"):
    raise SystemExit("summary status does not match run status")
if summary.get("run_json") != str(run_path):
    raise SystemExit("summary run_json does not point at run.json")

print("PASS")
PY
}

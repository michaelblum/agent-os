#!/usr/bin/env bash

aos_supervised_run_events_file() {
  printf '%s/events.jsonl\n' "$1"
}

aos_supervised_run_human_responses_file() {
  printf '%s/human-responses.jsonl\n' "$1"
}

aos_supervised_run_response_events_file() {
  printf '%s/response-events.jsonl\n' "$1"
}

aos_supervised_run_response_pipe() {
  printf '%s/human-response-events.fifo\n' "$1"
}

aos_supervised_run_append_event() {
  local run_dir="$1"
  local events_file
  events_file="$(aos_supervised_run_events_file "$run_dir")"

  python3 -c '
import json
import pathlib
import sys

events_path = pathlib.Path(sys.argv[1])
events_path.parent.mkdir(parents=True, exist_ok=True)
event = json.load(sys.stdin)

existing = []
if events_path.exists():
    existing = [line for line in events_path.read_text().splitlines() if line.strip()]
next_sequence = len(existing) + 1

if "sequence" in event and event["sequence"] != next_sequence:
    actual_sequence = event["sequence"]
    raise SystemExit(f"event sequence {actual_sequence} does not match next sequence {next_sequence}")
event["sequence"] = next_sequence

event_type = event.get("type", "")
if not event_type.startswith("supervised."):
    raise SystemExit(f"event type must use supervised.* naming: {event_type}")
if event_type.startswith("test."):
    raise SystemExit(f"event type must not use test.* naming: {event_type}")

with events_path.open("a", encoding="utf-8") as handle:
    handle.write(json.dumps(event, sort_keys=True, separators=(",", ":")) + "\n")
' "$events_file"
}

aos_supervised_run_prepare_response_pipe() {
  local run_dir="$1"
  local pipe
  pipe="$(aos_supervised_run_response_pipe "$run_dir")"
  mkdir -p "$run_dir"
  if [[ -e "$pipe" && ! -p "$pipe" ]]; then
    rm -f "$pipe"
  fi
  if [[ ! -p "$pipe" ]]; then
    mkfifo "$pipe"
  fi
}

aos_supervised_run_send_human_response() {
  local run_dir="$1"
  local pipe
  local line

  pipe="$(aos_supervised_run_response_pipe "$run_dir")"
  if [[ ! -p "$pipe" ]]; then
    echo "FAIL: supervised-run response pipe is missing: $pipe" >&2
    return 1
  fi

  line="$(python3 -c '
import json
import sys

response = json.load(sys.stdin)
print(json.dumps(response, sort_keys=True, separators=(",", ":")))
')"

  printf '%s\n' "$line" > "$pipe"
}

aos_supervised_run_append_response_event() {
  local run_dir="$1"
  local payload
  local response_events_file

  payload="$(cat)"
  response_events_file="$(aos_supervised_run_response_events_file "$run_dir")"
  AOS_SUPERVISED_RUN_RESPONSE_PAYLOAD="$payload" \
  python3 - "$response_events_file" <<'PY'
import json
import os
import pathlib
import sys

events_path = pathlib.Path(sys.argv[1])
events_path.parent.mkdir(parents=True, exist_ok=True)
payload = json.loads(os.environ["AOS_SUPERVISED_RUN_RESPONSE_PAYLOAD"])

if not isinstance(payload, dict):
    raise SystemExit("response event must be a JSON object")

response = payload.get("response") if isinstance(payload.get("response"), dict) else payload
required = [
    "id",
    "event_ref",
    "step_ref",
    "request_ref",
    "response",
    "author",
    "source",
    "responded_at",
    "summary",
]
missing = [key for key in required if key not in response]
if missing:
    raise SystemExit(f"human response missing required fields: {missing}")
if response["response"] not in {"confirmed", "failed", "blocked", "note"}:
    raise SystemExit(f"invalid human response kind: {response['response']}")

response_id = response["id"]
if events_path.exists():
    for line in events_path.read_text().splitlines():
        if not line.strip():
            continue
        existing = json.loads(line)
        existing_response = existing.get("response") if isinstance(existing.get("response"), dict) else existing
        if existing_response.get("id") == response_id:
            print(json.dumps(existing_response, sort_keys=True, separators=(",", ":")))
            raise SystemExit(0)

with events_path.open("a", encoding="utf-8") as handle:
    handle.write(json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n")
print(json.dumps(response, sort_keys=True, separators=(",", ":")))
PY
}

aos_supervised_run_wait_for_human_response_event() {
  local run_dir="$1"
  local request_ref="$2"
  local timeout_seconds="${3:-30}"
  local response_events_file
  local responses_file

  response_events_file="$(aos_supervised_run_response_events_file "$run_dir")"
  responses_file="$(aos_supervised_run_human_responses_file "$run_dir")"
  mkdir -p "$run_dir"
  touch "$response_events_file"

  python3 - "$response_events_file" "$responses_file" "$request_ref" "$timeout_seconds" <<'PY'
import json
import pathlib
import sys
import time

events_path = pathlib.Path(sys.argv[1])
responses_path = pathlib.Path(sys.argv[2])
request_ref = sys.argv[3]
timeout_seconds = float(sys.argv[4])
deadline = time.monotonic() + timeout_seconds

required = [
    "id",
    "event_ref",
    "step_ref",
    "request_ref",
    "response",
    "author",
    "source",
    "responded_at",
    "summary",
]

def response_from_payload(payload):
    if not isinstance(payload, dict):
        raise SystemExit("response event must be a JSON object")
    response = payload.get("response") if isinstance(payload.get("response"), dict) else payload
    missing = [key for key in required if key not in response]
    if missing:
        raise SystemExit(f"human response missing required fields: {missing}")
    if response["request_ref"] != request_ref:
        actual_request_ref = response["request_ref"]
        raise SystemExit(f"human response request_ref {actual_request_ref} does not match {request_ref}")
    if response["response"] not in {"confirmed", "failed", "blocked", "note"}:
        response_kind = response["response"]
        raise SystemExit(f"invalid human response kind: {response_kind}")
    return response

while time.monotonic() < deadline:
    if events_path.exists():
        raw = events_path.read_text()
        lines = [line for line in raw.splitlines() if line.strip()]
        if raw and not raw.endswith("\n") and lines:
            lines = lines[:-1]
    else:
        lines = []
    for line in lines:
        response = response_from_payload(json.loads(line))
        line = json.dumps(response, sort_keys=True, separators=(",", ":"))
        responses_path.parent.mkdir(parents=True, exist_ok=True)
        with responses_path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
        print(line)
        raise SystemExit(0)
    time.sleep(0.05)

raise SystemExit(f"FAIL: timed out waiting for supervised-run response event for {request_ref}")
PY
}

aos_supervised_run_wait_for_human_response() {
  local run_dir="$1"
  local request_ref="$2"
  local timeout_seconds="${3:-30}"
  local pipe
  local responses_file
  local line

  pipe="$(aos_supervised_run_response_pipe "$run_dir")"
  responses_file="$(aos_supervised_run_human_responses_file "$run_dir")"
  aos_supervised_run_prepare_response_pipe "$run_dir"

  exec 9<>"$pipe"
  if ! IFS= read -r -t "$timeout_seconds" line <&9; then
    exec 9>&-
    echo "FAIL: timed out waiting for supervised-run human response for $request_ref" >&2
    return 124
  fi
  exec 9>&-

  AOS_SUPERVISED_RUN_RESPONSE_LINE="$line" \
  AOS_SUPERVISED_RUN_REQUEST_REF="$request_ref" \
  python3 -c '
import json
import os
import pathlib
import sys

responses_path = pathlib.Path(sys.argv[1])
responses_path.parent.mkdir(parents=True, exist_ok=True)
response = json.loads(os.environ["AOS_SUPERVISED_RUN_RESPONSE_LINE"])
request_ref = os.environ["AOS_SUPERVISED_RUN_REQUEST_REF"]

required = [
    "id",
    "event_ref",
    "step_ref",
    "request_ref",
    "response",
    "author",
    "source",
    "responded_at",
    "summary",
]
missing = [key for key in required if key not in response]
if missing:
    raise SystemExit(f"human response missing required fields: {missing}")
if response["request_ref"] != request_ref:
    actual_request_ref = response["request_ref"]
    raise SystemExit(f"human response request_ref {actual_request_ref} does not match {request_ref}")
if response["response"] not in {"confirmed", "failed", "blocked", "note"}:
    response_kind = response["response"]
    raise SystemExit(f"invalid human response kind: {response_kind}")

line = json.dumps(response, sort_keys=True, separators=(",", ":"))
with responses_path.open("a", encoding="utf-8") as handle:
    handle.write(line + "\n")
print(line)
' "$responses_file"
}

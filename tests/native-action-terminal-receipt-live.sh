#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

if [[ "${AOS_REAL_INPUT_OK:-}" != "1" ]]; then
  echo "SKIP: set AOS_REAL_INPUT_OK=1 to run the public long-drag receipt proof; incidental user input is permitted."
  exit 77
fi

source tests/lib/harness-contracts.sh

TMP="$(mktemp -d "${TMPDIR:-/tmp}/aos-native-action-terminal-receipt.XXXXXX")"
OBSERVER_PID=""
cleanup() {
  if [[ -n "$OBSERVER_PID" ]]; then
    kill "$OBSERVER_PID" 2>/dev/null || true
    wait "$OBSERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
  aos_harness_contract_release_all
}
trap cleanup EXIT

export AOS_HARNESS_CONTRACT_SCRIPT="$0"
aos_harness_contract_acquire native-action-terminal-receipt \
  --group repo-daemon-live \
  --group real-input-pointer \
  --blocks repo-service-mutator

READY_RESULT="$(./aos ready --json)"
read -r DAEMON_PID SOCKET_PATH <<EOF
$(python3 - "$READY_RESULT" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
assert payload.get("ready") is True, payload
runtime = payload.get("runtime") or {}
print(runtime["daemon_pid"], runtime["socket_path"])
PY
)
EOF

OBSERVER_LOG="$TMP/input-events.ndjson"
OBSERVER_READY="$TMP/input-observer.ready"
node tests/lib/input-event-observer.mjs \
  --socket "$SOCKET_PATH" \
  --ready-file "$OBSERVER_READY" \
  >"$OBSERVER_LOG" 2>"$TMP/input-observer.stderr" &
OBSERVER_PID=$!

for _ in $(seq 1 50); do
  [[ -f "$OBSERVER_READY" ]] && break
  kill -0 "$OBSERVER_PID" 2>/dev/null || {
    cat "$OBSERVER_LOG" "$TMP/input-observer.stderr" >&2 || true
    echo "FAIL: canonical observer exited before readiness" >&2
    exit 1
  }
  sleep 0.1
done
[[ -f "$OBSERVER_READY" ]] || { echo "FAIL: canonical observer did not become ready" >&2; exit 1; }

./aos do hover 400,500 >/dev/null
DRAG_RESULT="$(./aos do drag 400,500 800,500 --speed 40)"

python3 - "$DRAG_RESULT" "$OBSERVER_LOG" "$SOCKET_PATH" "$DAEMON_PID" <<'PY'
import json
import pathlib
import socket
import sys
import time

result = json.loads(sys.argv[1])
assert result.get("status") == "success", result
receipt = (result.get("execution") or {}).get("terminal_event_receipt")
assert isinstance(receipt, str) and receipt.startswith("aos-input-"), result

log_path = pathlib.Path(sys.argv[2])
deadline = time.monotonic() + 8
records = []
while time.monotonic() < deadline:
    records = [
        json.loads(line)
        for line in log_path.read_text().splitlines()
        if line
    ]
    if any(
        record.get("observer") == "input_event"
        and record.get("event", {}).get("gesture_id") == receipt
        and record.get("event", {}).get("phase") == "up"
        for record in records
    ):
        break
    time.sleep(0.05)

errors = [record for record in records if record.get("observer") == "error"]
assert not errors, errors
events = [
    record["event"]
    for record in records
    if record.get("observer") == "input_event"
    and record.get("event", {}).get("gesture_id") == receipt
]
phases = [event.get("phase") for event in events]
assert phases and phases[-1] == "up", phases
assert phases.count("up") == 1, phases
assert phases.count("down") <= 1, phases
assert phases.count("drag") >= 100, len(phases)
assert all(phase in {"down", "drag", "up"} for phase in phases), phases

client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
client.settimeout(3)
client.connect(sys.argv[3])
client.sendall(b'{"v":1,"service":"system","action":"ping","data":{}}\n')
payload = b""
while b"\n" not in payload:
    chunk = client.recv(65536)
    if not chunk:
        break
    payload += chunk
client.close()
response = json.loads(payload.split(b"\n", 1)[0])
data = response.get("data") or response
assert data.get("pid") == int(sys.argv[4]), data
tap = data.get("input_tap") or {}
assert tap.get("status") == "active", tap
assert tap.get("listen_access") is True, tap
assert tap.get("post_access") is True, tap

print(json.dumps({
    "status": "passed",
    "receipt": receipt,
    "raw_down_events": phases.count("down"),
    "raw_drag_events": phases.count("drag"),
    "raw_up_events": phases.count("up"),
    "daemon_pid": data.get("pid"),
    "input_tap": tap.get("status"),
}, sort_keys=True))
PY

echo "PASS: public 10-second drag retains its terminal receipt and managed input tap"

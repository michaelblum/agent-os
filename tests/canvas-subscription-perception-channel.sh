#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-canvas-subscription-perception"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

aos_test_start_daemon "$ROOT" toolkit packages/toolkit \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

SOCK="$(aos_test_socket_path "$ROOT")"

ping_json() {
  python3 - "$SOCK" <<'PY'
import socket
import sys

sock_path = sys.argv[1]
line = '{"v":1,"service":"system","action":"ping","data":{}}\n'
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(3)
s.connect(sock_path)
s.sendall(line.encode())
buf = b""
while b"\n" not in buf:
    chunk = s.recv(65536)
    if not chunk:
        break
    buf += chunk
print(buf.decode().splitlines()[0])
PY
}

assert_canvas_channel() {
  local expected_count="$1"
  local expected_depth="${2:-}"
  local expected_rate="${3:-}"
  local payload
  payload="$(ping_json)"
  PING_JSON="$payload" python3 - "$expected_count" "$expected_depth" "$expected_rate" <<'PY'
import json
import os
import sys

expected_count = int(sys.argv[1])
expected_depth = sys.argv[2]
expected_rate = sys.argv[3]
payload = json.loads(os.environ["PING_JSON"])
data = payload.get("data", payload)
channels = data.get("canvas_perception_channels") or []
assert len(channels) == expected_count, data
assert data.get("perception_channels", 0) >= expected_count, data
if expected_count:
    channel = channels[0]
    assert channel.get("canvas_id") == "perception-subscriber", channel
    assert channel.get("scope") == "cursor", channel
    if expected_depth:
        assert channel.get("depth") == int(expected_depth), channel
    if expected_rate:
        assert channel.get("rate") == expected_rate, channel
PY
}

./aos show create --id perception-subscriber --at 80,80,240,120 --html '
<!doctype html><html><body>perception subscriber<script>
window.subscribeEvents = (events) => {
  window.webkit.messageHandlers.headsup.postMessage({
    type: "subscribe",
    payload: { events }
  });
};
window.unsubscribeEvents = (events) => {
  window.webkit.messageHandlers.headsup.postMessage({
    type: "unsubscribe",
    payload: { events }
  });
};
</script></body></html>' >/dev/null

python3 - <<'PY'
import json
import subprocess
import sys
import time

def eval_json(js):
    out = subprocess.check_output(["./aos", "show", "eval", "--id", "perception-subscriber", "--js", js], text=True)
    wrapped = json.loads(out)
    return json.loads(wrapped.get("result") or "null")

deadline = time.time() + 5
while time.time() < deadline:
    state = eval_json('JSON.stringify({subscribe: typeof window.subscribeEvents, unsubscribe: typeof window.unsubscribeEvents})')
    if state.get("subscribe") == "function" and state.get("unsubscribe") == "function":
        raise SystemExit(0)
    time.sleep(0.1)
print("FAIL: timed out waiting for canvas subscription helpers", file=sys.stderr)
raise SystemExit(1)
PY

assert_canvas_channel 0

./aos show eval --id perception-subscriber --js 'window.subscribeEvents(["element_focused"])' >/dev/null
assert_canvas_channel 1 2 on-settle

./aos show eval --id perception-subscriber --js 'window.subscribeEvents(["window_entered"])' >/dev/null
assert_canvas_channel 1 2 on-change

./aos show eval --id perception-subscriber --js 'window.unsubscribeEvents(["element_focused"])' >/dev/null
assert_canvas_channel 1 1 on-change

./aos show eval --id perception-subscriber --js 'window.unsubscribeEvents(["window_entered"])' >/dev/null
assert_canvas_channel 0

./aos show eval --id perception-subscriber --js 'window.subscribeEvents(["element_focused"])' >/dev/null
assert_canvas_channel 1 2 on-settle
./aos show remove --id perception-subscriber >/dev/null
assert_canvas_channel 0

echo "PASS"

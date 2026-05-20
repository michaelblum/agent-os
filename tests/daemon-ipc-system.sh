#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

PREFIX="aos-daemon-ipc-system"
aos_test_cleanup_prefix "$PREFIX"

STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$STATE_ROOT"

cleanup() {
  aos_test_kill_root "$STATE_ROOT"
  rm -rf "$STATE_ROOT"
}
trap cleanup EXIT

./aos serve --idle-timeout none >"$STATE_ROOT/daemon.stdout" 2>"$STATE_ROOT/daemon.stderr" &
aos_test_wait_for_socket "$STATE_ROOT" || { echo "FAIL: isolated daemon did not start"; exit 1; }

SOCK="$(aos_test_socket_path "$STATE_ROOT")"

send_envelope() {
  python3 -c "import json, socket, sys
sock_path = '$SOCK'
line = sys.stdin.read()
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(3)
s.connect(sock_path)
s.sendall(line.encode() + b'\n')
buf = b''
while b'\n' not in buf:
    chunk = s.recv(4096)
    if not chunk: break
    buf += chunk
sys.stdout.write(buf.decode().splitlines()[0])"
}

# 1. system.ping returns identity + health fields.
OUT="$(echo '{"v":1,"service":"system","action":"ping","data":{}}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") in ("ok", "success"), f"unexpected status: {d}"
payload = d.get("data", d)
assert "uptime" in payload, f"uptime missing: {d}"
assert isinstance(payload.get("pid"), int), f"pid missing: {d}"
assert payload.get("mode") in ("repo", "installed"), f"mode missing: {d}"
assert isinstance(payload.get("socket_path"), str) and payload["socket_path"], f"socket_path missing: {d}"
assert isinstance(payload.get("perception_channels"), int), f"perception_channels missing: {d}"
canvas_channels = payload.get("canvas_perception_channels")
assert isinstance(canvas_channels, list), f"canvas_perception_channels missing: {d}"
for channel in canvas_channels:
    assert isinstance(channel.get("canvas_id"), str) and channel["canvas_id"], f"canvas channel id missing: {channel}"
    assert isinstance(channel.get("channel_id"), str) and channel["channel_id"], f"channel id missing: {channel}"
    assert isinstance(channel.get("depth"), int), f"channel depth missing: {channel}"
    assert channel.get("scope") == "cursor", f"channel scope invalid: {channel}"
    assert channel.get("rate") in ("continuous", "on-change", "on-settle"), f"channel rate invalid: {channel}"

resources = payload.get("runtime_resources")
assert isinstance(resources, dict), f"runtime_resources missing: {d}"
canvases = resources.get("canvases")
assert isinstance(canvases, dict), f"runtime_resources.canvases missing: {d}"
assert isinstance(canvases.get("total"), int), f"canvas total missing: {resources}"
assert isinstance(canvases.get("by_lifecycle_state"), dict), f"canvas lifecycle counts missing: {resources}"
assert isinstance(canvases.get("by_surface_type"), dict), f"canvas surface counts missing: {resources}"
assert isinstance(canvases.get("native_window_count"), int), f"native window count missing: {resources}"
assert isinstance(canvases.get("window_levels"), dict), f"window levels missing: {resources}"
assert isinstance(canvases.get("interactive_active"), int), f"interactive active count missing: {resources}"
assert isinstance(canvases.get("full_desktop_active"), int), f"full desktop active count missing: {resources}"
assert isinstance(canvases.get("desktop_world_segments"), int), f"desktop world segment count missing: {resources}"
assert isinstance(canvases.get("pending_lifecycle_waiters"), int), f"pending lifecycle waiters missing: {resources}"
subs = resources.get("canvas_event_subscriptions")
assert isinstance(subs, dict), f"canvas subscription counters missing: {resources}"
assert isinstance(subs.get("canvas_count"), int), f"canvas subscription count missing: {resources}"
assert isinstance(subs.get("by_event"), dict), f"canvas subscription event counts missing: {resources}"
assert isinstance(resources.get("canvas_perception_channel_count"), int), f"canvas perception channel count missing: {resources}"
assert isinstance(resources.get("canvas_ready_manifest_count"), int), f"ready manifest count missing: {resources}"
assert isinstance(resources.get("canvas_object_registry_count"), int), f"object registry count missing: {resources}"
regions = resources.get("input_regions")
assert isinstance(regions, dict), f"input region counters missing: {resources}"
assert isinstance(regions.get("count"), int), f"input region count missing: {resources}"
assert regions.get("active_capture") is None or isinstance(regions.get("active_capture"), dict), f"active capture invalid: {resources}"

# Legacy flat fields preserved
assert payload.get("input_tap_status") in ("active", "retrying", "unavailable"), f"input_tap_status missing: {d}"
assert isinstance(payload.get("input_tap_attempts"), int), f"input_tap_attempts missing: {d}"

# New nested input_tap block
tap = payload.get("input_tap")
assert isinstance(tap, dict), f"input_tap block missing: {d}"
assert tap.get("status") in ("active", "retrying", "unavailable"), f"input_tap.status missing: {d}"
assert tap["status"] == payload["input_tap_status"], f"flat/nested mismatch: {d}"
assert isinstance(tap.get("attempts"), int), f"input_tap.attempts missing: {d}"
assert tap["attempts"] == payload["input_tap_attempts"], f"flat/nested mismatch: {d}"
assert isinstance(tap.get("listen_access"), bool), f"input_tap.listen_access missing: {d}"
assert isinstance(tap.get("post_access"), bool), f"input_tap.post_access missing: {d}"
assert tap.get("last_error_at") is None or isinstance(tap.get("last_error_at"), str), f"input_tap.last_error_at must be string-or-null: {d}"
assert isinstance(tap.get("panic_passthrough_active"), bool), f"input_tap.panic_passthrough_active missing: {d}"
assert tap.get("panic_passthrough_until") is None or isinstance(tap.get("panic_passthrough_until"), str), f"input_tap.panic_passthrough_until must be string-or-null: {d}"
assert tap.get("panic_trigger") is None or tap.get("panic_trigger") == "cmd_opt_escape", f"input_tap.panic_trigger invalid: {d}"
assert isinstance(tap.get("panic_trigger_count"), int), f"input_tap.panic_trigger_count missing: {d}"
assert isinstance(tap.get("canvas_input_passthrough_active"), bool), f"input_tap.canvas_input_passthrough_active missing: {d}"

# New nested permissions block
perms = payload.get("permissions")
assert isinstance(perms, dict), f"permissions block missing: {d}"
assert isinstance(perms.get("accessibility"), bool), f"permissions.accessibility missing: {d}"
'
echo "PASS: system.ping"

echo "PASS"

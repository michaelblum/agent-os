#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-canvas-object-control"
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

./aos show create --id object-subscriber --at 80,80,240,160 --html '
<!doctype html><html><body>subscriber<script>
window.received = [];
window.headsup = {
  receive(b64) {
    window.received.push(JSON.parse(atob(b64)));
  }
};
window.subscribe = (events, snapshot = false) => {
  window.webkit.messageHandlers.headsup.postMessage({
    type: "subscribe",
    payload: { events, snapshot }
  });
};
</script></body></html>' >/dev/null

./aos show create --id object-producer --at 360,80,240,160 --html '
<!doctype html><html><body>producer<script>
window.postRegistry = (objects) => {
  window.webkit.messageHandlers.headsup.postMessage({
    type: "canvas_object.registry",
    payload: {
      schema_version: "2026-05-03",
      canvas_id: "object-producer",
      objects
    }
  });
};
window.postResult = () => {
  window.webkit.messageHandlers.headsup.postMessage({
    type: "canvas_object.transform.result",
    payload: {
      schema_version: "2026-05-03",
      request_id: "req-1",
      target: {
        canvas_id: "object-producer",
        object_id: "demo.cube"
      },
      status: "applied",
      transform: {
        position: { x: 1, y: 2, z: 3 },
        scale: { x: 1, y: 1, z: 1 },
        rotation_degrees: { x: 0, y: 45, z: 0 }
      }
    }
  });
};
</script></body></html>' >/dev/null

python3 - <<'PY'
import json
import subprocess
import sys
import time


def eval_json(canvas_id, js):
    out = subprocess.check_output([
        "./aos", "show", "eval", "--id", canvas_id, "--js", js
    ], text=True)
    wrapped = json.loads(out)
    return json.loads(wrapped.get("result") or "null")


def eval_void(canvas_id, js):
    subprocess.check_call([
        "./aos", "show", "eval", "--id", canvas_id, "--js", js
    ], stdout=subprocess.DEVNULL)


def show_create(canvas_id, at, html):
    subprocess.check_call([
        "./aos", "show", "create", "--id", canvas_id, "--at", at, "--html", html
    ], stdout=subprocess.DEVNULL)


def wait_for(predicate, what, timeout=5.0):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = predicate()
        if last:
            return last
        time.sleep(0.1)
    print(f"FAIL: timed out waiting for {what}; last={last}", flush=True)
    sys.exit(1)


wait_for(
    lambda: eval_json(
        "object-subscriber",
        'JSON.stringify({subscribe: typeof window.subscribe, received: Array.isArray(window.received)})'
    ).get("subscribe") == "function",
    "subscriber bridge setup",
)
wait_for(
    lambda: eval_json(
        "object-producer",
        'JSON.stringify({registry: typeof window.postRegistry, result: typeof window.postResult})'
    ).get("registry") == "function",
    "producer bridge setup",
)

eval_void(
    "object-subscriber",
    'window.subscribe(["canvas_object.registry", "canvas_object.transform.result"])'
)

object_entry = {
    "object_id": "demo.cube",
    "name": "Demo Cube",
    "kind": "three.object3d",
    "capabilities": ["transform.read", "transform.patch"],
    "transform": {
        "position": {"x": 1, "y": 2, "z": 3},
        "scale": {"x": 1, "y": 1, "z": 1},
        "rotation_degrees": {"x": 0, "y": 45, "z": 0},
    },
    "units": {
        "position": "scene",
        "scale": "multiplier",
        "rotation": "degrees",
    },
}
eval_void("object-producer", f"window.postRegistry({json.dumps([object_entry])})")

registry = wait_for(
    lambda: next(
        (
            msg for msg in eval_json("object-subscriber", "JSON.stringify(window.received)")
            if msg.get("type") == "canvas_object.registry"
        ),
        None,
    ),
    "registry fanout",
)
assert registry["canvas_id"] == "object-producer", registry
assert registry["source_id"] == "object-producer", registry
assert registry["objects"][0]["object_id"] == "demo.cube", registry
print("step 1 ok - registry fanout")

show_create("object-late-subscriber", "80,280,240,160", '''
<!doctype html><html><body>late<script>
window.received = [];
window.headsup = {
  receive(b64) {
    window.received.push(JSON.parse(atob(b64)));
  }
};
window.subscribe = () => {
  window.webkit.messageHandlers.headsup.postMessage({
    type: "subscribe",
    payload: { events: ["canvas_object.registry"], snapshot: true }
  });
};
</script></body></html>''')

wait_for(
    lambda: eval_json(
        "object-late-subscriber",
        'JSON.stringify({subscribe: typeof window.subscribe})'
    ).get("subscribe") == "function",
    "late subscriber bridge setup",
)
eval_void("object-late-subscriber", "window.subscribe()")
late_registry = wait_for(
    lambda: next(
        (
            msg for msg in eval_json("object-late-subscriber", "JSON.stringify(window.received)")
            if msg.get("type") == "canvas_object.registry"
        ),
        None,
    ),
    "late registry snapshot",
)
assert late_registry["objects"][0]["object_id"] == "demo.cube", late_registry
print("step 2 ok - retained registry snapshot")

eval_void("object-producer", "window.postRegistry([])")
cleared = wait_for(
    lambda: next(
        (
            msg for msg in eval_json("object-subscriber", "JSON.stringify(window.received)")
            if msg.get("type") == "canvas_object.registry" and msg.get("objects") == []
        ),
        None,
    ),
    "registry clear fanout",
)
assert cleared["canvas_id"] == "object-producer", cleared
print("step 3 ok - empty registry clears")

eval_void("object-subscriber", "window.received = []")
eval_void("object-producer", "window.postResult()")
result = wait_for(
    lambda: next(
        (
            msg for msg in eval_json("object-subscriber", "JSON.stringify(window.received)")
            if msg.get("type") == "canvas_object.transform.result"
        ),
        None,
    ),
    "transform result fanout",
)
assert result["request_id"] == "req-1", result
assert result["target"]["object_id"] == "demo.cube", result
assert result["source_id"] == "object-producer", result
print("step 4 ok - transform result fanout")
print("PASS")
PY

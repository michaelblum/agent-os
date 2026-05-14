#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"
source "$(dirname "$0")/lib/real-input-surface-harness.sh"

PREFIX="aos-subject-family-cleanup"
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

./aos show create --id surface-inspector --at 40,40,180,120 --html '<!doctype html><html><body>admin</body></html>' >/dev/null
./aos show create --id cleanup-observer --at 240,40,180,120 --html '
<!doctype html><html><body>observer<script>
window.received = [];
window.headsup = {
  receive(b64) {
    window.received.push(JSON.parse(atob(b64)));
  }
};
window.subscribeInputRegions = () => {
  window.webkit.messageHandlers.headsup.postMessage({
    type: "subscribe",
    payload: { events: ["input_region"], snapshot: true }
  });
};
</script></body></html>' >/dev/null
./aos show create --id subject-root --at 80,220,180,120 --html '<!doctype html><html><body>subject</body></html>' >/dev/null

python3 - <<'PY'
import json
import subprocess
import sys
import time

def eval_json(canvas_id, js):
    out = subprocess.check_output(["./aos", "show", "eval", "--id", canvas_id, "--js", js], text=True)
    return json.loads(json.loads(out).get("result") or "null")

def eval_void(canvas_id, js):
    subprocess.check_call(["./aos", "show", "eval", "--id", canvas_id, "--js", js], stdout=subprocess.DEVNULL)

def wait_for(predicate, what, timeout=6.0):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = predicate()
        if last:
            return last
        time.sleep(0.1)
    raise SystemExit(f"FAIL: timed out waiting for {what}; last={last!r}")

wait_for(
    lambda: eval_json(
        "cleanup-observer",
        'JSON.stringify({ready: typeof window.subscribeInputRegions === "function", received: Array.isArray(window.received)})'
    ).get("ready"),
    "observer bootstrap",
)
eval_void("cleanup-observer", "window.subscribeInputRegions()")

eval_void("subject-root", '''
window.webkit.messageHandlers.headsup.postMessage({
  type: "canvas.create",
  payload: {
    id: "subject-child",
    frame: [280, 220, 120, 90],
    url: "aos://toolkit/runtime/_smoke/index.html"
  }
});
window.webkit.messageHandlers.headsup.postMessage({
  type: "canvas.create",
  payload: {
    id: "subject-orphan",
    frame: [420, 220, 120, 90],
    cascade: false,
    url: "aos://toolkit/runtime/_smoke/index.html"
  }
});
window.webkit.messageHandlers.headsup.postMessage({
  type: "input_region.register",
  payload: {
    id: "subject-input-region",
    owner_canvas_id: "subject-root",
    frame: [80, 220, 40, 40],
    coordinate_space: "native",
    semantic_label: "subject region",
    consume_policy: "none",
    metadata: { resource_scope_id: "subject-root-scope" }
  }
});
''')

wait_for(
    lambda: {"subject-child", "subject-orphan"}.issubset({
        canvas["id"] for canvas in json.loads(subprocess.check_output(["./aos", "show", "list", "--json"], text=True)).get("canvases", [])
    }),
    "subject child canvases",
)

wait_for(
    lambda: "subject-input-region" in eval_json(
        "cleanup-observer",
        'JSON.stringify(window.received.flatMap((msg) => msg.regions || [msg.region]).filter(Boolean).map((region) => region.id))'
    ),
    "registered input region observation",
)
PY

FIRST_REPORT="$(aos_real_input_surface_cleanup_subject_family subject-root)"
SECOND_REPORT="$(aos_real_input_surface_cleanup_subject_family subject-root)"

python3 - "$FIRST_REPORT" "$SECOND_REPORT" <<'PY'
import json
import subprocess
import sys
import time

first = json.loads(sys.argv[1])
second = json.loads(sys.argv[2])
if not first["rootPresentBeforeCleanup"]:
    raise SystemExit(f"FAIL: first cleanup did not see root: {first}")
if first["removed"] != ["subject-root", "subject-child"]:
    raise SystemExit(f"FAIL: first cleanup removed wrong canvases: {first}")
if "subject-orphan" not in first["orphaned"]:
    raise SystemExit(f"FAIL: first cleanup did not report orphaned child: {first}")
if "surface-inspector" not in first["preserved"] or "cleanup-observer" not in first["preserved"]:
    raise SystemExit(f"FAIL: first cleanup did not preserve unrelated/admin canvases: {first}")
if first["errors"]:
    raise SystemExit(f"FAIL: first cleanup reported errors: {first}")
if second["rootPresentBeforeCleanup"]:
    raise SystemExit(f"FAIL: second cleanup should be idempotent with root gone: {second}")
if second["removed"] or second["errors"]:
    raise SystemExit(f"FAIL: second cleanup should be a no-op: {second}")

def canvases():
    return {
        canvas["id"]: canvas
        for canvas in json.loads(subprocess.check_output(["./aos", "show", "list", "--json"], text=True)).get("canvases", [])
    }

by_id = canvases()
for missing in ["subject-root", "subject-child"]:
    if missing in by_id:
        raise SystemExit(f"FAIL: {missing} survived cleanup: {by_id[missing]}")
for present in ["surface-inspector", "cleanup-observer", "subject-orphan"]:
    if present not in by_id:
        raise SystemExit(f"FAIL: {present} should survive cleanup: {by_id}")
if by_id["subject-orphan"].get("parent") or by_id["subject-orphan"].get("parent_id"):
    raise SystemExit(f"FAIL: orphan child still has parent: {by_id['subject-orphan']}")

deadline = time.time() + 5
while time.time() < deadline:
    out = subprocess.check_output([
        "./aos", "show", "eval", "--id", "cleanup-observer", "--js",
        'JSON.stringify(window.received.map((msg) => ({type: msg.type, action: msg.action, id: msg.region && msg.region.id})))'
    ], text=True)
    events = json.loads(json.loads(out).get("result") or "[]")
    if any(event.get("type") == "input_region" and event.get("action") == "removed" and event.get("id") == "subject-input-region" for event in events):
        break
    time.sleep(0.1)
else:
    raise SystemExit("FAIL: observer did not receive input_region removed event for subject-input-region")

print(json.dumps({
    "first": first,
    "second": second,
    "survivors": sorted(by_id),
}, sort_keys=True))
PY

echo "PASS"

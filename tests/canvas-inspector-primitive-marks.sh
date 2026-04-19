#!/usr/bin/env bash
# End-to-end test for canvas_object.marks:
#   - daemon fan-out
#   - inspector normalize + reconcile + render
#   - tree grouping under the owning canvas
#   - empty-list clears the entry
#   - parent-canvas-removed evicts the entry
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-primitive-marks"
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

bash packages/toolkit/components/canvas-inspector/launch.sh >/dev/null

# Producer canvas — posts canvas_object.marks targeting canvas id "producer".
./aos show create --id producer --at 120,120,240,160 \
  --html '<html><head><script>window.post = (objects) => { window.webkit.messageHandlers.headsup.postMessage({type: "canvas_object.marks", payload: { canvas_id: "producer", objects }}); };</script></head><body>producer</body></html>' >/dev/null

# Producer has no manifest; wait for its bridge to be live via a trivial eval.
python3 - <<'PY'
import json, subprocess, sys, time
deadline = time.time() + 10
last = None
while time.time() < deadline:
    try:
        out = subprocess.check_output(
            ["./aos", "show", "eval", "--id", "producer", "--js", "JSON.stringify({postType: typeof window.post, readyState: document.readyState, href: location.href})"],
            text=True, stderr=subprocess.DEVNULL,
        )
        wrapped = json.loads(out)
        inner = json.loads(wrapped.get("result") or "null")
        last = inner
        if inner and inner.get("postType") == "function":
            sys.exit(0)
    except (subprocess.CalledProcessError, json.JSONDecodeError) as e:
        last = f"err: {e}"
    time.sleep(0.2)
print(f"FAIL: producer canvas never became ready; last state: {last}", flush=True)
sys.exit(1)
PY

python3 - <<'PY'
import json, subprocess, time, sys

def eval_inspector(js):
    out = subprocess.check_output([
        "./aos", "show", "eval", "--id", "canvas-inspector", "--js", js,
    ], text=True)
    wrap = json.loads(out)
    return json.loads(wrap.get("result") or "null")

def post_from_producer(js):
    subprocess.check_call([
        "./aos", "show", "eval", "--id", "producer", "--js", js,
    ], stdout=subprocess.DEVNULL)

def wait_for(predicate, what, timeout=5.0, interval=0.1):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = predicate()
        if last:
            return last
        time.sleep(interval)
    print(f"FAIL: timed out waiting for {what}; last state: {last}", flush=True)
    sys.exit(1)

# Step 1: emit a single primitive mark and wait for the inspector to receive it.
post_from_producer('window.post([{id: "alpha", x: 200, y: 200, name: "Alpha"}])')

state = wait_for(
    lambda: eval_inspector(
        'JSON.stringify({'
        'marks: window.__canvasInspectorState?.marksByCanvas?.producer,'
        'minimap: document.querySelectorAll(".minimap-mark").length,'
        'treeMarks: document.querySelectorAll(".tree-row.mark").length'
        '})'
    ),
    "mark to arrive",
)
assert state["marks"] and len(state["marks"]) == 1, f"expected 1 mark, got {state['marks']}"
m = state["marks"][0]
assert m["id"] == "alpha" and m["x"] == 200 and m["y"] == 200, f"bad mark: {m}"
assert m["rect"] is True and m["ellipse"] is True and m["cross"] is True, f"primitives missing: {m}"
assert m["w"] == 20 and m["h"] == 20, f"wrong dims: {m}"
assert state["minimap"] >= 1, f"no minimap-mark svg rendered: {state}"
assert state["treeMarks"] >= 1, f"no mark list row rendered: {state}"

print("step 1 ok — mark received and rendered")

# Step 2: snapshot with empty objects clears the entry.
post_from_producer('window.post([])')
wait_for(
    lambda: (lambda s: s is not None and s.get("marks") is None)(
        eval_inspector('JSON.stringify({marks: window.__canvasInspectorState?.marksByCanvas?.producer ?? null})')
    ),
    "empty-list clear",
)
cleared = eval_inspector(
    'JSON.stringify({'
    'minimap: document.querySelectorAll(".minimap-mark").length,'
    'treeMarks: document.querySelectorAll(".tree-row.mark").length'
    '})'
)
assert cleared["minimap"] == 0, f"minimap mark not removed: {cleared}"
assert cleared["treeMarks"] == 0, f"tree mark row not removed: {cleared}"

print("step 2 ok — empty-list clears the entry")

# Step 3: resend, then remove the parent canvas — should evict the entry.
post_from_producer('window.post([{id: "alpha", x: 200, y: 200, name: "Alpha"}])')
wait_for(
    lambda: (lambda s: s and len(s.get("marks") or []) == 1)(
        eval_inspector('JSON.stringify({marks: window.__canvasInspectorState?.marksByCanvas?.producer ?? null})')
    ),
    "mark to reappear",
)

subprocess.check_call(["./aos", "show", "remove", "--id", "producer"])

wait_for(
    lambda: (lambda s: s and s.get("marks") is None)(
        eval_inspector('JSON.stringify({marks: window.__canvasInspectorState?.marksByCanvas?.producer ?? null})')
    ),
    "parent-canvas removal eviction",
)

print("step 3 ok — parent-canvas removal evicts the entry")
print("PASS")
PY

#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-action-bus"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"
export AOS_OPEN_URL_LOG="$ROOT/open-url.log"

cleanup() {
  ./aos show remove-all >/dev/null 2>&1 || true
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

aos_test_start_daemon "$ROOT" toolkit packages/toolkit \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

./aos show create \
  --id action-target \
  --at 40,40,220,120 \
  --html '<!doctype html><html><body><script>
window.headsup = window.headsup || {};
window.headsup.receive = function receive(b64) {
  const msg = JSON.parse(atob(b64));
  if (msg.type === "action-ping") {
    document.body.dataset.ping = String(msg.payload && msg.payload.n);
  }
};
</script></body></html>' >/dev/null

./aos show create \
  --id action-source \
  --at 280,40,280,160 \
  --interactive \
  --html '<!doctype html><html><body><script>
window.headsup = window.headsup || {};
window.headsup.receive = function receive(b64) {
  const msg = JSON.parse(atob(b64));
  if (msg.type !== "canvas.response") return;
  const key = String(msg.request_id || "").replace(/[^a-zA-Z0-9_]/g, "_");
  document.body.dataset[key] = msg.status || "";
  document.body.dataset[key + "Code"] = msg.code || "";
};
window.sendAction = function sendAction(requestId, action, payload) {
  window.webkit.messageHandlers.headsup.postMessage({
    type: "aos.action",
    payload: { ...(payload || {}), request_id: requestId, action }
  });
};
window.__aosActionReady = true;
</script></body></html>' >/dev/null

./aos show wait \
  --id action-source \
  --js 'window.__aosActionReady === true' \
  --timeout 5s >/dev/null

./aos show eval --id action-source --js \
  'window.sendAction("open_url", "macos.open_url", { url: "https://www.example.com/" }); "ok"' >/dev/null
./aos show eval --id action-source --js \
  'window.sendAction("canvas_send", "canvas.send", { target: "action-target", message: { type: "action-ping", payload: { n: 42 } } }); "ok"' >/dev/null
./aos show eval --id action-source --js \
  'window.sendAction("panel_open", "panel.open", { id: "action-panel", url: "aos://toolkit/runtime/_smoke/index.html", frame: [60, 70, 320, 220], interactive: true, focus: false }); "ok"' >/dev/null

./aos show wait \
  --id action-source \
  --js 'document.body.dataset.open_url === "ok" && document.body.dataset.canvas_send === "ok" && document.body.dataset.panel_open === "ok"' \
  --timeout 5s >/dev/null

./aos show wait \
  --id action-target \
  --js 'document.body.dataset.ping === "42"' \
  --timeout 5s >/dev/null

grep -qx 'https://www.example.com/' "$AOS_OPEN_URL_LOG" || {
  echo "FAIL: injected URL opener did not record expected URL" >&2
  exit 1
}

./aos show wait \
  --id action-panel \
  --manifest runtime-smoke \
  --timeout 5s >/dev/null

python3 - <<'PY'
import json, subprocess, time

def rect_value(rect, key):
    aliases = {
        "w": ("w", "width"),
        "h": ("h", "height"),
    }
    for name in aliases.get(key, (key,)):
        if name in rect:
            return float(rect[name])
    raise KeyError(key)

geometry = json.loads(subprocess.check_output(["./aos", "see", "list"], text=True))
display = next(
    (
        item for item in geometry.get("displays", [])
        if rect_value(item.get("visible_desktop_world_bounds", {}), "w") >= 240
        and rect_value(item.get("visible_desktop_world_bounds", {}), "h") >= 180
    ),
    None,
)
if not display:
    raise SystemExit("FAIL: no display large enough for desktop-world panel anchor test")

desktop = display["desktop_world_bounds"]
native = display["native_bounds"]
visible = display["visible_desktop_world_bounds"]
anchor_x = rect_value(visible, "x") + 20
anchor_y = rect_value(visible, "y") + 20
expected = [
    anchor_x + rect_value(native, "x") - rect_value(desktop, "x"),
    anchor_y + rect_value(native, "y") - rect_value(desktop, "y"),
    180,
    120,
]
payload = {
    "id": "action-anchor-panel",
    "url": "aos://toolkit/runtime/_smoke/index.html",
    "width": expected[2],
    "height": expected[3],
    "interactive": True,
    "focus": False,
    "anchor": {
        "coordinate_space": "desktop_world",
        "x": anchor_x,
        "y": anchor_y,
        "offset": {"x": 0, "y": 0},
    },
}
subprocess.check_call([
    "./aos", "show", "eval",
    "--id", "action-source",
    "--js", f'window.sendAction("panel_anchor", "panel.open", {json.dumps(payload)}); "ok"',
], stdout=subprocess.DEVNULL)
subprocess.check_call([
    "./aos", "show", "wait",
    "--id", "action-source",
    "--js", 'document.body.dataset.panel_anchor === "ok"',
    "--timeout", "5s",
], stdout=subprocess.DEVNULL)
subprocess.check_call([
    "./aos", "show", "wait",
    "--id", "action-anchor-panel",
    "--manifest", "runtime-smoke",
    "--timeout", "5s",
], stdout=subprocess.DEVNULL)

for _ in range(30):
    payload = json.loads(subprocess.check_output(["./aos", "show", "list"], text=True))
    panel = next((item for item in payload.get("canvases", []) if item.get("id") == "action-anchor-panel"), None)
    frame = panel.get("at", [])[:4] if panel else []
    if len(frame) == 4 and all(abs(float(a) - float(b)) < 0.51 for a, b in zip(frame, expected)):
        break
    time.sleep(0.1)
else:
    raise SystemExit(f"FAIL: desktop-world anchor panel frame mismatch: expected={expected} actual={panel}")
PY

./aos show eval --id action-source --js \
  'window.sendAction("panel_toggle", "panel.toggle", { id: "action-panel", frame: [80, 90, 320, 220], interactive: true, toggle_behavior: "reposition" }); "ok"' >/dev/null
./aos show wait \
  --id action-source \
  --js 'document.body.dataset.panel_toggle === "ok"' \
  --timeout 5s >/dev/null

python3 - <<'PY'
import json, subprocess, time

for _ in range(30):
    payload = json.loads(subprocess.check_output(["./aos", "show", "list"], text=True))
    panel = next((item for item in payload.get("canvases", []) if item.get("id") == "action-panel"), None)
    if panel and panel.get("at", [])[:4] == [80, 90, 320, 220]:
        break
    time.sleep(0.1)
else:
    raise SystemExit(f"FAIL: action-panel was not repositioned: {panel}")
PY

./aos show eval --id action-source --js \
  'window.sendAction("panel_close", "panel.close", { id: "action-panel" }); "ok"' >/dev/null
./aos show wait \
  --id action-source \
  --js 'document.body.dataset.panel_close === "ok"' \
  --timeout 5s >/dev/null

python3 - <<'PY'
import json, subprocess, time

for _ in range(30):
    payload = json.loads(subprocess.check_output(["./aos", "show", "list"], text=True))
    if not any(item.get("id") == "action-panel" for item in payload.get("canvases", [])):
        print("PASS")
        raise SystemExit(0)
    time.sleep(0.1)

raise SystemExit("FAIL: action-panel still exists after panel.close")
PY

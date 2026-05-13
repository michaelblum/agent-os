#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-canvas-non-finite-frame"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"
unset AOS_REPO_ROOT

cleanup() {
  ./aos show remove-all >/dev/null 2>&1 || true
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

aos_test_start_daemon "$ROOT" \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

CANVAS_ID="${PREFIX}-owner-$$"

./aos show create \
  --id "$CANVAS_ID" \
  --at 20,20,260,120 \
  --html '<!doctype html><html><body><script>
window.headsup = window.headsup || {};
window.headsup.receive = function(b64) {
  const msg = JSON.parse(atob(b64));
  if (msg.type !== "canvas.response") return;
  document.body.dataset[msg.request_id + "Status"] = msg.status;
  document.body.dataset[msg.request_id + "Code"] = msg.code || "";
  document.body.dataset[msg.request_id + "Message"] = msg.message || "";
};
</script></body></html>' >/dev/null

./aos show eval --id "$CANVAS_ID" --js '
window.webkit.messageHandlers.headsup.postMessage({
  type: "canvas.create",
  payload: {
    request_id: "badCreate",
    id: "bad-frame-child",
    url: "data:text/html,%3C!doctype%20html%3Echild",
    frame: [NaN, 10, 100, 80]
  }
});
window.webkit.messageHandlers.headsup.postMessage({
  type: "canvas.update",
  payload: {
    request_id: "badUpdate",
    frame: [20, Infinity, 260, 120]
  }
});
"posted";
' >/dev/null

./aos show wait \
  --id "$CANVAS_ID" \
  --js 'document.body.dataset.badCreateStatus === "error" && document.body.dataset.badCreateCode === "INVALID_FRAME" && /finite/.test(document.body.dataset.badCreateMessage || "") && document.body.dataset.badUpdateStatus === "error" && document.body.dataset.badUpdateCode === "INVALID_FRAME" && /finite/.test(document.body.dataset.badUpdateMessage || "")' \
  --timeout 5s >/dev/null

./aos status --json | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") == "ok", d
assert d.get("runtime", {}).get("socket_reachable") is True, d
'

echo "PASS"

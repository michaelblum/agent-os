#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-canvas-info-readiness"
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

aos_test_start_daemon "$ROOT" toolkit packages/toolkit \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

OWNER_ID="${PREFIX}-owner-$$"
CALLER_ID="${PREFIX}-caller-$$"
STAGE_ID="${PREFIX}-stage-$$"

./aos show create \
  --id "$OWNER_ID" \
  --at 20,20,260,120 \
  --html "<!doctype html><html><body><script>
window.headsup = window.headsup || {};
window.headsup.receive = function(b64) {
  const msg = JSON.parse(atob(b64));
  if (msg.type === 'canvas.response' && msg.request_id === 'create-stage') {
    document.body.dataset.createStatus = msg.status;
    document.body.dataset.createCode = msg.code || '';
  }
};
window.webkit.messageHandlers.headsup.postMessage({
  type: 'canvas.create',
  payload: {
    request_id: 'create-stage',
    id: '$STAGE_ID',
    url: 'aos://toolkit/components/desktop-world-stage/index.html',
    surface: 'desktop-world',
    scope: 'global',
    interactive: false,
    focus: false,
    cascade: false
  }
});
</script></body></html>" >/dev/null

./aos show wait \
  --id "$OWNER_ID" \
  --js 'document.body.dataset.createStatus === "ok"' \
  --timeout 5s >/dev/null

./aos show wait \
  --id "$STAGE_ID" \
  --manifest desktop-world-stage \
  --timeout 5s >/dev/null

./aos show create \
  --id "$CALLER_ID" \
  --at 300,20,300,160 \
  --html "<!doctype html><html><body><script>
window.headsup = window.headsup || {};
window.headsup.receive = function(b64) {
  const msg = JSON.parse(atob(b64));
  if (msg.type !== 'canvas.response') return;
  if (msg.request_id === 'info-stage') {
    document.body.dataset.infoStatus = msg.status;
    document.body.dataset.infoManifest = msg.ready && msg.ready.manifest && msg.ready.manifest.name || '';
    document.body.dataset.infoLifecycle = msg.ready && msg.ready.lifecycle_state || '';
  }
  if (msg.request_id === 'eval-stage') {
    document.body.dataset.evalStatus = msg.status;
    document.body.dataset.evalCode = msg.code || '';
  }
};
window.webkit.messageHandlers.headsup.postMessage({
  type: 'canvas.info',
  payload: { request_id: 'info-stage', id: '$STAGE_ID' }
});
window.webkit.messageHandlers.headsup.postMessage({
  type: 'canvas.eval',
  payload: { request_id: 'eval-stage', id: '$STAGE_ID', js: 'document.title' }
});
</script></body></html>" >/dev/null

./aos show wait \
  --id "$CALLER_ID" \
  --js 'document.body.dataset.infoStatus === "ok" && document.body.dataset.infoManifest === "desktop-world-stage" && document.body.dataset.evalCode === "FORBIDDEN"' \
  --timeout 5s >/dev/null

echo "PASS"

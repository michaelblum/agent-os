#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-sigil-renderer-bootstrap"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

./aos set content.roots.sigil apps/sigil >/dev/null
AOS_BIN="$(pwd)/aos" AOS_RUNTIME_MODE=repo apps/sigil/sigilctl-seed.sh >/dev/null

aos_test_start_daemon "$ROOT" sigil apps/sigil \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

./aos show create \
  --id sigil-bootstrap \
  --url 'aos://sigil/renderer/index.html' \
  --track union >/dev/null

./aos show wait \
  --id sigil-bootstrap \
  --js 'window.liveJs && window.liveJs.currentAgentId === "default" && window.liveJs.avatarPos && window.liveJs.avatarPos.valid === true && Array.isArray(window.liveJs.displays) && window.liveJs.displays.length > 0' \
  --timeout 10s >/dev/null

JSON_PATH="$ROOT/sigil-bootstrap.json"
./aos show eval \
  --id sigil-bootstrap \
  --js 'JSON.stringify({agentId: window.liveJs.currentAgentId, avatarPos: window.liveJs.avatarPos, displays: window.liveJs.displays.length, state: window.liveJs.currentState})' \
  >"$JSON_PATH"

python3 - "$JSON_PATH" <<'PY'
import json, pathlib, sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert payload["status"] == "success", payload
state = json.loads(payload["result"])
assert state["agentId"] == "default", state
assert state["avatarPos"]["valid"] is True, state
assert state["displays"] >= 1, state
assert state["state"] == "IDLE", state
print("PASS")
PY

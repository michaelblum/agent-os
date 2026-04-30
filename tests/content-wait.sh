#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-content-wait"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

./aos set content.roots.toolkit packages/toolkit >/dev/null

JSON_PATH="$ROOT/content-wait.json"
./aos content wait --root toolkit --auto-start --timeout 10s --json > "$JSON_PATH"

aos_test_wait_for_socket "$ROOT" || { echo "FAIL: daemon socket did not become reachable"; exit 1; }

python3 - "$JSON_PATH" <<'PY'
import json, pathlib, sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert payload["status"] == "success", payload
assert payload["ready"] is True, payload
assert int(payload["port"]) > 0, payload
expected = str((pathlib.Path.cwd() / "packages/toolkit").resolve())
assert payload["roots"]["toolkit"] == expected, payload
print("PASS")
PY

aos_test_kill_root "$ROOT"

BAD_ROOT="$ROOT/removed-worktree/packages/toolkit"
./aos set content.roots.toolkit "$BAD_ROOT" >/dev/null

BAD_JSON_PATH="$ROOT/content-wait-stale.json"
BAD_ERR_PATH="$ROOT/content-wait-stale.err"
if ./aos content wait --root toolkit --auto-start --timeout 5s --json > "$BAD_JSON_PATH" 2> "$BAD_ERR_PATH"; then
  echo "FAIL: stale toolkit content root should not become ready"
  exit 1
fi

python3 - "$BAD_ERR_PATH" "$BAD_ROOT" <<'PY'
import json, pathlib, sys

stderr = pathlib.Path(sys.argv[1]).read_text()
payload = json.loads(stderr[stderr.index("{"):])
assert payload["code"] == "CONTENT_ROOT_INVALID", payload
message = payload["error"]
assert "Content root 'toolkit' points to a missing path" in message, payload
assert "/removed-worktree/packages/toolkit" in message, payload
print("PASS stale-root")
PY

READY_JSON_PATH="$ROOT/ready-stale-root.json"
if AOS_TEST_SKIP_READY_SERVICE_START=1 ./aos ready --json > "$READY_JSON_PATH"; then
  echo "FAIL: ready should report stale canonical content root as a blocker"
  exit 1
fi

python3 - "$READY_JSON_PATH" <<'PY'
import json, pathlib, sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
content_blockers = [
    blocker for blocker in payload.get("blockers", [])
    if blocker.get("kind") == "content"
]
assert content_blockers, payload
assert any("show" in blocker.get("blocks", []) for blocker in content_blockers), payload
assert any(blocker.get("scope") == "toolkit" for blocker in content_blockers), payload
print("PASS ready-stale-root")
PY

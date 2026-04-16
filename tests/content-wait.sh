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

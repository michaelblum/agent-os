#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-show-wait"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

./aos set content.roots.toolkit packages/toolkit >/dev/null
./aos content wait --root toolkit --auto-start --timeout 10s >/dev/null

./aos show create \
  --id wait-smoke \
  --at 80,80,320,200 \
  --url 'aos://toolkit/runtime/_smoke/index.html' >/dev/null

JSON_PATH="$ROOT/show-wait.json"
./aos show wait \
  --id wait-smoke \
  --manifest runtime-smoke \
  --js 'document.body.textContent.includes("runtime smoke")' \
  --timeout 5s \
  --json > "$JSON_PATH"

python3 - "$JSON_PATH" <<'PY'
import json, pathlib, sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert payload["status"] == "success", payload
assert payload["ready"] is True, payload
assert payload["id"] == "wait-smoke", payload
print("PASS")
PY

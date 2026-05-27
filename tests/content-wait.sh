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

if ./aos content status --bogus 2>"$ROOT/content-status-bogus.err"; then
  echo "FAIL: content status accepted unknown flag"
  exit 1
fi
grep -q '"code" : "UNKNOWN_FLAG"' "$ROOT/content-status-bogus.err" || {
  cat "$ROOT/content-status-bogus.err"
  echo "FAIL: content status unknown flag did not use UNKNOWN_FLAG"
  exit 1
}

if ./aos content status extra 2>"$ROOT/content-status-extra.err"; then
  echo "FAIL: content status accepted extra positional"
  exit 1
fi
grep -q '"code" : "UNKNOWN_ARG"' "$ROOT/content-status-extra.err" || {
  cat "$ROOT/content-status-extra.err"
  echo "FAIL: content status extra positional did not use UNKNOWN_ARG"
  exit 1
}
grep -q '"error" : "Unknown argument: extra"' "$ROOT/content-status-extra.err" || {
  cat "$ROOT/content-status-extra.err"
  echo "FAIL: content status extra positional message did not say Unknown argument"
  exit 1
}

if ./aos content wait --bogus 2>"$ROOT/content-wait-bogus.err"; then
  echo "FAIL: content wait accepted unknown flag"
  exit 1
fi
grep -q '"code" : "UNKNOWN_FLAG"' "$ROOT/content-wait-bogus.err" || {
  cat "$ROOT/content-wait-bogus.err"
  echo "FAIL: content wait unknown flag did not use UNKNOWN_FLAG"
  exit 1
}

if ./aos content wait extra 2>"$ROOT/content-wait-extra.err"; then
  echo "FAIL: content wait accepted extra positional"
  exit 1
fi
grep -q '"code" : "UNKNOWN_ARG"' "$ROOT/content-wait-extra.err" || {
  cat "$ROOT/content-wait-extra.err"
  echo "FAIL: content wait extra positional did not use UNKNOWN_ARG"
  exit 1
}
grep -q '"error" : "Unknown argument: extra"' "$ROOT/content-wait-extra.err" || {
  cat "$ROOT/content-wait-extra.err"
  echo "FAIL: content wait extra positional message did not say Unknown argument"
  exit 1
}

if ./aos content wait --root --json 2>"$ROOT/content-wait-root-missing.err"; then
  echo "FAIL: content wait accepted missing --root value"
  exit 1
fi
grep -q '"code" : "MISSING_ARG"' "$ROOT/content-wait-root-missing.err" || {
  cat "$ROOT/content-wait-root-missing.err"
  echo "FAIL: content wait missing --root value did not use MISSING_ARG"
  exit 1
}

if ./aos content wait --timeout --json 2>"$ROOT/content-wait-timeout-missing.err"; then
  echo "FAIL: content wait accepted missing --timeout value"
  exit 1
fi
grep -q '"code" : "MISSING_ARG"' "$ROOT/content-wait-timeout-missing.err" || {
  cat "$ROOT/content-wait-timeout-missing.err"
  echo "FAIL: content wait missing --timeout value did not use MISSING_ARG"
  exit 1
}

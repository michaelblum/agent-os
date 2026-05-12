#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-show-update-reload"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
ASSET_ROOT="$ROOT/assets"
mkdir -p "$ASSET_ROOT"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

write_asset() {
  local version="$1"
  cat > "$ASSET_ROOT/index.html" <<HTML
<!doctype html>
<html>
<body>
  <main id="version">version ${version}</main>
  <script>
    window.headsup = window.headsup || {};
    window.headsup.receive = window.headsup.receive || function () {};
    window.__reloadVersion = "${version}";
    window.webkit?.messageHandlers?.headsup?.postMessage({
      type: "ready",
      payload: { name: "reload-smoke" }
    });
  </script>
</body>
</html>
HTML
}

write_asset one

aos_test_start_daemon "$ROOT" reloadtest "$ASSET_ROOT" \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

./aos show create \
  --id reload-target \
  --at 90,100,320,180 \
  --interactive \
  --window-level floating \
  --ttl 30s \
  --url 'aos://reloadtest/index.html' >/dev/null

./aos show create \
  --id reload-unrelated \
  --at 450,100,120,80 \
  --html '<!doctype html><html><body>unrelated</body></html>' >/dev/null

./aos show wait \
  --id reload-target \
  --js 'window.__reloadVersion === "one"' \
  --timeout 5s >/dev/null

BEFORE_JSON="$ROOT/before.json"
./aos show get --id reload-target > "$BEFORE_JSON"

write_asset two

./aos show update \
  --id reload-target \
  --url 'aos://reloadtest/index.html' >/dev/null

./aos show wait \
  --id reload-target \
  --js 'window.__reloadVersion === "two"' \
  --timeout 5s >/dev/null

AFTER_JSON="$ROOT/after.json"
UNRELATED_JSON="$ROOT/unrelated.json"
./aos show get --id reload-target > "$AFTER_JSON"
./aos show get --id reload-unrelated > "$UNRELATED_JSON"

python3 - "$BEFORE_JSON" "$AFTER_JSON" "$UNRELATED_JSON" <<'PY'
import json
import pathlib
import sys

before = json.loads(pathlib.Path(sys.argv[1]).read_text())["canvas"]
after = json.loads(pathlib.Path(sys.argv[2]).read_text())["canvas"]
unrelated = json.loads(pathlib.Path(sys.argv[3]).read_text())

assert unrelated["exists"] is True, unrelated
assert before["id"] == after["id"] == "reload-target", (before, after)
assert before["at"] == after["at"], (before, after)
assert before["interactive"] is True and after["interactive"] is True, (before, after)
assert before["windowLevel"] == after["windowLevel"] == "floating", (before, after)
assert before["scope"] == after["scope"] == "global", (before, after)
assert before.get("track") == after.get("track"), (before, after)
assert before.get("parent") == after.get("parent"), (before, after)
assert before.get("lifecycleState") == after.get("lifecycleState") == "active", (before, after)

before_ttl = before.get("ttl")
after_ttl = after.get("ttl")
assert isinstance(before_ttl, (int, float)) and before_ttl > 0, before
assert isinstance(after_ttl, (int, float)) and after_ttl > 0, after
assert after_ttl <= before_ttl, (before_ttl, after_ttl)
assert before_ttl - after_ttl < 10, (before_ttl, after_ttl)

print("PASS")
PY

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

source tests/lib/isolated-daemon.sh

PREFIX="aos-clean-canvas-regression"
aos_test_cleanup_prefix "$PREFIX"

STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$STATE_ROOT"
export AOS_RUNTIME_MODE=repo

cleanup() {
  aos_test_kill_root "$STATE_ROOT"
  rm -rf "$STATE_ROOT"
}
trap cleanup EXIT

aos_test_start_daemon "$STATE_ROOT" repo "$ROOT_DIR" \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

./aos show create \
  --id clean-regression-canvas \
  --at 80,80,240,120 \
  --html '<html><body>clean regression</body></html>' \
  >/dev/null

DRY_RUN="$(./aos clean --dry-run --json)"
DRY_RUN="$DRY_RUN" python3 - <<'PY'
import json, os

payload = json.loads(os.environ["DRY_RUN"])
assert payload["status"] == "dirty", payload
assert any(canvas.get("id") == "clean-regression-canvas" for canvas in payload.get("canvases", [])), payload
PY

CLEANED="$(./aos clean --json)"
CLEANED="$CLEANED" python3 - <<'PY'
import json, os

payload = json.loads(os.environ["CLEANED"])
assert payload["status"] in {"clean", "cleaned"}, payload
assert not payload.get("canvases"), payload
assert any("removed canvas id=clean-regression-canvas" in action for action in payload.get("actions_taken", [])), payload
PY

STATUS="$(./aos status --json)"
STATUS="$STATUS" python3 - <<'PY'
import json, os

payload = json.loads(os.environ["STATUS"])
assert payload.get("status") == "ok", payload
assert payload.get("stale_resources", {}).get("canvases") == [], payload
PY

mkdir -p "$STATE_ROOT/repo"
cat >"$STATE_ROOT/repo/experience-state.json" <<'JSON'
{
  "active_experience": "sigil",
  "exclusive": true
}
JSON

./aos show create \
  --id avatar-main \
  --at 80,80,240,120 \
  --html '<html><body>owned sigil avatar</body></html>' \
  >/dev/null

OWNED_DRY_RUN="$(./aos clean --dry-run --json)"
OWNED_DRY_RUN="$OWNED_DRY_RUN" python3 - <<'PY'
import json, os

payload = json.loads(os.environ["OWNED_DRY_RUN"])
assert payload["status"] == "clean", payload
assert not payload.get("canvases"), payload
PY

cat >"$STATE_ROOT/repo/experience-state.json" <<'JSON'
{
  "active_experience": null,
  "exclusive": true
}
JSON

STALE_DRY_RUN="$(./aos clean --dry-run --json)"
STALE_DRY_RUN="$STALE_DRY_RUN" python3 - <<'PY'
import json, os

payload = json.loads(os.environ["STALE_DRY_RUN"])
assert payload["status"] == "dirty", payload
assert any(canvas.get("id") == "avatar-main" for canvas in payload.get("canvases", [])), payload
PY

STALE_CLEANED="$(./aos clean --json)"
STALE_CLEANED="$STALE_CLEANED" python3 - <<'PY'
import json, os

payload = json.loads(os.environ["STALE_CLEANED"])
assert payload["status"] in {"clean", "cleaned"}, payload
assert not payload.get("canvases"), payload
assert any("removed canvas id=avatar-main" in action for action in payload.get("actions_taken", [])), payload
PY

echo "PASS"

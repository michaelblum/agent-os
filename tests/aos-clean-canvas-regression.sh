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

./aos config set status_item.enabled true >/dev/null
./aos config set status_item.toggle_id avatar-main >/dev/null
./aos config set status_item.toggle_url 'aos://sigil_old_branch/renderer/index.html?toolkit-root=toolkit_old_branch' >/dev/null
./aos config set status_item.toggle_track union >/dev/null

DRIFT_DRY_RUN="$(./aos clean --dry-run --json)"
DRIFT_DRY_RUN="$DRIFT_DRY_RUN" python3 - <<'PY'
import json, os

payload = json.loads(os.environ["DRIFT_DRY_RUN"])
assert payload["status"] == "dirty", payload
notes = "\n".join(payload.get("notes", []))
assert "Active Sigil status item target drift" in notes, payload
assert "missing content root" in notes, payload
assert "./aos experience activate sigil" in notes, payload
PY

BRANCH_SUFFIX="$(git branch --show-current | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/_/g; s/^_+//; s/_+$//')"
SIGIL_ROOT="sigil_${BRANCH_SUFFIX:-worktree}"
TOOLKIT_ROOT="toolkit_${BRANCH_SUFFIX:-worktree}"
./aos config set "content.roots.$SIGIL_ROOT" "$ROOT_DIR/apps/sigil" >/dev/null
./aos config set "content.roots.$TOOLKIT_ROOT" "$ROOT_DIR/packages/toolkit" >/dev/null
./aos config set status_item.toggle_url "aos://$SIGIL_ROOT/renderer/index.html?toolkit-root=$TOOLKIT_ROOT" >/dev/null

create_canvas() {
  local id="$1"
  ./aos show create \
    --id "$id" \
    --at 80,80,240,120 \
    --html "<html><body>$id</body></html>" \
    >/dev/null
}

for id in \
  avatar-main \
  sigil-hit-avatar-main \
  sigil-radial-menu-avatar-main \
  sigil-agent-terminal \
  sigil-wiki-workbench \
  sigil-render-performance \
  sigil-interaction-trace \
  surface-inspector \
  __log__ \
  clean-unowned-canvas
do
  create_canvas "$id"
done

./aos show eval --id sigil-render-performance --js '
window.webkit.messageHandlers.headsup.postMessage({
  type: "canvas.create",
  payload: {
    id: "aos-desktop-world-stage",
    url: "aos://sigil/tests/mutation/child.html",
    surface: "desktop-world",
    request_id: "clean-regression-diagnostic-stage"
  }
});
"requested";
' >/dev/null

python3 - <<'PY'
import json, subprocess, time

deadline = time.time() + 5
while time.time() < deadline:
    payload = json.loads(subprocess.check_output(["./aos", "show", "list", "--json"]))
    canvases = {canvas.get("id"): canvas for canvas in payload.get("canvases", [])}
    stage = canvases.get("aos-desktop-world-stage")
    if stage and stage.get("parent") == "sigil-render-performance":
        break
    time.sleep(0.1)
else:
    raise SystemExit(f"FAIL: diagnostic-parented desktop-world stage was not created: {canvases!r}")
PY

OWNED_IDS="avatar-main sigil-hit-avatar-main sigil-radial-menu-avatar-main sigil-agent-terminal sigil-wiki-workbench"
DIAGNOSTIC_IDS="sigil-render-performance sigil-interaction-trace aos-desktop-world-stage"
UNOWNED_IDS="surface-inspector __log__ clean-unowned-canvas"

OWNED_DRY_RUN="$(./aos clean --dry-run --json)"
OWNED_DRY_RUN="$OWNED_DRY_RUN" OWNED_IDS="$OWNED_IDS" DIAGNOSTIC_IDS="$DIAGNOSTIC_IDS" UNOWNED_IDS="$UNOWNED_IDS" python3 - <<'PY'
import json, os

payload = json.loads(os.environ["OWNED_DRY_RUN"])
stale_ids = {canvas.get("id") for canvas in payload.get("canvases", [])}
for canvas_id in os.environ["OWNED_IDS"].split():
    assert canvas_id not in stale_ids, (canvas_id, payload)
for canvas_id in os.environ["DIAGNOSTIC_IDS"].split():
    assert canvas_id in stale_ids, (canvas_id, payload)
for canvas_id in os.environ["UNOWNED_IDS"].split():
    assert canvas_id in stale_ids, (canvas_id, payload)
PY

OWNED_STATUS="$(./aos status --json)"
OWNED_STATUS="$OWNED_STATUS" OWNED_IDS="$OWNED_IDS" DIAGNOSTIC_IDS="$DIAGNOSTIC_IDS" UNOWNED_IDS="$UNOWNED_IDS" python3 - <<'PY'
import json, os

payload = json.loads(os.environ["OWNED_STATUS"])
stale_ids = set(payload.get("stale_resources", {}).get("canvases", []))
for canvas_id in os.environ["OWNED_IDS"].split():
    assert canvas_id not in stale_ids, (canvas_id, payload)
for canvas_id in os.environ["DIAGNOSTIC_IDS"].split():
    assert canvas_id in stale_ids, (canvas_id, payload)
for canvas_id in os.environ["UNOWNED_IDS"].split():
    assert canvas_id in stale_ids, (canvas_id, payload)
PY

OWNED_CLEANED="$(./aos clean --json)"
OWNED_CLEANED="$OWNED_CLEANED" OWNED_IDS="$OWNED_IDS" DIAGNOSTIC_IDS="$DIAGNOSTIC_IDS" UNOWNED_IDS="$UNOWNED_IDS" python3 - <<'PY'
import json, os, subprocess

payload = json.loads(os.environ["OWNED_CLEANED"])
assert payload["status"] in {"clean", "cleaned"}, payload
remaining_stale_ids = {canvas.get("id") for canvas in payload.get("canvases", [])}
for canvas_id in os.environ["OWNED_IDS"].split():
    assert canvas_id not in remaining_stale_ids, (canvas_id, payload)
for canvas_id in os.environ["DIAGNOSTIC_IDS"].split():
    if canvas_id != "aos-desktop-world-stage":
        assert any(f"removed canvas id={canvas_id}" in action for action in payload.get("actions_taken", [])), (canvas_id, payload)
for canvas_id in os.environ["UNOWNED_IDS"].split():
    assert any(f"removed canvas id={canvas_id}" in action for action in payload.get("actions_taken", [])), (canvas_id, payload)

canvases = {canvas.get("id") for canvas in json.loads(subprocess.check_output(["./aos", "show", "list", "--json"])).get("canvases", [])}
for canvas_id in os.environ["OWNED_IDS"].split():
    assert canvas_id in canvases, (canvas_id, canvases)
for canvas_id in os.environ["DIAGNOSTIC_IDS"].split():
    assert canvas_id not in canvases, (canvas_id, canvases)
for canvas_id in os.environ["UNOWNED_IDS"].split():
    assert canvas_id not in canvases, (canvas_id, canvases)
PY

OWNED_CLEAN_STATUS="$(./aos status --json)"
OWNED_CLEAN_STATUS="$OWNED_CLEAN_STATUS" python3 - <<'PY'
import json, os

payload = json.loads(os.environ["OWNED_CLEAN_STATUS"])
assert payload.get("stale_resources", {}).get("canvases") == [], payload
PY

cat >"$STATE_ROOT/repo/experience-state.json" <<'JSON'
{
  "active_experience": null,
  "exclusive": true
}
JSON

STALE_DRY_RUN="$(./aos clean --dry-run --json)"
STALE_DRY_RUN="$STALE_DRY_RUN" OWNED_IDS="$OWNED_IDS" python3 - <<'PY'
import json, os

payload = json.loads(os.environ["STALE_DRY_RUN"])
assert payload["status"] == "dirty", payload
stale_ids = {canvas.get("id") for canvas in payload.get("canvases", [])}
for canvas_id in os.environ["OWNED_IDS"].split():
    assert canvas_id in stale_ids, (canvas_id, payload)
PY

STALE_CLEANED="$(./aos clean --json)"
STALE_CLEANED="$STALE_CLEANED" OWNED_IDS="$OWNED_IDS" python3 - <<'PY'
import json, os

payload = json.loads(os.environ["STALE_CLEANED"])
assert payload["status"] in {"clean", "cleaned"}, payload
assert not payload.get("canvases"), payload
for canvas_id in os.environ["OWNED_IDS"].split():
    assert any(f"removed canvas id={canvas_id}" in action for action in payload.get("actions_taken", [])), (canvas_id, payload)
PY

echo "PASS"

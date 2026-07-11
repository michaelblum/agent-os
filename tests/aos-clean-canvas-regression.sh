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

aos_test_start_daemon "$STATE_ROOT" repo "$ROOT_DIR" toolkit "$ROOT_DIR/packages/toolkit" \
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

mkdir -p "$STATE_ROOT/installed"
cat >"$STATE_ROOT/installed/daemon.lock" <<'JSON'
{"pid":999999,"mode":"installed","socket_path":"/tmp/aos-missing.sock"}
JSON

LOCK_DRY_RUN="$(./aos clean --dry-run --json)"
LOCK_DRY_RUN="$LOCK_DRY_RUN" python3 - <<'PY'
import json, os

payload = json.loads(os.environ["LOCK_DRY_RUN"])
assert payload["status"] == "dirty", payload
assert any(lock.get("mode") == "installed" and lock.get("pid") == 999999 for lock in payload.get("stale_locks", [])), payload
PY

./aos clean --json >/dev/null
test ! -e "$STATE_ROOT/installed/daemon.lock"

EXPECTED_URL="$(node --input-type=module - "$ROOT_DIR" <<'JS'
import { discoverExperience, projectedToggleURL, resolveContentRoots, rootMap } from './scripts/lib/experience-manifest.mjs';

const repoRoot = process.argv[2];
const manifest = discoverExperience('operator-fixture', { experiencesRoot: `${repoRoot}/experiences` });
const roots = resolveContentRoots(manifest, { repoRoot });
const surface = manifest.status_item.toggle_surface;
process.stdout.write(projectedToggleURL(manifest, surface, rootMap(roots), { mode: 'repo', repoRoot }));
JS
)"

write_active_state() {
  local active_id="$1"
  python3 - "$STATE_ROOT" "$active_id" <<'PY'
import json, pathlib, sys

root = pathlib.Path(sys.argv[1]) / "repo"
root.mkdir(parents=True, exist_ok=True)
active = sys.argv[2] or None
(root / "experience-state.json").write_text(json.dumps({"active_experience": active, "exclusive": True}, indent=2) + "\n")
PY
}

write_status_item() {
  local url="$1"
  python3 - "$STATE_ROOT" "$url" <<'PY'
import json, pathlib, sys

root = pathlib.Path(sys.argv[1]) / "repo"
path = root / "config.json"
try:
    config = json.loads(path.read_text())
except Exception:
    config = {}
config.setdefault("content", {}).setdefault("roots", {})["toolkit"] = "packages/toolkit"
config["status_item"] = {
    "enabled": True,
    "toggle_id": "operator-fixture-surface",
    "toggle_url": sys.argv[2],
    "toggle_at": [200, 200, 300, 300],
    "toggle_track": "union",
    "icon": "aos",
}
path.write_text(json.dumps(config, indent=2) + "\n")
PY
}

write_active_state operator-fixture
write_status_item "$EXPECTED_URL"

./aos show create \
  --id operator-fixture-surface \
  --url "$EXPECTED_URL" \
  --at 80,80,320,180 \
  --interactive \
  >/dev/null

./aos show eval --id operator-fixture-surface --js '
window.webkit.messageHandlers.headsup.postMessage({
  type: "canvas.create",
  payload: {
    id: "operator-fixture-child",
    url: "aos://toolkit/runtime/_smoke/index.html",
    frame: [100, 100, 120, 80],
    request_id: "clean-regression-child"
  }
});
"requested";
' >/dev/null

./aos show create \
  --id stale-independent-surface \
  --at 480,80,240,120 \
  --html '<html><body>stale</body></html>' \
  >/dev/null

for _ in 1 2 3 4 5; do
  if ./aos show get --id operator-fixture-child | python3 -c 'import json,sys; raise SystemExit(0 if json.load(sys.stdin).get("exists") else 1)'; then
    break
  fi
  sleep 0.1
done

ACTIVE_DRY_RUN="$(./aos clean --dry-run --json)"
ACTIVE_DRY_RUN="$ACTIVE_DRY_RUN" python3 - <<'PY'
import json, os

payload = json.loads(os.environ["ACTIVE_DRY_RUN"])
stale = {canvas.get("id") for canvas in payload.get("canvases", [])}
assert "stale-independent-surface" in stale, payload
assert "operator-fixture-surface" not in stale, payload
assert "operator-fixture-child" not in stale, payload
PY

./aos clean --json >/dev/null
./aos show get --id operator-fixture-surface | python3 -c 'import json,sys; assert json.load(sys.stdin).get("exists")'
./aos show get --id operator-fixture-child | python3 -c 'import json,sys; assert json.load(sys.stdin).get("exists")'

write_status_item 'aos://missing-root/old-surface.html'
DRIFT="$(./aos clean --dry-run --json)"
DRIFT="$DRIFT" python3 - <<'PY'
import json, os

payload = json.loads(os.environ["DRIFT"])
notes = "\n".join(payload.get("notes", []))
assert "Active experience operator-fixture status item target drift" in notes, payload
assert "missing content root" in notes, payload
assert "./aos experience activate operator-fixture" in notes, payload
PY

write_status_item "$EXPECTED_URL"
write_active_state ""

FINAL="$(./aos clean --json)"
FINAL="$FINAL" python3 - <<'PY'
import json, os

payload = json.loads(os.environ["FINAL"])
assert payload["status"] in {"clean", "cleaned"}, payload
assert not payload.get("canvases"), payload
actions = "\n".join(payload.get("actions_taken", []))
assert "operator-fixture-surface" in actions, payload
PY

echo "PASS"

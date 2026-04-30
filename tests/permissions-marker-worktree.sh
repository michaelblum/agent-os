#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

PREFIX="aos-permissions-marker-worktree"
STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$STATE_ROOT"
export AOS_TEST_ASSUME_PERMISSIONS_GRANTED=1
export AOS_TEST_SKIP_READY_SERVICE_START=1

SOCK="$STATE_ROOT/repo/sock"
MARKER="$STATE_ROOT/repo/permissions-onboarding.json"
mkdir -p "$(dirname "$SOCK")"

cleanup() {
  if [[ -n "${MOCK_PID:-}" ]] && kill -0 "$MOCK_PID" 2>/dev/null; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
  fi
  rm -rf "$STATE_ROOT"
}
trap cleanup EXIT

python3 tests/lib/mock-daemon.py \
    --socket "$SOCK" \
    --tap-status active \
    --listen-access true \
    --post-access true \
    --accessibility true \
    >"$STATE_ROOT/mock.stdout" 2>"$STATE_ROOT/mock.stderr" &
MOCK_PID=$!

for _ in $(seq 1 20); do
  if [[ -S "$SOCK" ]]; then break; fi
  sleep 0.1
done
if ! [[ -S "$SOCK" ]]; then
  echo "FAIL: mock daemon did not bind socket $SOCK"
  exit 1
fi

python3 - "$MARKER" <<'PY'
import json
import pathlib
import sys

marker = pathlib.Path(sys.argv[1])
marker.write_text(json.dumps({
    "bundle_path": "/tmp/aos-other-worktree",
    "completed_at": "2026-04-30T00:00:00Z",
    "permissions": {
        "accessibility": True,
        "screen_recording": True,
        "listen_access": True,
        "post_access": True,
    },
}, indent=2, sort_keys=True), encoding="utf-8")
PY

OUT="$(./aos permissions check --json)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
setup = d.get("setup", {})
assert d.get("status") == "ok", d
assert d.get("ready_for_testing") is True, d
assert d.get("ready_source") == "daemon", d
assert setup.get("marker_exists") is True, setup
assert setup.get("bundle_matches_current") is False, setup
assert setup.get("setup_completed") is True, setup
notes = "\n".join(d.get("notes", []))
assert "different app bundle path" not in notes, notes
'
echo "PASS: permissions check accepts live-verified cross-worktree marker"

OUT="$(./aos ready --json)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("ready") is True, d
assert d.get("phase") == "ready", d
assert d.get("diagnosis") == "ready", d
blockers = {b.get("id") for b in d.get("blockers", [])}
assert "permissions_onboarding" not in blockers, d
setup = d.get("permissions_setup", {})
assert setup.get("bundle_matches_current") is False, setup
assert setup.get("setup_completed") is True, setup
'
echo "PASS: ready does not block on cross-worktree marker path"

rm -f "$MARKER"
set +e
OUT="$(./aos ready --json)"
RC=$?
set -e
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("ready") is False, d
assert d.get("phase") == "setup_required", d
assert d.get("diagnosis") == "permissions_onboarding_required", d
blockers = {b.get("id") for b in d.get("blockers", [])}
assert "permissions_onboarding" in blockers, d
'
if [[ "$RC" -eq 0 ]]; then
  echo "FAIL: ready exited 0 without any onboarding marker"
  exit 1
fi
echo "PASS: ready still requires an onboarding marker"

echo "PASS"

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source "$ROOT/tests/lib/isolated-daemon.sh"

TMPDIR_GUARD="$(mktemp -d "${TMPDIR:-/tmp}/aos-guarded-live.XXXXXX")"
cleanup() {
  rm -rf "$TMPDIR_GUARD"
}
trap cleanup EXIT

assert_json_failure() {
  local file="$1"
  local code="$2"
  python3 - "$file" "$code" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
expected = sys.argv[2]
assert payload["status"] == "failure", payload
assert payload["code"] == expected, payload
assert payload.get("operation_id"), payload
assert payload.get("blocker"), payload
assert "runtime_verdict" in payload, payload
assert payload.get("next_action"), payload
PY
}

if ./aos content wait --root toolkit --auto-start --timeout 1s --json >"$TMPDIR_GUARD/content.out" 2>"$TMPDIR_GUARD/content.err"; then
  echo "FAIL: content wait allowed --auto-start without --allow-start"
  exit 1
fi
assert_json_failure "$TMPDIR_GUARD/content.err" LIVE_START_NOT_ALLOWED

if ./aos show wait --id missing --auto-start --timeout 1s --json >"$TMPDIR_GUARD/show.out" 2>"$TMPDIR_GUARD/show.err"; then
  echo "FAIL: show wait allowed --auto-start without --allow-start"
  exit 1
fi
assert_json_failure "$TMPDIR_GUARD/show.err" LIVE_START_NOT_ALLOWED

if ./aos launch sigil --json >"$TMPDIR_GUARD/launch.out" 2>"$TMPDIR_GUARD/launch.err"; then
  echo "FAIL: launch succeeded without --allow-start"
  exit 1
fi
assert_json_failure "$TMPDIR_GUARD/launch.err" LIVE_START_NOT_ALLOWED

if ./aos experience activate sigil --json >"$TMPDIR_GUARD/experience.out" 2>"$TMPDIR_GUARD/experience.err"; then
  echo "FAIL: experience activate succeeded without --allow-start"
  exit 1
fi
assert_json_failure "$TMPDIR_GUARD/experience.err" LIVE_START_NOT_ALLOWED

SURFACE_STATE_ROOT="$TMPDIR_GUARD/surface-inspector-state"
mkdir -p "$SURFACE_STATE_ROOT"
if AOS_STATE_ROOT="$SURFACE_STATE_ROOT" AOS_RUNTIME_MODE=repo \
  packages/toolkit/components/surface-inspector/launch.sh \
  >"$TMPDIR_GUARD/surface-inspector.out" \
  2>"$TMPDIR_GUARD/surface-inspector.err"; then
  echo "FAIL: surface-inspector launch succeeded without --allow-start in isolated state"
  exit 1
fi
assert_json_failure "$TMPDIR_GUARD/surface-inspector.err" NO_DAEMON
if aos_test_socket_reachable "$SURFACE_STATE_ROOT" repo; then
  echo "FAIL: surface-inspector default launch started an isolated daemon"
  exit 1
fi
if [[ -n "$(aos_test_pids_for_root "$SURFACE_STATE_ROOT")" ]]; then
  echo "FAIL: surface-inspector default launch left an isolated daemon process"
  aos_test_pids_for_root "$SURFACE_STATE_ROOT"
  exit 1
fi

.docks/gdi/scripts/human-needed-runtime-blocker daemon_unmanaged >"$TMPDIR_GUARD/human-daemon.out"
grep -q '^human_needed: daemon_unmanaged$' "$TMPDIR_GUARD/human-daemon.out" || {
  cat "$TMPDIR_GUARD/human-daemon.out"
  echo "FAIL: daemon_unmanaged helper output missing distinct blocker"
  exit 1
}
if grep -q 'TCC reset needed' "$TMPDIR_GUARD/human-daemon.out"; then
  cat "$TMPDIR_GUARD/human-daemon.out"
  echo "FAIL: daemon_unmanaged helper collapsed to TCC reset wording"
  exit 1
fi

.docks/gdi/scripts/human-needed-tcc-reset >"$TMPDIR_GUARD/human-tcc.out"
grep -q '^human_needed: accessibility$' "$TMPDIR_GUARD/human-tcc.out" || {
  cat "$TMPDIR_GUARD/human-tcc.out"
  echo "FAIL: compatibility TCC helper did not use permission-specific blocker"
  exit 1
}

echo "PASS"

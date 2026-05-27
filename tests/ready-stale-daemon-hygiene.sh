#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

PREFIX="aos-ready-stale-daemon-hygiene"
STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
STALE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}-stale.XXXXXX")"
export AOS_STATE_ROOT="$STATE_ROOT"
export AOS_BYPASS_PERMISSIONS_SETUP=1
export AOS_TEST_SKIP_READY_SERVICE_START=1

SOCK="$STATE_ROOT/repo/sock"
MARKER="$STATE_ROOT/repo/permissions-onboarding.json"
mkdir -p "$(dirname "$SOCK")"
printf '{"completed_at":"2026-05-25T00:00:00Z"}\n' >"$MARKER"

cleanup() {
  if [[ -n "${MOCK_PID:-}" ]] && kill -0 "$MOCK_PID" 2>/dev/null; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
  fi
  if [[ -n "${STALE_PID:-}" ]] && kill -0 "$STALE_PID" 2>/dev/null; then
    kill "$STALE_PID" 2>/dev/null || true
    wait "$STALE_PID" 2>/dev/null || true
  fi
  rm -rf "$STATE_ROOT" "$STALE_ROOT"
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

cat >"$STALE_ROOT/aos" <<'SH'
#!/usr/bin/env bash
while true; do
  sleep 10
done
SH
chmod +x "$STALE_ROOT/aos"
"$STALE_ROOT/aos" serve --idle-timeout 5m \
  >"$STALE_ROOT/stale.stdout" 2>"$STALE_ROOT/stale.stderr" &
STALE_PID=$!

FOUND_STALE=0
for _ in $(seq 1 20); do
  if ./aos clean --dry-run --json | STALE_PID="$STALE_PID" python3 -c '
import json
import os
import sys

payload = json.loads(sys.stdin.read())
pid = int(os.environ["STALE_PID"])
raise SystemExit(0 if any(item.get("pid") == pid for item in payload.get("stale_daemons", [])) else 1)
'; then
    FOUND_STALE=1
    break
  fi
  sleep 0.1
done
if [[ "$FOUND_STALE" -ne 1 ]]; then
  echo "FAIL: clean dry-run did not detect stale daemon pid=$STALE_PID"
  ./aos clean --dry-run --json
  exit 1
fi

DRY_RUN="$(./aos clean --dry-run --json)"
DRY_RUN="$DRY_RUN" STALE_PID="$STALE_PID" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["DRY_RUN"])
pid = int(os.environ["STALE_PID"])
assert payload.get("status") == "dirty", payload
assert any(item.get("pid") == pid for item in payload.get("stale_daemons", [])), payload
PY

set +e
READY_JSON="$(./aos ready --json)"
READY_RC=$?
set -e
READY_JSON="$READY_JSON" STALE_PID="$STALE_PID" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["READY_JSON"])
pid = int(os.environ["STALE_PID"])
blockers = payload.get("blockers", [])
actions = payload.get("next_actions", [])
assert payload.get("ready") is False, payload
assert payload.get("status") == "degraded", payload
assert payload.get("phase") == "runtime_blocked", payload
assert payload.get("diagnosis") == "stale_daemons", payload
assert any(item.get("id") == "stale_daemons" and str(pid) in item.get("message", "") for item in blockers), payload
assert any(item.get("command") == "./aos clean" for item in actions), payload
PY
if [[ "$READY_RC" -eq 0 ]]; then
  echo "FAIL: ready exited 0 with stale daemon pid=$STALE_PID"
  exit 1
fi

CLEANED="$(./aos clean --json)"
CLEANED="$CLEANED" STALE_PID="$STALE_PID" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["CLEANED"])
pid = int(os.environ["STALE_PID"])
assert payload.get("status") == "cleaned", payload
assert not payload.get("stale_daemons"), payload
assert any(f"pid={pid}" in action for action in payload.get("actions_taken", [])), payload
PY

for _ in $(seq 1 20); do
  if ! kill -0 "$STALE_PID" 2>/dev/null; then
    break
  fi
  sleep 0.1
done
if kill -0 "$STALE_PID" 2>/dev/null; then
  echo "FAIL: stale daemon still exists after clean pid=$STALE_PID"
  exit 1
fi

READY_AFTER="$(./aos ready --json)"
READY_AFTER="$READY_AFTER" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["READY_AFTER"])
assert payload.get("ready") is True, payload
assert payload.get("diagnosis") == "ready", payload
PY

echo "PASS"

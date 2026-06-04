#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

PREFIX="aos-clean-active-unmanaged-owner"
STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
FAKE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}-fake.XXXXXX")"
export AOS_STATE_ROOT="$STATE_ROOT"

cleanup() {
  if [[ -n "${FAKE_PID:-}" ]] && kill -0 "$FAKE_PID" 2>/dev/null; then
    kill "$FAKE_PID" 2>/dev/null || true
    wait "$FAKE_PID" 2>/dev/null || true
  fi
  rm -rf "$STATE_ROOT" "$FAKE_ROOT"
}
trap cleanup EXIT

cat >"$FAKE_ROOT/aos" <<'SH'
#!/usr/bin/env bash
while true; do
  sleep 10
done
SH
chmod +x "$FAKE_ROOT/aos"

mkdir -p "$STATE_ROOT/repo"
"$FAKE_ROOT/aos" serve --idle-timeout none \
  >"$FAKE_ROOT/stdout.log" 2>"$FAKE_ROOT/stderr.log" &
FAKE_PID=$!
printf '{"pid":%s,"mode":"repo","socket_path":"%s"}\n' "$FAKE_PID" "$STATE_ROOT/repo/sock" \
  >"$STATE_ROOT/repo/daemon.lock"

EXPLICIT_DRY_RUN="$(./aos clean --dry-run --json)"
EXPLICIT_DRY_RUN="$EXPLICIT_DRY_RUN" FAKE_PID="$FAKE_PID" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["EXPLICIT_DRY_RUN"])
pid = int(os.environ["FAKE_PID"])
assert not any(item.get("pid") == pid for item in payload.get("stale_daemons", [])), payload
PY

NORMAL_DRY_RUN="$(AOS_TEST_CLASSIFY_STATE_ROOT_AS_NORMAL=1 ./aos clean --dry-run --json)"
NORMAL_DRY_RUN="$NORMAL_DRY_RUN" FAKE_PID="$FAKE_PID" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["NORMAL_DRY_RUN"])
pid = int(os.environ["FAKE_PID"])
assert payload.get("status") == "dirty", payload
assert any(item.get("pid") == pid for item in payload.get("stale_daemons", [])), payload
PY

CLEANED="$(AOS_TEST_CLASSIFY_STATE_ROOT_AS_NORMAL=1 ./aos clean --json)"
CLEANED="$CLEANED" FAKE_PID="$FAKE_PID" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["CLEANED"])
pid = int(os.environ["FAKE_PID"])
assert payload.get("status") == "cleaned", payload
assert any(f"pid={pid}" in action for action in payload.get("actions_taken", [])), payload
PY

for _ in $(seq 1 20); do
  if ! kill -0 "$FAKE_PID" 2>/dev/null; then
    echo "PASS"
    exit 0
  fi
  sleep 0.1
done

echo "FAIL: unmanaged lock owner still exists after clean pid=$FAKE_PID"
exit 1

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$ROOT/tests/lib/isolated-daemon.sh"
# shellcheck source=/dev/null
source "$ROOT/.agents/hooks/session-common.sh"

PREFIX="aos-handoff"
aos_test_cleanup_prefix "$PREFIX"

STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
TO="handoff-target-$$"
FROM="handoff-source-$$"
CLIPBOARD_FILE="$STATE_ROOT/clipboard.txt"

cleanup() {
  aos_test_kill_root "$STATE_ROOT"
  rm -rf "$STATE_ROOT"
}
trap cleanup EXIT

export AOS_STATE_ROOT="$STATE_ROOT"
export AOS_CLIPBOARD_FILE="$CLIPBOARD_FILE"
PAYLOAD_FILE="$(aos_session_bootstrap_payload_file "$TO")"
LAUNCHER="$(aos_session_bootstrap_launcher_file "$TO")"

aos_test_start_daemon "$STATE_ROOT" >/dev/null

bash "$ROOT/scripts/handoff" \
  --runtime codex \
  --to "$TO" \
  --from "$FROM" \
  --task "Run handoff smoke test" \
  --context "Verify launcher, clipboard fallback, and daemon-native posting." >/dev/null

[[ -f "$PAYLOAD_FILE" ]] || { echo "FAIL: missing payload file"; exit 1; }
[[ -x "$LAUNCHER" ]] || { echo "FAIL: launcher missing or not executable"; exit 1; }
bash -n "$LAUNCHER" || { echo "FAIL: launcher is not valid bash"; exit 1; }

grep -q "export AOS_SESSION_NAME=\"$TO\"" "$LAUNCHER" || {
  echo "FAIL: launcher missing AOS_SESSION_NAME export"
  exit 1
}
grep -q "Use the repo-scoped agent-os bootstrap payload for session $TO" "$LAUNCHER" || {
  echo "FAIL: launcher missing repo-scoped bootstrap prompt"
  exit 1
}

EXPECTED_CLIPBOARD="bash $LAUNCHER"
ACTUAL_CLIPBOARD="$(tr -d '\n' < "$CLIPBOARD_FILE")"
[[ "$ACTUAL_CLIPBOARD" == "$EXPECTED_CLIPBOARD" ]] || {
  echo "FAIL: clipboard mismatch: expected '$EXPECTED_CLIPBOARD', got '$ACTUAL_CLIPBOARD'"
  exit 1
}

python3 - "$PAYLOAD_FILE" "$TO" "$FROM" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1]))
if payload.get("type") != "session_handoff":
    raise SystemExit(f"FAIL: wrong payload type: {payload}")
if payload.get("to") != sys.argv[2] or payload.get("from") != sys.argv[3]:
    raise SystemExit(f"FAIL: wrong payload routing: {payload}")
brief = payload.get("brief", "")
if "Run handoff smoke test" not in brief:
    raise SystemExit(f"FAIL: brief missing task text: {payload}")
PY

HANDOFF_JSON=""
TARGET_JSON=""
for _ in $(seq 1 20); do
  HANDOFF_JSON="$("$ROOT/aos" listen handoff --limit 1)"
  TARGET_JSON="$("$ROOT/aos" listen "$TO" --limit 1)"
  if python3 - "$HANDOFF_JSON" "$TARGET_JSON" <<'PY'
import json, sys
handoff = json.loads(sys.argv[1]).get("data", {}).get("messages", [])
target = json.loads(sys.argv[2]).get("data", {}).get("messages", [])
raise SystemExit(0 if handoff and target else 1)
PY
  then
    break
  fi
  sleep 0.1
done

python3 - "$HANDOFF_JSON" "$TARGET_JSON" "$FROM" "$TO" <<'PY'
import json, sys

handoff = json.loads(sys.argv[1]).get("data", {}).get("messages", [])
target = json.loads(sys.argv[2]).get("data", {}).get("messages", [])
sender = sys.argv[3]
channel = sys.argv[4]

if not handoff:
    raise SystemExit("FAIL: missing handoff channel message")
if not target:
    raise SystemExit("FAIL: missing direct target channel message")

handoff_latest = handoff[-1]
target_latest = target[-1]

if handoff_latest.get("from") != sender or '"type": "session_handoff"' not in handoff_latest.get("payload", ""):
    raise SystemExit(f"FAIL: unexpected handoff message: {handoff_latest}")
if target_latest.get("channel") != channel or target_latest.get("from") != sender:
    raise SystemExit(f"FAIL: unexpected target message envelope: {target_latest}")
if '"to": "' + channel + '"' not in target_latest.get("payload", ""):
    raise SystemExit(f"FAIL: target payload did not preserve bootstrap json: {target_latest}")
PY

echo "PASS"

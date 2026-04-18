#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-voice-telemetry"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

aos_test_start_daemon "$ROOT"

SESSION_ID="019d99f3-0001-7000-b000-000000000001"
./aos tell --register --session-id "$SESSION_ID" --name "voice-telemetry" --role worker --harness codex >/dev/null

LEASES="$(./aos voice leases)"
SESSION_VOICE_ID="$(python3 - "$LEASES" "$SESSION_ID" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
session_id = sys.argv[2]
for row in payload.get("data", {}).get("leases", []):
    if row.get("session_id") == session_id:
        print(row["id"])
        break
else:
    raise SystemExit("FAIL: missing lease for registered session")
PY
)"

DEFAULT_ROUTE="$(./aos tell human "Default voice route check.")"
SESSION_ROUTE="$(./aos tell human --from-session-id "$SESSION_ID" --purpose final_response "Alpha sentence. Beta sentence.")"

if printf '%s' '{}' | ./aos voice final-response --harness codex >/tmp/aos-voice-telemetry.err 2>&1; then
  echo "FAIL: expected missing-session final-response ingress to fail" >&2
  exit 1
fi

VOICE_LOG="$ROOT/repo/voice-events.jsonl"
[[ -f "$VOICE_LOG" ]] || {
  echo "FAIL: expected voice telemetry log at $VOICE_LOG" >&2
  exit 1
}

python3 - "$DEFAULT_ROUTE" "$SESSION_ROUTE" "$VOICE_LOG" "$SESSION_ID" "$SESSION_VOICE_ID" <<'PY'
import json, sys
from pathlib import Path

default_route = json.loads(sys.argv[1]).get("data", {}).get("routes", [{}])[0]
session_route = json.loads(sys.argv[2]).get("data", {}).get("routes", [{}])[0]
log_path = Path(sys.argv[3])
session_id = sys.argv[4]
session_voice_id = sys.argv[5]
rows = [json.loads(line) for line in log_path.read_text().splitlines() if line.strip()]

if not default_route.get("voice", {}).get("id"):
    raise SystemExit(f"FAIL: expected default tell human route to expose a resolved voice descriptor, got {default_route}")

if session_route.get("voice", {}).get("id") != session_voice_id:
    raise SystemExit(f"FAIL: expected session route to use leased voice {session_voice_id}, got {session_route}")

route_events = [row for row in rows if row.get("event") == "voice_route"]
if len(route_events) < 2:
    raise SystemExit(f"FAIL: expected at least two voice_route telemetry rows, got {rows}")

default_events = [row for row in route_events if row.get("purpose") is None]
if not default_events or not default_events[-1].get("voice", {}).get("id"):
    raise SystemExit(f"FAIL: expected default tell human telemetry with a voice descriptor, got {rows}")

session_events = [row for row in route_events if row.get("session_id") == session_id and row.get("purpose") == "final_response"]
if not session_events:
    raise SystemExit(f"FAIL: expected session-bound final_response telemetry, got {rows}")
if session_events[-1].get("voice", {}).get("id") != session_voice_id:
    raise SystemExit(f"FAIL: expected session telemetry to record leased voice {session_voice_id}, got {session_events[-1]}")

failed = [row for row in rows if row.get("event") == "final_response_ingress_failed" and row.get("code") == "MISSING_SESSION_ID"]
if not failed:
    raise SystemExit(f"FAIL: expected failed ingress telemetry for missing session id, got {rows}")
PY

echo "PASS"

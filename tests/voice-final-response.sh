#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-voice-final-response"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

aos_test_start_daemon "$ROOT"

SESSION_ID="019d99f1-0001-7000-b000-000000000001"
./aos tell --register --session-id "$SESSION_ID" --name "voice-reader" --role worker --harness codex >/dev/null

OUT="$(./aos tell human --from-session-id "$SESSION_ID" --purpose final_response "First sentence. Second sentence.")"
python3 - "$OUT" <<'PY'
import json, sys

payload = json.loads(sys.argv[1])
route = payload.get("routes", [{}])[0]
rendered = route.get("rendered", {})
voice = route.get("voice", {})

if route.get("audience") != "human" or route.get("route") != "voice":
    raise SystemExit(f"FAIL: expected human voice route, got {route}")
if rendered.get("text") != "Second sentence.":
    raise SystemExit(f"FAIL: expected final-response policy to keep the last sentence, got {rendered}")
if not voice.get("id"):
    raise SystemExit(f"FAIL: expected session voice metadata on human route, got {route}")
if route.get("delivered") is not False or route.get("reason") != "voice.enabled is false":
    raise SystemExit(f"FAIL: expected disabled-voice acknowledgement without delivery, got {route}")
PY

TRANSCRIPT_PATH="$ROOT/rollout-2026-04-17T00-00-00-$SESSION_ID.jsonl"
cat >"$TRANSCRIPT_PATH" <<'EOF'
{"type":"response_item","payload":{"type":"message","role":"assistant","phase":"commentary","content":[{"type":"output_text","text":"Commentary text."}]}}
{"type":"response_item","payload":{"type":"message","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"Transcript fallback sentence."}]}}
{"type":"event_msg","payload":{"type":"task_complete","last_agent_message":"Task-complete fallback sentence."}}
EOF

HOOK_PAYLOAD="$(python3 - "$TRANSCRIPT_PATH" <<'PY'
import json, sys
print(json.dumps({"transcript_path": sys.argv[1]}))
PY
)"

OUT="$(printf '%s' "$HOOK_PAYLOAD" | ./aos voice final-response --harness codex)"
python3 - "$OUT" "$SESSION_ID" <<'PY'
import json, sys

payload = json.loads(sys.argv[1])
session_id = sys.argv[2]
route = payload.get("routes", [{}])[0]
rendered = route.get("rendered", {})
source = route.get("source", {})

if payload.get("session_id") != session_id:
    raise SystemExit(f"FAIL: expected final-response ingress to recover session id {session_id}, got {payload}")
if rendered.get("text") != "Task-complete fallback sentence.":
    raise SystemExit(f"FAIL: expected transcript task_complete fallback text, got {rendered}")
if source.get("message_source") != "codex.task_complete":
    raise SystemExit(f"FAIL: expected codex.task_complete source metadata, got {source}")
if route.get("delivered") is not False or route.get("reason") != "voice.enabled is false":
    raise SystemExit(f"FAIL: expected disabled-voice acknowledgement without delivery, got {route}")
PY

./aos set voice.policies.final_response.style last_n_chars >/dev/null
./aos set voice.policies.final_response.last_n_chars 12 >/dev/null
sleep 1

OUT="$(./aos tell human --from-session-id "$SESSION_ID" --purpose final_response "0123456789abcdefghijklmnopqrstuvwxyz")"
python3 - "$OUT" <<'PY'
import json, sys

payload = json.loads(sys.argv[1])
route = payload.get("routes", [{}])[0]
rendered = route.get("rendered", {})

if rendered.get("style") != "last_n_chars":
    raise SystemExit(f"FAIL: expected configured last_n_chars style, got {rendered}")
if rendered.get("text") != "opqrstuvwxyz":
    raise SystemExit(f"FAIL: expected 12-character tail, got {rendered}")
PY

if OUT="$(./aos tell human --from-session-id 00000000-0000-0000-0000-000000000000 --purpose final_response "bad session" 2>&1)"; then
  echo "FAIL: expected invalid from-session-id to fail" >&2
  exit 1
else
  echo "$OUT" | grep -q '"code":"SESSION_NOT_FOUND"' || {
    echo "FAIL: expected SESSION_NOT_FOUND for invalid from-session-id: $OUT" >&2
    exit 1
  }
fi

if OUT="$(printf '%s' '{}' | ./aos voice final-response --harness codex 2>&1)"; then
  echo "FAIL: expected missing-session final-response ingress to fail" >&2
  exit 1
else
  echo "$OUT" | grep -q '"code":"MISSING_SESSION_ID"' || {
    echo "FAIL: expected MISSING_SESSION_ID for missing-session final-response ingress: $OUT" >&2
    exit 1
  }
fi

echo "PASS"

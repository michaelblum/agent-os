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

echo "PASS"

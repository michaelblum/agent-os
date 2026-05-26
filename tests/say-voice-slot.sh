#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TMPDIR_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-say-voice-slot.XXXXXX")"
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

export AOS_STATE_ROOT="$TMPDIR_ROOT"
export AOS_VOICE_TEST_PROVIDERS=mock
export AOS_SAY_TEST_SKIP_SPEECH=1

say_json() {
  ./aos say "$@" | python3 -c '
import json
import sys
payload = json.loads(sys.stdin.read())
print(json.dumps(payload, sort_keys=True))
'
}

out="$(say_json --voice-slot 1 "slot one")"
python3 - "$out" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
assert payload["status"] == "success", payload
assert payload["text"] == "slot one", payload
assert payload["voice"] == "voice://mock/mock-alpha", payload
PY

out="$(say_json --voice-slot 1 --language en --quality-tier premium "filtered premium")"
python3 - "$out" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
assert payload["text"] == "filtered premium", payload
assert payload["voice"] == "voice://mock/mock-alpha", payload
PY

out="$(say_json --voice-slot 2 --language en --quality-tier premium --quality-tier enhanced "repeat tiers")"
python3 - "$out" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
assert payload["text"] == "repeat tiers", payload
assert payload["voice"] == "voice://mock/mock-bravo", payload
PY

out="$(say_json --voice-slot 2 --language en --quality-tier premium,enhanced "comma tiers")"
python3 - "$out" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
assert payload["text"] == "comma tiers", payload
assert payload["voice"] == "voice://mock/mock-bravo", payload
PY

out="$(say_json --voice-slot 1 --language en --quality-tier premium,enhanced --gender male "gender narrowed")"
python3 - "$out" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
assert payload["text"] == "gender narrowed", payload
assert payload["voice"] == "voice://mock/mock-bravo", payload
PY

if err="$(./aos say --voice-slot 1 --language zz --quality-tier premium "empty filter" 2>&1 >/dev/null)"; then
  echo "FAIL: expected empty filtered voice bucket to fail" >&2
  exit 1
fi
echo "$err" | grep -q '"code" : "VOICE_FILTER_EMPTY"' || {
  echo "FAIL: expected VOICE_FILTER_EMPTY for empty filters, got $err" >&2
  exit 1
}
echo "$err" | grep -q 'after filters' || {
  echo "FAIL: expected empty filter error to mention filters, got $err" >&2
  exit 1
}

for slot in 0 -1 nope 999999; do
  if err="$(./aos say --voice-slot "$slot" "bad slot" 2>&1 >/dev/null)"; then
    echo "FAIL: expected --voice-slot $slot to fail" >&2
    exit 1
  fi
  echo "$err" | grep -Eq '"code"[[:space:]]*:[[:space:]]*"INVALID_VOICE_SLOT"' || {
    echo "FAIL: expected INVALID_VOICE_SLOT for $slot, got $err" >&2
    exit 1
  }
done

if err="$(./aos say --bogus "bad flag" 2>&1 >/dev/null)"; then
  echo "FAIL: expected unknown say flag to fail" >&2
  exit 1
fi
echo "$err" | grep -Eq '"code"[[:space:]]*:[[:space:]]*"UNKNOWN_FLAG"' || {
  echo "FAIL: expected UNKNOWN_FLAG for unknown say flag, got $err" >&2
  exit 1
}

if err="$(./aos say --voice --voice-slot 1 "missing voice" 2>&1 >/dev/null)"; then
  echo "FAIL: expected missing --voice value to fail" >&2
  exit 1
fi
echo "$err" | grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' || {
  echo "FAIL: expected MISSING_ARG for missing --voice value, got $err" >&2
  exit 1
}

if err="$(./aos say --rate fast "bad rate" 2>&1 >/dev/null)"; then
  echo "FAIL: expected non-numeric --rate to fail" >&2
  exit 1
fi
echo "$err" | grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' || {
  echo "FAIL: expected MISSING_ARG for non-numeric --rate, got $err" >&2
  exit 1
}

out="$(say_json --voice voice://mock/mock-bravo "explicit voice")"
python3 - "$out" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
assert payload["text"] == "explicit voice", payload
assert payload["voice"] == "voice://mock/mock-bravo", payload
PY

out="$(printf 'stdin text\n' | ./aos say --voice-slot 1)"
python3 - "$out" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
assert payload["text"] == "stdin text", payload
assert payload["voice"] == "voice://mock/mock-alpha", payload
PY

echo "ok"

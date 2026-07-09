#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TMPDIR_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-say-tts-provider-seam.XXXXXX")"
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

export AOS_STATE_ROOT="$TMPDIR_ROOT"
export AOS_SAY_TEST_SKIP_SPEECH=1

say_json() {
  ./aos say "$@" | python3 -c '
import json
import sys
payload = json.loads(sys.stdin.read())
print(json.dumps(payload, sort_keys=True))
'
}

export AOS_VOICE_TEST_PROVIDERS=mock
export AOS_VOICE_MOCK_SPEAK_LOG="$TMPDIR_ROOT/mock-speak.jsonl"

out="$(say_json --voice voice://mock/mock-bravo --rate 210 "mock provider dispatch")"
python3 - "$out" "$AOS_VOICE_MOCK_SPEAK_LOG" <<'PY'
import json
import pathlib
import sys

payload = json.loads(sys.argv[1])
assert payload["status"] == "success", payload
assert payload["voice"] == "voice://mock/mock-bravo", payload
lines = pathlib.Path(sys.argv[2]).read_text().splitlines()
assert len(lines) == 1, lines
entry = json.loads(lines[0])
assert entry["provider"] == "mock", entry
assert entry["voice"] == "voice://mock/mock-bravo", entry
assert entry["text"] == "mock provider dispatch", entry
assert entry["rate"] == 210, entry
assert entry["skip_audio"] is True, entry
PY

out="$(say_json --voice-slot 1 "slot provider dispatch")"
python3 - "$out" "$AOS_VOICE_MOCK_SPEAK_LOG" <<'PY'
import json
import pathlib
import sys

payload = json.loads(sys.argv[1])
assert payload["voice"] == "voice://mock/mock-alpha", payload
lines = pathlib.Path(sys.argv[2]).read_text().splitlines()
assert len(lines) == 2, lines
entry = json.loads(lines[1])
assert entry["voice"] == "voice://mock/mock-alpha", entry
assert entry["text"] == "slot provider dispatch", entry
PY

before_count="$(wc -l < "$AOS_VOICE_MOCK_SPEAK_LOG")"
out="$(say_json --voice voice://system/com.apple.voice.compact.en-US.Samantha "system path unchanged")"
after_count="$(wc -l < "$AOS_VOICE_MOCK_SPEAK_LOG")"
python3 - "$out" "$before_count" "$after_count" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
assert payload["status"] == "success", payload
assert payload["voice"] == "voice://system/com.apple.voice.compact.en-US.Samantha", payload
assert sys.argv[2] == sys.argv[3], (sys.argv[2], sys.argv[3])
PY

export AOS_VOICE_TEST_PROVIDERS=mock-unreachable
if err="$(./aos say --voice voice://mock/mock-alpha "unreachable provider" 2>&1 >/dev/null)"; then
  echo "FAIL: expected unreachable mock provider to fail" >&2
  exit 1
fi
echo "$err" | grep -Eq '"code"[[:space:]]*:[[:space:]]*"VOICE_PROVIDER_UNAVAILABLE"' || {
  echo "FAIL: expected VOICE_PROVIDER_UNAVAILABLE for unreachable mock, got $err" >&2
  exit 1
}

export AOS_VOICE_TEST_PROVIDERS=kokoro
unset AOS_VOICE_KOKORO_FAKE_RUNNER
if err="$(./aos say --voice voice://kokoro/kokoro-82m-default "kokoro unavailable" 2>&1 >/dev/null)"; then
  echo "FAIL: expected Kokoro provider without runner/model to fail" >&2
  exit 1
fi
echo "$err" | grep -Eq '"code"[[:space:]]*:[[:space:]]*"VOICE_PROVIDER_UNAVAILABLE"' || {
  echo "FAIL: expected VOICE_PROVIDER_UNAVAILABLE for Kokoro, got $err" >&2
  exit 1
}

export AOS_VOICE_KOKORO_FAKE_RUNNER=1
out="$(say_json --voice voice://kokoro/kokoro-82m-default "kokoro fake runner")"
python3 - "$out" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
assert payload["status"] == "success", payload
assert payload["voice"] == "voice://kokoro/kokoro-82m-default", payload
assert payload["text"] == "kokoro fake runner", payload
PY

echo "ok"

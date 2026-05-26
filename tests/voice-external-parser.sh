#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-voice-parser.XXXXXX")"
trap 'rm -rf "$STATE_ROOT"' EXIT

export AOS_STATE_ROOT="$STATE_ROOT"
export AOS_DISABLE_DAEMON_AUTOSTART=1

if ./aos voice providers --bogus 2>"$STATE_ROOT/voice-providers-bogus.err"; then
  echo "FAIL: voice providers accepted unknown flag" >&2
  exit 1
fi
grep -q '"code":"UNKNOWN_FLAG"' "$STATE_ROOT/voice-providers-bogus.err" || {
  echo "FAIL: voice providers unknown flag did not use UNKNOWN_FLAG" >&2
  cat "$STATE_ROOT/voice-providers-bogus.err" >&2
  exit 1
}

if ./aos voice list --bogus 2>"$STATE_ROOT/voice-list-bogus.err"; then
  echo "FAIL: voice list accepted unknown flag" >&2
  exit 1
fi
grep -q '"code":"UNKNOWN_FLAG"' "$STATE_ROOT/voice-list-bogus.err" || {
  echo "FAIL: voice list unknown flag did not use UNKNOWN_FLAG" >&2
  cat "$STATE_ROOT/voice-list-bogus.err" >&2
  exit 1
}

if printf '{}' | ./aos voice final-response --bogus 2>"$STATE_ROOT/voice-final-response-bogus.err"; then
  echo "FAIL: voice final-response accepted unknown flag" >&2
  exit 1
fi
grep -q '"code":"UNKNOWN_FLAG"' "$STATE_ROOT/voice-final-response-bogus.err" || {
  echo "FAIL: voice final-response unknown flag did not use UNKNOWN_FLAG" >&2
  cat "$STATE_ROOT/voice-final-response-bogus.err" >&2
  exit 1
}

echo "voice-external-parser: all checks passed"

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

if ./aos voice list --provider --json 2>"$STATE_ROOT/voice-list-provider-missing.err"; then
  echo "FAIL: voice list accepted missing --provider value" >&2
  exit 1
fi
grep -q '"code":"MISSING_ARG"' "$STATE_ROOT/voice-list-provider-missing.err" || {
  echo "FAIL: voice list missing --provider value did not use MISSING_ARG" >&2
  cat "$STATE_ROOT/voice-list-provider-missing.err" >&2
  exit 1
}

if ./aos voice bind --session-id session --provider --json 2>"$STATE_ROOT/voice-bind-provider-missing.err"; then
  echo "FAIL: voice bind accepted missing --provider value" >&2
  exit 1
fi
grep -q '"code":"MISSING_ARG"' "$STATE_ROOT/voice-bind-provider-missing.err" || {
  echo "FAIL: voice bind missing --provider value did not use MISSING_ARG" >&2
  cat "$STATE_ROOT/voice-bind-provider-missing.err" >&2
  exit 1
}

if ./aos voice next --session-id --json 2>"$STATE_ROOT/voice-next-session-missing.err"; then
  echo "FAIL: voice next accepted missing --session-id value" >&2
  exit 1
fi
grep -q '"code":"MISSING_ARG"' "$STATE_ROOT/voice-next-session-missing.err" || {
  echo "FAIL: voice next missing --session-id value did not use MISSING_ARG" >&2
  cat "$STATE_ROOT/voice-next-session-missing.err" >&2
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

if ./aos listen --source hotkey --follow --bogus 2>"$STATE_ROOT/listen-hotkey-bogus.err"; then
  echo "FAIL: hotkey listen accepted unknown flag" >&2
  exit 1
fi
grep -q '"code":"UNKNOWN_FLAG"' "$STATE_ROOT/listen-hotkey-bogus.err" || {
  echo "FAIL: hotkey listen unknown flag did not use UNKNOWN_FLAG" >&2
  cat "$STATE_ROOT/listen-hotkey-bogus.err" >&2
  exit 1
}

if ./aos listen --source microphone --follow 2>"$STATE_ROOT/listen-microphone-output-missing.err"; then
  echo "FAIL: microphone listen accepted missing output" >&2
  exit 1
fi
grep -q '"code":"MISSING_ARG"' "$STATE_ROOT/listen-microphone-output-missing.err" || {
  echo "FAIL: microphone listen missing output did not use MISSING_ARG" >&2
  cat "$STATE_ROOT/listen-microphone-output-missing.err" >&2
  exit 1
}

if ./aos listen --source microphone --output /private/tmp/capture.wav --max-duration 121s --follow 2>"$STATE_ROOT/listen-microphone-duration-invalid.err"; then
  echo "FAIL: microphone listen accepted duration above 120s" >&2
  exit 1
fi
grep -q '"code":"INVALID_ARG"' "$STATE_ROOT/listen-microphone-duration-invalid.err" || {
  echo "FAIL: microphone listen invalid duration did not use INVALID_ARG" >&2
  cat "$STATE_ROOT/listen-microphone-duration-invalid.err" >&2
  exit 1
}

if ./aos listen --source microphone --output /private/tmp/capture.wav --segments /private/tmp/segments --follow 2>"$STATE_ROOT/listen-microphone-target-conflict.err"; then
  echo "FAIL: microphone listen accepted both output forms" >&2
  exit 1
fi
grep -q '"code":"INVALID_ARG"' "$STATE_ROOT/listen-microphone-target-conflict.err" || {
  echo "FAIL: microphone target conflict did not use INVALID_ARG" >&2
  cat "$STATE_ROOT/listen-microphone-target-conflict.err" >&2
  exit 1
}

if ./aos listen --source microphone --segments /private/tmp/segments --segment-duration 250ms --follow 2>"$STATE_ROOT/listen-microphone-segment-duration-invalid.err"; then
  echo "FAIL: segmented microphone listen accepted a short segment duration" >&2
  exit 1
fi
grep -q '"code":"INVALID_ARG"' "$STATE_ROOT/listen-microphone-segment-duration-invalid.err" || {
  echo "FAIL: invalid segment duration did not use INVALID_ARG" >&2
  cat "$STATE_ROOT/listen-microphone-segment-duration-invalid.err" >&2
  exit 1
}

if ./aos listen --source microphone --segments /private/tmp/segments --ready-cue voice --follow 2>"$STATE_ROOT/listen-microphone-ready-cue-invalid.err"; then
  echo "FAIL: segmented microphone listen accepted an unknown ready cue" >&2
  exit 1
fi
grep -q '"code":"INVALID_ARG"' "$STATE_ROOT/listen-microphone-ready-cue-invalid.err" || {
  echo "FAIL: invalid ready cue did not use INVALID_ARG" >&2
  cat "$STATE_ROOT/listen-microphone-ready-cue-invalid.err" >&2
  exit 1
}

if ./aos listen --source microphone --output /private/tmp/capture.wav --ready-cue chime --follow 2>"$STATE_ROOT/listen-microphone-ready-cue-target-invalid.err"; then
  echo "FAIL: single-file microphone listen accepted a segmented ready cue" >&2
  exit 1
fi
grep -q '"code":"INVALID_ARG"' "$STATE_ROOT/listen-microphone-ready-cue-target-invalid.err" || {
  echo "FAIL: misplaced ready cue did not use INVALID_ARG" >&2
  cat "$STATE_ROOT/listen-microphone-ready-cue-target-invalid.err" >&2
  exit 1
}

secret="voice-parser-secret"
if printf '%s' "$secret" | ./aos say --follow --rate invalid 2>"$STATE_ROOT/say-follow-rate-invalid.err"; then
  echo "FAIL: say follow accepted invalid rate" >&2
  exit 1
fi
grep -q '"code":"INVALID_SPEECH_RATE"' "$STATE_ROOT/say-follow-rate-invalid.err" || {
  echo "FAIL: say follow invalid rate did not use INVALID_SPEECH_RATE" >&2
  cat "$STATE_ROOT/say-follow-rate-invalid.err" >&2
  exit 1
}
if grep -q "$secret" "$STATE_ROOT/say-follow-rate-invalid.err"; then
  echo "FAIL: say follow error echoed spoken text" >&2
  exit 1
fi

echo "voice-external-parser: all checks passed"

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-show-parser.XXXXXX")"
trap 'rm -rf "$STATE_ROOT"' EXIT

export AOS_STATE_ROOT="$STATE_ROOT"
export AOS_DISABLE_DAEMON_AUTOSTART=1

check_unknown_flag() {
  local label="$1"
  shift
  local err="$STATE_ROOT/${label}.err"
  if "$@" 2>"$err"; then
    echo "FAIL: $label accepted unknown flag" >&2
    exit 1
  fi
  if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"UNKNOWN_FLAG"' "$err"; then
    echo "FAIL: $label did not use UNKNOWN_FLAG" >&2
    cat "$err" >&2
    exit 1
  fi
}

check_unknown_flag show-list ./aos show list --bogus
check_unknown_flag show-ping ./aos show ping --bogus
check_unknown_flag show-remove-all ./aos show remove-all --bogus
check_unknown_flag show-remove ./aos show remove --id parser-test --bogus
check_unknown_flag show-to-front ./aos show to-front --id parser-test --bogus
check_unknown_flag show-create ./aos show create --id parser-test --bogus
check_unknown_flag show-update ./aos show update --id parser-test --bogus
check_unknown_flag show-wait ./aos show wait --id parser-test --bogus
check_unknown_flag show-eval ./aos show eval --id parser-test --js '"ok"' --bogus
check_unknown_flag show-post ./aos show post --id parser-test --event '{"type":"test"}' --bogus
check_unknown_flag show-listen ./aos show listen --bogus
check_unknown_flag show-render ./aos show render --html '<p>parser</p>' --base64 --bogus

if ./aos show exists --id --json 2>"$STATE_ROOT/show-exists-id-missing.err"; then
  echo "FAIL: show exists accepted missing --id value" >&2
  exit 1
fi
grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$STATE_ROOT/show-exists-id-missing.err" || {
  echo "FAIL: show exists missing --id value did not use MISSING_ARG" >&2
  cat "$STATE_ROOT/show-exists-id-missing.err" >&2
  exit 1
}

if ./aos show get --id --json 2>"$STATE_ROOT/show-get-id-missing.err"; then
  echo "FAIL: show get accepted missing --id value" >&2
  exit 1
fi
grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$STATE_ROOT/show-get-id-missing.err" || {
  echo "FAIL: show get missing --id value did not use MISSING_ARG" >&2
  cat "$STATE_ROOT/show-get-id-missing.err" >&2
  exit 1
}

if ./aos show create --id parser-test --html --json 2>"$STATE_ROOT/show-create-html-missing.err"; then
  echo "FAIL: show create accepted missing --html value" >&2
  exit 1
fi
grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$STATE_ROOT/show-create-html-missing.err" || {
  echo "FAIL: show create missing --html value did not use MISSING_ARG" >&2
  cat "$STATE_ROOT/show-create-html-missing.err" >&2
  exit 1
}

if ./aos show wait --id parser-test --timeout --json 2>"$STATE_ROOT/show-wait-timeout-missing.err"; then
  echo "FAIL: show wait accepted missing --timeout value" >&2
  exit 1
fi
grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$STATE_ROOT/show-wait-timeout-missing.err" || {
  echo "FAIL: show wait missing --timeout value did not use MISSING_ARG" >&2
  cat "$STATE_ROOT/show-wait-timeout-missing.err" >&2
  exit 1
}

if ./aos show eval --id parser-test --js --json 2>"$STATE_ROOT/show-eval-js-missing.err"; then
  echo "FAIL: show eval accepted missing --js value" >&2
  exit 1
fi
grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$STATE_ROOT/show-eval-js-missing.err" || {
  echo "FAIL: show eval missing --js value did not use MISSING_ARG" >&2
  cat "$STATE_ROOT/show-eval-js-missing.err" >&2
  exit 1
}

if ./aos show post --id parser-test --event --json 2>"$STATE_ROOT/show-post-event-missing.err"; then
  echo "FAIL: show post accepted missing --event value" >&2
  exit 1
fi
grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$STATE_ROOT/show-post-event-missing.err" || {
  echo "FAIL: show post missing --event value did not use MISSING_ARG" >&2
  cat "$STATE_ROOT/show-post-event-missing.err" >&2
  exit 1
}

if ./aos show render --width --html '<p>parser</p>' --base64 2>"$STATE_ROOT/show-render-width-missing.err"; then
  echo "FAIL: show render accepted missing --width value" >&2
  exit 1
fi
grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$STATE_ROOT/show-render-width-missing.err" || {
  echo "FAIL: show render missing --width value did not use MISSING_ARG" >&2
  cat "$STATE_ROOT/show-render-width-missing.err" >&2
  exit 1
}

if ./aos show render --height --html '<p>parser</p>' --base64 2>"$STATE_ROOT/show-render-height-missing.err"; then
  echo "FAIL: show render accepted missing --height value" >&2
  exit 1
fi
grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$STATE_ROOT/show-render-height-missing.err" || {
  echo "FAIL: show render missing --height value did not use MISSING_ARG" >&2
  cat "$STATE_ROOT/show-render-height-missing.err" >&2
  exit 1
}

if ./aos show render --html --base64 2>"$STATE_ROOT/show-render-html-missing.err"; then
  echo "FAIL: show render accepted missing --html value" >&2
  exit 1
fi
grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$STATE_ROOT/show-render-html-missing.err" || {
  echo "FAIL: show render missing --html value did not use MISSING_ARG" >&2
  cat "$STATE_ROOT/show-render-html-missing.err" >&2
  exit 1
}

if ./aos show render --file --base64 2>"$STATE_ROOT/show-render-file-missing.err"; then
  echo "FAIL: show render accepted missing --file value" >&2
  exit 1
fi
grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$STATE_ROOT/show-render-file-missing.err" || {
  echo "FAIL: show render missing --file value did not use MISSING_ARG" >&2
  cat "$STATE_ROOT/show-render-file-missing.err" >&2
  exit 1
}

if ./aos show render --html '<p>parser</p>' --out --base64 2>"$STATE_ROOT/show-render-out-missing.err"; then
  echo "FAIL: show render accepted missing --out value" >&2
  exit 1
fi
grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$STATE_ROOT/show-render-out-missing.err" || {
  echo "FAIL: show render missing --out value did not use MISSING_ARG" >&2
  cat "$STATE_ROOT/show-render-out-missing.err" >&2
  exit 1
}

echo "show-external-parser: all checks passed"

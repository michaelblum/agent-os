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

echo "show-external-parser: all checks passed"

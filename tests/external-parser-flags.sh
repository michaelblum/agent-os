#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-external-parser-flags.XXXXXX")"
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

check_unknown_flag inspect ./aos inspect --bogus
check_unknown_flag show-exists ./aos show exists --id parser-test --bogus
check_unknown_flag show-get ./aos show get --id parser-test --bogus
check_unknown_flag do-profiles ./aos do profiles natural --bogus

echo "external-parser-flags: all checks passed"

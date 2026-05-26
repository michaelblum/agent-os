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

check_unknown_arg() {
  local label="$1"
  shift
  local err="$STATE_ROOT/${label}.err"
  if "$@" 2>"$err"; then
    echo "FAIL: $label accepted unknown argument" >&2
    exit 1
  fi
  if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"UNKNOWN_ARG"' "$err"; then
    echo "FAIL: $label did not use UNKNOWN_ARG" >&2
    cat "$err" >&2
    exit 1
  fi
}

check_unknown_flag inspect ./aos inspect --bogus
check_unknown_flag show-exists ./aos show exists --id parser-test --bogus
check_unknown_flag show-get ./aos show get --id parser-test --bogus
check_unknown_flag do-profiles ./aos do profiles natural --bogus
check_unknown_flag do-native-click ./aos do click 10,10 --bogus
check_unknown_arg do-native-click-extra ./aos do click 10,10 unexpected --dry-run
check_unknown_arg do-native-drag-extra ./aos do drag 10,10 20,20 unexpected --dry-run
check_unknown_arg do-native-scroll-extra ./aos do scroll 10,10 unexpected --dx 0 --dy 1 --dry-run
check_unknown_arg do-native-type-extra ./aos do type hello unexpected --dry-run
check_unknown_arg do-native-key-extra ./aos do key Enter unexpected --dry-run

echo "external-parser-flags: all checks passed"

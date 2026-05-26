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
check_unknown_flag do-profiles-root ./aos do profiles --bogus
check_unknown_flag do-profiles ./aos do profiles natural --bogus
check_unknown_arg do-profiles-list-extra ./aos do profiles list unexpected
check_unknown_flag do-native-click ./aos do click 10,10 --bogus
check_unknown_arg do-native-click-extra ./aos do click 10,10 unexpected --dry-run
check_unknown_arg do-native-drag-extra ./aos do drag 10,10 20,20 unexpected --dry-run
check_unknown_arg do-native-scroll-extra ./aos do scroll 10,10 unexpected --dx 0 --dy 1 --dry-run
check_unknown_arg do-native-type-extra ./aos do type hello unexpected --dry-run
check_unknown_arg do-native-key-extra ./aos do key Enter unexpected --dry-run
check_unknown_flag see-observe ./aos see observe --bogus
check_unknown_arg see-observe-extra ./aos see observe unexpected
check_unknown_flag focus-list ./aos focus list --bogus
check_unknown_arg focus-list-extra ./aos focus list unexpected
check_unknown_flag focus-create ./aos focus create --id parser-focus --window 1 --bogus
check_unknown_arg focus-create-extra ./aos focus create --id parser-focus --window 1 unexpected
check_unknown_flag graph-displays ./aos graph displays --bogus
check_unknown_arg graph-displays-extra ./aos graph displays unexpected
check_unknown_flag graph-windows ./aos graph windows --bogus
check_unknown_arg graph-windows-extra ./aos graph windows unexpected
check_unknown_flag graph-deepen ./aos graph deepen --id parser-node --bogus
check_unknown_flag graph-collapse-subtree ./aos graph collapse --id parser-node --subtree-role button
check_unknown_arg service-status-extra ./aos service status unexpected
check_unknown_arg service-verify-extra ./aos service _verify-readiness unexpected
check_unknown_arg reset-extra ./aos reset unexpected
check_unknown_arg ops-list-extra ./aos ops list unexpected
check_unknown_arg ops-explain-extra ./aos ops explain runtime/status-snapshot unexpected
check_unknown_flag tell-unknown-flag ./aos tell channel --bogus hello
check_unknown_arg tell-who-extra ./aos tell --who unexpected
check_unknown_flag listen-unknown-flag ./aos listen channel --bogus
check_unknown_arg listen-extra ./aos listen channel unexpected
check_unknown_arg listen-channels-extra ./aos listen --channels unexpected

err="$STATE_ROOT/see-observe-depth-missing.err"
if ./aos see observe --depth 2>"$err"; then
  echo "FAIL: see observe accepted missing --depth value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$err"; then
  echo "FAIL: see observe missing --depth value did not use MISSING_ARG" >&2
  cat "$err" >&2
  exit 1
fi

err="$STATE_ROOT/see-observe-rate-missing.err"
if ./aos see observe --rate 2>"$err"; then
  echo "FAIL: see observe accepted missing --rate value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$err"; then
  echo "FAIL: see observe missing --rate value did not use MISSING_ARG" >&2
  cat "$err" >&2
  exit 1
fi

echo "external-parser-flags: all checks passed"

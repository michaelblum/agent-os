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

check_missing_arg() {
  local label="$1"
  shift
  local err="$STATE_ROOT/${label}.err"
  if "$@" 2>"$err"; then
    echo "FAIL: $label accepted missing argument" >&2
    exit 1
  fi
  if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$err"; then
    echo "FAIL: $label did not use MISSING_ARG" >&2
    cat "$err" >&2
    exit 1
  fi
}

check_unknown_flag inspect ./aos inspect --bogus
err="$STATE_ROOT/inspect-at-missing.err"
if ./aos inspect --at --size 10,10 2>"$err"; then
  echo "FAIL: inspect accepted missing --at value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$err"; then
  echo "FAIL: inspect missing --at value did not use MISSING_ARG" >&2
  cat "$err" >&2
  exit 1
fi

err="$STATE_ROOT/inspect-size-missing.err"
if ./aos inspect --size --at 0,0 2>"$err"; then
  echo "FAIL: inspect accepted missing --size value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$err"; then
  echo "FAIL: inspect missing --size value did not use MISSING_ARG" >&2
  cat "$err" >&2
  exit 1
fi

check_unknown_flag show-exists ./aos show exists --id parser-test --bogus
check_unknown_flag show-get ./aos show get --id parser-test --bogus
check_unknown_flag do-profiles-root ./aos do profiles --bogus
check_unknown_flag do-profiles ./aos do profiles natural --bogus
check_unknown_arg do-profiles-list-extra ./aos do profiles list unexpected
check_unknown_flag do-native-click ./aos do click 10,10 --bogus
check_unknown_arg do-native-click-extra ./aos do click 10,10 unexpected --dry-run
err="$STATE_ROOT/do-native-scroll-dx-missing.err"
if ./aos do scroll 10,10 --dx --dy 1 --dry-run 2>"$err"; then
  echo "FAIL: do native scroll accepted missing --dx value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$err"; then
  echo "FAIL: do native scroll missing --dx value did not use MISSING_ARG" >&2
  cat "$err" >&2
  exit 1
fi
check_unknown_arg do-native-drag-extra ./aos do drag 10,10 20,20 unexpected --dry-run
check_unknown_arg do-native-scroll-extra ./aos do scroll 10,10 unexpected --dx 0 --dy 1 --dry-run
check_unknown_arg do-native-type-extra ./aos do type hello unexpected --dry-run
check_unknown_arg do-native-key-extra ./aos do key Enter unexpected --dry-run
check_missing_arg do-native-press-pid-missing ./aos do press --dry-run
check_missing_arg do-native-set-value-pid-missing ./aos do set-value --role AXTextField --value hello --dry-run
check_missing_arg do-native-set-value-role-missing ./aos do set-value --pid 123 --value hello --dry-run
check_missing_arg do-native-set-value-value-missing ./aos do set-value --pid 123 --role AXTextField --dry-run
check_missing_arg do-native-focus-role-missing ./aos do focus --pid 123 --dry-run
check_missing_arg do-native-raise-pid-missing ./aos do raise --dry-run
check_missing_arg do-native-move-to-missing ./aos do move --pid 123 --dry-run
check_missing_arg do-native-resize-to-missing ./aos do resize --pid 123 --dry-run
check_missing_arg do-native-tell-script-missing ./aos do tell Finder --dry-run
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
err="$STATE_ROOT/tell-json-missing.err"
if ./aos tell channel --json --from tester 2>"$err"; then
  echo "FAIL: tell accepted missing --json value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$err"; then
  echo "FAIL: tell missing --json value did not use MISSING_ARG" >&2
  cat "$err" >&2
  exit 1
fi
err="$STATE_ROOT/tell-from-missing.err"
if ./aos tell channel --from --json '{"ok":true}' 2>"$err"; then
  echo "FAIL: tell accepted missing --from value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$err"; then
  echo "FAIL: tell missing --from value did not use MISSING_ARG" >&2
  cat "$err" >&2
  exit 1
fi
check_unknown_flag listen-unknown-flag ./aos listen channel --bogus
check_unknown_arg listen-extra ./aos listen channel unexpected
check_unknown_arg listen-channels-extra ./aos listen --channels unexpected
err="$STATE_ROOT/listen-limit-missing.err"
if ./aos listen channel --limit --since 1 2>"$err"; then
  echo "FAIL: listen accepted missing --limit value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$err"; then
  echo "FAIL: listen missing --limit value did not use MISSING_ARG" >&2
  cat "$err" >&2
  exit 1
fi
err="$STATE_ROOT/listen-session-missing.err"
if ./aos listen --session-id --limit 1 2>"$err"; then
  echo "FAIL: listen accepted missing --session-id value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$err"; then
  echo "FAIL: listen missing --session-id value did not use MISSING_ARG" >&2
  cat "$err" >&2
  exit 1
fi

err="$STATE_ROOT/see-observe-depth-missing.err"
if ./aos see observe --depth --rate on-settle 2>"$err"; then
  echo "FAIL: see observe accepted missing --depth value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$err"; then
  echo "FAIL: see observe missing --depth value did not use MISSING_ARG" >&2
  cat "$err" >&2
  exit 1
fi

err="$STATE_ROOT/see-observe-rate-missing.err"
if ./aos see observe --rate --depth 2 2>"$err"; then
  echo "FAIL: see observe accepted missing --rate value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$err"; then
  echo "FAIL: see observe missing --rate value did not use MISSING_ARG" >&2
  cat "$err" >&2
  exit 1
fi

echo "external-parser-flags: all checks passed"

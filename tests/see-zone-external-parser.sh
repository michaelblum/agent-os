#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-see-zone-parser.XXXXXX")"
trap 'rm -rf "$STATE_ROOT"' EXIT

export AOS_STATE_ROOT="$STATE_ROOT"

check_unknown_flag() {
  local label="$1"
  shift
  local err="$STATE_ROOT/${label}.err"
  if "$@" 2>"$err"; then
    echo "FAIL: $label accepted unknown flag" >&2
    exit 1
  fi
  if ! grep -q '"code" : "UNKNOWN_FLAG"' "$err"; then
    echo "FAIL: $label did not use UNKNOWN_FLAG" >&2
    cat "$err" >&2
    exit 1
  fi
}

check_unknown_flag see-zone-list ./aos see zone list --bogus
check_unknown_flag see-zone-delete ./aos see zone delete parser-test --bogus

if ./aos see zone define parser-test --target --bounds 0,0,10,10 2>"$STATE_ROOT/see-zone-target-missing.err"; then
  echo "FAIL: see zone define accepted missing --target value" >&2
  exit 1
fi
if ! grep -q '"code" : "MISSING_ARG"' "$STATE_ROOT/see-zone-target-missing.err"; then
  echo "FAIL: see zone define missing --target value did not use MISSING_ARG" >&2
  cat "$STATE_ROOT/see-zone-target-missing.err" >&2
  exit 1
fi

if ./aos see zone define parser-test --bounds --target main 2>"$STATE_ROOT/see-zone-bounds-missing.err"; then
  echo "FAIL: see zone define accepted missing --bounds value" >&2
  exit 1
fi
if ! grep -q '"code" : "MISSING_ARG"' "$STATE_ROOT/see-zone-bounds-missing.err"; then
  echo "FAIL: see zone define missing --bounds value did not use MISSING_ARG" >&2
  cat "$STATE_ROOT/see-zone-bounds-missing.err" >&2
  exit 1
fi

echo "see-zone-external-parser: all checks passed"

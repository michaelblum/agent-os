#!/usr/bin/env bash
# config-surface.sh — verify config alias/get surface with isolated state

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-config-surface.XXXXXX")"
trap 'rm -rf "$STATE_ROOT"' EXIT

export AOS_STATE_ROOT="$STATE_ROOT"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; exit 1; }

OUT="$(./aos config get voice.enabled)"
[ "$OUT" = "false" ] || fail "expected default voice.enabled=false, got '$OUT'"
pass "config get returns scalar text"

OUT="$(./aos config get voice.enabled --json)"
[ "$OUT" = "false" ] || fail "expected JSON false, got '$OUT'"
pass "config get --json returns JSON scalar"

OUT="$(./aos config set voice.enabled true)"
echo "$OUT" | grep -q '"enabled" : true' || fail "config set did not update voice.enabled: $OUT"
pass "config set mutates config"

OUT="$(./aos config get voice.enabled)"
[ "$OUT" = "true" ] || fail "expected updated voice.enabled=true, got '$OUT'"
pass "config get reads updated value"

OUT="$(./aos set voice.policies.final_response.last_n_chars 321)"
echo "$OUT" | grep -q '"last_n_chars" : 321' || fail "set shorthand did not remain compatible: $OUT"
pass "legacy set shorthand still works"

OUT="$(./aos config get voice.policies.final_response.last_n_chars)"
[ "$OUT" = "321" ] || fail "expected last_n_chars=321, got '$OUT'"
pass "config get reads nested scalar"

if ./aos set --bogus 2>"$STATE_ROOT/set-bogus.err"; then
  fail "set shorthand accepted unknown flag"
fi
grep -q '"code": "UNKNOWN_FLAG"' "$STATE_ROOT/set-bogus.err" || {
  cat "$STATE_ROOT/set-bogus.err"
  fail "set shorthand unknown flag did not use external JSON error contract"
}
pass "set shorthand rejects unknown flags with JSON error"

if ./aos set voice.enabled 2>"$STATE_ROOT/set-missing-value.err"; then
  fail "set shorthand accepted missing value"
fi
grep -q '"code": "MISSING_ARG"' "$STATE_ROOT/set-missing-value.err" || {
  cat "$STATE_ROOT/set-missing-value.err"
  fail "set shorthand missing value did not use MISSING_ARG"
}
pass "set shorthand rejects missing values with JSON error"

if ./aos set voice.enabled true extra 2>"$STATE_ROOT/set-extra.err"; then
  fail "set shorthand accepted extra positional"
fi
grep -q '"code": "UNKNOWN_ARG"' "$STATE_ROOT/set-extra.err" || {
  cat "$STATE_ROOT/set-extra.err"
  fail "set shorthand extra positional did not use UNKNOWN_ARG"
}
grep -q '"error": "Unknown argument: extra"' "$STATE_ROOT/set-extra.err" || {
  cat "$STATE_ROOT/set-extra.err"
  fail "set shorthand extra positional message did not say Unknown argument"
}
pass "set shorthand rejects extra positional args with JSON error"

OUT="$(./aos config get voice.controls.cancel.key_code)"
[ "$OUT" = "53" ] || fail "expected default cancel key_code=53, got '$OUT'"
pass "config get reads daemon-owned voice cancel key"

OUT="$(./aos config get content.port)"
[ "$OUT" = "null" ] || fail "expected unset optional content.port=null, got '$OUT'"
pass "config get returns null for known but unset optional values"

if ./aos config get voice.enabled --bogus 2>"$STATE_ROOT/config-get-bogus.err"; then
  fail "config get accepted unknown flag"
fi
grep -q '"code": "UNKNOWN_FLAG"' "$STATE_ROOT/config-get-bogus.err" || {
  cat "$STATE_ROOT/config-get-bogus.err"
  fail "config get unknown flag did not use external JSON error contract"
}
pass "config get rejects unknown flags with JSON error"

if ./aos config get voice.enabled extra 2>"$STATE_ROOT/config-get-extra.err"; then
  fail "config get accepted extra positional"
fi
grep -q '"code": "UNKNOWN_ARG"' "$STATE_ROOT/config-get-extra.err" || {
  cat "$STATE_ROOT/config-get-extra.err"
  fail "config get extra positional did not use UNKNOWN_ARG"
}
grep -q '"error": "Unknown argument: extra"' "$STATE_ROOT/config-get-extra.err" || {
  cat "$STATE_ROOT/config-get-extra.err"
  fail "config get extra positional message did not say Unknown argument"
}
pass "config get rejects extra positional args with JSON error"

if ./aos config --bogus 2>"$STATE_ROOT/config-dump-bogus.err"; then
  fail "config accepted unknown flag"
fi
grep -q '"code": "UNKNOWN_FLAG"' "$STATE_ROOT/config-dump-bogus.err" || {
  cat "$STATE_ROOT/config-dump-bogus.err"
  fail "config unknown flag did not use external JSON error contract"
}
pass "config rejects unknown flags with JSON error"

if ./aos config set voice.enabled true --json 2>"$STATE_ROOT/config-set-bogus.err"; then
  fail "config set accepted unknown flag"
fi
grep -q '"code": "UNKNOWN_FLAG"' "$STATE_ROOT/config-set-bogus.err" || {
  cat "$STATE_ROOT/config-set-bogus.err"
  fail "config set unknown flag did not use external JSON error contract"
}
pass "config set rejects unknown flags with JSON error"

if ./aos config set voice.enabled true extra 2>"$STATE_ROOT/config-set-extra.err"; then
  fail "config set accepted extra positional"
fi
grep -q '"code": "UNKNOWN_ARG"' "$STATE_ROOT/config-set-extra.err" || {
  cat "$STATE_ROOT/config-set-extra.err"
  fail "config set extra positional did not use UNKNOWN_ARG"
}
grep -q '"error": "Unknown argument: extra"' "$STATE_ROOT/config-set-extra.err" || {
  cat "$STATE_ROOT/config-set-extra.err"
  fail "config set extra positional message did not say Unknown argument"
}
pass "config set rejects extra positional args with JSON error"

CORRUPT_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-config-corrupt.XXXXXX")"
mkdir -p "$CORRUPT_ROOT/repo"
printf '{not-json\n' >"$CORRUPT_ROOT/repo/config.json"
if AOS_STATE_ROOT="$CORRUPT_ROOT" ./aos config set voice.enabled false >"$CORRUPT_ROOT/config-set-corrupt.out" 2>"$CORRUPT_ROOT/config-set-corrupt.err"; then
  fail "config set accepted corrupt existing config"
fi
grep -q '"code": "CONFIG_INVALID"' "$CORRUPT_ROOT/config-set-corrupt.err" || {
  cat "$CORRUPT_ROOT/config-set-corrupt.err"
  fail "config set corrupt config did not use CONFIG_INVALID"
}
grep -q '{not-json' "$CORRUPT_ROOT/repo/config.json" || {
  cat "$CORRUPT_ROOT/repo/config.json"
  fail "config set corrupt config overwrote the existing file"
}
rm -rf "$CORRUPT_ROOT"
pass "config set refuses to overwrite corrupt existing config"

echo "config-surface: all checks passed"

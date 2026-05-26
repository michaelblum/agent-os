#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-introspect-review.XXXXXX")"
trap 'rm -rf "$STATE_ROOT"' EXIT

export AOS_STATE_ROOT="$STATE_ROOT"
export AOS_SESSION_ID="introspect-review-test"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; exit 1; }

OUT="$(./aos introspect review --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["OUT"])
assert payload["status"] == "ok", payload
assert payload["session"] == "introspect-review-test", payload
assert isinstance(payload["recommendations"], list), payload
PY
pass "introspect review emits JSON for the current session"

if ./aos introspect review --session 2>"$STATE_ROOT/missing-session.err"; then
  fail "introspect review accepted missing --session value"
fi
grep -q '"code": "MISSING_ARG"' "$STATE_ROOT/missing-session.err" || {
  cat "$STATE_ROOT/missing-session.err"
  fail "introspect review missing --session did not use JSON error contract"
}
pass "introspect review rejects missing --session with JSON error"

if ./aos introspect review --bogus 2>"$STATE_ROOT/bogus.err"; then
  fail "introspect review accepted unknown flag"
fi
grep -q '"code": "UNKNOWN_FLAG"' "$STATE_ROOT/bogus.err" || {
  cat "$STATE_ROOT/bogus.err"
  fail "introspect review unknown flag did not use JSON error contract"
}
pass "introspect review rejects unknown flags with JSON error"

echo "introspect-review: all checks passed"

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

OUT="$(./aos config get voice.controls.cancel.key_code)"
[ "$OUT" = "53" ] || fail "expected default cancel key_code=53, got '$OUT'"
pass "config get reads daemon-owned voice cancel key"

OUT="$(./aos config get content.port)"
[ "$OUT" = "null" ] || fail "expected unset optional content.port=null, got '$OUT'"
pass "config get returns null for known but unset optional values"

echo "config-surface: all checks passed"

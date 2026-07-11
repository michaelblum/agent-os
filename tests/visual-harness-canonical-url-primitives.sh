#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tests/lib/visual-harness.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_eq() {
  local expected="$1" actual="$2" label="$3"
  [[ "$expected" == "$actual" ]] || fail "$label: expected '$expected', got '$actual'"
}

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/aos-visual-url.XXXXXX")"
trap 'rm -rf "$tmpdir"' EXIT

unset AOS_TOOLKIT_CONTENT_ROOT AOS_VISUAL_CONTENT_ROOT_SCOPE
assert_eq "toolkit" "$(aos_visual_content_root_key toolkit)" "canonical toolkit root"
assert_eq \
  "aos://toolkit/components/surface-inspector/index.html" \
  "$(aos_visual_content_url toolkit components/surface-inspector/index.html)" \
  "toolkit URL"

if AOS_VISUAL_CONTENT_ROOT_SCOPE=branch aos_visual_content_root_key example 2>"$tmpdir/no-state.err"; then
  fail "branch-scoped roots must require an isolated state root"
fi
branch_key="$(AOS_STATE_ROOT="$tmpdir/state" AOS_VISUAL_CONTENT_ROOT_SCOPE=branch aos_visual_content_root_key example)"
[[ "$branch_key" == example_* ]] || fail "branch-scoped root did not use scoped form: $branch_key"

assert_eq \
  "aos://toolkit_manual/runtime/index.html" \
  "$(AOS_TOOLKIT_CONTENT_ROOT=toolkit_manual aos_visual_content_url "$(AOS_TOOLKIT_CONTENT_ROOT=toolkit_manual aos_visual_content_root_key toolkit)" runtime/index.html)" \
  "explicit toolkit root override"

aos_visual_urls_equivalent \
  "aos://example/runtime/index.html?mode=test" \
  "http://127.0.0.1:49152/example/runtime/index.html?mode=test"

if aos_visual_urls_equivalent \
  "aos://example/runtime/index.html?mode=test" \
  "http://127.0.0.1:49152/other/runtime/index.html?mode=test"; then
  fail "different content roots must not compare equivalent"
fi

echo "PASS: canonical visual URL primitives"

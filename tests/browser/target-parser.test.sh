#!/usr/bin/env bash
# Exercises src/browser/target-parser.swift through a focused pure Swift harness.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="$(mktemp -d)/browser-target-parser-harness"
trap 'rm -rf "$(dirname "$BIN")"' EXIT
swiftc \
    "$ROOT/src/browser/target-parser.swift" \
    "$ROOT/tests/fixtures/browser-target-parser-harness.swift" \
    -o "$BIN"

assert_parse() {
    local input="$1" expected_json="$2"
    local actual
    actual=$("$BIN" "$input" 2>&1)
    if [[ "$actual" != "$expected_json" ]]; then
        echo "FAIL: input '$input'" >&2
        echo "  expected: $expected_json" >&2
        echo "  actual:   $actual" >&2
        exit 1
    fi
}

assert_error() {
    local input="$1" expected_code="$2"
    local actual
    if actual=$("$BIN" "$input" 2>&1); then
        echo "FAIL: input '$input' — expected error but got success: $actual" >&2
        exit 1
    fi
    # exitError() pretty-prints JSON to stderr (spaces around ':'), so match
    # with a flexible regex rather than an exact-punctuation substring.
    if ! echo "$actual" | grep -Eq "\"code\"[[:space:]]*:[[:space:]]*\"$expected_code\""; then
        echo "FAIL: input '$input' — expected code $expected_code, got: $actual" >&2
        exit 1
    fi
}

# Happy paths
assert_parse "browser:todo" '{"ref":null,"session":"todo"}'
assert_parse "browser:todo-app/e21" '{"ref":"e21","session":"todo-app"}'
assert_parse "browser:todo-app/e34" '{"ref":"e34","session":"todo-app"}'

# Bare browser targets never inherit an ambient session.
assert_error "browser:" "MISSING_SESSION"

# Malformed inputs -> INVALID_TARGET
assert_error "browser" "INVALID_TARGET"
assert_error "browser://todo" "INVALID_TARGET"
assert_error "browser:todo/" "INVALID_TARGET"
assert_error "browser:todo/e21/extra" "INVALID_TARGET"
assert_error "" "INVALID_TARGET"

# ASCII-only validation: non-ASCII session names and refs rejected
assert_error "browser:sëssion" "INVALID_TARGET"
assert_error "browser:日本語" "INVALID_TARGET"
assert_error "browser:ñame/e1" "INVALID_TARGET"
assert_error "browser:app/ëe1" "INVALID_TARGET"
assert_error "browser:app/日本" "INVALID_TARGET"
assert_error "browser:app/button" "INVALID_TARGET"

if out=$("$BIN" "browser:todo" extra 2>&1); then
    echo "FAIL: expected extra argument error, got success: $out" >&2
    exit 1
fi
echo "$out" | grep -Eq '"code"[[:space:]]*:[[:space:]]*"UNKNOWN_ARG"' \
    || { echo "FAIL extra argument code: $out" >&2; exit 1; }

# Session names with hyphens, underscores, digits allowed
assert_parse "browser:todo_app-v2/e1" '{"ref":"e1","session":"todo_app-v2"}'

echo "PASS"

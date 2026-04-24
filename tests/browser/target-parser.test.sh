#!/usr/bin/env bash
# Exercises src/browser/target-parser.swift via the hidden _parse-target helper.
set -euo pipefail

assert_parse() {
    local input="$1" expected_json="$2"
    local actual
    actual=$(./aos browser _parse-target "$input" 2>&1)
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
    if actual=$(./aos browser _parse-target "$input" 2>&1); then
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

# Bare browser: with env var
PLAYWRIGHT_CLI_SESSION="default-sess" assert_parse "browser:" '{"ref":null,"session":"default-sess"}'

# Bare browser: without env var -> error
unset PLAYWRIGHT_CLI_SESSION
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

# Session names with hyphens, underscores, digits allowed
assert_parse "browser:todo_app-v2/e1" '{"ref":"e1","session":"todo_app-v2"}'

echo "PASS"

#!/usr/bin/env bash
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"
export FAKE_PWCLI_VERSION="0.9.9"
export FAKE_PWCLI_MODE="new"

check_verb() {
    local aos_verb="$1" expected_substring="$2"; shift 2
    out=$(./aos do "$aos_verb" "$@" 2>&1) || { echo "FAIL $aos_verb: exit non-zero: $out" >&2; exit 1; }
    echo "$out" | grep -q "$expected_substring" \
        || { echo "FAIL $aos_verb: expected '$expected_substring' in: $out" >&2; exit 1; }
}

check_verb click  "fake click invoked"      "browser:todo/e21"
check_verb hover  "fake hover invoked"      "browser:todo/e21"
check_verb scroll "fake mousewheel invoked" "browser:todo" "100,200"
check_verb type   "fake type invoked"       "browser:todo" "hello world"
check_verb key    "fake press invoked"      "browser:todo" "Enter"
check_verb drag   "fake drag invoked"       "browser:todo/e1" "browser:todo/e2"

assert_error_code() {
    local expected_code="$1"; shift
    local out
    if out=$(./aos "$@" 2>&1); then
        echo "FAIL $*: expected error $expected_code but got success: $out" >&2
        exit 1
    fi
    echo "$out" | grep -Eq "\"code\"[[:space:]]*:[[:space:]]*\"$expected_code\"" \
        || { echo "FAIL $*: expected code $expected_code in: $out" >&2; exit 1; }
}

assert_error_code UNKNOWN_ARG do click "browser:todo/e21" unexpected
assert_error_code UNKNOWN_ARG do hover "browser:todo/e21" unexpected
assert_error_code UNKNOWN_ARG do scroll "browser:todo" "100,200" unexpected
assert_error_code UNKNOWN_ARG do type "browser:todo" "hello" unexpected
assert_error_code UNKNOWN_ARG do key "browser:todo" "Enter" unexpected
assert_error_code UNKNOWN_ARG do drag "browser:todo/e1" "browser:todo/e2" unexpected
assert_error_code UNKNOWN_FLAG do click "browser:todo/e21" --bogus
assert_error_code MISSING_ARG do click "browser:todo/e21" --state-id --double

echo "PASS"

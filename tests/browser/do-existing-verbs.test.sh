#!/usr/bin/env bash
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"
export FAKE_PWCLI_VERSION="0.1.15"
export FAKE_PWCLI_MODE="new"
export AOS_STATE_ROOT="$(mktemp -d)"
trap 'rm -rf "$AOS_STATE_ROOT"' EXIT
PW_PACKAGE="$AOS_STATE_ROOT/node_modules/@playwright/cli"
mkdir -p "$PW_PACKAGE"
cp "$FIX/playwright-cli" "$PW_PACKAGE/playwright-cli"
printf '%s\n' '{"name":"@playwright/cli","version":"0.1.15"}' > "$PW_PACKAGE/package.json"
export AOS_PLAYWRIGHT_CLI="$PW_PACKAGE/playwright-cli"
node --input-type=module - <<'NODE'
import { recordBrowserCaptureGeneration } from './scripts/lib/target-handle-runtime.mjs'
import { resolveReviewedObservationRuntime } from './scripts/lib/playwright-cli-runtime.mjs'
const runtime = resolveReviewedObservationRuntime()
if (runtime.status !== 'ok') throw new Error(runtime.error)
recordBrowserCaptureGeneration(
  'todo',
  { state_id: 'see_test', elements: [{ ref: 'e21' }, { ref: 'e1' }, { ref: 'e2' }] },
  process.env,
  runtime.observation_identity,
)
NODE

check_verb() {
    local aos_verb="$1" expected_substring="$2"; shift 2
    out=$(node scripts/aos-do-browser.mjs "$aos_verb" "$@" 2>&1) || { echo "FAIL $aos_verb: exit non-zero: $out" >&2; exit 1; }
    echo "$out" | grep -q "$expected_substring" \
        || { echo "FAIL $aos_verb: expected '$expected_substring' in: $out" >&2; exit 1; }
}

check_verb scroll "fake mousewheel invoked" "browser:todo" "100,200"
check_verb type   "fake type invoked"       "browser:todo" "hello world"
check_verb key    "fake press invoked"      "browser:todo" "Enter"

assert_error_code() {
    local expected_code="$1"; shift
    local out
    [[ "${1:-}" == "do" ]] && shift
    if out=$(node scripts/aos-do-browser.mjs "$@" 2>&1); then
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
assert_error_code UNKNOWN_FLAG do click "browser:todo/e21" --dwell 25
assert_error_code MISSING_ARG do click "browser:todo/e21" --state-id --double
assert_error_code TARGET_STATE_REQUIRED do click "browser:todo/e21"
assert_error_code TARGET_ACTION_UNSUPPORTED do click "browser:todo/e21" --state-id see_test
assert_error_code TARGET_ACTION_UNSUPPORTED do hover "browser:todo/e21" --state-id see_test
assert_error_code TARGET_ACTION_UNSUPPORTED do drag "browser:todo/e1" "browser:todo/e2" --state-id see_test

echo "PASS"

#!/usr/bin/env bash
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"
export FAKE_PWCLI_VERSION="0.9.9"
export FAKE_PWCLI_MODE="new"
tmproot="/tmp/aos-focus-$$"
export AOS_STATE_ROOT="$tmproot"
export AOS_RUNTIME_MODE="repo"
trap 'rm -rf "$tmproot"' EXIT

# Case 1: create attach extension
out=$(./aos focus create --id test-attach --target browser://attach --extension 2>&1)
echo "$out" | grep -q '"status":[[:space:]]*"success"' || { echo "FAIL create: $out" >&2; exit 1; }

# Case 2: list includes browser kind
out=$(./aos focus list)
echo "$out" | jq -e '[.channels[]? // .data.channels[]? | select(.kind == "browser" and .id == "test-attach")] | length == 1' >/dev/null \
    || { echo "FAIL list: $out" >&2; exit 1; }

# Case 2b: browser entries must carry stable keys with null for missing
# optionals so agents can jq without conditional existence checks.
out=$(./aos focus list)
echo "$out" | jq -e '.channels[] | select(.id == "test-attach") | has("browser_window_id") and has("attach") and has("headless") and has("active_url")' >/dev/null \
    || { echo "FAIL null keys present: $out" >&2; exit 1; }
echo "$out" | jq -e '.channels[] | select(.id == "test-attach") | .browser_window_id == null and .headless == null and .active_url == null' >/dev/null \
    || { echo "FAIL null key values: $out" >&2; exit 1; }
echo "$out" | jq -e '.channels[] | select(.id == "test-attach") | .attach == "extension"' >/dev/null \
    || { echo "FAIL attach populated: $out" >&2; exit 1; }

# Case 2c: with AOS_TEST_BROWSER_WINDOW_ID injected, a new session's
# browser_window_id should be populated. This exercises the plumbing
# between focus create → resolveBrowserWindowID → registry; the real
# CG/eval match path is exercised by the opt-in smoke test.
AOS_TEST_BROWSER_WINDOW_ID=91234 ./aos focus create --id test-with-wid --target browser://attach --extension >/dev/null
out=$(./aos focus list)
echo "$out" | jq -e '.channels[] | select(.id == "test-with-wid") | .browser_window_id == 91234' >/dev/null \
    || { echo "FAIL window-id injection: $out" >&2; exit 1; }
./aos focus remove --id test-with-wid >/dev/null

# Case 3: create launched headed
out=$(./aos focus create --id test-launched --target browser://new 2>&1)
echo "$out" | grep -q '"status":[[:space:]]*"success"' || { echo "FAIL launched: $out" >&2; exit 1; }

# Case 4: remove browser channel
./aos focus remove --id test-attach >/dev/null
out=$(./aos focus list)
echo "$out" | jq -e '[.channels[]? // .data.channels[]? | select(.id == "test-attach")] | length == 0' >/dev/null \
    || { echo "FAIL remove: $out" >&2; exit 1; }

# Case 5: --target and --window mutually exclusive
if ./aos focus create --id oops --target browser://new --window 12345 2>/dev/null; then
    echo "FAIL exclusive: expected error" >&2; exit 1
fi

echo "PASS"
